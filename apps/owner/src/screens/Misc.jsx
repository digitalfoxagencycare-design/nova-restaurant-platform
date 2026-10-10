import { useState } from "react";
import { ago, mapsLink, money, timeOf } from "@nova/shared";
import { api } from "../session.js";
import { Card, Empty, ErrorBox, Field, Icon, inputCls, Spinner, usePoll } from "../ui.jsx";
import { Bar, SubHeader } from "../ui-extra.jsx";

export function Riders({ onBack }) {
  const q = usePoll(() => api.get("/v2/delivery/drivers"), 10000, []);
  return (
    <div className="space-y-3">
      <SubHeader title="Riders" onBack={onBack} />
      {q.error ? <ErrorBox message={q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div> : null}
      {q.data && !q.data.length ? <Empty icon="bike" title="No riders yet" hint="Invite someone with the Delivery partner role under Staff." /> : null}
      <ul className="space-y-2">
        {(q.data || []).map((d) => (
          <li key={d.id}>
            <Card className="!p-3">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${d.online ? "bg-good" : "bg-line"}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{d.name}</p>
                  <p className="text-sm font-semibold">{d.status !== "active" ? <span className="text-bad">Disabled</span> : d.online ? <span className="text-good">Online</span> : <span className="opacity-70">Offline</span>}
                    <span className="font-normal opacity-70"> · {d.active_orders} on the road{d.battery != null ? ` · battery ${d.battery}%` : ""}</span></p>
                  <p className="text-xs opacity-60">{d.seen_at ? `Last seen ${ago(d.seen_at)}` : "Never shared a location"}</p>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                {d.phone ? <a href={`tel:${d.phone}`} className="active-press inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold"><Icon name="phone" className="h-4 w-4" />Call</a>
                  : <span className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-dashed border-line text-xs opacity-60">No phone saved</span>}
                {d.lat != null ? <a href={mapsLink({ lat: d.lat, lng: d.lng })} target="_blank" rel="noopener noreferrer" className="active-press inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold"><Icon name="pin" className="h-4 w-4" />Open map</a>
                  : <span className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-dashed border-line text-xs opacity-60">No location</span>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Tables({ onBack }) {
  const q = usePoll(() => api.get("/v2/tables"), 10000, []);
  const rows = q.data || [];
  return (
    <div className="space-y-3">
      <SubHeader title="Tables" onBack={onBack} />
      {q.error ? <ErrorBox message={q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div> : null}
      {q.data && !rows.length ? <Empty icon="grid" title="No tables set up" /> : null}
      {rows.length ? <p className="text-sm opacity-80">{rows.filter((t) => t.state === "occupied").length} occupied, {rows.filter((t) => t.state === "free").length} free</p> : null}
      <ul className="grid grid-cols-3 gap-2">
        {rows.map((t) => (
          <li key={t.table} className={`rounded-2xl border p-3 text-center ${t.state === "occupied" ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
            <p className="font-display text-lg font-extrabold">{t.table}</p>
            <p className={`text-xs font-bold ${t.state === "occupied" ? "text-accent" : "text-good"}`}>{t.state === "occupied" ? "Occupied" : "Free"}</p>
            {t.bill ? <p className="mt-0.5 text-xs opacity-70">{money(t.bill.total)} · {timeOf(t.bill.since)}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MODE = { cash: "Cash", upi: "UPI", card: "Card" };
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

export function DaySummary({ onBack }) {
  const [date, setDate] = useState(todayIso());
  const q = usePoll(() => api.get("/v2/pos/reports/day", { query: { date } }), 0, [date]);
  const r = q.data;
  const net = r ? Object.entries(r.by_mode) : [];
  const maxMode = Math.max(1, ...net.map(([, v]) => Math.abs(v)));
  const row = (label, value, strong) => <div className={`flex justify-between gap-3 border-b border-line py-2.5 last:border-0 ${strong ? "font-display text-lg font-extrabold" : "text-sm"}`}><dt>{label}</dt><dd className="font-semibold">{value}</dd></div>;
  return (
    <div className="space-y-3">
      <SubHeader title="Day summary" onBack={onBack} />
      <Field label="Date" id="ddate"><input id="ddate" type="date" className={inputCls} value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
      {q.error ? <ErrorBox message={q.error.status === 403 ? "You are not allowed to see reports." : q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !r ? <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div> : null}
      {r ? (
        <>
          <Card>
            <dl>
              {row("Sales", money(r.sales), true)}
              {row("Paid bills", r.bills_paid)}
              {row("Discounts given", money(r.discounts))}
              {row("Refunds", money(r.refunds))}
              {row("Voided bills", r.voided_bills)}
              {row("Still open", r.still_open)}
              {row("Net collected", money(r.net_collected), true)}
            </dl>
          </Card>
          <Card>
            <h3 className="font-display text-base font-bold">By payment mode</h3>
            {net.length ? net.map(([m, v]) => <Bar key={m} label={MODE[m] || m} value={money(v)} pct={(Math.abs(v) / maxMode) * 100} tone="bg-accent" />) : <p className="py-2 text-sm opacity-70">No payments on this day.</p>}
          </Card>
        </>
      ) : null}
    </div>
  );
}
