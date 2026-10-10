import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@nova/shared";

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const KEY = "nova.ops.session";

// ---------------------------------------------------------------- session (sessionStorage only, 30 minute token, no refresh)
function read() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return s && s.token ? s : null;
  } catch {
    return null;
  }
}
export function getSession() {
  const s = read();
  return s && s.exp > Date.now() ? s : null;
}
function claims(token) {
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}
export function saveSession(email, token, expiresIn) {
  const c = claims(token);
  const s = { token, email, role: c.role || c.roles?.[0] || "", exp: Date.now() + (expiresIn || 1800) * 1000 };
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  emit();
  return s;
}
export function clearSession() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  emit();
}
const subs = new Set();
const emit = () => subs.forEach((f) => f());
export function onSessionChange(f) {
  subs.add(f);
  return () => subs.delete(f);
}

export const sessionState = { expired: false };

export const api = createClient({
  baseUrl: API_BASE,
  getToken: () => getSession()?.token,
  onUnauthorized: () => {
    // A 401 while signed in means the 30 minute token ran out. (A wrong password on the sign-in form is handled there.)
    if (read()) {
      sessionState.expired = true;
      clearSession();
    }
  },
});

/** Upload raw bytes (the logo). The shared client only sends JSON, so this one call uses fetch directly. */
export async function uploadLogo(id, blob) {
  let res;
  try {
    res = await fetch(`${API_BASE}/v2/platform/tenants/${id}/logo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getSession()?.token || ""}`, "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
  } catch {
    throw Object.assign(new Error("Cannot reach the server. Check your internet and try again."), { code: "NETWORK" });
  }
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    if (res.status === 401 && read()) { sessionState.expired = true; clearSession(); }
    const d = data?.detail;
    throw Object.assign(new Error(d?.message || (typeof d === "string" ? d : "The logo could not be saved.")), { code: d?.code || "ERROR", status: res.status });
  }
  return data;
}

/** Download a file the API makes (CSV) with the sign-in token, then hand it to the browser as a Blob. */
export async function downloadAuthed(path, fallbackName) {
  let res;
  try {
    res = await fetch(API_BASE + path, { headers: { Authorization: `Bearer ${getSession()?.token || ""}` } });
  } catch {
    throw Object.assign(new Error("Cannot reach the server. Check your internet and try again."), { code: "NETWORK" });
  }
  if (!res.ok) {
    let d = null;
    try { d = (await res.json())?.detail; } catch { /* not json */ }
    if (res.status === 401 && read()) { sessionState.expired = true; clearSession(); }
    throw Object.assign(new Error(d?.message || "The file could not be made."), { code: d?.code || "ERROR", status: res.status });
  }
  const blob = await res.blob();
  const name = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { name, truncated: res.headers.get("X-Truncated") === "true" };
}

const FRIENDLY = {
  TOO_MANY_ROWS: (e) => e.message,
  BAD_RANGE: (e) => e.message,
  BAD_DATE: (e) => e.message,
  NETWORK: () => "We cannot reach the Nova server. Check your internet connection and try again.",
  TIMEOUT: () => "The server is taking too long to answer. Please try again in a moment.",
  SLUG_TAKEN: () => "That web address is already used by another restaurant. Please choose a different one.",
  BAD_SLUG: () => "The web address can only use small letters, numbers and dashes, 3 to 40 characters.",
  INVALID_CONFIG: (e) => `Some of the details are not accepted: ${e.message}`,
  CONFIG_CONFLICT: () => "Someone changed this restaurant a moment ago. We have loaded the latest version; please make your change again.",
  FORBIDDEN: () => "Your account is allowed to look but not to change this. Ask the Nova owner to do it.",
  NOT_FOUND: () => "We could not find that. It may have been removed.",
  TOO_MANY: () => "Too many tries in a short time. Please wait a little and try again.",
  WHATSAPP_NOT_CONNECTED: () => "WhatsApp is not connected yet. Save the phone number id and the access token first.",
  UNKNOWN_SECRET: () => "That key name is not allowed.",
  INVITE_INVALID: () => "That sign-up code is not valid or has expired.",
};

/** One plain sentence for any error from the API. */
export function niceError(e) {
  if (!e) return "Something went wrong. Please try again.";
  if (e.status === 401) return "Please sign in again.";
  if (e.status === 403 && !FRIENDLY[e.code]) return FRIENDLY.FORBIDDEN();
  const f = FRIENDLY[e.code];
  if (f) return f(e);
  if (e.code === "VALIDATION") return `Please check what you typed: ${e.message}.`;
  if (e.status >= 500) return "Something went wrong on the Nova server. Please try again, and tell the Nova developer if it keeps happening.";
  return e.message || "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------- data hook
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(
    (quiet) => {
      const n = ++seq.current;
      if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
      return fn().then(
        (data) => n === seq.current && setState({ data, error: null, loading: false }),
        (error) => n === seq.current && setState((s) => ({ data: quiet ? s.data : null, error, loading: false })),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: () => run(true), retry: () => run(false) };
}

// ---------------------------------------------------------------- small helpers
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement("textarea");
      t.value = text;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadFile(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const logoSrc = (url) => (url ? (/^https?:/.test(url) ? url : API_BASE + url) : "");
export const storefrontLink = (links, slug) => (links && links.storefront) || `${location.origin}/s/${slug}`;

export function draft(key) {
  return {
    load() { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } },
    save(v) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* too big or private mode */ } },
    clear() { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
  };
}
