import { money } from "@nova/shared";
import { api, niceError, useLoad } from "../lib/api";
import { Chip, ErrorBox, Skeleton } from "../ui";
import Drawer from "./Drawer";

const stamp = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
};
const title = (s) => String(s ?? "").replace(/[_.]/g, " ").replace(/^./, (c) => c.toUpperCase());
const TONE = { paid: "good", completed: "good", delivered: "good", served: "good", refunded: "warn", void: "bad", cancelled: "bad", open: "info" };
const isMoneyKey = (k) => /(^|_)(amount|total|subtotal|tax|discount|price|paid|balance|tendered|change|fee|charge)$/.test(k);

const SEEN = new Set([
  "id", "bill_no", "type", "table", "customer", "lines", "discount", "status", "payments", "refunds", "totals", "created_by", "created_at", "business_date",
  "history", "online", "paid", "balance", "state", "restaurant", "restaurant_id", "channel",
]);
const SEEN_ONLINE = new Set(["timeline", "status", "address", "notes", "coupon", "driver", "payment_method", "type", "placed_at", "customer_id", "distance_km"]);

/** Any value at all, shown plainly. Used for the fields this screen has no special layout for, so nothing is hidden. */
function Value({ k, v }) {
  if (v === null || v === undefined || v === "") return <span className="text-ink/50">None</span>;
  if (typeof v === "boolean") return <>{v ? "Yes" : "No"}</>;
  if (typeof v === "number") return <>{isMoneyKey(k || "") ? money(v) : v}</>;
  if (typeof v === "string") return <>{/^\d{4}-\d{2}-\d{2}T/.test(v) ? stamp(v) : v}</>;
  if (Array.isArray(v)) return v.length ? <ul className="space-y-1">{v.map((x, i) => <li key={i} className="rounded-lg bg-surface px-2 py-1"><Value k={k} v={x} /></li>)}</ul> : <span className="text-ink/50">None</span>;
  return <Kv obj={v} />;
}
function Kv({ obj }) {
  const rows = Object.entries(obj);
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[13px] text-ink/65">{title(k)}</dt>
          <dd className="min-w-0 break-words text-[14px]"><Value k={k} v={v} /></dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ name, children, count }) {
  return (
    <section className="mb-5" aria-label={name}>
      <h3 className="mb-2 flex items-center gap-2 font-display text-base font-bold">{name}{count !== undefined ? <span className="text-[13px] font-semibold text-ink/60">{count}</span> : null}</h3>
      {children}
    </section>
  );
}

