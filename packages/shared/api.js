/** Tiny fetch client for the Nova API. No dependencies; works in the browser and in Capacitor.
 *  Errors are normalised to `ApiError { status, code, message, details }` so screens can branch on stable codes. */
export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const NETWORK = "Cannot reach the server. Check your internet and try again.";

export function createClient({ baseUrl, getToken = () => null, onUnauthorized = () => {}, timeoutMs = 15000 }) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request(method, path, { body, headers = {}, query } = {}) {
    const url = new URL(root + path, typeof location !== "undefined" ? location.href : undefined);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    const token = await getToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, e.name === "AbortError" ? "TIMEOUT" : "NETWORK", e.name === "AbortError" ? "The server took too long to answer." : NETWORK);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    if (!res.ok) {
      const d = data && data.detail;
      // our errors: {code, message, ...extra}; FastAPI validation errors: [{msg, loc}]
      const err = d && typeof d === "object" && !Array.isArray(d)
        ? new ApiError(res.status, d.code || "ERROR", d.message || "Something went wrong", d)
        : new ApiError(res.status, Array.isArray(d) ? "VALIDATION" : "ERROR", Array.isArray(d) ? d.map((x) => x.msg).join(", ") : typeof d === "string" ? d : "Something went wrong");
      if (res.status === 401) onUnauthorized(err);
      throw err;
    }
    return data;
  }

  return {
    get: (p, o) => request("GET", p, o),
    post: (p, body, o) => request("POST", p, { ...o, body: body ?? {} }),
    put: (p, body, o) => request("PUT", p, { ...o, body }),
    patch: (p, body, o) => request("PATCH", p, { ...o, body }),
    del: (p, o) => request("DELETE", p, o),
  };
}
