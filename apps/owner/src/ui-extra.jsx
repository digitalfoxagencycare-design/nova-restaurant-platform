import { Button, Sheet } from "./ui.jsx";

/** Confirm step as a bottom sheet (bulk changes, deletes, cancels). */
export function ConfirmSheet({ open, title, message, confirmLabel = "Confirm", danger, busy, disabled, onConfirm, onClose, children }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {message ? <p className="text-sm">{message}</p> : null}
        {children}
        <div className="flex gap-2">
          <Button kind="line" className="flex-1" onClick={onClose}>Back</Button>
          <Button kind={danger ? "danger" : "primary"} className="flex-1" busy={busy} disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Buttons that behave like a radio group. */
export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`active-press min-h-[44px] flex-1 rounded-xl border px-2 text-sm font-semibold ${value === v ? "border-brand bg-brand text-brand-on" : "border-line bg-surface text-ink"}`}>{text}</button>
      ))}
    </div>
  );
}

/** One horizontal bar with a label and value; `pct` is 0 to 100. */
export function Bar({ label, value, pct, tone = "bg-brand" }) {
  return (
    <div className="py-1.5">
      <div className="flex justify-between gap-2 text-sm"><span className="min-w-0 truncate">{label}</span><span className="shrink-0 font-semibold">{value}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-brand-soft"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>
    </div>
  );
}

/** Subpage header with a back button. */
export function SubHeader({ title, onBack, right }) {
  return (
    <div className="mb-4 flex items-center gap-1">
      <button type="button" onClick={onBack} aria-label="Back" className="-ml-2 grid h-11 w-11 place-items-center rounded-full">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <h2 className="min-w-0 flex-1 truncate font-display text-xl font-extrabold">{title}</h2>
      {right}
    </div>
  );
}
