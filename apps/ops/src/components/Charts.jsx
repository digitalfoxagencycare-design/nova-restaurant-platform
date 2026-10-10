import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { OTHER_COLOR, PALETTE, share } from "../lib/analytics";
import { cx } from "../ui";

/* Charts for drilling. Every slice, bar, point and legend row is a real focusable button:
   Tab to it, Enter or Space to drill, hover or focus for a tooltip. Items look like
   { key, label, value, text, fraction, color, drill: true|false }  (drill false = "Others", not clickable). */

const key = (fn) => (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };

function useWidth(ref, fallback = 640) {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width)) || fallback);
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}

/** Hover / focus tooltip, positioned over the mark that asked for it. */
function useTip() {
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const show = useCallback((e, text) => {
    const b = box.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    if (!b) return;
    setTip({ text, x: r.left - b.left + r.width / 2, y: r.top - b.top });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <div role="presentation" className="pointer-events-none absolute z-10 max-w-[220px] -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-[13px] font-semibold leading-snug text-white shadow-float" style={{ left: Math.min(Math.max(tip.x, 90), (box.current?.clientWidth || 400) - 90), top: Math.max(tip.y - 6, 30) }}>
      {tip.text}
    </div>
  ) : null;
  return { box, show, hide, node };
}

export const colorize = (items) => items.map((it, i) => ({ ...it, color: it.color || (it.drill === false ? OTHER_COLOR : PALETTE[i % PALETTE.length]) }));

/** Keep the biggest slices and fold the rest into one grey "Others" slice that is shown but not clickable. */
export function topWithOthers(items, max = 7, fmt = String) {
  const live = items.filter((i) => i.value > 0);
  if (live.length <= max + 1) return live;
  const head = live.slice(0, max);
  const rest = live.slice(max);
  const value = rest.reduce((a, r) => a + r.value, 0);
  const fraction = rest.reduce((a, r) => a + r.fraction, 0);
  return [...head, { key: "__others", label: `Others (${rest.length})`, value, fraction, text: fmt(value), drill: false }];
}

const aria = (it, verb = "Filter to") => `${it.label}: ${it.text}, ${share(it.fraction)} of total.${it.drill === false ? "" : ` ${verb} this`}`;

// ---------------------------------------------------------------- donut
const polar = (cx0, cy0, r, a) => [cx0 + r * Math.cos(a), cy0 + r * Math.sin(a)];
function arc(cx0, cy0, R, r, a0, a1) {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 0.0001);
  const e = a0 + sweep, big = sweep > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx0, cy0, R, a0), [x1, y1] = polar(cx0, cy0, R, e), [x2, y2] = polar(cx0, cy0, r, e), [x3, y3] = polar(cx0, cy0, r, a0);
  return `M${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${big} 0 ${x3},${y3}Z`;
}

export function Donut({ items, total, centerLabel, onPick, title, selected }) {
  const { box, show, hide, node } = useTip();
  const [active, setActive] = useState(null);
  const S = 220, c = S / 2, R = 104, r = 62;
  let a = -Math.PI / 2;
  const sum = items.reduce((x, i) => x + i.value, 0) || 1;
  const cur = items.find((i) => i.key === active);
  const on = (it) => (e) => { setActive(it.key); show(e, `${it.label}: ${it.text} (${share(it.fraction)})`); };
  const off = () => { setActive(null); hide(); };
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
      <div ref={box} className="relative mx-auto" style={{ width: S, height: S }}>
        <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="group" aria-label={title}>
          {items.map((it) => {
            const sweep = (it.value / sum) * Math.PI * 2;
            const d = arc(c, c, R, r, a, a + sweep);
            a += sweep;
            const live = it.drill !== false;
            const dim = active && active !== it.key;
            const props = live
              ? { role: "button", tabIndex: 0, "aria-label": aria(it), onClick: () => onPick(it), onKeyDown: key(() => onPick(it)), style: { cursor: "pointer" } }
              : { role: "img", "aria-label": `${it.label}: ${it.text}, ${share(it.fraction)} of total` };
            return (
              <path key={it.key} d={d} fill={it.color} stroke="#fff" strokeWidth="2" opacity={dim ? 0.45 : 1} {...props} onMouseEnter={on(it)} onMouseLeave={off} onFocus={on(it)} onBlur={off} className="outline-none transition-opacity focus-visible:stroke-[#EF4B2B] focus-visible:[stroke-width:4]" data-testid="slice" data-key={it.key} data-selected={selected === it.key || undefined} />
            );
          })}
          <text x={c} y={c - 4} textAnchor="middle" pointerEvents="none" className="fill-ink" style={{ font: "800 19px var(--font-display)" }}>{cur ? cur.text : total}</text>
          <text x={c} y={c + 16} textAnchor="middle" pointerEvents="none" className="fill-ink/70" style={{ font: "600 12px var(--font-body)" }}>{cur ? share(cur.fraction) : centerLabel}</text>
        </svg>
        {node}
      </div>
      <Legend items={items} onPick={onPick} active={active} setActive={setActive} />
    </div>
  );
}

