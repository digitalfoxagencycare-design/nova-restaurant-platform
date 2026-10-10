import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import logo from "@nova/shared/assets/nova-logo.png";

const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  nav: "M3 11l18-8-8 18-2-8-8-2z",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12M18 6L6 18",
  bag: "M6 8h12l1 12H5L6 8zM9 8V6a3 3 0 0 1 6 0v2",
  pin: "M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  rupee: "M7 5h10M7 9h10M7 5c5 0 7 2 7 4s-2 4-7 4l7 6",
  bike: "M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 15l4-7h5l3 7M9 8L8 5H6M14 8l-2 7",
  chev: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  refresh: "M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4M20 19v-4h-4",
  out: "M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9",
  alert: "M12 4l9 16H3L12 4zM12 10v4M12 17v.5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4",
  bellOff: "M6 16V11a6 6 0 0 1 9-5M18 11v5l2 2H4M10 21h4M3 3l18 18",
  dish: "M4 13h16a8 8 0 0 1-16 0zM12 5v3M3 13h18",
  menu: "M4 7h16M4 12h16M4 17h16",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  copy: "M9 9h11v11H9zM5 15V4h11",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 4a4 4 0 0 1 0 7M22 21c0-3-2-5-4-5.6",
  tag: "M3 12V4h8l10 10-8 8L3 12zM8 8h.01",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  chat: "M4 5h16v11H9l-5 4V5z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};
export function Icon({ name, className = "h-5 w-5", strokeWidth = 1.9 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name] || ""} />
    </svg>
  );
}

export function Spinner({ className = "h-5 w-5" }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-line border-t-accent ${className}`} role="status" aria-label="Loading" />;
}

const BTN = {
  primary: "bg-accent text-accent-on",
  soft: "bg-accent-soft text-ink",
  line: "bg-surface border border-line text-ink",
  danger: "bg-bad-soft text-bad border border-bad",
  good: "bg-good-soft text-good border border-good",
};
export function Button({ kind = "primary", busy, className = "", children, disabled, ...rest }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`active-press inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 font-semibold disabled:opacity-50 ${BTN[kind]} ${className}`}
      {...rest}
    >
      {busy ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function Chip({ active, children, className = "", ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={!!active}
      className={`active-press min-h-[44px] shrink-0 rounded-full border px-4 text-sm font-semibold ${active ? "border-brand bg-brand text-brand-on" : "border-line bg-surface text-ink"} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className = "", children, ...rest }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${className}`} {...rest}>{children}</div>;
}

export function Field({ label, id, hint, error, children }) {
  return (
    <div className="block">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">{label}</label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs opacity-70">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-semibold text-bad" role="alert">{error}</p> : null}
    </div>
  );
}
export const inputCls = "block w-full min-h-[48px] rounded-xl border border-line bg-surface px-3 text-base text-ink placeholder:opacity-50";

export function Empty({ icon = "bag", title, hint, children }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={icon} className="h-6 w-6" /></span>
      <p className="font-display text-lg font-bold">{title}</p>
      {hint ? <p className="mt-1 text-sm opacity-70">{hint}</p> : null}
      {children}
    </div>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-bad bg-bad-soft p-4 text-bad" role="alert">
      <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{message}</p>
        {onRetry ? <button type="button" onClick={onRetry} className="mt-2 min-h-[44px] font-bold underline">Try again</button> : null}
      </div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => { const el = ref.current && ref.current.querySelector("[data-autofocus],input,textarea,select,button"); if (el) el.focus(); }, 60);
    return () => { document.removeEventListener("keydown", onKey); clearTimeout(t); if (prev && prev.focus) prev.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="anim-fade fixed inset-0 z-40 flex items-end bg-ink/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="anim-sheet mx-auto flex max-h-[92dvh] w-full max-w-[520px] flex-col rounded-t-3xl bg-surface shadow-float">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft"><Icon name="x" /></button>
        </div>
        <div className="overflow-y-auto px-5 pb-6 pb-safe">{children}</div>
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-safe" style={{ paddingTop: "calc(var(--sat) + 12px)" }} aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`anim-sheet pointer-events-auto w-full max-w-[420px] rounded-xl border px-4 py-3 text-sm font-semibold shadow-float ${t.kind === "bad" ? "border-bad bg-bad-soft text-bad" : t.kind === "good" ? "border-good bg-good-soft text-good" : "border-brand bg-brand text-brand-on"}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function PoweredBy({ className = "" }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-xs opacity-70 ${className}`}>
      <span>Powered by Nova</span>
      <img src={logo} alt="Nova" className="h-5 w-auto" />
    </div>
  );
}

/** Switch with a visible label for assistive tech. */
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${checked ? "border-good bg-good" : "border-line bg-brand-soft"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface shadow-card transition-all ${checked ? "left-[26px]" : "left-0.5"}`} />
    </button>
  );
}

/** Polls `fn` every `ms` while the page is visible. Returns { data, error, loading, reload }. */
export function usePoll(fn, ms, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      const data = await fnRef.current();
      setState({ data, error: null, loading: false });
      return data;
    } catch (e) {
      setState((s) => ({ ...s, error: e, loading: false }));
      return null;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: s.data == null }));
    reload();
    const id = ms ? setInterval(() => { if (alive && !document.hidden) reload(); }, ms) : null;
    return () => { alive = false; if (id) clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...state, reload };
}
