import { useEffect, useId, useRef } from "react";
import { Icon } from "../ui";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** A panel that slides in from the right (full width on a phone). Esc or the backdrop closes it; focus stays inside and returns to where it was. */
export default function Drawer({ open, onClose, title, subtitle, children, actions }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const el = ref.current;
    el.querySelector("[data-autofocus]")?.focus();
    document.body.style.overflow = "hidden";
    const key = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const items = [...el.querySelectorAll(FOCUSABLE)];
        if (!items.length) return;
        const a = items[0], z = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && (document.activeElement === z || !el.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      if (prev && prev.isConnected && prev.focus) prev.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[#0b1f21]/60" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} data-testid="drawer" className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-float sm:max-w-xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={id} className="font-display text-xl font-extrabold">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-[14px] text-ink/75">{subtitle}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <button type="button" data-autofocus onClick={onClose} aria-label="Close the bill" className="-mr-2 grid h-11 w-11 place-items-center rounded-xl hover:bg-brand-soft"><Icon name="x" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-safe text-[15px] sm:px-5">{children}</div>
      </div>
    </div>
  );
}
