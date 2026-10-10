import { useEffect, useMemo, useState } from "react";
import { FINAL_STATES, ORDER_STATE, ago, mapsLink, money, timeOf } from "@nova/shared";
import { api } from "../session.js";
import { useApp } from "../ctx.js";
import { Button, Card, Chip, Empty, ErrorBox, Field, Icon, inputCls, Sheet, Spinner, useToast, usePoll } from "../ui.jsx";
import { Segmented } from "../ui-extra.jsx";

const SCOPES = [["open", "Open"], ["done", "Done"], ["cancelled", "Cancelled"], ["all", "All"]];
const CHANNELS = [["all", "All"], ["online", "Online"], ["pos", "Counter"]];
const TONE = {
  placed: "bg-warn-soft text-warn", preparing: "bg-accent-soft text-ink", ready: "bg-accent-soft text-ink", out_for_delivery: "bg-brand-soft text-ink",
  served: "bg-good-soft text-good", delivered: "bg-good-soft text-good", completed: "bg-good-soft text-good", cancelled: "bg-bad-soft text-bad",
};
const LABEL = { ...ORDER_STATE, served: "Served" };
const REASONS = ["Out of stock", "Too busy", "Customer asked", "Cannot deliver there"];

export function StatusBadge({ state, pos }) {
  const text = pos && state === "open" ? "Open bill" : pos && state === "paid" ? "Paid" : pos && state === "void" ? "Cancelled" : LABEL[state] || state;
  const tone = pos ? (state === "open" ? "bg-warn-soft text-warn" : state === "paid" ? "bg-good-soft text-good" : "bg-bad-soft text-bad") : TONE[state] || "bg-brand-soft text-ink";
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{text}</span>;
}

/** What the one-tap button should do next, following the order's flow (the restaurant can change flows in its config). */
export function nextStep(o, flows) {
  if (o.channel !== "online" || FINAL_STATES.includes(o.state)) return null;
  const flow = flows[o.type.toLowerCase()] || [];
  const i = flow.indexOf(o.state);
  if (i < 0 || i >= flow.length - 1) return null;
  const to = flow[i + 1];
  const final = i + 1 === flow.length - 1;
  const type = o.type.toLowerCase();
  const labels = {
    preparing: "Accept and start preparing", ready: "Mark ready", served: "Mark served",
    out_for_delivery: o.driver ? "Send out for delivery" : "Assign rider",
    delivered: "Mark delivered", completed: type === "takeaway" ? "Handed over. Complete order" : "Complete order",
  };
  return { to, final, needsRider: to === "out_for_delivery" && !o.driver, label: labels[to] || `Move to ${to}` };
}

function PaySheet({ order, due, onClose, onPaid }) {
  const [mode, setMode] = useState("cash");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    try { await onPaid({ mode, ref: ref.trim() }); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title="Collect payment">
      <div className="space-y-4">
        <p className="text-sm">Order #{order.order_no} is not paid yet. Take the money, then finish the order.</p>
        <p className="font-display text-3xl font-extrabold">{money(due)}</p>
        <Segmented label="Payment mode" value={mode} onChange={setMode} options={[["cash", "Cash"], ["upi", "UPI"], ["card", "Card"]]} />
        {mode !== "cash" ? <Field label="Reference (optional)" id="payref"><input id="payref" className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} /></Field> : null}
        {err ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{err}</p> : null}
        <Button className="w-full" busy={busy} onClick={go}>Collected {money(due)}. Complete order</Button>
      </div>
    </Sheet>
  );
}

