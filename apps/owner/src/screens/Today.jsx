import { useEffect, useState } from "react";
import { money } from "@nova/shared";
import { api } from "../session.js";
import { useApp } from "../ctx.js";
import { Button, Card, ErrorBox, Icon, Spinner, Switch, useToast, usePoll } from "../ui.jsx";
import { Bar } from "../ui-extra.jsx";

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-line p-3 shadow-card ${tone || "bg-surface"}`}>
      <p className="truncate text-xs font-semibold opacity-70">{label}</p>
      <p className="truncate font-display text-2xl font-extrabold leading-tight">{value}</p>
      {sub ? <p className="truncate text-xs opacity-70">{sub}</p> : null}
    </div>
  );
}

function StoreCard() {
  const { can } = useApp();
  const toast = useToast();
  const q = usePoll(() => api.get("/v2/store"), 0, []);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = can("orders.update");
  const s = q.data;
  useEffect(() => { if (s) setNotice(s.notice || ""); }, [s && s.notice]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch, okText) {
    setBusy(true);
    try {
      await api.put("/v2/store", patch);
      await q.reload();
      if (okText) toast(okText, "good");
    } catch (e) { toast(e.code === "FORBIDDEN" ? "You are not allowed to change this." : e.message, "bad"); await q.reload(); }
    finally { setBusy(false); }
  }

  if (q.error && !s) return <ErrorBox message={q.error.message} onRetry={q.reload} />;
  if (!s) return <div className="h-32 animate-pulse rounded-2xl bg-line" />;
  const open = !s.paused;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-extrabold">Online ordering</p>
          <p className={`text-sm font-semibold ${open ? "text-good" : "text-warn"}`} data-testid="store-state">{open ? "Open. Customers can order." : "Paused. Customers cannot order."}</p>
        </div>
        <Switch checked={open} disabled={busy || !editable} label="Online ordering" onChange={(v) => save({ paused: !v }, v ? "Online ordering is on" : "Online ordering is paused")} />
      </div>
      <div className="mt-4">
        <label htmlFor="notice" className="mb-1 block text-sm font-semibold">Notice for customers</label>
        <textarea id="notice" rows={2} maxLength={160} value={notice} disabled={!editable} onChange={(e) => setNotice(e.target.value)}
          placeholder="For example: Delivery is slow today because of rain"
          className="block w-full rounded-xl border border-line bg-surface px-3 py-2 text-base placeholder:opacity-50" />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs opacity-60">{notice.length}/160. Shown on the storefront, and when ordering is paused.</span>
          {editable ? <Button kind="soft" className="!min-h-[44px]" busy={busy} disabled={notice === (s.notice || "")} onClick={() => save({ notice }, "Notice saved")}>Save</Button> : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <div className="min-w-0">
          <p className="font-semibold">Auto-accept orders</p>
          <p className="text-xs opacity-70">New online orders go straight to the kitchen.</p>
        </div>
        <Switch checked={s.auto_accept} disabled={busy || !editable} label="Auto-accept orders" onChange={(v) => save({ auto_accept: v }, v ? "Auto-accept is on" : "Auto-accept is off")} />
      </div>
      {!editable ? <p className="mt-3 text-xs opacity-70">Your role can see this but not change it.</p> : null}
    </Card>
  );
}

const MODE = { cash: "Cash", upi: "UPI", card: "Card" };
const dayLabel = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 2);

function Overview() {
  const q = usePoll(() => api.get("/v2/overview"), 10000, []);
  const o = q.data;
  if (q.error && !o) return <ErrorBox message={q.error.code === "FORBIDDEN" ? "You are not allowed to see sales figures." : q.error.message} onRetry={q.reload} />;
  if (!o) return <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div>;
  const chTotal = (o.by_channel.online || 0) + (o.by_channel.pos || 0);
  const modeTotal = Object.values(o.by_mode).reduce((a, b) => a + Math.max(0, b), 0);
  const max7 = Math.max(1, ...o.last7.map((d) => d.sales));
  const maxItem = Math.max(1, ...o.top_items.map((i) => i.qty));
  return (
    <>
      <div className="grid grid-cols-2 gap-3" data-testid="tiles">
        <Tile label="Sales today" value={money(o.sales)} sub={`${o.bills} paid bills`} tone="bg-brand text-brand-on" />
        <Tile label="Average bill" value={money(o.avg_bill)} />
        <Tile label="Open online orders" value={o.open_online} sub={o.new_online ? `${o.new_online} waiting` : "None waiting"} />
        <Tile label="To collect" value={money(o.to_collect)} sub="From open online orders" />
      </div>

      <Card>
        <h3 className="font-display text-base font-bold">Online and counter</h3>
        {chTotal ? (
          <>
            <Bar label="Online" value={money(o.by_channel.online || 0)} pct={((o.by_channel.online || 0) / chTotal) * 100} tone="bg-accent" />
            <Bar label="Counter" value={money(o.by_channel.pos || 0)} pct={((o.by_channel.pos || 0) / chTotal) * 100} />
          </>
        ) : <p className="py-2 text-sm opacity-70">No paid bills yet today.</p>}
      </Card>

      <Card>
        <h3 className="font-display text-base font-bold">How customers paid</h3>
        {modeTotal ? Object.entries(o.by_mode).map(([m, v]) => <Bar key={m} label={MODE[m] || m} value={money(v)} pct={(Math.max(0, v) / modeTotal) * 100} />) : <p className="py-2 text-sm opacity-70">No payments yet today.</p>}
      </Card>

      <Card>
        <h3 className="font-display text-base font-bold">Last 7 days</h3>
        <div className="mt-3 flex h-36 items-end gap-2" role="img" aria-label={"Sales per day: " + o.last7.map((d) => `${dayLabel(d.date)} ${money(d.sales)}`).join(", ")}>
          {o.last7.map((d, i) => (
            <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <span className="mb-1 text-[10px] font-semibold opacity-70">{d.sales ? money(d.sales).replace(/,000$/, "k") : ""}</span>
              <div className={`w-full rounded-t-lg ${i === 6 ? "bg-accent" : "bg-brand"}`} style={{ height: `${Math.max(3, (d.sales / max7) * 100)}%`, opacity: d.sales ? 1 : 0.25 }} />
              <span className="mt-1 text-xs font-semibold">{dayLabel(d.date)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-display text-base font-bold">Best sellers today</h3>
        {o.top_items.length ? o.top_items.map((i) => <Bar key={i.name} label={i.name} value={`${i.qty} sold`} pct={(i.qty / maxItem) * 100} tone="bg-accent" />) : <p className="py-2 text-sm opacity-70">Nothing sold yet today.</p>}
      </Card>
    </>
  );
}

export default function Today() {
  const { can, placed, goOrders } = useApp();
  return (
    <div className="space-y-4">
      {placed ? (
        <button type="button" onClick={() => goOrders({ scope: "open", channel: "online" })} data-testid="new-orders-banner"
          className="active-press flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-accent px-4 py-3 text-left text-accent-on shadow-float">
          <Icon name="bell" className="h-6 w-6 shrink-0" />
          <span className="min-w-0 flex-1 font-bold">{placed === 1 ? "1 new online order is waiting" : `${placed} new online orders are waiting`}</span>
          <Icon name="chev" />
        </button>
      ) : null}
      {can("orders.view") ? <StoreCard /> : null}
      {can("reports.view") ? <Overview /> : (
        <Card><p className="font-display text-base font-bold">Sales figures</p><p className="mt-1 text-sm opacity-70">Sales and reports are shown to owners and managers. Your role can take care of orders, customers and tables.</p></Card>
      )}
    </div>
  );
}