export function Legend({ items, onPick, active, setActive }) {
  return (
    <ul className="grid gap-1" aria-label="Legend" data-testid="legend">
      {items.map((it) => {
        const live = it.drill !== false;
        const inner = (
          <>
            <span className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: it.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left font-semibold">{it.label}</span>
            <span className="shrink-0 tabular-nums text-ink/75">{it.text}</span>
            <span className="w-12 shrink-0 text-right tabular-nums font-bold">{share(it.fraction)}</span>
          </>
        );
        const cls = cx("flex min-h-[44px] w-full items-center gap-2 rounded-xl px-2 text-[14px] sm:min-h-[36px]", live ? "hover:bg-brand-soft" : "", active === it.key && "bg-brand-soft");
        return (
          <li key={it.key}>
            {live ? (
              <button type="button" className={cls} aria-label={aria(it)} onClick={() => onPick(it)} onMouseEnter={() => setActive?.(it.key)} onMouseLeave={() => setActive?.(null)} onFocus={() => setActive?.(it.key)} onBlur={() => setActive?.(null)} data-testid="legend-row">
                {inner}
              </button>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- vertical bars and lines for time
const compact = (v, money) => {
  const x = money ? v / 100 : v;
  const a = Math.abs(x);
  const s = a >= 1e7 ? (x / 1e7).toFixed(1) + "Cr" : a >= 1e5 ? (x / 1e5).toFixed(1) + "L" : a >= 1e3 ? (x / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k" : String(Math.round(x));
  return (money ? "₹" : "") + s.replace(".0", "");
};

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function Frame({ items, money, h = 230, render, title }) {
  const wrap = useRef(null);
  const W = useWidth(wrap);
  const { box, show, hide, node } = useTip();
  const [active, setActive] = useState(null);
  const L = money ? 52 : 38, T = 10, B = 28, R = 8;
  const max = niceMax(Math.max(0, ...items.map((i) => i.value)));
  const iw = W - L - R, ih = h - T - B;
  const y = (v) => T + ih - (v / max) * ih;
  const step = Math.max(1, Math.ceil(items.length / Math.max(2, Math.floor(iw / 62))));
  return (
    <div ref={(n) => { wrap.current = n; box.current = n; }} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${h}`} width={W} height={h} role="group" aria-label={title} className="block max-w-full overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="rgb(var(--line))" strokeDasharray={f ? "3 4" : undefined} />
            <text x={L - 6} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="rgb(var(--ink) / .7)">{compact(max * f, money)}</text>
          </g>
        ))}
        {render({ L, T, iw, ih, y, W, active, setActive, show, hide, h })}
        {items.map((it, i) => (i % step === 0 ? <text key={it.key} x={L + (iw / items.length) * (i + 0.5)} y={h - 8} textAnchor="middle" fontSize="11" fill="rgb(var(--ink) / .75)">{it.short || it.label}</text> : null))}
      </svg>
      {node}
    </div>
  );
}

const hoverProps = (it, active, setActive, show, hide) => ({
  onMouseEnter: (e) => { setActive(it.key); show(e, `${it.label}: ${it.text} (${share(it.fraction)})`); },
  onMouseLeave: () => { setActive(null); hide(); },
  onFocus: (e) => { setActive(it.key); show(e, `${it.label}: ${it.text} (${share(it.fraction)})`); },
  onBlur: () => { setActive(null); hide(); },
});

export function Bars({ items, money, onPick, title }) {
  return (
    <Frame items={items} money={money} title={title} render={({ L, iw, ih, T, y, active, setActive, show, hide }) => {
      const bw = iw / items.length;
      return items.map((it, i) => {
        const x = L + bw * i;
        const top = y(it.value);
        const live = it.value > 0 && it.drill !== false;
        const props = live ? { role: "button", tabIndex: 0, "aria-label": aria(it), onClick: () => onPick(it), onKeyDown: key(() => onPick(it)), style: { cursor: "pointer" } } : { role: "img", "aria-label": `${it.label}: ${it.text}` };
        return (
          <g key={it.key} {...props} {...hoverProps(it, active, setActive, show, hide)} className="outline-none" data-testid="bar" data-key={it.key}>
            <rect x={x} y={T} width={bw} height={ih} fill="transparent" />
            <rect x={x + Math.min(3, bw * 0.12)} y={top} width={Math.max(2, bw - Math.min(6, bw * 0.24))} height={Math.max(0, T + ih - top)} rx={Math.min(4, bw / 4)} fill={it.color} opacity={active && active !== it.key ? 0.5 : 1} stroke={active === it.key ? "#EF4B2B" : "none"} strokeWidth="2" />
          </g>
        );
      });
    }} />
  );
}

export function Line({ items, money, onPick, title, area }) {
  const color = items[0]?.color || PALETTE[0];
  return (
    <Frame items={items} money={money} title={title} render={({ L, iw, ih, T, y, active, setActive, show, hide }) => {
      const bw = iw / items.length;
      const pts = items.map((it, i) => [L + bw * (i + 0.5), y(it.value)]);
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
      return (
        <>
          {area ? <path d={`${d}L${pts[pts.length - 1][0]},${T + ih}L${pts[0][0]},${T + ih}Z`} fill={color} opacity="0.14" /> : null}
          <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {items.map((it, i) => {
            const live = it.drill !== false && it.value > 0;
            const props = live ? { role: "button", tabIndex: 0, "aria-label": aria(it), onClick: () => onPick(it), onKeyDown: key(() => onPick(it)), style: { cursor: "pointer" } } : { role: "img", "aria-label": `${it.label}: ${it.text}` };
            return (
              <g key={it.key} {...props} {...hoverProps(it, active, setActive, show, hide)} className="outline-none" data-testid="point" data-key={it.key}>
                <circle cx={pts[i][0]} cy={pts[i][1]} r={Math.max(10, Math.min(16, bw / 2))} fill="transparent" />
                <circle cx={pts[i][0]} cy={pts[i][1]} r={active === it.key ? 6 : items.length > 40 ? 2 : 3.5} fill="#fff" stroke={active === it.key ? "#EF4B2B" : color} strokeWidth="2.5" />
              </g>
            );
          })}
        </>
      );
    }} />
  );
}

// ---------------------------------------------------------------- leaderboard (horizontal bars, one button per row)
export function HBars({ items, onPick, title }) {
  const [active, setActive] = useState(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="grid gap-1" aria-label={title} data-testid="hbars">
      {items.map((it, i) => {
        const live = it.drill !== false && it.value > 0;
        const body = (
          <>
            <span className="flex w-full items-baseline justify-between gap-2 text-[14px]">
              <span className="min-w-0 truncate text-left font-semibold"><span className="mr-1.5 tabular-nums text-ink/60">{i + 1}</span>{it.label}</span>
              <span className="shrink-0 tabular-nums"><b>{it.text}</b> <span className="text-ink/70">{share(it.fraction)}</span></span>
            </span>
            <svg className="mt-1 block h-3 w-full" aria-hidden="true" focusable="false">
              <rect width="100%" height="12" rx="6" fill="rgb(var(--line))" />
              <rect width={`${Math.max(it.value > 0 ? 1.5 : 0, (it.value / max) * 100)}%`} height="12" rx="6" fill={it.color} />
            </svg>
          </>
        );
        const cls = cx("block min-h-[44px] w-full rounded-xl px-2 py-1.5", live && "hover:bg-brand-soft", active === it.key && "bg-brand-soft");
        return (
          <li key={it.key}>
            {live ? (
              <button type="button" className={cls} aria-label={aria(it)} onClick={() => onPick(it)} onMouseEnter={() => setActive(it.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(it.key)} onBlur={() => setActive(null)} title={`${it.label}: ${it.text} (${share(it.fraction)})`} data-testid="hbar" data-key={it.key}>{body}</button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
