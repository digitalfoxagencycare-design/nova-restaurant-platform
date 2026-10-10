import { Capacitor } from "@capacitor/core";

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
export const BUILD_TENANT = (import.meta.env.VITE_TENANT || "").trim();

export const isNative = (() => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
})();

const CODE = /^[a-z0-9][a-z0-9-]{1,60}$/i;
const clean = (c) => (c && CODE.test(c) ? c.toLowerCase() : "");

/** Where am I? `/s/<code>[/about]` or `/` on the web; always the build tenant inside the Android app. */
export function readLocation(loc = window.location) {
  const parts = loc.pathname.split("/").filter(Boolean);
  const q = new URLSearchParams(loc.search);
  let code = "";
  let page = "store";
  if (!isNative && parts[0] === "s") {
    code = clean(parts[1]);
    if (parts[2] === "about") page = "landing";
  } else if (!isNative) {
    code = clean(q.get("t")) || BUILD_TENANT.toLowerCase();
    page = parts.length === 0 ? "landing" : "store";
  }
  if (isNative || !code) code = code || BUILD_TENANT.toLowerCase();
  if (isNative) page = "store";
  const table = (q.get("table") || "").trim().slice(0, 12);
  return { code, page, table, fromUrl: !!clean(parts[0] === "s" ? parts[1] : q.get("t")) };
}

export function storeUrl(code, table) {
  if (isNative) return "/";
  return `/s/${code}${table ? `?table=${encodeURIComponent(table)}` : ""}`;
}
export function aboutUrl(code) {
  return `/s/${code}/about`;
}
