import { useEffect, useMemo, useRef, useState } from "react";
import { money, dateOf, timeOf } from "@nova/shared";
import { api, downloadAuthed, niceError, useLoad } from "../lib/api";
import { setHashQuery, useHashQuery } from "../lib/router";
import {
  MEASURES, PALETTE, PRESETS, addDays, apiQuery, daysBetween, delta, measureOf, nextDimension, pct, presetOf, presetRange, prettyDay, readState,
  shortDay, share, todayIST, valueLabel, writeState,
} from "../lib/analytics";
import { Button, Card, Chip, Empty, ErrorBox, Icon, Notice, Skeleton, Toggle, cx, useToast } from "../ui";
import { Bars, Donut, HBars, Line, colorize, topWithOthers } from "./Charts";
import BillDrawer from "./BillDrawer";

const PAGE = 25;
const TIME_VIEWS = [{ id: "bars", label: "Bars" }, { id: "line", label: "Line" }, { id: "area", label: "Area" }];
const CAT_VIEWS = [{ id: "donut", label: "Donut" }, { id: "rank", label: "Bars" }];
const REST_VIEWS = [{ id: "rank", label: "Leaderboard" }, { id: "donut", label: "Donut" }];

/**
 * Click a chart, add a filter, look at the next angle, down to the bills and one bill in full.
 * `lock` fixes one filter (the restaurant, when this sits inside a restaurant's own page).
 * All of the view lives in the URL hash query, so a link to a drilled view shows the same thing.
 */
