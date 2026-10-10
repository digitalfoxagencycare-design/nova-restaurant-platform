import { useEffect, useState } from "react";

/** Tiny hash router: "#/restaurants/abc/payments?x=1" -> ["restaurants", "abc", "payments"]. Works on any static host. */
const parse = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "").split("/").filter(Boolean).map(decodeURIComponent);

export function useRoute() {
  const [parts, setParts] = useState(parse);
  useEffect(() => {
    let last = parts.join("/");
    const f = () => {
      const next = parse();
      const key = next.join("/");
      // Only a change of page scrolls to the top; changing the query (drilling into a chart) must keep your place.
      if (key !== last) window.scrollTo(0, 0);
      last = key;
      setParts((p) => (p.join("/") === key ? p : next));
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return parts;
}

/** The "?a=1&b=2" part of the hash as URLSearchParams, re-read on every hash change. */
const readQuery = () => new URLSearchParams(location.hash.split("?")[1] || "");
export function useHashQuery() {
  const [q, setQ] = useState(() => location.hash.split("?")[1] || "");
  useEffect(() => {
    const f = () => setQ(location.hash.split("?")[1] || "");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return new URLSearchParams(q);
}
export { readQuery };

/** Change only the query of the current page. `replace` keeps the Back button for real steps only (a new layer is a step; sorting is not). */
export function setHashQuery(params, { replace = false } = {}) {
  const base = location.hash.split("?")[0] || "#/";
  const qs = params.toString();
  const next = base + (qs ? "?" + qs : "");
  if (next === location.hash) return;
  if (replace) {
    history.replaceState(null, "", next);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = next;
  }
}

export const go = (path) => { location.hash = path; };
export const href = (path) => "#" + path;
