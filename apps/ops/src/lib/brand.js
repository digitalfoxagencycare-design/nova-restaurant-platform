import { NOVA_DEFAULT, onColor } from "@nova/shared";

export const PALETTES = [
  { name: "Nova", primary: "#EF4B2B", secondary: "#133B40", background: "#F5F7F7", foreground: "#10201F", muted: "#E4EAEA" },
  { name: "Saffron spice", primary: "#E8590C", secondary: "#3B1F0E", background: "#FFF8EE", foreground: "#2B1A0F", muted: "#F1E3CF" },
  { name: "Garden green", primary: "#2E7D32", secondary: "#14361A", background: "#F4F8F1", foreground: "#14241A", muted: "#DDE8D7" },
  { name: "Royal maroon", primary: "#9B1C31", secondary: "#3D0F18", background: "#FBF5F1", foreground: "#2A1216", muted: "#EBDCD5" },
  { name: "Ocean blue", primary: "#0B6EBD", secondary: "#0B2A4A", background: "#F3F8FC", foreground: "#0F1F2E", muted: "#D9E6F1" },
  { name: "Charcoal and gold", primary: "#C79A2B", secondary: "#1E1E22", background: "#FAF8F3", foreground: "#1A1A1C", muted: "#E8E3D6" },
  { name: "Berry", primary: "#B02A74", secondary: "#3A1230", background: "#FCF5F9", foreground: "#2A1424", muted: "#EEDCE7" },
  { name: "Fresh lime", primary: "#6AA121", secondary: "#1F3D2B", background: "#F7FAEF", foreground: "#1B2A1B", muted: "#E2EBD0" },
  { name: "Midnight purple", primary: "#6D3FD0", secondary: "#1D1440", background: "#F6F4FD", foreground: "#1B1630", muted: "#E1DCF2" },
];

export const FONTS = ["Bricolage Grotesque", "Figtree", "Poppins", "Playfair Display", "Montserrat", "Lora", "DM Sans", "Merriweather", "Nunito"];

let fontsLoaded = false;
/** Load the curated fonts once so the preview shows the real thing. */
export function loadPreviewFonts() {
  if (fontsLoaded || typeof document === "undefined") return;
  fontsLoaded = true;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?" + FONTS.map((f) => "family=" + f.replace(/ /g, "+") + ":wght@400;600;700").join("&") + "&display=swap";
  document.head.appendChild(l);
}

