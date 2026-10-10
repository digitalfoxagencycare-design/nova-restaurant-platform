import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { copyText, downloadFile, logoSrc } from "./lib/api";
import { monogram } from "./lib/brand";
import { onColor } from "@nova/shared";

export const cx = (...a) => a.filter(Boolean).join(" ");

// ---------------------------------------------------------------- icons
const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  store: "M4 9l1-5h14l1 5M4 9v11h16V9M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0M9 20v-6h6v6",
  chat: "M4 5h16v11H9l-5 4V5z",
  inbox: "M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1 3h6l1-3h5",
  chart: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  menu: "M4 6h16M4 12h16M4 18h16",
  x: "M6 6l12 12M18 6L6 18",
  copy: "M9 9h11v11H9zM5 15V5h10",
  check: "M5 12.5l4.5 4.5L19 7",
  plus: "M12 5v14M5 12h14",
  alert: "M12 4l9 16H3L12 4zM12 10v4M12 17.5v.01",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5",
  logout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  pin: "M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z",
  upload: "M12 16V5M7 9l5-5 5 5M5 20h14",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  send: "M4 12l16-8-6 16-3-7-7-1z",
};
export function Icon({ name, className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <path d={PATHS[name] || PATHS.alert} />
    </svg>
  );
}

// ---------------------------------------------------------------- buttons and fields
const BTN = {
  primary: "bg-action text-white hover:bg-action-dark shadow-sm",
  dark: "bg-brand text-brand-on hover:opacity-90",
  secondary: "bg-white text-ink border border-line hover:bg-brand-soft",
  danger: "bg-bad text-white hover:opacity-90",
  ghost: "text-ink hover:bg-brand-soft",
};
export function Button({ variant = "primary", busy, className, children, disabled, type = "button", ...p }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx("inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50", BTN[variant], className)}
      {...p}
    >
      {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary", className, ...p }) {
  return (
    <a href={href} className={cx("inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition", BTN[variant], className)} {...p}>
      {children}
    </a>
  );
}

const inputCls = "min-h-[44px] w-full rounded-xl border bg-white px-3 text-[15px] placeholder:text-ink/40 focus:border-brand";

