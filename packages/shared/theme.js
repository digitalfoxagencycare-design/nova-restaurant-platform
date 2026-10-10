/** White-label theming: a restaurant's brand colours and fonts (from tenant config) become CSS variables.
 *  The apps only ever use the variables, so one build serves every restaurant. */
export const NOVA_DEFAULT = { primary: "#EF4B2B", secondary: "#133B40", background: "#F5F7F7", foreground: "#10201F", muted: "#E4EAEA" };

const HEX = /^#[0-9a-fA-F]{6}$/;
const trip = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** Text colour that stays readable on `hex`. */
export const onColor = (hex) => (luminance(hex) > 0.4 ? "#10201F" : "#FFFFFF");

function mix(hex, other, t) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(other.slice(i, i + 2), 16));
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export function applyBrand(brand = {}, root = document.documentElement) {
  const c = { ...NOVA_DEFAULT };
  for (const [k, v] of Object.entries(brand.colors || {})) if (HEX.test(v)) c[k] = v;
  const set = (name, hex) => root.style.setProperty(name, trip(hex));
  set("--brand", c.secondary);
  set("--on-brand", onColor(c.secondary));
  set("--brand-soft", mix(c.secondary, "#FFFFFF", 0.9));
  set("--accent", c.primary);
  set("--on-accent", onColor(c.primary));
  set("--accent-soft", mix(c.primary, "#FFFFFF", 0.88));
  set("--bg", c.background);
  set("--ink", c.foreground);
  set("--line", c.muted);
  const f = brand.fonts || {};
  const fam = [f.heading, f.body].filter((x) => x && /^[A-Za-z0-9 ]{2,40}$/.test(x));
  if (fam.length && typeof document !== "undefined") {
    const href = "https://fonts.googleapis.com/css2?" + [...new Set(fam)].map((x) => "family=" + x.replace(/ /g, "+") + ":wght@400;500;600;700;800").join("&") + "&display=swap";
    if (!document.querySelector(`link[data-brand-font]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = href; l.dataset.brandFont = "1";
      document.head.appendChild(l);
    }
    if (f.heading) root.style.setProperty("--font-display", `'${f.heading}', 'Bricolage Grotesque', system-ui, sans-serif`);
    if (f.body) root.style.setProperty("--font-body", `'${f.body}', 'Figtree', system-ui, sans-serif`);
  }
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", c.secondary);
    if (brand.name) document.title = brand.name;
  }
}
