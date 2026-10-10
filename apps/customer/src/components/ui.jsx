import { useEffect, useId, useRef, useState } from "react";
import novaLogo from "@nova/shared/assets/nova-logo.png";
import { useI18n } from "../i18n.js";

// ------------------------------------------------------------------ icons (stroke icons, 24px grid)
const P = {
  home: "M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  bag: "M5 8h14l-1 12H6ZM9 8V6a3 3 0 0 1 6 0v2",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  check: "M5 12.5 10 17.5 19 7",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  alert: "M12 8v5m0 3.5v.5M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  wifi: "M3 9a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0M9.5 16.5a4 4 0 0 1 5 0M12 20h.01M4 4l16 16",
  bike: "M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm14 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM5 15h4l3-6h4l3 6M12 9l-2-3H7",
  store: "M4 9l1.5-5h13L20 9M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 6 0 2.5 2.5 0 0 0 5 0M5 11v9h14v-9",
  table: "M3 8h18M6 8v11M18 8v11M3 13h18",
  tag: "M3 12V4h8l10 10-8 8ZM8 8h.01",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  gps: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  note: "M5 4h14v12l-4 4H5ZM15 20v-4h4M8 9h8M8 13h4",
};
export function Icon({ name, size = 22, className = "", stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <path d={P[name]} />
    </svg>
  );
}

// ------------------------------------------------------------------ basic controls
export function Button({ variant = "primary", className = "", busy, children, ...rest }) {
  const v = {
    primary: "bg-accent text-accent-on shadow-card",
    brand: "bg-brand text-brand-on",
    ghost: "bg-transparent text-ink border border-line",
    soft: "bg-accent-soft text-ink",
    danger: "bg-bad-soft text-bad border border-bad/30",
  }[variant];
  return (
    <button {...rest} disabled={rest.disabled || busy} className={`active-press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition disabled:opacity-50 ${v} ${className}`}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} role="status" aria-label="Loading" />;
}

export function Stepper({ qty, onInc, onDec, label, size = "md" }) {
  const h = size === "sm" ? "min-h-[44px]" : "min-h-[44px]";
  return (
    <div className={`inline-flex ${h} items-center rounded-xl bg-accent text-accent-on shadow-card`} role="group" aria-label={label}>
      <button type="button" onClick={onDec} aria-label={`Remove one ${label || ""}`} className="flex h-[44px] w-[44px] items-center justify-center rounded-l-xl"><Icon name="minus" size={18} /></button>
      <span className="min-w-[24px] text-center text-[15px] font-bold tabular-nums" aria-live="polite">{qty}</span>
      <button type="button" onClick={onInc} aria-label={`Add one ${label || ""}`} className="flex h-[44px] w-[44px] items-center justify-center rounded-r-xl"><Icon name="plus" size={18} /></button>
    </div>
  );
}

export function Field({ label, hint, error, children, className = "" }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold">{label}</label>
      {typeof children === "function" ? children({ id, "aria-describedby": hint || error ? id + "-d" : undefined, "aria-invalid": error ? true : undefined }) : children}
      {(hint || error) && <p id={id + "-d"} className={`mt-1 text-[12px] ${error ? "text-bad" : "text-ink/70"}`}>{error || hint}</p>}
    </div>
  );
}
export const inputCls = "min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-[15px] text-ink placeholder:text-ink/50";

export function Chip({ active, children, className = "", ...rest }) {
  return (
    <button type="button" aria-pressed={active} {...rest} className={`active-press min-h-[44px] shrink-0 whitespace-nowrap rounded-full border px-4 text-[14px] font-semibold ${active ? "border-brand bg-brand text-brand-on" : "border-line bg-white text-ink"} ${className}`}>
      {children}
    </button>
  );
}

export function VegMark({ veg }) {
  if (veg == null) return null;
  const c = veg ? "#1B8548" : "#C62828";
  return (
    <span className="inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border-2 bg-white" style={{ borderColor: c }} role="img" aria-label={veg ? "Vegetarian" : "Non-vegetarian"}>
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: c }} />
    </span>
  );
}

// ------------------------------------------------------------------ feedback
export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-line/70 ${className}`} aria-hidden="true" />;
}

export function Banner({ tone = "warn", icon = "alert", children, action, className = "" }) {
  const tones = { warn: "bg-warn-soft text-warn border-warn/30", bad: "bg-bad-soft text-bad border-bad/30", good: "bg-good-soft text-good border-good/30", info: "bg-brand-soft text-ink border-line" };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-[14px] ${tones[tone]} ${className}`}>
      <Icon name={icon} size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
      {action}
    </div>
  );
}

export function Empty({ title, hint, icon = "bag", action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand"><Icon name={icon} size={30} /></div>
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {hint && <p className="mt-1 max-w-xs text-[14px] text-ink/70">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ brand
export function Monogram({ name = "", className = "" }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "R";
  return <span className={`flex items-center justify-center rounded-xl bg-accent font-display font-extrabold text-accent-on ${className}`} aria-hidden="true">{letters}</span>;
}
export function BrandMark({ brand, size = 40 }) {
  const [broken, setBroken] = useState(false);
  if (brand?.logo_url && !broken) {
    return <img src={brand.logo_url} alt={brand.name} onError={() => setBroken(true)} style={{ width: size, height: size }} className="shrink-0 rounded-xl bg-white object-contain" />;
  }
  return <Monogram name={brand?.name} className="shrink-0" />;
}

export function PoweredBy({ className = "", dark }) {
  const { t } = useI18n();
  return (
    <div className={`flex items-center justify-center gap-2 text-[13px] ${dark ? "text-brand-on/80" : "text-ink/70"} ${className}`}>
      <span>{t("powered_by")}</span>
      <img src={novaLogo} alt="Nova" className="h-5 w-auto rounded" />
      <span className="font-display font-bold">Nova</span>
    </div>
  );
}

// ------------------------------------------------------------------ bottom sheet (modal dialog with focus handling)
export function Sheet({ open, onClose, title, children, footer, tall }) {
  const ref = useRef(null);
  const { t } = useI18n();
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector("[data-autofocus]") || node?.querySelector("button, input, select, textarea, a[href]");
    first?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); }
      if (e.key === "Tab" && node) {
        const f = [...node.querySelectorAll("button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => el.offsetParent !== null);
        if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`relative flex w-full max-w-lg flex-col rounded-t-3xl bg-surface shadow-float sm:rounded-3xl ${tall ? "h-[92dvh]" : "max-h-[92dvh]"} sheet-in`}>
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <h2 id={titleId} className="font-display text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white text-ink shadow-card"><Icon name="close" size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer && <div className="border-t border-line bg-white px-4 pb-safe pt-3 pb-3 rounded-b-3xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Row({ label, value, strong, tone }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 text-[14px] ${strong ? "text-[16px] font-bold" : ""} ${tone === "good" ? "text-good" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