function AssignSheet({ order, onClose, onAssigned }) {
  const toast = useToast();
  const q = usePoll(() => api.get("/v2/delivery/drivers"), 0, []);
  const [busy, setBusy] = useState("");
  const riders = (q.data || []).filter((d) => d.status === "active").sort((a, b) => Number(b.online) - Number(a.online));
  async function pick(d) {
    setBusy(d.id);
    try {
      await api.post(`/v2/orders/${order.id}/assign`, { driver_id: d.id });
      toast(`${d.name} will deliver order #${order.order_no}`, "good");
      await onAssigned();
    } catch (e) { toast(e.message, "bad"); } finally { setBusy(""); }
  }
  return (
    <Sheet open onClose={onClose} title="Assign rider">
      <div className="space-y-3">
        <p className="text-sm opacity-80">Pick a rider for order #{order.order_no}. If you do not pick one, any online rider can accept it once it is ready.</p>
        {q.error ? <ErrorBox message={q.error.message} onRetry={q.reload} /> : null}
        {q.loading && !q.data ? <div className="flex justify-center py-6"><Spinner /></div> : null}
        {q.data && !riders.length ? <Empty icon="bike" title="No riders yet" hint="Add a user with the delivery role in More, Staff." /> : null}
        <ul className="space-y-2">
          {riders.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => pick(d)} disabled={!!busy} className="active-press flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left disabled:opacity-60">
                <span className={`h-3 w-3 shrink-0 rounded-full ${d.online ? "bg-good" : "bg-line"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{d.name}</span>
                  <span className="block text-xs opacity-70">{d.online ? "Online" : "Offline"} · {d.active_orders} on the road{d.battery != null ? ` · battery ${d.battery}%` : ""}</span>
                </span>
                {busy === d.id ? <Spinner className="h-4 w-4" /> : <span className="text-sm font-bold text-accent">Assign</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function CancelSheet({ order, onClose, onCancelled }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    try { await onCancelled(reason.trim()); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={`Cancel order #${order.order_no}`}>
      <div className="space-y-4">
        <p className="text-sm">The customer will see the order as cancelled. This cannot be undone.</p>
        <div className="flex flex-wrap gap-2">{REASONS.map((r) => <Chip key={r} active={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
        <Field label="Reason" id="creason"><input id="creason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Short reason" /></Field>
        {err ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{err}</p> : null}
        <div className="flex gap-2">
          <Button kind="line" className="flex-1" onClick={onClose}>Keep order</Button>
          <Button kind="danger" className="flex-1" busy={busy} disabled={reason.trim().length < 3} onClick={go}>Cancel order</Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Next-step button, cancel and the sheets they open. Used on the card and in the detail sheet. */
function Actions({ o, onChanged, compact }) {
  const { flows, can } = useApp();
  const toast = useToast();
  const [sheet, setSheet] = useState(null); // 'pay' | 'assign' | 'cancel'
  const [due, setDue] = useState(0);
  const [busy, setBusy] = useState(false);
  const step = nextStep(o, flows);
  const canUpdate = can("orders.update");

  async function move(to, collect) {
    const body = { status: to };
    if (collect) body.collect = collect;
    await api.post(`/v2/orders/${o.id}/status`, body);
    toast(`Order #${o.order_no}: ${LABEL[to] || to}`, "good");
    setSheet(null);
    await onChanged();
  }
  async function tap() {
    if (!step) return;
    if (step.needsRider) { setSheet("assign"); return; }
    if (step.final && o.balance > 0) { setDue(o.balance); setSheet("pay"); return; }
    setBusy(true);
    try { await move(step.to); } catch (e) {
      if (e.code === "PAYMENT_DUE") { setDue((e.details && e.details.due) || o.balance); setSheet("pay"); }
      else if (e.code === "NO_DRIVER") setSheet("assign");
      else { toast(e.status === 403 ? "You are not allowed to do this." : e.message, "bad"); await onChanged(); }
    } finally { setBusy(false); }
  }

  if (o.channel !== "online") {
    return o.state === "open" ? <p className="text-xs opacity-70">Counter bill. Take payment from the POS.</p> : null;
  }
  const canCancel = canUpdate && !FINAL_STATES.includes(o.state) && o.state !== "out_for_delivery";
  return (
    <div className={compact ? "" : "space-y-2"}>
      {step && canUpdate ? (
        <div className="flex gap-2">
          <Button className="flex-1" busy={busy} onClick={tap} data-testid={`next-${o.order_no}`}>{step.label}</Button>
          {step.to === "out_for_delivery" && o.driver ? <Button kind="line" aria-label="Change rider" onClick={() => setSheet("assign")}>Change rider</Button> : null}
        </div>
      ) : null}
      {o.state === "ready" && o.type === "Delivery" && !o.driver && canUpdate ? <p className="text-xs opacity-70">Waiting for a rider. Any online rider can also accept it from their app.</p> : null}
      {o.driver ? <p className="text-xs font-semibold">Rider: {o.driver.name}{o.state === "out_for_delivery" ? " (on the way)" : ""}</p> : null}
      {canCancel ? <Button kind="danger" className="w-full !min-h-[44px]" onClick={() => setSheet("cancel")}>Cancel order</Button> : null}
      {sheet === "pay" ? <PaySheet order={o} due={due} onClose={() => setSheet(null)} onPaid={(c) => move(step.to, c)} /> : null}
      {sheet === "assign" ? <AssignSheet order={o} onClose={() => setSheet(null)} onAssigned={async () => { setSheet(null); await onChanged(); }} /> : null}
      {sheet === "cancel" ? <CancelSheet order={o} onClose={() => setSheet(null)} onCancelled={(reason) => api.post(`/v2/orders/${o.id}/status`, { status: "cancelled", reason }).then(async () => { toast(`Order #${o.order_no} cancelled`); setSheet(null); await onChanged(); })} /> : null}
    </div>
  );
}

function Detail({ row, onClose, onChanged }) {
  const q = usePoll(() => api.get(`/v2/orders/${row.id}`), 10000, [row.id]);
  const d = q.data;
  const o = d && d.online;
  const addr = o && o.address;
  const phone = (d && d.customer && d.customer.phone) || row.customer.phone;
  const cur = { ...row, state: d ? d.state : row.state, balance: d ? d.balance : row.balance, driver: o ? o.driver : row.driver };
  return (
    <Sheet open onClose={onClose} title={`Order #${row.order_no}`}>
      {q.error && !d ? <ErrorBox message={q.error.message} onRetry={q.reload} /> : null}
      {!d && !q.error ? <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div> : null}
      {d ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge state={d.state} pos={d.channel !== "online"} />
            <span className="text-sm opacity-70">{d.type}{d.table ? ` · ${d.table}` : ""} · {timeOf(d.created_at)}</span>
          </div>
          <section className="rounded-xl bg-brand-soft p-3">
            <p className="font-semibold">{(d.customer && d.customer.name) || "Customer"}</p>
            {phone ? <a href={`tel:${phone}`} className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold"><Icon name="phone" className="h-4 w-4" />Call {phone}</a> : null}
            {addr && addr.text ? (
              <p className="mt-2 text-sm"><Icon name="pin" className="mr-1 inline h-4 w-4" />{addr.text}{addr.landmark ? ` (near ${addr.landmark})` : ""}
                {" "}<a className="font-semibold text-accent underline" target="_blank" rel="noopener noreferrer" href={mapsLink({ lat: addr.lat, lng: addr.lng, text: addr.text })}>Map</a></p>
            ) : null}
            {o && o.driver ? <p className="mt-2 text-sm">Rider: <b>{o.driver.name}</b>{o.driver.phone ? <> · <a className="font-semibold text-accent underline" href={`tel:${o.driver.phone}`}>{o.driver.phone}</a></> : null}</p> : null}
            {o && o.notes ? <p className="mt-2 rounded-lg bg-warn-soft px-2 py-1 text-sm text-warn">Customer note: {o.notes}</p> : null}
          </section>
          <section>
            <h3 className="mb-1 font-display font-bold">Items</h3>
            <ul className="divide-y divide-line">
              {d.lines.map((ln, i) => (
                <li key={i} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 break-words">{ln.qty} x {ln.name}{ln.note ? <em className="block text-xs text-warn">Note: {ln.note}</em> : null}</span>
                  <span className="shrink-0 font-semibold">{money(ln.price * ln.qty)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 space-y-1 border-t border-line pt-2 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(d.totals.subtotal)}</dd></div>
              {d.totals.discount ? <div className="flex justify-between"><dt>Discount</dt><dd>-{money(d.totals.discount)}</dd></div> : null}
              <div className="flex justify-between"><dt>Tax</dt><dd>{money(d.totals.tax)}</dd></div>
              <div className="flex justify-between font-display text-lg font-extrabold"><dt>Total</dt><dd>{money(d.totals.total)}</dd></div>
              <div className="flex justify-between"><dt>Paid</dt><dd>{money(d.paid)}</dd></div>
              {d.balance > 0 && d.status !== "void" ? <div className="flex justify-between font-semibold text-warn"><dt>To collect</dt><dd>{money(d.balance)}{o && o.payment_method === "cod" ? " (pay on delivery)" : ""}</dd></div> : null}
            </dl>
          </section>
          {o && o.timeline ? (
            <section>
              <h3 className="mb-1 font-display font-bold">Timeline</h3>
              <ol className="space-y-1.5 border-l-2 border-line pl-4">
                {o.timeline.map((t, i) => (
                  <li key={i} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                    <b>{LABEL[t.status] || t.status}</b> <span className="opacity-70">{timeOf(t.at)}{t.by ? ` · ${String(t.by).replace(/@.*/, "")}` : ""}</span>
                    {t.reason ? <span className="block text-xs text-bad">Reason: {t.reason}</span> : null}</li>
                ))}
              </ol>
            </section>
          ) : null}
          <Actions o={cur} onChanged={async () => { await q.reload(); await onChanged(); }} />
        </div>
      ) : null}
    </Sheet>
  );
}

function OrderCard({ o, onOpen, onChanged }) {
  const online = o.channel === "online";
  return (
    <Card className="!p-0" data-testid={`order-${o.order_no}`}>
      <button type="button" onClick={() => onOpen(o)} className="block w-full p-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-extrabold">#{o.order_no} <span className="text-sm font-semibold opacity-70">{o.type}{o.table ? ` · ${o.table}` : ""}</span></p>
            <p className="text-xs opacity-70">{online ? "Online" : "Counter"} · {timeOf(o.created_at)} · {ago(o.created_at)}</p>
          </div>
          <StatusBadge state={o.state} pos={!online} />
        </div>
        <p className="mt-2 truncate text-sm font-semibold">{(o.customer && (o.customer.name || o.customer.phone)) || "Walk-in"}</p>
        <p className="mt-0.5 line-clamp-2 text-sm opacity-80">{o.items.join(", ")}</p>
        {o.address ? <p className="mt-1 truncate text-xs opacity-70"><Icon name="pin" className="mr-1 inline h-3.5 w-3.5" />{o.address}</p> : null}
        <div className="mt-2 flex items-center justify-between">
          <span className="font-display text-lg font-extrabold">{money(o.total)}</span>
          <span className={`text-xs font-bold ${o.balance > 0 && o.state !== "cancelled" ? "text-warn" : "text-good"}`}>{o.state === "cancelled" ? "" : o.balance > 0 ? `${money(o.balance)} to collect` : "Paid"}</span>
        </div>
      </button>
      <div className="px-4 pb-4 empty:hidden"><Actions o={o} onChanged={onChanged} compact /></div>
    </Card>
  );
}

export default function Orders({ preset }) {
  const [scope, setScope] = useState("open");
  const [channel, setChannel] = useState("all");
  const [text, setText] = useState("");
  const [detail, setDetail] = useState(null);
  const { reloadWatch } = useApp();
  useEffect(() => { if (preset) { setScope(preset.scope || "open"); setChannel(preset.channel || "all"); } }, [preset]);

  const q = usePoll(() => api.get("/v2/orders", { query: { scope, channel, limit: 150 } }), 10000, [scope, channel]);
  const rows = useMemo(() => {
    const s = text.trim().toLowerCase();
    return (q.data || []).filter((o) => !s || String(o.order_no).includes(s) || (o.customer.name || "").toLowerCase().includes(s) || (o.customer.phone || "").includes(s) || o.items.join(" ").toLowerCase().includes(s));
  }, [q.data, text]);
  const refresh = async () => { await Promise.all([q.reload(), reloadWatch()]); };

  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Which orders">
        {SCOPES.map(([id, label]) => <Chip key={id} active={scope === id} onClick={() => setScope(id)}>{label}</Chip>)}
      </div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Channel">
        {CHANNELS.map(([id, label]) => <Chip key={id} active={channel === id} onClick={() => setChannel(id)} className="!min-h-[40px] !text-xs">{label}</Chip>)}
      </div>
      <div className="relative">
        <label htmlFor="osearch" className="sr-only">Search orders</label>
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 opacity-60" />
        <input id="osearch" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search number, name, phone or dish" className={`${inputCls} pl-10`} />
      </div>
      {q.error ? <ErrorBox message={q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div> : null}
      {q.data && !rows.length ? <Empty icon="bag" title={text ? "No orders match" : scope === "open" ? "No open orders" : "Nothing here"} hint="This list refreshes every 10 seconds." /> : null}
      <div className="space-y-3">{rows.map((o) => <OrderCard key={o.id} o={o} onOpen={setDetail} onChanged={refresh} />)}</div>
      {detail ? <Detail row={detail} onClose={() => setDetail(null)} onChanged={refresh} /> : null}
    </div>
  );
}
