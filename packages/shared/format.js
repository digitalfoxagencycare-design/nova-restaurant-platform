/** Money is integer paise on the wire. Show rupees; show paise only when there are some. */
export function money(paise, currency = "INR") {
  const v = (Number(paise) || 0) / 100;
  const frac = Math.abs(v - Math.round(v)) > 0.004;
  const s = v.toLocaleString("en-IN", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
  return (currency === "INR" ? "₹" : currency + " ") + s;
}

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

export function timeOf(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
}
export function dateOf(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
}
export function ago(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/** Order states shown to people. Keep wording short; colours come from the apps. */
export const ORDER_STATE = {
  placed: "Order placed",
  preparing: "Being prepared",
  ready: "Ready",
  out_for_delivery: "On the way",
  served: "Served",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const FINAL_STATES = ["delivered", "completed", "cancelled"];

export function mapsLink({ lat, lng, text }) {
  return lat != null && lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text || "")}`;
}
