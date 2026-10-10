"use strict";
process.env.PRINT_AGENT_DRIVER = "file";
process.env.PRINT_AGENT_FILE_DIR = require("node:os").tmpdir();
process.env.PRINT_AGENT_ALLOWED_ORIGINS = "https://pos.example.com";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { server } = require("../server");
const { isPrivateHost } = require("../rawPrinter");

let base;
test.before(() => new Promise((r) => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => server.close());

test("prints the bytes it is given, for an allowed origin", async () => {
  const bytes = Buffer.from([0x1b, 0x40, 0x48, 0x69, 0x0a]);
  const r = await fetch(`${base}/print-raw`, { method: "POST", headers: { Origin: "https://pos.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ data: bytes.toString("base64") }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://pos.example.com");
  assert.deepEqual(fs.readFileSync(j.printer), bytes);
});

test("another website in the browser cannot print", async () => {
  const r = await fetch(`${base}/print-raw`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ data: "G0A=" }) });
  assert.equal(r.status, 403);
});

test("rejects bad payloads and oversized jobs", async () => {
  const h = { Origin: "https://pos.example.com", "Content-Type": "application/json" };
  assert.equal((await fetch(`${base}/print-raw`, { method: "POST", headers: h, body: "nope" })).status, 400);
  assert.equal((await fetch(`${base}/print-raw`, { method: "POST", headers: h, body: JSON.stringify({ data: "not base64!!" }) })).status, 400);
  assert.equal((await fetch(`${base}/print-raw`, { method: "POST", headers: h, body: JSON.stringify({ data: "A".repeat(400000) }) })).status, 413);
});

test("network printers must be on the local network", () => {
  assert.ok(isPrivateHost("192.168.1.50") && isPrivateHost("10.0.0.7"));
  assert.ok(!isPrivateHost("8.8.8.8") && !isPrivateHost("169.254.169.254"));
});
