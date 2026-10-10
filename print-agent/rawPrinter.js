"use strict";
// Sends raw ESC/POS bytes to a printer. Printer names are never put into a shell string: they travel in an
// environment variable (Windows) or as a separate argv entry (CUPS), so a hostile name cannot run commands.
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const DRIVER = process.env.PRINT_AGENT_DRIVER || (process.platform === "win32" ? "winspool" : "cups");
const PS_SEND = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class RawPrn {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFOW { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, IntPtr b, int n, out int w);
  public static bool Send(string name, byte[] data) {
    IntPtr h; if (!OpenPrinter(name, out h, IntPtr.Zero)) return false;
    var di = new DOCINFOW(); di.pDocName = "Nova receipt"; di.pDataType = "RAW"; bool ok = false;
    if (StartDocPrinter(h, 1, di)) { if (StartPagePrinter(h)) { IntPtr p = Marshal.AllocCoTaskMem(data.Length); Marshal.Copy(data, 0, p, data.Length); int w; ok = WritePrinter(h, p, data.Length, out w); Marshal.FreeCoTaskMem(p); EndPagePrinter(h); } EndDocPrinter(h); }
    ClosePrinter(h); return ok;
  }
}
"@
$bytes = [System.IO.File]::ReadAllBytes($env:NOVA_PRINT_FILE)
if (-not [RawPrn]::Send($env:NOVA_PRINTER, $bytes)) { Write-Error "Printer rejected the job"; exit 2 }
`;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `exit ${code}`))));
  });
}

async function listPrinters() {
  if (DRIVER === "winspool") {
    try {
      const out = await run("powershell", ["-NoProfile", "-Command", "Get-Printer | Select-Object Name,DriverName,PortName | ConvertTo-Json -Compress"]);
      const j = JSON.parse(out || "[]");
      return (Array.isArray(j) ? j : [j]).map((p) => ({ name: p.Name, driver: p.DriverName, port: p.PortName }));
    } catch { return []; }
  }
  if (DRIVER === "cups") {
    try {
      const out = await run("lpstat", ["-e"]);
      return out.split("\n").filter(Boolean).map((n) => ({ name: n.trim() }));
    } catch { return []; }
  }
  return [{ name: "file" }];
}

async function findThermal() {
  const all = await listPrinters();
  const pick = all.find((p) => /tvs|rp\s*3[12]00|thermal|pos|receipt|star|epson|tm-/i.test(`${p.name} ${p.driver || ""}`)) || all[0];
  return pick ? pick.name : null;
}

function isPrivateHost(h) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === "127.0.0.1";
}

async function sendNetwork(host, port, buf) {
  if (!isPrivateHost(host)) throw new Error("Network printers must be on the local network");
  await new Promise((resolve, reject) => {
    const s = net.connect({ host, port, timeout: 5000 }, () => s.end(buf, resolve));
    s.on("timeout", () => { s.destroy(); reject(new Error("Printer did not answer")); });
    s.on("error", reject);
  });
}

async function printRaw({ printerName, host, port, buffer }) {
  if (host) { await sendNetwork(host, Number(port) || 9100, buffer); return { printer: `${host}:${port || 9100}` }; }
  const name = printerName || (await findThermal());
  if (DRIVER === "file") {
    const dir = process.env.PRINT_AGENT_FILE_DIR || os.tmpdir();
    const f = path.join(dir, `nova-print-${Date.now()}.bin`);
    fs.writeFileSync(f, buffer);
    return { printer: f };
  }
  if (!name) throw new Error("No printer found. Install the printer driver and try again.");
  if (DRIVER === "cups") {
    await new Promise((resolve, reject) => {
      const p = spawn("lp", ["-d", name, "-o", "raw"]);
      let err = ""; p.stderr.on("data", (d) => (err += d)); p.on("error", reject);
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err.trim() || "lp failed"))));
      p.stdin.end(buffer);
    });
    return { printer: name };
  }
  const tmp = path.join(os.tmpdir(), `nova_${process.pid}_${Date.now()}.bin`);
  fs.writeFileSync(tmp, buffer);
  try {
    await run("powershell", ["-NoProfile", "-Command", PS_SEND], { env: { ...process.env, NOVA_PRINT_FILE: tmp, NOVA_PRINTER: name } });
  } finally { fs.rmSync(tmp, { force: true }); }
  return { printer: name };
}

module.exports = { listPrinters, findThermal, printRaw, isPrivateHost, DRIVER };
