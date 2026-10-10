import { useState } from "react";
import { mapsLink, money, timeOf } from "@nova/shared";
import { api } from "../session.js";
import { Button, Card, Chip, ErrorBox, Icon, Sheet, useToast, Field, inputCls } from "../ui.jsx";

const STEPS = ["Accepted", "On the way", "Delivered"];
const stageOf = (s) => (s === "delivered" ? 2 : s === "out_for_delivery" ? 1 : 0);

function Progress({ stage }) {
  return (
    <ol className="flex items-center" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 items-center last:flex-none" aria-current={i === stage ? "step" : undefined}>
          <span className="flex flex-col items-center gap-1">
            <span className={`grid h-9 w-9 place-items-center rounded-full border-2 text-sm font-bold ${i <= stage ? "border-accent bg-accent text-accent-on" : "border-line bg-surface text-ink"}`}>
              {i < stage || (i === 2 && stage === 2) ? <Icon name="check" className="h-5 w-5" strokeWidth={2.6} /> : i + 1}
            </span>
            <span className={`text-[11px] font-semibold ${i <= stage ? "text-ink" : "opacity-60"}`}>{s}</span>
          </span>
          {i < STEPS.length - 1 ? <span className={`mx-1 mb-5 h-0.5 flex-1 ${i < stage ? "bg-accent" : "bg-line"}`} /> : null}
        </li>
      ))}
    </ol>
  );
}

function Block({ title, children }) {
  return (
    <Card>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide opacity-70">{title}</p>
      {children}
    </Card>
  );
}

const linkBtn = "active-press inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold";

function DeliveredSheet({ order, open, onClose, onDone }) {
  const [code, setCode] = useState("");
  const [mode, setMode] = useState("cash");
  const [got, setGot] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const due = order.collect || 0;
  const locked = err && err.code === "CODE_LOCKED";

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body = { code };
      if (due > 0) body.collected_mode = mode;
      await api.post(`/v2/delivery/orders/${order.id}/delivered`, body);
      onDone();
    } catch (ex) {
      setErr(ex);
      if (ex.code === "WRONG_CODE") setCode("");
    } finally { setBusy(false); }
  }

  const msg = !err ? "" : err.code === "WRONG_CODE" ? "That code is not right. Ask the customer to open their order and read the 4 digits again."
    : err.code === "CODE_LOCKED" ? "Too many wrong codes. Call the restaurant to finish this order."
    : err.code === "PAYMENT_DUE" ? `Payment of ${money(err.details.due || due)} still has to be collected. Choose how the customer paid.`
    : err.message;

  return (
    <Sheet open={open} onClose={onClose} title="Mark delivered">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Code from the customer" id="dcode" hint="The customer sees a 4-digit code in their order screen.">
          <input id="dcode" data-autofocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric" autoComplete="one-time-code" maxLength={4} placeholder="0000" disabled={locked}
            className={`${inputCls} text-center font-display text-3xl font-extrabold tracking-[0.5em]`} />
        </Field>
        {due > 0 || (err && err.code === "PAYMENT_DUE") ? (
          <div className="space-y-3 rounded-2xl bg-brand-soft p-3">
            <p className="font-semibold">Collect <span className="font-display text-xl font-extrabold">{money(due)}</span> from the customer</p>
            <div className="flex gap-2" role="group" aria-label="Payment mode">
              <Chip active={mode === "cash"} onClick={() => setMode("cash")} className="flex-1">Cash</Chip>
              <Chip active={mode === "upi"} onClick={() => setMode("upi")} className="flex-1">UPI</Chip>
            </div>
            <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
              <input type="checkbox" checked={got} onChange={(e) => setGot(e.target.checked)} className="h-6 w-6 accent-[rgb(var(--accent))]" />
              I have collected {money(due)} by {mode === "cash" ? "cash" : "UPI"}
            </label>
          </div>
        ) : <p className="rounded-xl bg-good-soft px-3 py-2 text-sm font-semibold text-good">This order is already paid. Nothing to collect.</p>}
        {msg ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{msg}</p> : null}
        <Button type="submit" className="w-full" busy={busy} disabled={code.length !== 4 || (due > 0 && !got) || locked}>Confirm delivery</Button>
      </form>
    </Sheet>
  );
}