export default function Drill({ lock, defaultBy = "restaurant" }) {
  const q = useHashQuery();
  const toast = useToast();
  const cfg = useMemo(() => ({ lock, defaultBy }), [lock?.dim, lock?.value, defaultBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useMemo(() => readState(q, cfg), [q.toString(), cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = (extra) => { const n = new URLSearchParams(writeState({ ...s, ...extra }, cfg)); const t = q.get("tab"); if (t) n.set("tab", t); return n; };
  const update = (patch, replace = false) => setHashQuery(keep(patch), { replace });

  const meta = useLoad(() => api.get("/v2/platform/analytics/meta"), []);
  const tenants = useLoad(() => api.get("/v2/platform/tenants"), []);
  const names = useMemo(() => Object.fromEntries((tenants.data || []).map((t) => [t.id, t.name])), [tenants.data]);
  const labels = useRef({});

  const dims = useMemo(() => (meta.data?.dimensions || []).filter((d) => !(lock && d.key === lock.dim)), [meta.data, lock?.dim]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = meta.data?.suggested_path || [];
  const dimInfo = (k) => (meta.data?.dimensions || []).find((d) => d.key === k);
  const by = dimInfo(s.by) && !(lock && s.by === lock.dim) ? s.by : lock ? "day" : defaultBy;
  const isTime = !!dimInfo(by)?.time;
  const M = measureOf(s.m);

  const fkey = JSON.stringify(s.filters);
  const bd = useLoad(
    () => (meta.data ? api.get(`/v2/platform/analytics/breakdown?${apiQuery(s, { by, compare: s.compare })}`) : new Promise(() => {})),
    [meta.data, s.from, s.to, by, fkey, s.compare],
  );
  const rec = useLoad(
    () => (s.bills && meta.data ? api.get(`/v2/platform/analytics/records?${apiQuery(s, { limit: PAGE, offset: s.page * PAGE, sort: s.sort })}`) : Promise.resolve(null)),
    [meta.data, s.bills, s.from, s.to, fkey, s.page, s.sort],
  );

  const labelOf = (dim, value) => labels.current[dim + ":" + value] || valueLabel(dim, value, names);

  const pick = (item) => {
    labels.current[by + ":" + item.key] = item.label;
    const filters = [...s.filters.filter((f) => f.dim !== by), { dim: by, value: item.key }];
    const next = nextDimension(by, filters, path, dims);
    update({ filters, by: next || by, bills: !next, page: 0, bill: null });
  };
  const popTo = (i) => update({ filters: s.filters.slice(0, i), by: s.filters[i].dim, bills: false, page: 0, bill: null });
  const removeAt = (i) => update({ filters: s.filters.filter((_, j) => j !== i), by: s.filters[i].dim, page: 0, bill: null });
  const locked = (f) => lock && f.dim === lock.dim;
  const free = s.filters.filter((f) => !locked(f));

  const [csvBusy, setCsvBusy] = useState(false);
  const [csvErr, setCsvErr] = useState("");
  const csv = async () => {
    setCsvBusy(true); setCsvErr("");
    try {
      const r = await downloadAuthed(`/v2/platform/analytics/records.csv?${apiQuery(s)}`, `bills-${s.from}-to-${s.to}.csv`);
      toast(r.truncated ? `Downloaded ${r.name}. Only the first part of the bills fit; narrow the dates for all of them.` : `Downloaded ${r.name}`);
    } catch (e) { setCsvErr(niceError(e)); } finally { setCsvBusy(false); }
  };

  const recRef = useRef(null);
  useEffect(() => { if (s.bills && rec.data) recRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [s.bills]); // eslint-disable-line react-hooks/exhaustive-deps

  if (meta.error) return <ErrorBox text={niceError(meta.error)} onRetry={meta.retry} />;
  const d = bd.data;
  const showSkeleton = meta.loading || (bd.loading && !d);

  return (
    <div data-testid="drill">
      <RangeBar s={s} update={update} />

      <Layers s={s} lock={lock} labelOf={labelOf} update={update} popTo={popTo} removeAt={removeAt} />

      {bd.error ? (
        <div className="mt-4"><ErrorBox text={niceError(bd.error)} onRetry={bd.retry} /></div>
      ) : showSkeleton ? (
        <div className="mt-4 space-y-4" role="status" aria-label="Loading the figures"><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-72" /></div>
      ) : (
        <div className={cx("transition-opacity", bd.loading && "opacity-60")} aria-busy={bd.loading || undefined}>
          <Kpis d={d} s={s} update={update} />
          {d.truncated ? <Notice tone="warn" className="mt-4" title="Showing part of the bills">There are more bills than can be added up at once. Narrow the dates or add a filter for exact figures.</Notice> : null}

          <Card className="mt-4">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <label htmlFor="by" className="mb-1 block text-sm font-semibold">Split by</label>
                <select id="by" value={by} onChange={(e) => update({ by: e.target.value, bills: false, page: 0 })} className="min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-[15px] focus:border-brand" data-testid="split-by">
                  <optgroup label="Over time">{dims.filter((x) => x.time).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
                  <optgroup label="Category">{dims.filter((x) => !x.time).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
                </select>
              </div>
              <ViewToggle isTime={isTime} by={by} view={s.view} m={M} update={update} />
            </div>
            <h2 className="mb-2 font-display text-lg font-bold">{M.label} by {(dimInfo(by)?.label || by).toLowerCase()}<span className="ml-2 text-[14px] font-normal text-ink/65">click any {isTime ? "bar or point" : "slice, bar or legend row"} to look inside it</span></h2>
            {d.totals.orders === 0 ? (
              <Empty icon="search" title="Nothing here" hint="No bills match these dates and filters. Try a longer date range or remove a filter." action={<Button onClick={() => update({ filters: s.filters.filter(locked), bills: false })}>Clear the filters</Button>} />
            ) : (
              <ChartArea d={d} s={s} by={by} isTime={isTime} M={M} pick={pick} />
            )}
          </Card>

          {d.totals.orders > 0 ? (
            <>
              <Card className="mt-4">
                <BreakdownTable d={d} by={by} M={M} isTime={isTime} pick={pick} />
              </Card>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant={s.bills ? "secondary" : "primary"} aria-expanded={s.bills} onClick={() => update({ bills: !s.bills, page: 0 })} data-testid="show-bills">
                  {s.bills ? "Hide bills" : `Show bills (${d.totals.orders})`}
                </Button>
                <Button variant="secondary" busy={csvBusy} onClick={csv} data-testid="csv"><Icon name="download" className="h-4 w-4" />Download CSV</Button>
                {csvErr ? <p role="alert" className="text-[14px] font-medium text-bad">{csvErr}</p> : null}
              </div>
            </>
          ) : null}
        </div>
      )}

      {s.bills ? (
        <div ref={recRef} className="mt-4" id="bills">
          <Records s={s} rec={rec} update={update} hideRestaurant={!!lock && lock.dim === "restaurant"} csv={csv} csvBusy={csvBusy} />
        </div>
      ) : null}

      <BillDrawer open={!!s.bill} tid={s.bill?.tid} id={s.bill?.id} onClose={() => update({ bill: null }, true)} />
    </div>
  );
}

// ---------------------------------------------------------------- dates
function RangeBar({ s, update }) {
  const cur = presetOf(s.from, s.to);
  const [custom, setCustom] = useState(false);
  const [err, setErr] = useState("");
  const showCustom = custom || cur === "custom";
  const set = (from, to) => {
    if (!from || !to) return;
    if (from > to) return setErr("The start date must be before the end date.");
    if (daysBetween(from, to) > 366) return setErr("Choose a range of at most one year.");
    setErr("");
    update({ from, to, page: 0, bill: null });
  };
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3" data-testid="range">
      <div role="group" aria-label="Dates" className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={cur === p.id && !custom} onClick={() => { setCustom(false); setErr(""); const r = presetRange(p.id); set(r.from, r.to); }} className={cx("min-h-[44px] rounded-xl border px-3.5 text-[15px] font-semibold", cur === p.id && !custom ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand/40")}>{p.label}</button>
        ))}
        <button type="button" aria-pressed={showCustom} onClick={() => setCustom(true)} className={cx("min-h-[44px] rounded-xl border px-3.5 text-[15px] font-semibold", showCustom ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand/40")}>Custom</button>
      </div>
      {showCustom ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm font-semibold">From<input type="date" value={s.from} max={s.to} onChange={(e) => set(e.target.value, s.to)} className="mt-1 block min-h-[44px] rounded-xl border border-line bg-white px-3 text-[15px]" /></label>
          <label className="text-sm font-semibold">To<input type="date" value={s.to} min={s.from} max={todayIST()} onChange={(e) => set(s.from, e.target.value)} className="mt-1 block min-h-[44px] rounded-xl border border-line bg-white px-3 text-[15px]" /></label>
        </div>
      ) : null}
      <Toggle checked={s.compare} onChange={(v) => update({ compare: v }, true)} label="Compare with the period before" />
      <p className="basis-full text-[14px] text-ink/70">{s.from === s.to ? prettyDay(s.from) : `${prettyDay(s.from)} to ${prettyDay(s.to)}`} ({daysBetween(s.from, s.to)} day{daysBetween(s.from, s.to) === 1 ? "" : "s"})</p>
      {err ? <p role="alert" className="basis-full text-[14px] font-medium text-bad">{err}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- the layers you are inside
function Layers({ s, lock, labelOf, update, popTo, removeAt }) {
  const pre = s.filters.length;
  return (
    <nav aria-label="Layers you are inside" className="mt-4" data-testid="layers">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <button type="button" disabled={!s.filters.some((f) => !(lock && f.dim === lock.dim))} onClick={() => update({ filters: s.filters.filter((f) => lock && f.dim === lock.dim), by: undefined, bills: false, page: 0, bill: null })} className="min-h-[36px] rounded-full px-2.5 text-[14px] font-semibold text-brand underline-offset-2 hover:underline disabled:text-ink/70 disabled:no-underline">
            {lock ? lock.label || "This restaurant" : "All restaurants"}
          </button>
        </li>
        {s.filters.map((f, i) => {
          const isLock = lock && f.dim === lock.dim;
          if (isLock) return null;
          return (
            <li key={f.dim + f.value} className="flex items-center gap-1.5">
              <Icon name="chevron" className="h-3.5 w-3.5 text-ink/40" />
              <span className="inline-flex min-h-[36px] items-center rounded-full bg-brand-soft pl-3 text-[14px] font-semibold text-brand" data-testid="chip">
                <button type="button" className="py-1 text-left" onClick={() => popTo(i)} title="Go back to this layer" aria-label={`${f.dim.replace("_", " ")}: ${labelOf(f.dim, f.value)}. Go back to this layer`}>
                  <span className="font-normal text-ink/70">{f.dim.replace("_", " ")}:</span> {labelOf(f.dim, f.value)}
                </button>
                <button type="button" onClick={() => removeAt(i)} aria-label={`Remove the filter ${f.dim.replace("_", " ")}: ${labelOf(f.dim, f.value)}`} className="ml-1 grid h-9 w-9 place-items-center rounded-full hover:bg-brand/10"><Icon name="x" className="h-4 w-4" /></button>
              </span>
            </li>
          );
        })}
        {pre === 0 ? <li className="text-[14px] text-ink/65">Click a slice or bar to look inside it.</li> : null}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------- KPI tiles
function Kpis({ d, s, update }) {
  const prev = s.compare ? d.previous : null;
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" role="group" aria-label="Choose what to measure" data-testid="kpis">
      {MEASURES.map((m) => {
        const v = d.totals[m.key];
        const dl = prev ? delta(v, prev[m.key]) : null;
        const up = dl !== null && dl > 0, down = dl !== null && dl < 0;
        const on = s.m === m.key;
        return (
          <button key={m.key} type="button" aria-pressed={on} onClick={() => update({ m: m.key }, true)} data-testid={"kpi-" + m.key} className={cx("rounded-2xl border bg-white p-3.5 text-left shadow-card transition", on ? "border-brand ring-2 ring-brand" : "border-line hover:border-brand/40")}>
            <span className="block text-[14px] font-semibold text-ink/70">{m.label}</span>
            <span className="mt-0.5 block font-display text-2xl font-extrabold tracking-tight">{m.fmt(v)}</span>
            {prev ? (
              <span className={cx("mt-0.5 block text-[13px] font-semibold", m.key === "discount" || m.key === "tax" ? "text-ink/70" : up ? "text-good" : down ? "text-bad" : "text-ink/70")} aria-label={`${pct(dl) || "no change"} compared with the period before, which was ${m.fmt(prev[m.key])}`}>
                {up ? "▲ " : down ? "▼ " : ""}{pct(dl) || "0%"} <span className="font-normal text-ink/60">vs {m.fmt(prev[m.key])}</span>
              </span>
            ) : <span className="mt-0.5 block text-[13px] text-ink/50">&nbsp;</span>}
          </button>
        );
      })}
      {prev ? <p className="col-span-full -mt-1 text-[13px] text-ink/65">Compared with {prev.from === prev.to ? prettyDay(prev.from) : `${prettyDay(prev.from)} to ${prettyDay(prev.to)}`}.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- chart
function ViewToggle({ isTime, by, view, m, update }) {
  const opts = (isTime ? TIME_VIEWS : by === "restaurant" ? REST_VIEWS : CAT_VIEWS).filter((o) => m.additive || o.id !== "donut");
  const cur = opts.some((o) => o.id === view) ? view : opts[0].id;
  if (opts.length < 2) return null;
  return (
    <div role="group" aria-label="Chart style" className="flex gap-1">
      {opts.map((o) => (
        <button key={o.id} type="button" aria-pressed={cur === o.id} onClick={() => update({ view: o.id }, true)} className={cx("min-h-[44px] rounded-xl border px-3.5 text-[15px] font-semibold", cur === o.id ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand/40")}>{o.label}</button>
      ))}
    </div>
  );
}

function makeItems(rows, by, isTime, M) {
  const val = (r) => r[M.key] || 0;
  const sum = rows.reduce((a, r) => a + Math.max(0, val(r)), 0);
  let items = rows.map((r) => ({
    key: r.key,
    label: by === "day" ? prettyDay(r.key) : by === "month" ? r.label : r.label,
    short: by === "day" ? shortDay(r.key) : by === "hour" ? r.key : by === "weekday" ? r.label.slice(0, 3) : r.label,
    value: val(r),
    text: M.fmt(val(r)),
    fraction: M.additive ? (sum ? Math.max(0, val(r)) / sum : 0) : r.share || 0,
  }));
  if (!isTime) items = items.sort((a, b) => b.value - a.value);
  return items;
}

function ChartArea({ d, s, by, isTime, M, pick }) {
  const opts = (isTime ? TIME_VIEWS : by === "restaurant" ? REST_VIEWS : CAT_VIEWS).filter((o) => M.additive || o.id !== "donut");
  const view = opts.some((o) => o.id === s.view) ? s.view : opts[0].id;
  const items = useMemo(() => makeItems(d.rows, by, isTime, M), [d.rows, by, isTime, M.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = `${M.label} by ${d.label.toLowerCase()}`;
  const money_ = M.fmt === money;
  if (isTime) {
    const colored = items.map((i) => ({ ...i, color: PALETTE[0] }));
    return view === "bars" ? <Bars items={colored} money={money_} onPick={pick} title={title} /> : <Line items={colored} money={money_} onPick={pick} title={title} area={view === "area"} />;
  }
  if (view === "donut") {
    const shown = colorize(topWithOthers(items, 7, M.fmt));
    return <Donut items={shown} total={M.fmt(items.reduce((a, i) => a + i.value, 0))} centerLabel={M.label} onPick={pick} title={title} />;
  }
  const list = items.slice(0, 15);
  return (
    <>
      <HBars items={list.map((i) => ({ ...i, color: PALETTE[0] }))} onPick={pick} title={title} />
      {items.length > list.length ? <p className="mt-2 text-[13px] text-ink/65">Showing the top {list.length} of {items.length}. The table below has all of them.</p> : null}
    </>
  );
}

// ---------------------------------------------------------------- breakdown table
const COLS = [
  { key: "sales", label: "Sales", fmt: money },
  { key: "orders", label: "Orders", fmt: String },
  { key: "avg_bill", label: "Avg bill", fmt: money },
  { key: "items", label: "Items", fmt: String },
  { key: "discount", label: "Discount", fmt: money },
  { key: "tax", label: "GST", fmt: money },
];
function BreakdownTable({ d, by, M, isTime, pick }) {
  const [sort, setSort] = useState({ key: null, dir: -1 });
  useEffect(() => setSort({ key: null, dir: -1 }), [by]);
  const rows = useMemo(() => {
    const r = [...d.rows];
    if (sort.key === "label") r.sort((a, b) => a.label.localeCompare(b.label) * sort.dir * -1);
    else if (sort.key) r.sort((a, b) => (a[sort.key] - b[sort.key]) * sort.dir);
    else if (!isTime) r.sort((a, b) => b[M.key] - a[M.key]);
    return r;
  }, [d.rows, sort, isTime, M.key]);
  const max = Math.max(1, ...d.rows.map((r) => r[M.key] || 0));
  const th = (key, label, right) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none"} className={cx("px-3 py-2 font-semibold", right && "text-right")}>
      <button type="button" onClick={() => setSort((p) => ({ key, dir: p.key === key ? -p.dir : key === "label" ? -1 : -1 }))} className={cx("inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap hover:text-brand", sort.key === key && "text-brand")}>
        {label}<span aria-hidden="true" className="text-[11px]">{sort.key === key ? (sort.dir > 0 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
  return (
    <div>
      <h2 className="mb-2 font-display text-lg font-bold">{d.label} in numbers</h2>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[640px] border-collapse text-[14px]" data-testid="breakdown">
          <thead className="border-b border-line text-left text-ink/75">
            <tr>{th("label", d.label)}{COLS.map((c) => th(c.key, c.label, true))}<th scope="col" className="px-3 py-2 font-semibold">Share of {M.label.toLowerCase()}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const live = r.orders > 0 && (r.sales > 0 || r.orders > 0);
              return (
                <tr key={r.key} onClick={live ? () => pick({ key: r.key, label: r.label }) : undefined} className={cx("border-b border-line/70", live ? "cursor-pointer hover:bg-brand-soft/60" : "text-ink/45")} data-testid="row">
                  <th scope="row" className="px-3 py-1 text-left font-semibold">
                    {live ? <button type="button" onClick={(e) => { e.stopPropagation(); pick({ key: r.key, label: r.label }); }} aria-label={`${r.label}: ${money(r.sales)}, ${r.orders} orders. Look inside`} className="min-h-[36px] max-w-[220px] truncate text-left hover:text-brand hover:underline">{by === "day" ? prettyDay(r.key) : r.label}</button> : <span className="block min-h-[36px] py-2">{by === "day" ? prettyDay(r.key) : r.label}</span>}
                  </th>
                  {COLS.map((c) => <td key={c.key} className={cx("px-3 py-1 text-right tabular-nums", c.key === M.key && "font-bold")}>{c.fmt(r[c.key] || 0)}</td>)}
                  <td className="min-w-[120px] px-3 py-1">
                    <div className="flex items-center gap-2" title={`${share(M.additive ? (r[M.key] || 0) / (d.rows.reduce((a, x) => a + Math.max(0, x[M.key] || 0), 0) || 1) : r.share)}`}>
                      <div className="h-2.5 flex-1 rounded-full bg-line" aria-hidden="true"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(r[M.key] > 0 ? 2 : 0, ((r[M.key] || 0) / max) * 100)}%` }} /></div>
                      <span className="w-11 text-right tabular-nums text-ink/75">{share(M.additive ? (r[M.key] || 0) / (d.rows.reduce((a, x) => a + Math.max(0, x[M.key] || 0), 0) || 1) : r.share)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-bold">
              <th scope="row" className="px-3 py-2 text-left">Total</th>
              {COLS.map((c) => <td key={c.key} className="px-3 py-2 text-right tabular-nums">{c.fmt(d.totals[c.key])}</td>)}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bills
const STATE_TONE = { paid: "good", completed: "good", delivered: "good", served: "good", refunded: "warn", void: "bad", cancelled: "bad" };
function Records({ s, rec, update, hideRestaurant, csv, csvBusy }) {
  const r = rec.data;
  const pages = r ? Math.max(1, Math.ceil(r.total_count / PAGE)) : 1;
  const open = (row) => update({ bill: { tid: row.restaurant_id, id: row.id } }, true);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-lg font-bold">Bills{r ? ` (${r.total_count})` : ""}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm font-semibold">Sort by
            <select value={s.sort} onChange={(e) => update({ sort: e.target.value, page: 0 }, true)} className="mt-1 block min-h-[44px] rounded-xl border border-line bg-white px-3 text-[15px]">
              <option value="created_at">Newest first</option><option value="total">Biggest bill</option><option value="net">Most paid</option>
            </select>
          </label>
          <Button variant="secondary" busy={csvBusy} onClick={csv}><Icon name="download" className="h-4 w-4" />CSV</Button>
        </div>
      </div>
      {rec.error ? <ErrorBox text={niceError(rec.error)} onRetry={rec.retry} /> : null}
      {rec.loading && !r ? <div role="status" aria-label="Loading the bills" className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div> : null}
      {r && r.rows.length === 0 ? <Empty title="No bills" hint="Nothing matches these dates and filters." /> : null}
      {r && r.rows.length ? (
        <>
          {r.truncated ? <Notice tone="warn" className="mb-3" title="Showing part of the bills">There are more bills than can be listed at once. Narrow the dates or add a filter.</Notice> : null}
          <div className={cx("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", rec.loading && "opacity-60")}>
            <table className="w-full min-w-[560px] border-collapse text-[14px]" data-testid="bills">
              <thead className="border-b border-line text-left text-ink/75">
                <tr>
                  <th scope="col" className="px-2 py-2 font-semibold">Bill</th>
                  <th scope="col" className="px-2 py-2 font-semibold">When</th>
                  {hideRestaurant ? null : <th scope="col" className="px-2 py-2 font-semibold">Restaurant</th>}
                  <th scope="col" className="hidden px-2 py-2 font-semibold md:table-cell">Type</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Status</th>
                  <th scope="col" className="hidden px-2 py-2 font-semibold lg:table-cell">Customer</th>
                  <th scope="col" className="hidden px-2 py-2 font-semibold lg:table-cell">Items</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Total</th>
                  <th scope="col" className="hidden px-2 py-2 font-semibold sm:table-cell">Paid with</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.restaurant_id + x.id} onClick={() => open(x)} className="cursor-pointer border-b border-line/70 hover:bg-brand-soft/60" data-testid="bill-row">
                    <th scope="row" className="px-2 py-1 text-left font-bold">
                      <button type="button" onClick={(e) => { e.stopPropagation(); open(x); }} aria-label={`Open bill ${x.order_no} from ${x.restaurant || "this restaurant"}, ${money(x.total)}`} className="min-h-[44px] min-w-[44px] text-left text-brand underline underline-offset-2">#{x.order_no}</button>
                    </th>
                    <td className="whitespace-nowrap px-2 py-1">{dateOf(x.created_at)}, {timeOf(x.created_at)}</td>
                    {hideRestaurant ? null : <td className="max-w-[160px] truncate px-2 py-1">{x.restaurant}</td>}
                    <td className="hidden px-2 py-1 md:table-cell">{x.type}<span className="text-ink/60">{x.channel === "online" ? ", online" : ""}</span></td>
                    <td className="px-2 py-1"><Chip tone={STATE_TONE[x.state] || "mute"}>{x.state.replace(/_/g, " ")}</Chip></td>
                    <td className="hidden max-w-[140px] truncate px-2 py-1 lg:table-cell">{x.customer || x.phone || "Walk-in"}</td>
                    <td className="hidden max-w-[220px] truncate px-2 py-1 text-ink/75 lg:table-cell" title={x.items.join(", ")}>{x.items.join(", ")}</td>
                    <td className="px-2 py-1 text-right font-bold tabular-nums">{money(x.total)}{x.net !== x.total ? <span className="block text-[12px] font-normal text-ink/60">paid {money(x.net)}</span> : null}</td>
                    <td className="hidden px-2 py-1 uppercase sm:table-cell">{x.modes.join(" + ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] text-ink/75" aria-live="polite">Showing {s.page * PAGE + 1} to {Math.min(r.total_count, s.page * PAGE + r.rows.length)} of {r.total_count}</p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={s.page <= 0} onClick={() => update({ page: s.page - 1 }, true)}>Previous</Button>
              <span className="text-[14px]">Page {s.page + 1} of {pages}</span>
              <Button variant="secondary" disabled={s.page + 1 >= pages} onClick={() => update({ page: s.page + 1 }, true)}>Next</Button>
            </div>
          </div>
        </>
      ) : null}
    </Card>
  );
}
