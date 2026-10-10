import { useEffect, useState } from "react";

/** Tiny hash router: "#/restaurants/abc/payments" -> ["restaurants", "abc", "payments"]. Works on any static host. */
const parse = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "").split("/").filter(Boolean).map(decodeURIComponent);

export function useRoute() {
  const [parts, setParts] = useState(parse);
  useEffect(() => {
    const f = () => { setParts(parse()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return parts;
}

export const go = (path) => { location.hash = path; };
export const href = (path) => "#" + path;