export default function Order({ order, orderId, onBack, onChanged, shop }) {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [starting, setStarting] = useState(false);
  async function startDelivery() {
    setStarting(true);
    try {
      await api.post(`/v2/delivery/orders/${order.id}/accept`);
      toast(`Order #${order.order_no}: on the way`, "good");
      await onChanged();
    } catch (e) {
      toast(e.message, "bad");
      await onChanged();
    } finally { setStarting(false); }
  }
  const header = (
    <header className="pt-safe sticky top-0 z-20 flex items-center gap-2 bg-brand px-3 pb-3 pt-3 text-brand-on">
      <button type="button" onClick={onBack} aria-label="Back" className="grid h-11 w-11 place-items-center rounded-full"><Icon name="back" className="h-6 w-6" /></button>
      <h1 className="font-display text-lg font-extrabold">{order ? `Order #${order.order_no}` : "Order"}</h1>
    </header>
  );
  if (!order) {
    return <>{header}<div className="p-4"><ErrorBox message={`Order not found. It may have been taken or cancelled. (${orderId})`} onRetry={onChanged} /></div></>;
  }
  const stage = stageOf(order.status);
  const brand = (shop && shop.brand) || {};
  const origin = shop && shop.delivery && shop.delivery.origin;
  const addr = order.address || {};
  const pickupLink = mapsLink({ lat: origin && origin.lat, lng: origin && origin.lng, text: brand.address });
  const dropLink = mapsLink({ lat: addr.lat, lng: addr.lng, text: addr.text });
  const phone = order.customer && order.customer.phone;

  return (
    <>
      {header}
      <main className="flex-1 space-y-3 px-4 pb-32 pt-4">
        <Card><Progress stage={stage} /></Card>

        {order.status === "ready" || order.status === "preparing" ? (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">Go to the restaurant to collect the order. Tap "Collected, start delivery" once you have the food.</p>
        ) : null}

        <Block title="Pickup">
          <p className="font-semibold">{brand.name || "Restaurant"}</p>
          <p className="text-sm opacity-80">{brand.address || "Address not set"}</p>
          <div className="mt-3 flex gap-2">
            <a className={linkBtn} href={pickupLink} target="_blank" rel="noopener noreferrer"><Icon name="nav" className="h-4 w-4" />Navigate</a>
            {brand.support && brand.support.phone ? <a className={linkBtn} href={`tel:${brand.support.phone}`}><Icon name="phone" className="h-4 w-4" />Call restaurant</a> : null}
          </div>
        </Block>

        <Block title="Drop">
          <p className="font-semibold">{(order.customer && order.customer.name) || "Customer"}</p>
          <p className="break-words text-sm opacity-80">{addr.text || "No address"}{addr.landmark ? ` (near ${addr.landmark})` : ""}</p>
          {order.distance_km != null ? <p className="mt-1 text-xs opacity-70">{order.distance_km} km from the restaurant</p> : null}
          {order.notes ? <p className="mt-2 rounded-lg bg-warn-soft px-2 py-1 text-sm text-warn">Note: {order.notes}</p> : null}
          <div className="mt-3 flex gap-2">
            <a className={linkBtn} href={dropLink} target="_blank" rel="noopener noreferrer"><Icon name="nav" className="h-4 w-4" />Navigate</a>
            {phone ? <a className={linkBtn} href={`tel:${phone}`}><Icon name="phone" className="h-4 w-4" />Call customer</a> : null}
          </div>
        </Block>

        <Block title="Items">
          <ul className="divide-y divide-line">
            {order.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{i.name}{i.note ? <em className="block text-xs opacity-70">{i.note}</em> : null}</span><span className="font-semibold">x {i.qty}</span></li>
            ))}
          </ul>
        </Block>

        <Card className={order.collect > 0 ? "border-accent bg-accent-soft" : "bg-good-soft"}>
          <p className="text-xs font-bold uppercase tracking-wide opacity-70">{order.status === "delivered" ? "Collected" : "Amount to collect"}</p>
          <p className="font-display text-3xl font-extrabold">{order.status === "delivered" ? money(order.total) : money(order.collect)}</p>
          <p className="text-sm font-semibold">{order.status === "delivered" ? `Delivered at ${timeOf(order.delivered_at)}` : order.collect > 0 ? "Cash on delivery. Take cash or UPI from the customer." : "Already paid. Do not collect any money."}</p>
        </Card>
      </main>

      {order.status === "ready" ? (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[520px] border-t border-line bg-surface p-3">
          <Button className="w-full" busy={starting} onClick={startDelivery}><Icon name="nav" />Collected, start delivery</Button>
        </div>
      ) : null}
      {order.status === "out_for_delivery" ? (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[520px] border-t border-line bg-surface p-3">
          <Button className="w-full" onClick={() => setSheet(true)}><Icon name="check" />Mark delivered</Button>
        </div>
      ) : null}
      {sheet ? (
        <DeliveredSheet order={order} open onClose={() => setSheet(false)}
          onDone={async () => { setSheet(false); toast(`Order #${order.order_no} delivered`, "good"); await onChanged(); onBack(); }} />
      ) : null}
    </>
  );
}
