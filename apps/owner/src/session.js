// Staff session: restaurant code, tokens, one transparent refresh on 401, then sign out.
import { createClient, ApiError, applyBrand } from "@nova/shared";

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
export const FIXED_TENANT = (import.meta.env.VITE_TENANT || "").trim().toLowerCase();
export const ALLOWED_ROLES = ["owner", "manager", "cashier"];
const NS = "nova.owner.";

export const store = {
  get(k) { try { return localStorage.getItem(NS + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(NS + k, v); } catch { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem(NS + k); } catch { /* storage blocked */ } },
};

function readJson(k) { try { return JSON.parse(store.get(k) || "null"); } catch { return null; } }

export function decodeToken(t) {
  try {
    const b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(b + "=".repeat((4 - (b.length % 4)) % 4)))));
  } catch { return {}; }
}

let tokens = readJson("tokens");
let tenant = FIXED_TENANT || store.get("tenant") || "";
let email = store.get("email") || "";
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

export const getSession = () => (tokens ? { tenant, email, role: decodeToken(tokens.access_token).role, userId: decodeToken(tokens.access_token).sub } : null);
export const getTenant = () => tenant;
export const getEmail = () => email;
export const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
export function rememberTenant(code) { tenant = code.trim().toLowerCase(); if (!FIXED_TENANT) store.set("tenant", tenant); }

function setTokens(t) {
  tokens = t;
  if (t) store.set("tokens", JSON.stringify(t)); else store.del("tokens");
  emit();
}

const raw = createClient({ baseUrl: API_BASE, getToken: () => tokens && tokens.access_token });

export async function login(code, mail, password) {
  rememberTenant(code);
  const r = await raw.post("/v2/auth/login", { tenant: tenant, email: mail.trim(), password }, { headers: { Authorization: "" } });
  email = mail.trim();
  store.set("email", email);
  const role = decodeToken(r.access_token).role;
  if (!ALLOWED_ROLES.includes(role)) {
    throw new ApiError(403, "WRONG_APP", "This account cannot use this app. Use the app made for your role.");
  }
  setTokens({ access_token: r.access_token, refresh_token: r.refresh_token });
}

export function signOut() {
  const rt = tokens && tokens.refresh_token;
  setTokens(null);
  if (rt) raw.post("/v2/auth/logout", { tenant, refresh_token: rt }).catch(() => {});
}

let refreshing = null;
function refresh() {
  if (!tokens || !tokens.refresh_token) return Promise.reject(new Error("no refresh token"));
  if (!refreshing) {
    refreshing = createClient({ baseUrl: API_BASE })
      .post("/v2/auth/refresh", { tenant, refresh_token: tokens.refresh_token })
      .then((r) => setTokens({ access_token: r.access_token, refresh_token: r.refresh_token }))
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function call(method, path, a, b) {
  const run = () => (method === "get" || method === "del" ? raw[method](path, a) : raw[method](path, a, b));
  try {
    return await run();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && tokens) {
      try { await refresh(); } catch { signOut(); throw e; }
      try { return await run(); } catch (e2) { if (e2 instanceof ApiError && e2.status === 401) signOut(); throw e2; }
    }
    throw e;
  }
}

export const api = {
  get: (p, o) => call("get", p, o),
  post: (p, body, o) => call("post", p, body, o),
  put: (p, body, o) => call("put", p, body, o),
  patch: (p, body, o) => call("patch", p, body, o),
  del: (p, o) => call("del", p, o),
};

/** Public storefront config of the restaurant (brand, address, origin). Applies the brand colours and fonts. */
export async function loadBrand(code) {
  const sf = await createClient({ baseUrl: API_BASE }).get(`/v2/public/${encodeURIComponent(code)}/storefront`);
  applyBrand(sf.brand || {});
  return sf;
}

export { ApiError };
