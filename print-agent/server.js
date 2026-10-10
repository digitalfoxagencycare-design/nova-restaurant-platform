"use strict";
// Nova print agent: the cashier's browser POSTs ESC/POS bytes (made by the Nova backend) to http://127.0.0.1:8989
// and this writes them to the thermal printer. It only listens on this computer, and only answers the origins you list.
const http = require("node:http");
const { listPrinters, findThermal, printRaw, DRIVER } = require("./rawPrinter");

const PORT = Number(process.env.PRINT_AGENT_PORT || 8989);
const MAX_BYTES = 256 * 1024;
const ALLOWED = (process.env.PRINT_AGENT_ALLOWED_ORIGINS || "http://localhost:8000,http://127.0.0.1:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);
if (ALLOWED.includes("*")) { console.error("Refusing to start: PRINT_AGENT_ALLOWED_ORIGINS must list real origins, not *"); process.exit(1); }

function send(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED.includes(origin)) return send(res, 403, { error: "This website is not allowed to print" });
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true"); // Chrome: https site -> localhost
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    if (req.method === "GET" && req.url === "/status") {
      return send(res, 200, { status: "online", version: "1.0.0", driver: DRIVER, printer: await findThermal() });
    }
    if (req.method === "GET" && req.url === "/printers") return send(res, 200, { printers: await listPrinters() });
    if (req.method === "POST" && req.url === "/print-raw") {
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > MAX_BYTES) return send(res, 413, { error: "Print job is too large" }); chunks.push(c); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { error: "Send JSON" }); }
      if (typeof body.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(body.data)) return send(res, 400, { error: "data must be base64" });
      const buffer = Buffer.from(body.data, "base64");
      if (!buffer.length) return send(res, 400, { error: "Empty print job" });
      const copies = Math.min(Math.max(parseInt(body.copies || 1, 10) || 1, 1), 3);
      let r;
      for (let i = 0; i < copies; i++) r = await printRaw({ printerName: body.printerName, host: body.host, port: body.port, buffer });
      console.log(`printed ${buffer.length} bytes x${copies} -> ${r.printer}`);
      return send(res, 200, { success: true, printer: r.printer, bytes: buffer.length });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error("print error:", e.message);
    send(res, 500, { success: false, error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => console.log(`Nova print agent on http://127.0.0.1:${PORT} (driver: ${DRIVER}, origins: ${ALLOWED.join(", ")})`));
}
module.exports = { server };
