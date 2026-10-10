import { money } from "@nova/shared";

/** Everything about a drilled view lives in the URL hash query, so a link to it shows the same thing. */

export const MEASURES = [
  { key: "sales", label: "Sales", fmt: money, additive: true },
  { key: "orders", label: "Orders", fmt: (v) => String(v), additive: true },
  { key: "avg_bill", label: "Average bill", fmt: money, additive: false },
  { key: "items", label: "Items sold", fmt: (v) => String(v), additive: true },
  { key: "discount", label: "Discounts", fmt: money, additive: true },
  { key: "tax", label: "GST", fmt: money, additive: true },
];
export const measureOf = (k) => MEASURES.find((m) => m.key === k) || MEASURES[0];

export const PALETTE = ["#133B40", "#EF4B2B", "#2E86AB", "#D69E00", "#7B4FA3", "#1B8548", "#C2547D", "#6B7B7A"];
export const OTHER_COLOR = "#A9B4B3";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ---------------------------------------------------------------- dates (Nova's days are India days)
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const todayIST = () => iso(new Date(Date.now() + 5.5 * 3600 * 1000));
export const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000) + 1;

export const PRESETS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "month", label: "This month" },
];
export function presetRange(id, today = todayIST()) {
  if (id === "today") return { from: today, to: today };
  if (id === "7d") return { from: addDays(today, -6), to: today };
  if (id === "30d") return { from: addDays(today, -29), to: today };
  if (id === "month") return { from: today.slice(0, 8) + "01", to: today };
  return null;
}
export function presetOf(from, to) {
  return PRESETS.find((p) => { const r = presetRange(p.id); return r.from === from && r.to === to; })?.id || "custom";
}
export const prettyDay = (s) => (s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
export const shortDay = (s) => (s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "");

// ---------------------------------------------------------------- state <-> hash query
/** The state of a drilled view. `lock` is a filter that cannot be removed (the restaurant when you are inside its page). */
export function readState(q, { lock, defaultBy }) {
  const today = todayIST();
  const dflt = presetRange("30d", today);
  const ok = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : null);
  let from = ok(q.get("from")) || dflt.from;
  let to = ok(q.get("to")) || dflt.to;
  if (from > to) [from, to] = [to, from];
  const filters = q.getAll("f").map((x) => { const i = x.indexOf(":"); return i > 0 ? { dim: x.slice(0, i), value: x.slice(i + 1) } : null; }).filter(Boolean);
  if (lock && !filters.some((f) => f.dim === lock.dim)) filters.unshift({ ...lock });
  const bill = (q.get("bill") || "").split("~");
  return {
    from,
    to,
    by: q.get("by") || defaultBy,
    m: measureOf(q.get("m")).key,
    filters,
    compare: q.get("cmp") !== "0",
    view: q.get("view") || "",
    bills: q.get("bills") === "1",
    page: Math.max(0, parseInt(q.get("page") || "0", 10) || 0),
    sort: ["created_at", "total", "net"].includes(q.get("sort")) ? q.get("sort") : "created_at",
    bill: bill.length === 2 && bill[0] && bill[1] ? { tid: bill[0], id: bill[1] } : null,
  };
}

/** Write a state back to a query. Defaults are left out to keep links short. Keeps unrelated keys (like a tab) untouched. */
export function writeState(s, { lock, defaultBy }) {
  const q = new URLSearchParams();
  q.set("from", s.from);
  q.set("to", s.to);
  if (s.by && s.by !== defaultBy) q.set("by", s.by);
  if (s.m !== "sales") q.set("m", s.m);
  for (const f of s.filters) if (!(lock && f.dim === lock.dim && f.value === lock.value)) q.append("f", `${f.dim}:${f.value}`);
  if (!s.compare) q.set("cmp", "0");
  if (s.view) q.set("view", s.view);
  if (s.bills) q.set("bills", "1");
  if (s.page) q.set("page", String(s.page));
  if (s.sort !== "created_at") q.set("sort", s.sort);
  if (s.bill) q.set("bill", `${s.bill.tid}~${s.bill.id}`);
  return q;
}

/** Query string for the API. */
export function apiQuery(s, extra = {}) {
  const q = new URLSearchParams();
  q.set("from", s.from);
  q.set("to", s.to);
  for (const f of s.filters) q.append("f", `${f.dim}:${f.value}`);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) q.set(k, String(v));
  return q.toString();
}

/** After clicking a slice of `by`, which dimension to look at next: the next one on the suggested path that is not already filtered. */
export function nextDimension(by, filters, path, dims) {
  const used = new Set(filters.map((f) => f.dim));
  used.add(by);
  const known = new Set(dims.map((d) => d.key));
  const list = path.filter((d) => known.has(d));
  const i = list.indexOf(by);
  const after = i >= 0 ? list.slice(i + 1) : list;
  return after.find((d) => !used.has(d)) || list.find((d) => !used.has(d)) || null;
}

export function valueLabel(dim, value, names = {}) {
  if (dim === "restaurant") return names[value] || value;
  if (dim === "weekday") return WEEKDAYS[Number(value)] || value;
  if (dim === "hour") return `${value}:00`;
  if (dim === "channel") return value === "online" ? "Online orders" : value === "counter" ? "Counter" : value;
  if (dim === "payment_mode") return value.length <= 4 ? value.toUpperCase() : value;
  if (dim === "status") return value.replace(/_/g, " ");
  if (dim === "customer") return value === "walk-in" ? "Walk-in" : value;
  if (dim === "day") return prettyDay(value);
  return value;
}

/** Change from previous to now, as a signed fraction. null when there is nothing to compare with. */
export function delta(now, prev) {
  if (prev === undefined || prev === null) return null;
  if (!prev) return now ? Infinity : 0;
  return (now - prev) / prev;
}
export function pct(f, digits = 1) {
  if (f === null) return "";
  if (!isFinite(f)) return "new";
  return `${f > 0 ? "+" : ""}${(f * 100).toFixed(Math.abs(f) < 0.1 ? digits : 0)}%`;
}
export const share = (f) => `${(f * 100).toFixed(f > 0 && f < 0.01 ? 1 : f < 0.1 ? 1 : 0)}%`;
