"use strict";
/* API client: tokens, refresh, readable errors; and the bridge to the thermal-printer agent on this computer. */
const AUTH = { tenant: localStorage.getItem("nova_tenant") || "", access: null };
const AGENT_URL = "http://127.0.0.1:8989";

class ApiErr extends Error {
  constructor(status, detail) {
    super(status === 403 && detail && detail.code === "FORBIDDEN" ? "You do not have permission to do that. Ask a manager." : (detail && detail.message) || "Something went wrong. Please try again.");
    this.status = status; this.detail = detail || {}; this.code = this.detail.code || "ERROR";
  }
}

async function rawFetch(method, path, body, headers = {}) {
  const r = await fetch(path, {
    method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(AUTH.access ? { Authorization: `Bearer ${AUTH.access}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new ApiErr(r.status, j && (j.detail && typeof j.detail === "object" && !Array.isArray(j.detail) ? j.detail : { message: Array.isArray(j?.detail) ? "Please check what you entered." : j?.detail }));
  return j;
}

let refreshing = null;
async function refreshTokens() {
  const rt = sessionStorage.getItem("nova_rt");
  if (!rt || !AUTH.tenant) throw new ApiErr(401, { code: "UNAUTHORIZED", message: "Please log in again." });
  refreshing = refreshing || rawFetch("POST", "/v2/auth/refresh", { tenant: AUTH.tenant, refresh_token: rt })
    .then((t) => { AUTH.access = t.access_token; sessionStorage.setItem("nova_rt", t.refresh_token); })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function api(method, path, body, headers) {
  try { return await rawFetch(method, path, body, headers); } catch (e) {
    if (e.status === 401 && path !== "/v2/auth/login" && sessionStorage.getItem("nova_rt")) {
      try { await refreshTokens(); } catch { sessionStorage.removeItem("nova_rt"); AUTH.access = null; window.dispatchEvent(new Event("nova-logout")); throw e; }
      return rawFetch(method, path, body, headers);
    }
    throw e;
  }
}

async function login(tenant, email, password) {
  const t = await rawFetch("POST", "/v2/auth/login", { tenant, email, password });
  AUTH.tenant = tenant; localStorage.setItem("nova_tenant", tenant);
  AUTH.access = t.access_token; sessionStorage.setItem("nova_rt", t.refresh_token);
}

async function resume() {
  if (!sessionStorage.getItem("nova_rt")) return false;
  try { await refreshTokens(); return true; } catch { return false; }
}

async function logout() {
  const rt = sessionStorage.getItem("nova_rt");
  try { if (rt) await rawFetch("POST", "/v2/auth/logout", { tenant: AUTH.tenant, refresh_token: rt }); } catch { /* already gone */ }
  sessionStorage.removeItem("nova_rt"); AUTH.access = null;
}

/* ---- thermal printer agent (TVS RP 3200 and other ESC/POS printers) ---- */
const agent = {
  online: false, printer: null,
  async status() {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(`${AGENT_URL}/status`, { signal: ctl.signal }); clearTimeout(t);
      const j = await r.json(); this.online = j.status === "online"; this.printer = j.printer || null;
    } catch { this.online = false; this.printer = null; }
    return this.online;
  },
  async send(job) {
    /* job = {data(base64), printer:{windows_name, copies}} as returned by the Nova API */
    if (!this.online && !(await this.status())) throw new Error("The printer app is not running on this computer. Start it and try again.");
    const r = await fetch(`${AGENT_URL}/print-raw`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: job.data, printerName: (job.printer && job.printer.windows_name) || undefined, copies: (job.printer && job.printer.copies) || 1 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "The printer did not accept the job");
    return j;
  },
};