/** Label + control + hint + error, wired together for screen readers. `children` is a function that receives props for the control. */
export function Field({ label, hint, error, children, className, optional }) {
  const id = useId();
  const props = { id, "aria-invalid": error ? true : undefined, "aria-describedby": [hint && id + "-h", error && id + "-e"].filter(Boolean).join(" ") || undefined };
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
        {optional ? <span className="ml-1 font-normal text-ink/60">(optional)</span> : null}
      </label>
      {children(props, cx(inputCls, error ? "border-bad" : "border-line"))}
      {hint && !error ? <p id={id + "-h"} className="mt-1 text-[13px] text-ink/70">{hint}</p> : null}
      {error ? <p id={id + "-e"} role="alert" className="mt-1 text-[13px] font-medium text-bad">{error}</p> : null}
    </div>
  );
}
export function TextField({ label, hint, error, optional, className, inputClass, ...p }) {
  return (
    <Field label={label} hint={hint} error={error} className={className} optional={optional}>
      {(a, c) => <input className={cx(c, inputClass)} {...a} {...p} />}
    </Field>
  );
}
export function SelectField({ label, hint, error, children, className, ...p }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(a, c) => <select className={c} {...a} {...p}>{children}</select>}
    </Field>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-center gap-3 py-1">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-ink/25 transition peer-checked:bg-good peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
      <span>
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint ? <span className="block text-[13px] text-ink/70">{hint}</span> : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- surfaces
export function Card({ className, children, ...p }) {
  return <section className={cx("rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5", className)} {...p}>{children}</section>;
}
export function Page({ title, subtitle, actions, children }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-2xl text-[15px] text-ink/75">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

const TONES = { good: "bg-good-soft text-[#14633a]", bad: "bg-bad-soft text-[#a31f1f]", warn: "bg-warn-soft text-[#8a4e05]", info: "bg-brand-soft text-brand", mute: "bg-line text-ink/80" };
export function Chip({ tone = "mute", children, className }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-semibold", TONES[tone], className)}>{children}</span>;
}

export function Skeleton({ className }) {
  return <div className={cx("animate-pulse rounded-xl bg-ink/10", className)} aria-hidden="true" />;
}
export function SkeletonPage({ rows = 3 }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-24" />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry, text }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-bad/30 bg-bad-soft p-4 text-[15px] text-[#7d1616]">
      <Icon name="alert" className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1">{text}</p>
      {onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

export function Empty({ title, hint, action, icon = "inbox" }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/25 bg-white/60 px-5 py-10 text-center">
      <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={icon} className="h-6 w-6" /></span>
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {hint ? <p className="mx-auto mt-1 max-w-md text-[15px] text-ink/75">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }) {
  const t = { info: "border-brand/20 bg-brand-soft", warn: "border-warn/40 bg-warn-soft", good: "border-good/30 bg-good-soft", bad: "border-bad/30 bg-bad-soft" }[tone];
  return (
    <div role={tone === "bad" || tone === "warn" ? "alert" : "status"} className={cx("rounded-2xl border p-4 text-[15px]", t, className)}>
      {title ? <p className="mb-1 font-bold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- dialog
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Dialog({ open, onClose, title, children, footer, wide }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const el = ref.current;
    const first = el.querySelector("[data-autofocus]") || el.querySelector(FOCUSABLE);
    (first || el).focus();
    document.body.style.overflow = "hidden";
    const key = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const items = [...el.querySelectorAll(FOCUSABLE)];
        if (!items.length) return;
        const a = items[0], z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      if (prev && prev.focus) prev.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-[#0b1f21]/60" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx("relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-float sm:rounded-3xl", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="font-display text-xl font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 grid h-11 w-11 place-items-center rounded-xl hover:bg-brand-soft"><Icon name="x" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 text-[15px]">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 pb-safe">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = "good") => {
    const id = Math.random();
    setItems((l) => [...l, { id, text, tone }].slice(-3));
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto max-w-md rounded-xl px-4 py-3 text-[15px] font-semibold text-white shadow-float", t.tone === "bad" ? "bg-bad" : t.tone === "info" ? "bg-brand" : "bg-good")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- copy, QR, tabs
export function CopyButton({ text, label = "Copy", done = "Copied", className, variant = "secondary" }) {
  const toast = useToast();
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant={variant}
      className={className}
      onClick={async () => {
        const r = await copyText(text);
        if (r) { setOk(true); setTimeout(() => setOk(false), 1800); toast(done + "."); } else toast("Could not copy. Select the text and copy it by hand.", "bad");
      }}
    >
      <Icon name={ok ? "check" : "copy"} className="h-4 w-4" />
      {ok ? done : label}
    </Button>
  );
}

/** A value you can read and copy (link, code). */
export function CopyRow({ label, value, mono = true, hint }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="text-[13px] font-semibold text-ink/70">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className={cx("min-w-0 flex-1 break-all text-[15px]", mono && "font-mono text-[14px]")} data-testid={"copy-" + label.toLowerCase().replace(/\W+/g, "-")}>{value}</p>
        <CopyButton text={value} />
      </div>
      {hint ? <p className="mt-1 text-[13px] text-ink/70">{hint}</p> : null}
    </div>
  );
}

export function Qr({ text, size = 168, name = "qr" }) {
  const svg = useMemo(() => {
    try {
      const q = qrcode(0, "M");
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      return "";
    }
  }, [text]);
  if (!svg) return null;
  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div role="img" aria-label="QR code for the link" className="rounded-xl border border-line bg-white p-2" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
      <button type="button" className="min-h-[44px] rounded-lg px-3 text-sm font-semibold text-brand underline" onClick={() => downloadFile(name + ".svg", svg, "image/svg+xml")}>
        Download QR picture
      </button>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.id === value);
    if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].id);
    if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="no-scrollbar -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          id={"tab-" + t.id}
          aria-selected={value === t.id}
          aria-controls="tabpanel"
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cx("min-h-[44px] shrink-0 whitespace-nowrap border-b-[3px] px-3 text-[15px] font-semibold", value === t.id ? "border-action text-ink" : "border-transparent text-ink/65 hover:text-ink")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Restaurant logo, or a monogram in the restaurant's own colour when it has none. */
export function Avatar({ name, logoUrl, color = "#133B40", size = 44, className }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [logoUrl]);
  const src = logoSrc(logoUrl);
  const style = { width: size, height: size };
  if (src && !bad) return <img src={src} alt="" onError={() => setBad(true)} style={style} className={cx("shrink-0 rounded-xl border border-line bg-white object-contain", className)} />;
  return (
    <span aria-hidden="true" style={{ ...style, background: color, color: onColor(color), fontSize: size * 0.38 }} className={cx("grid shrink-0 place-items-center rounded-xl font-display font-extrabold", className)}>
      {monogram(name)}
    </span>
  );
}