function Money({ label, v, strong, sign }) {
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${strong ? "border-t border-line pt-1.5 font-extrabold" : ""}`}>
      <dt className={strong ? "" : "text-ink/75"}>{label}</dt>
      <dd className="tabular-nums">{sign}{money(v)}</dd>
    </div>
  );
}

export function BillBody({ b }) {
  const o = b.online;
  const extra = Object.fromEntries(Object.entries(b).filter(([k]) => !SEEN.has(k)));
  const extraOnline = o ? Object.fromEntries(Object.entries(o).filter(([k]) => !SEEN_ONLINE.has(k))) : {};
  const t = b.totals || {};
  const lines = b.lines || [];
  const events = [
    ...(o?.timeline || []).map((e) => ({ at: e.at, text: `Order ${title(e.status).toLowerCase()}`, by: e.by, detail: e.reason })),
    ...(b.history || []).map((h) => ({ at: h.ts, text: title(h.action), by: h.by, detail: h.detail })),
  ].sort((x, y) => String(x.at).localeCompare(String(y.at)));
  return (
    <div data-testid="bill-detail">
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={TONE[b.state] || "mute"}>{title(b.state)}</Chip>
        <Chip tone="info">{b.channel === "online" ? "Online order" : "Counter"}</Chip>
        <Chip>{title(b.type)}</Chip>
        {b.table ? <Chip>Table {b.table}</Chip> : null}
        {b.status !== b.state ? <Chip>Bill {b.status}</Chip> : null}
      </div>

      <Section name="Bill">
        <Kv obj={{ restaurant: b.restaurant, order_no: b.bill_no, placed: stamp(b.created_at), business_day: b.business_date, taken_by: b.created_by }} />
      </Section>

      <Section name="Items" count={lines.filter((l) => l.qty > 0).length}>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {lines.map((l, i) => (
            <li key={l.lid || i} className={`flex gap-3 px-3 py-2 ${l.qty <= 0 ? "opacity-50" : ""}`}>
              <span className="w-8 shrink-0 font-bold tabular-nums">{l.qty}x</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{l.name}{l.fee ? <span className="ml-1 text-[13px] font-normal text-ink/60">(fee)</span> : null}{l.qty <= 0 ? <span className="ml-1 text-[13px] font-normal">(removed)</span> : null}</span>
                {l.note ? <span className="mt-0.5 block rounded-md bg-warn-soft px-2 py-0.5 text-[13px] text-[#8a4e05]">Note: {l.note}</span> : null}
                <span className="block text-[13px] text-ink/65">{money(l.price)} each{l.station ? `, ${l.station}` : ""}{l.tax_rate !== undefined ? `, GST ${(l.tax_rate * 100).toFixed(0)}%` : ""}{l.kot_qty ? `, ${l.kot_qty} sent to kitchen` : ""}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{money(l.price * Math.max(0, l.qty))}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section name="Totals">
        <dl className="rounded-xl bg-surface p-3">
          <Money label="Subtotal" v={t.subtotal} />
          {t.discount ? <Money label={`Discount${b.discount?.value ? ` (${b.discount.kind === "pct" ? b.discount.value + "%" : "amount"}${b.discount.reason ? ", " + b.discount.reason : ""}${b.discount.by ? ", by " + b.discount.by : ""})` : ""}`} v={t.discount} sign="-" /> : null}
          <Money label="GST" v={t.tax} />
          <Money label="Total" v={t.total} strong />
          <Money label="Paid (kept)" v={b.paid} />
          {b.balance ? <Money label="Still to pay" v={b.balance} /> : null}
        </dl>
      </Section>

      <Section name="Payments" count={(b.payments || []).length}>
        {(b.payments || []).length ? (
          <ul className="space-y-2">
            {b.payments.map((p, i) => (
              <li key={p.id || i} className="rounded-xl border border-line p-3">
                <div className="flex justify-between gap-3"><b className="uppercase">{p.mode}</b><b className="tabular-nums">{money(p.amount)}</b></div>
                <p className="text-[13px] text-ink/70">{stamp(p.at)}{p.by ? `, taken by ${p.by}` : ""}</p>
                {p.ref ? <p className="text-[13px]">Reference <span className="font-mono">{p.ref}</span></p> : null}
                {p.change ? <p className="text-[13px]">Customer gave {money(p.tendered)}, change {money(p.change)}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-ink/65">No payment taken{o?.payment_method === "cod" ? " yet (pay on delivery)" : ""}.</p>}
        {o?.payment_method ? <p className="mt-2 text-[13px] text-ink/70">Customer chose: {o.payment_method === "cod" ? "pay on delivery" : "pay online"}</p> : null}
      </Section>

      {(b.refunds || []).length ? (
        <Section name="Refunds" count={b.refunds.length}>
          <ul className="space-y-2">
            {b.refunds.map((r, i) => (
              <li key={r.id || i} className="rounded-xl border border-warn/40 bg-warn-soft p-3">
                <div className="flex justify-between gap-3"><b className="uppercase">{r.mode}</b><b className="tabular-nums">-{money(r.amount)}</b></div>
                <p className="text-[13px]">{stamp(r.at)}{r.by ? `, by ${r.by}` : ""}</p>
                {r.reason ? <p className="text-[13px]">Reason: {r.reason}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section name="Customer">
        {b.customer && (b.customer.name || b.customer.phone) ? (
          <p><b>{b.customer.name || "No name"}</b>{b.customer.phone ? <> <a className="prose-link ml-1" href={`tel:${b.customer.phone}`}>{b.customer.phone}</a></> : null}</p>
        ) : <p className="text-ink/65">Walk-in, no details taken.</p>}
        {o?.notes ? <p className="mt-2 rounded-lg bg-warn-soft px-2 py-1 text-[14px]">Customer note: {o.notes}</p> : null}
        {o?.coupon ? <div className="mt-2 text-[14px]">Offer used: {typeof o.coupon === "object" ? <Kv obj={o.coupon} /> : o.coupon}</div> : null}
      </Section>

      {o && (o.address || o.driver) ? (
        <Section name="Delivery">
          {o.address ? <Kv obj={typeof o.address === "object" ? o.address : { address: o.address }} /> : null}
          {o.distance_km !== undefined && o.distance_km !== null ? <p className="mt-1 text-[13px] text-ink/70">Distance {o.distance_km} km</p> : null}
          {o.driver ? <p className="mt-2 rounded-xl border border-line p-3"><span className="text-[13px] text-ink/65">Rider</span><br /><b>{o.driver.name}</b>{o.driver.phone ? <> <a className="prose-link ml-1" href={`tel:${o.driver.phone}`}>{o.driver.phone}</a></> : null}{o.driver.assigned_by ? <span className="block text-[13px] text-ink/65">Assigned by {o.driver.assigned_by}</span> : null}</p> : <p className="mt-2 text-ink/65">No rider assigned.</p>}
        </Section>
      ) : null}

      <Section name="Timeline, minute by minute" count={events.length}>
        {events.length ? (
          <ol className="relative ml-2 space-y-3 border-l-2 border-line pl-4" data-testid="timeline">
            {events.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden="true" />
                <p className="font-semibold">{e.text}</p>
                <p className="text-[13px] text-ink/65">{stamp(e.at)}{e.by ? `, ${e.by}` : ""}</p>
                {e.detail ? <div className="mt-0.5 text-[13px]">{typeof e.detail === "object" ? <Kv obj={e.detail} /> : e.detail}</div> : null}
              </li>
            ))}
          </ol>
        ) : <p className="text-ink/65">No steps recorded.</p>}
      </Section>

      {Object.keys(extra).length || Object.keys(extraOnline).length ? (
        <Section name="Other details">
          <Kv obj={{ ...extra, ...extraOnline }} />
        </Section>
      ) : null}
      <p className="text-[12px] text-ink/50">Bill id {b.id}</p>
    </div>
  );
}

export default function BillDrawer({ open, tid, id, onClose }) {
  const q = useLoad(() => (open && tid && id ? api.get(`/v2/platform/analytics/bill/${encodeURIComponent(tid)}/${encodeURIComponent(id)}`) : Promise.resolve(null)), [open, tid, id]);
  const b = q.data;
  return (
    <Drawer open={open} onClose={onClose} title={b ? `Bill #${b.bill_no}` : "Bill"} subtitle={b ? <>{b.restaurant}, {stamp(b.created_at)}</> : null}>
      {q.loading ? <div role="status" aria-label="Loading the bill" className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-40" /><Skeleton className="h-32" /></div> : null}
      {q.error ? <ErrorBox text={q.error.status === 404 ? "We could not find this bill. It may have been removed." : niceError(q.error)} onRetry={q.error.status === 404 ? undefined : q.retry} /> : null}
      {b ? <BillBody b={b} /> : null}
    </Drawer>
  );
}