export const COLOR_FIELDS = [
  { key: "primary", label: "Button colour", hint: "Used for the Add button and highlights" },
  { key: "secondary", label: "Header colour", hint: "The top bar and the basket bar" },
  { key: "background", label: "Page background", hint: "Behind the menu" },
  { key: "foreground", label: "Text colour", hint: "Dish names and descriptions" },
  { key: "muted", label: "Lines and cards", hint: "Borders and soft panels" },
];

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v || "");
export function ratio(a, b) {
  if (!isHex(a) || !isHex(b)) return 21;
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Plain-language problems with a colour choice. `fix` tells the screen what button to offer. */
export function contrastWarnings(c) {
  const out = [];
  const r1 = ratio(c.foreground, c.background);
  if (r1 < 4.5) out.push({ id: "text", text: `The text colour is hard to read on the page background (readability ${r1.toFixed(1)}, it should be at least 4.5). Dish names and descriptions would be difficult to see.`, fix: { label: "Pick a readable text colour", set: { foreground: onColor(c.background) } } });
  const r2 = ratio(c.foreground, c.muted);
  if (r1 >= 4.5 && r2 < 4.5) out.push({ id: "cards", text: `Text on the cards and soft panels is hard to read (readability ${r2.toFixed(1)}). Choose a lighter "lines and cards" colour or a darker text colour.` });
  const r3 = ratio(onColor(c.primary), c.primary);
  if (r3 < 3) out.push({ id: "button", text: `Words on the buttons are hard to read (readability ${r3.toFixed(1)}). Choose a darker or lighter button colour.` });
  const r4 = ratio(onColor(c.secondary), c.secondary);
  if (r4 < 3) out.push({ id: "header", text: `The restaurant name in the header is hard to read (readability ${r4.toFixed(1)}). Choose a darker or lighter header colour.` });
  const r5 = ratio(c.primary, c.background);
  if (r5 < 2) out.push({ id: "blend", text: `The button colour is almost the same as the page background, so buttons will not stand out. Pick a stronger button colour.` });
  return out;
}

export const slugify = (name) =>
  (name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

export const SLUG_RE = /^[a-z0-9-]{3,40}$/;
export const monogram = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export const PLANS = [
  { id: "starter", label: "Starter", hint: "For a single restaurant getting started" },
  { id: "growth", label: "Growth", hint: "More staff and busier restaurants" },
  { id: "pro", label: "Pro", hint: "Everything, for bigger restaurants" },
];

// ---------------------------------------------------------------- form <-> config
const str = (v) => (v == null ? "" : String(v));

export function formFromConfig(cfg = {}) {
  const b = cfg.brand || {};
  const o = cfg.ordering || {};
  const d = cfg.delivery || {};
  const t = cfg.tax || {};
  const p = cfg.payments || {};
  const methods = p.methods || [];
  return {
    name: str(b.name),
    tagline: str(b.tagline),
    colors: { ...NOVA_DEFAULT, ...(b.colors || {}) },
    fonts: { heading: (b.fonts || {}).heading || "Bricolage Grotesque", body: (b.fonts || {}).body || "Figtree" },
    address: str(b.address),
    hours: str(b.hours),
    phone: str((b.support || {}).phone),
    email: str((b.support || {}).email),
    mapUrl: str(b.map_url),
    channels: o.channels || ["dine-in", "takeaway", "delivery"],
    minOrder: str(o.min_order ?? 0),
    prep: str(o.prep_minutes ?? 25),
    maxKm: str(d.max_km ?? 5),
    freeAbove: str(d.free_above ?? ""),
    slabs: (d.fee_slabs || []).map((s) => ({ km: str(s.up_to_km), fee: str(s.fee) })),
    lat: d.origin ? str(d.origin.lat) : "",
    lng: d.origin ? str(d.origin.lng) : "",
    taxMode: t.mode || "inclusive",
    taxRate: str(Math.round((t.default_rate ?? 0.05) * 1000) / 10),
    gstin: str(t.gstin),
    cod: p.cod ? p.cod.enabled !== false : methods.includes("cod"),
    online: methods.includes("razorpay"),
    tables: str(((cfg.pos || {}).tables || []).length),
  };
}

const num = (v) => (v === "" || v == null ? NaN : Number(v));

/** Check the form. Returns {field: message}. `part` limits the check to a screen: look, contact, selling. */
export function validateForm(f, part) {
  const e = {};
  if (part === "look" || !part) {
    if (!f.name.trim()) e.name = "Please enter the restaurant name.";
    for (const c of COLOR_FIELDS) if (!isHex(f.colors[c.key])) e["color_" + c.key] = "Use a colour like #EF4B2B.";
    if (f.tagline.length > 80) e.tagline = "Keep the tagline under 80 letters.";
  }
  if (part === "contact" || !part) {
    if (f.address.length > 200) e.address = "The address is too long (200 letters at most).";
    if (f.hours.length > 120) e.hours = "Opening hours are too long (120 letters at most).";
    const digits = f.phone.replace(/\D/g, "");
    if (f.phone.trim() && (digits.length < 10 || digits.length > 15)) e.phone = "Enter a phone number with 10 to 15 digits.";
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "That e-mail does not look right.";
    if (f.mapUrl.trim() && !/^https?:\/\//i.test(f.mapUrl.trim())) e.mapUrl = "The map link should start with https://";
  }
  if (part === "selling" || !part) {
    if (!f.channels.length) e.channels = "Pick at least one way customers can order.";
    const mo = num(f.minOrder);
    if (f.minOrder !== "" && !(mo >= 0)) e.minOrder = "Enter an amount of 0 or more.";
    const pm = num(f.prep);
    if (!Number.isInteger(pm) || pm < 5 || pm > 120) e.prep = "Preparation time must be between 5 and 120 minutes.";
    if (f.channels.includes("delivery")) {
      if (f.maxKm !== "" && !(num(f.maxKm) > 0)) e.maxKm = "Enter the delivery distance in km (more than 0).";
      if (f.freeAbove !== "" && !(num(f.freeAbove) >= 0)) e.freeAbove = "Enter an amount of 0 or more.";
    }
    f.slabs.forEach((s, i) => {
      if (s.km === "" && s.fee === "") return;
      if (!(num(s.km) > 0)) e["slab_km_" + i] = "Enter a distance.";
      if (!(num(s.fee) >= 0)) e["slab_fee_" + i] = "Enter a fee.";
    });
    const la = num(f.lat), ln = num(f.lng);
    if ((f.lat !== "" || f.lng !== "") && (isNaN(la) || isNaN(ln))) e.lat = "Enter both the latitude and the longitude.";
    else if (!isNaN(la) && (la < -90 || la > 90)) e.lat = "Latitude must be between -90 and 90.";
    else if (!isNaN(ln) && (ln < -180 || ln > 180)) e.lat = "Longitude must be between -180 and 180.";
    const tr = num(f.taxRate);
    if (!(tr >= 0 && tr <= 40)) e.taxRate = "Tax rate must be between 0 and 40 percent.";
    if (f.gstin.length > 20) e.gstin = "The GST number is too long.";
    const tb = num(f.tables);
    if (f.tables !== "" && !(Number.isInteger(tb) && tb >= 0 && tb <= 200)) e.tables = "Enter a whole number from 0 to 200.";
  }
  return e;
}

/** Put the form's values into a copy of the existing configuration, leaving everything the form does not manage untouched. */
export function buildConfig(base, f) {
  const c = JSON.parse(JSON.stringify(base));
  const b = (c.brand = c.brand || {});
  b.name = f.name.trim();
  b.tagline = f.tagline.trim();
  b.colors = { ...(b.colors || {}), ...f.colors };
  b.fonts = { ...f.fonts };
  const setOrDrop = (obj, key, v) => (v ? (obj[key] = v) : delete obj[key]);
  setOrDrop(b, "address", f.address.trim());
  setOrDrop(b, "hours", f.hours.trim());
  setOrDrop(b, "map_url", f.mapUrl.trim());
  b.support = { ...(b.support || {}) };
  setOrDrop(b.support, "phone", f.phone.trim());
  setOrDrop(b.support, "email", f.email.trim());

  c.ordering = { ...(c.ordering || {}), channels: f.channels, min_order: num(f.minOrder) || 0, prep_minutes: Number(f.prep) };
  const d = (c.delivery = { ...(c.delivery || {}) });
  if (f.maxKm !== "") d.max_km = Number(f.maxKm);
  if (f.freeAbove !== "") d.free_above = Number(f.freeAbove);
  else delete d.free_above;
  d.fee_slabs = f.slabs
    .filter((s) => s.km !== "" && s.fee !== "")
    .map((s) => ({ up_to_km: Number(s.km), fee: Number(s.fee) }))
    .sort((a, z) => a.up_to_km - z.up_to_km);
  if (f.lat !== "" && f.lng !== "") d.origin = { lat: Number(f.lat), lng: Number(f.lng) };
  else delete d.origin;

  c.tax = { ...(c.tax || {}), mode: f.taxMode, default_rate: Math.round(Number(f.taxRate) * 10) / 1000 };
  setOrDrop(c.tax, "gstin", f.gstin.trim());

  const pay = (c.payments = { ...(c.payments || {}) });
  const methods = new Set((pay.methods || ["cash", "card", "upi"]).filter((m) => m !== "cod" && m !== "razorpay"));
  if (f.cod) methods.add("cod");
  if (f.online) methods.add("razorpay");
  pay.methods = [...methods];
  pay.cod = { ...(pay.cod || {}), enabled: !!f.cod };

  const n = f.tables === "" ? 0 : Number(f.tables);
  const existing = (c.pos || {}).tables || [];
  if (n !== existing.length) {
    const tables = Array.from({ length: n }, (_, i) => `T-${String(i + 1).padStart(2, "0")}`);
    if (n) c.pos = { ...(c.pos || {}), tables };
    else if (c.pos) {
      delete c.pos.tables;
      if (!Object.keys(c.pos).length) delete c.pos;
    }
  }
  return c;
}

export const CHANNELS = [
  { id: "delivery", label: "Delivery" },
  { id: "takeaway", label: "Takeaway" },
  { id: "dine-in", label: "Dine-in" },
];

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_LOGO = 400_000;

/** Read a chosen file as a logo. Throws an Error with a plain message when it cannot be used. */
export function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file was chosen."));
    if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return reject(new Error("SVG logos are not accepted because they can hide harmful code. Please use a PNG, JPEG or WebP picture."));
    if (!LOGO_TYPES.includes(file.type)) return reject(new Error("That file is not a PNG, JPEG or WebP picture."));
    if (file.size > MAX_LOGO) return reject(new Error(`The logo is ${Math.round(file.size / 1000)} KB. It must be 400 KB or smaller. Try saving a smaller copy of the picture.`));
    if (file.size < 100) return reject(new Error("That picture looks empty."));
    const r = new FileReader();
    r.onerror = () => reject(new Error("The file could not be read."));
    r.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: r.result });
    r.readAsDataURL(file);
  });
}

export function dataUrlToBlob(url) {
  const [head, b64] = url.split(",");
  const type = /data:([^;]+)/.exec(head)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
