import { useState } from "react";
import { ago, money } from "@nova/shared";
import { api } from "../session.js";
import { Button, Card, Empty, ErrorBox, Icon, Spinner, Switch, useToast } from "../ui.jsx";

export function Stat({ label, value, sub }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-brand-soft px-2 py-2.5 text-center">
      <p className="truncate font-display text-lg font-extrabold leading-tight">{value}</p>
      <p className="truncate text-[11px] font-semibold opacity-70">{label}</p>
      {sub ? <p className="truncate text-[10px] opacity-60">{sub}</p> : null}
    </div>
  );
}

export function StatsStrip({ s }) {
  if (!s) return null;
  return (
    <div className="flex gap-2" aria-label="Today">
      <Stat label="Deliveries" value={s.deliveries} />
      <Stat label="Distance" value={`${s.distance_km} km`} />
      <Stat label="Cash" value={money(s.cash_collected)} />
      <Stat label="Earned" value={s.earnings_configured ? money(s.earnings) : "Not set"} />
    </div>
  );
}

const STATUS_TEXT = { preparing: "Being prepared", ready: "Assigned to you. Collect it at the restaurant.", out_for_delivery: "On the way to the customer" };

function ActiveCard({ o, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(o.id)} className="active-press block w-full text-left">
      <Card className="border-accent">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-accent">Active delivery</p>
            <p className="font-display text-xl font-extrabold">Order #{o.order_no}</p>
            <p className="text-sm opacity-80">{STATUS_TEXT[o.status] || o.status}</p>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-on"><Icon name="chev" /></span>
        </div>
        <p className="mt-3 flex gap-2 text-sm"><Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{(o.address && o.address.text) || "No address"}</span></p>
        <p className="mt-2 text-sm font-semibold">{o.collect > 0 ? `Collect ${money(o.collect)} (cash on delivery)` : "Already paid"}</p>
      </Card>
    </button>
  );
}

function PoolCard({ o, busy, onAccept, canAccept }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-extrabold">Order #{o.order_no}</p>
          <p className="text-xs opacity-70">{ago(o.placed_at)}{o.distance_km != null ? ` · ${o.distance_km} km` : ""}</p>
        </div>
        <p className="shrink-0 font-display text-lg font-extrabold">{money(o.total)}</p>
      </div>
      <p className="mt-2 flex gap-2 text-sm"><Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{(o.address && o.address.text) || "No address"}</span></p>
      <p className="mt-1 text-sm opacity-80">{o.items.map((i) => `${i.qty}x ${i.name}`).join(", ")}</p>
      <p className="mt-1 text-xs font-semibold opacity-80">{o.collect > 0 ? `Collect ${money(o.collect)} on delivery` : "Prepaid"}</p>
      <Button className="mt-3 w-full" busy={busy} disabled={!canAccept} onClick={() => onAccept(o)}>Accept this order</Button>
    </Card>
  );
}

export default function Home({ poll, sw, onOpen }) {
  const toast = useToast();
  const [accepting, setAccepting] = useState(null);
  const orders = poll.data ? poll.data.orders : null;

  async function accept(o) {
    setAccepting(o.id);
    try {
      await api.post(`/v2/delivery/orders/${o.id}/accept`);
      toast(`Order #${o.order_no} is yours`, "good");
      await poll.reload();
      onOpen(o.id);
    } catch (e) {
      if (e.code === "TAKEN") toast(`Order #${o.order_no} was just taken by another partner.`, "bad");
      else toast(e.message, "bad");
      await poll.reload();
    } finally { setAccepting(null); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-lg font-extrabold">{sw.online ? "You are online" : "You are offline"}</p>
            <p className="text-sm opacity-70" id="online-hint">{sw.online ? "Sharing your location every 10 seconds." : "Go online to receive orders."}</p>
          </div>
          <div className="flex items-center gap-2">
            {sw.busy ? <Spinner /> : null}
            <Switch checked={sw.online} onChange={sw.toggle} disabled={sw.busy} label="Online" />
          </div>
        </div>
        {sw.locError ? <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn" role="alert">{sw.locError}</p> : null}
      </Card>

      <section aria-label="Today so far">
        <h2 className="mb-2 font-display text-base font-bold">Today</h2>
        {poll.data ? <StatsStrip s={poll.data.today} /> : <div className="h-16 animate-pulse rounded-xl bg-line" />}
      </section>

      {poll.error && !poll.data ? <ErrorBox message={poll.error.message} onRetry={poll.reload} /> : null}
      {poll.error && poll.data ? <p className="text-xs font-semibold text-warn" role="status">Could not refresh. Showing the last update.</p> : null}
      {poll.loading && !poll.data ? <div className="flex justify-center py-6"><Spinner className="h-7 w-7" /></div> : null}

      {orders ? (
        <>
          {orders.active.map((o) => <ActiveCard key={o.id} o={o} onOpen={onOpen} />)}
          <section aria-label="Ready for pickup">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">Ready for pickup {orders.pickup.length ? `(${orders.pickup.length})` : ""}</h2>
              <button type="button" onClick={poll.reload} aria-label="Refresh" className="grid h-11 w-11 place-items-center rounded-full"><Icon name="refresh" /></button>
            </div>
            {!sw.online && orders.pickup.length ? <p className="mb-2 text-sm font-semibold text-warn">Go online to accept orders.</p> : null}
            {orders.pickup.length ? (
              <div className="space-y-3">{orders.pickup.map((o) => <PoolCard key={o.id} o={o} canAccept={sw.online} busy={accepting === o.id} onAccept={accept} />)}</div>
            ) : (
              <Empty icon="bag" title="No orders waiting" hint="New orders appear here when the kitchen marks them ready. This list refreshes every 10 seconds." />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
