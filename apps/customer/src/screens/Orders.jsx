import { useCallback, useEffect, useRef, useState } from "react";
import { ago, dateOf, FINAL_STATES, mapsLink, money, timeOf } from "@nova/shared";
import { useApp } from "../state.jsx";
import { useI18n } from "../i18n.js";
import { describeError } from "../lib/errors.js";
import { openCheckout } from "../lib/razorpay.js";
import { Banner, Button, Empty, Icon, Row, Skeleton } from "../components/ui.jsx";

const FLOWS = {
  delivery: ["placed", "preparing", "ready", "out_for_delivery", "delivered"],
  takeaway: ["placed", "preparing", "ready", "completed"],
  "dine-in": ["placed", "preparing", "ready", "served", "completed"],
};
const isFinal = (s) => FINAL_STATES.includes(s);
const PAY_WINDOW_MS = 20 * 60 * 1000;
const minsLeft = (o) => Math.ceil((new Date(o.placed_at).getTime() + PAY_WINDOW_MS - Date.now()) / 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TONE = { pending_payment: "bg-warn-soft text-warn",  cancelled: "bg-bad-soft text-bad", delivered: "bg-good-soft text-good", completed: "bg-good-soft text-good", out_for_delivery: "bg-accent-soft text-ink", ready: "bg-accent-soft text-ink" };

export function StatusPill({ status }) {
  const { t } = useI18n();
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold ${TONE[status] || "bg-brand-soft text-ink"}`}>{t(`status_${status}`)}</span>;
}

/** Fetch something and keep it fresh every `ms` while `active` and the tab is visible. */
function usePolled(fetcher, active, ms = 8000) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const f = useRef(fetcher);
  f.current = fetcher;
  const load = useCallback(async () => {
    try { const d = await f.current(); setState({ data: d, error: null, loading: false }); return d; }
    catch (e) { setState((s) => ({ ...s, error: e, loading: false })); return null; }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, ms);
    return () => clearInterval(id);
  }, [active, ms, load]);
  return [state, load];
}

export function OrdersList({ onOpen, openSignIn, goMenu }) {
  const { api, token } = useApp();
  const { t } = useI18n();
  const [state, load] = usePolled(() => (token ? api.get("/v2/me/orders") : Promise.resolve([])), true);
  useEffect(() => { load(); }, [token, load]);

  if (!token) return <Empty icon="orders" title={t("no_orders")} hint={t("sign_in_to_order")} action={<Button onClick={openSignIn}>{t("sign_in")}</Button>} />;
  if (state.loading && !state.data) return <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (state.error && !state.data) return <div className="p-4"><Banner tone="bad" action={<Button variant="ghost" onClick={load}>{t("retry")}</Button>}>{state.error.message}</Banner></div>;
  const list = [...(state.data || [])].sort((a, b) => (isFinal(a.status) - isFinal(b.status)) || (b.placed_at > a.placed_at ? 1 : -1));
  if (!list.length) return <Empty icon="orders" title={t("no_orders")} hint={t("no_orders_hint")} action={<Button onClick={goMenu}>{t("browse_menu")}</Button>} />;
  return (
    <div className="p-4">
      <h1 className="mb-3 font-display text-2xl font-bold">{t("orders")}</h1>
      <ul className="space-y-3">
        {list.map((o) => (
          <li key={o.id}>
            <div className="rounded-2xl border border-line bg-white shadow-card">
            <button type="button" onClick={() => onOpen(o.id)} className="active-press w-full rounded-2xl p-4 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-bold">#{o.order_no}</span>
                <StatusPill status={o.status} />
              </div>
              <p className="mt-1 truncate text-[14px] text-ink/80">{o.lines.filter((l) => !l.fee).map((l) => `${l.qty} × ${l.name}`).join(", ")}</p>
              <div className="mt-2 flex items-center justify-between text-[13px] text-ink/70">
                <span className="capitalize">{t(o.type)} · {dateOf(o.placed_at)} {timeOf(o.placed_at)}</span>
                <span className="text-[15px] font-bold text-ink">{money(o.totals.total)}</span>
              </div>
              {o.status === "cancelled" && o.payment?.refunded > 0 && <p className="mt-1 text-[13px] font-semibold text-good">{t("refund_text").replace("{amt}", money(o.payment.refunded))}</p>}
            </button>
            {o.status === "pending_payment" && o.payment?.checkout && minsLeft(o) > 0 && (
              <div className="px-4 pb-4"><Button className="w-full" onClick={() => onOpen(o.id, true)}>{t("pay_now")} · {money(o.totals.total)}</Button></div>
            )}
            {o.status === "pending_payment" && minsLeft(o) <= 0 && <p className="px-4 pb-4 text-[13px] font-semibold text-bad">{t("expired")}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Timeline({ order }) {
  const { t } = useI18n();
  const flow = [...(FLOWS[order.type] || FLOWS.takeaway)];
  for (const s of order.timeline) if (!flow.includes(s.status) && s.status !== "cancelled" && s.status !== "pending_payment") flow.splice(flow.length - 1, 0, s.status);
  if (order.timeline.some((s) => s.status === "pending_payment")) flow.unshift("pending_payment");
  const at = Object.fromEntries(order.timeline.map((s) => [s.status, s.at]));
  const cancelled = order.status === "cancelled";
  const idx = cancelled ? -1 : flow.indexOf(order.status);
  return (
    <ol className="space-y-0" aria-label="Order progress">
      {flow.map((s, i) => {
        const done = !cancelled && i <= idx;
        const current = !cancelled && i === idx;
        const reached = !!at[s];
        return (
          <li key={s} className="relative flex gap-3 pb-5 last:pb-0" aria-current={current ? "step" : undefined}>
            {i < flow.length - 1 && <span className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 ${done && i < idx ? "bg-good" : "bg-line"}`} aria-hidden="true" />}
            <span className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-good bg-good text-white" : reached ? "border-bad bg-bad-soft text-bad" : "border-line bg-white text-ink/40"} ${current ? "ring-4 ring-good/20" : ""}`}>
              {done ? <Icon name="check" size={14} stroke={3} /> : <span className="h-2 w-2 rounded-full bg-current" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-[15px] ${current ? "font-bold" : done ? "font-semibold" : "text-ink/70"}`}>{t(`status_${s}`)}</p>
              {at[s] && <p className="text-[12px] text-ink/70">{timeOf(at[s])}</p>}
            </div>
          </li>
        );
      })}
      {cancelled && (
        <li className="flex gap-3 pt-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bad text-white"><Icon name="close" size={14} stroke={3} /></span>
          <div className="pt-0.5"><p className="font-bold text-bad">{t("status_cancelled")}</p><p className="text-[12px] text-ink/70">{timeOf(at.cancelled)}</p></div>
        </li>
      )}
    </ol>
  );
}

export function Track({ id, autoPay, onBack, onReorder }) {
  const { api, storefront, byId, flash, me } = useApp();
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const [state, load] = usePolled(() => api.get(`/v2/me/orders/${id}`), !done, 8000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const o = state.data;
  const [pay, setPay] = useState({ phase: "idle", err: null });
  const live = useRef(true);
  const oRef = useRef(null);
  oRef.current = o;
  const attempt = useRef({ paid: false });
  const auto = useRef(!!autoPay);
  const expiredPoke = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setDone(!!o && isFinal(o.status)); }, [o]);
  const phone = storefront?.brand?.support?.phone;

  // the payment may have gone through even if our confirm call did not: keep asking for up to a minute
  async function waitForServer() {
    const end = Date.now() + 60000;
    while (live.current && Date.now() < end) {
      await sleep(3000);
      const d = await load();
      if (d && d.status !== "pending_payment") return true;
    }
    return false;
  }
  async function confirmPayment(resp) {
    attempt.current.paid = true;
    setPay({ phase: "confirming", err: null });
    try {
      await api.post(`/v2/me/orders/${id}/payment`, resp);
      await load();
      if (live.current) { setPay({ phase: "idle", err: null }); flash(t("paid_online"), "good"); }
    } catch (e) {
      if (!live.current) return;
      if (e.code === "NETWORK" || e.code === "TIMEOUT" || (e.status >= 500 && !e.code?.startsWith("PAYMENT_"))) {
        setPay({ phase: "checking", err: null });
        const ok = await waitForServer();
        if (live.current) setPay({ phase: ok ? "idle" : "unconfirmed", err: null });
        return;
      }
      if (e.code === "NOT_PENDING") { await load(); setPay({ phase: "idle", err: null }); return; }
      attempt.current.paid = false;
      setPay({ phase: "notdone", err: describeError(e, { storefront }) });
    }
  }
  async function startPay() {
    const cur = oRef.current;
    if (!cur?.payment?.checkout || pay.phase === "opening") return;
    if (minsLeft(cur) <= 0) { load(); return; }
    attempt.current = { paid: false };
    const mine = attempt.current;
    setPay({ phase: "opening", err: null });
    try {
      await openCheckout({
        checkout: cur.payment.checkout, orderNo: cur.order_no, name: storefront?.brand?.name || "", phone: me?.phone, color: storefront?.brand?.colors?.primary,
        onPaid: confirmPayment,
        onDismiss: () => { if (!mine.paid) setPay({ phase: "notdone", err: null }); },
        onFailed: () => { if (!mine.paid) setPay({ phase: "notdone", err: null, failed: true }); },
      });
      setPay((p) => (p.phase === "opening" ? { phase: "open", err: null } : p));
    } catch {
      setPay({ phase: "notdone", err: { message: "We could not open the payment window. Check your internet connection and try again." } });
    }
  }
  const unpaid = o?.status === "pending_payment";
  const expired = unpaid && minsLeft(o) <= 0;
  useEffect(() => {
    if (auto.current && unpaid && o.payment?.checkout) { auto.current = false; startPay(); }
  }, [o]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (expired && !expiredPoke.current) { expiredPoke.current = true; api.get("/v2/me/orders").then(load).catch(() => {}); } // listing orders makes the server cancel the unpaid ones
  }, [expired]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cancel() {
    setBusy(true); setErr(null);
    try { await api.post(`/v2/me/orders/${id}/cancel`, {}); setConfirm(false); await load(); }
    catch (e) { setErr(describeError(e, { storefront })); setConfirm(false); if (e.code === "TOO_LATE") load(); }
    setBusy(false);
  }
  function reorder() {
    const by = new Map(Object.values(byId).map((i) => [i.name, i]));
    let added = 0, missed = 0;
    for (const l of o.lines) {
      if (l.fee) continue;
      const it = by.get(l.name);
      if (it && it.available) { onReorder(it, l.qty, l.note); added++; } else missed++;
    }
    flash(missed ? `${added} added. ${missed} no longer available.` : `${added} dishes added to your cart.`, missed ? "warn" : "info");
  }

  const cancelBox = (
    <div className="mt-2 flex w-full items-center gap-2 rounded-xl border border-bad/30 bg-white p-3" role="alertdialog" aria-label="Confirm cancel">
      <span className="flex-1 text-[14px] font-semibold text-bad">{t("cancel_order")}?</span>
      <Button variant="ghost" onClick={() => setConfirm(false)}>{t("close")}</Button>
      <Button variant="danger" busy={busy} onClick={cancel}>{t("confirm")}</Button>
    </div>
  );

  return (
    <div className="p-4 pb-8">
      <button type="button" onClick={onBack} className="mb-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-brand"><Icon name="back" size={18} />{t("orders")}</button>
      {!o && state.loading && <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-60" /></div>}
      {!o && state.error && <Banner tone="bad" action={<Button variant="ghost" onClick={load}>{t("retry")}</Button>}>{state.error.message}</Banner>}
      {o && (
        <div className="space-y-4">
          {state.error && <Banner tone="warn" icon="wifi" action={<Button variant="ghost" onClick={load}>{t("retry")}</Button>}>Could not refresh. Showing the last update.</Banner>}
          <section className="rounded-2xl bg-brand p-4 text-brand-on">
            <p className="text-[13px] text-brand-on/80">#{o.order_no} · <span className="capitalize">{t(o.type)}</span></p>
            <h1 className="mt-1 font-display text-2xl font-extrabold" data-testid="status-title">{t(`status_${o.status}`)}</h1>
            <p className="mt-1 text-[13px] text-brand-on/80">
              {isFinal(o.status) ? `${dateOf(o.placed_at)}, ${timeOf(o.placed_at)}` : unpaid ? (expired ? t("expired") : `${t("wait_pay")}: ${Math.max(1, minsLeft(o))} ${t("min")}`) : `Placed ${ago(o.placed_at)}${storefront?.ordering?.prep_minutes ? ` · usually ready in ${storefront.ordering.prep_minutes} ${t("min")}` : ""}`}
            </p>
          </section>

          {o.type === "delivery" && o.delivery_code && (
            <section className="rounded-2xl border-2 border-accent bg-accent-soft p-4 text-center" aria-label={t("delivery_code")}>
              <p className="text-[13px] font-semibold uppercase tracking-wide">{t("delivery_code")}</p>
              <p className="my-1 font-display text-5xl font-extrabold tracking-[.25em] tabular-nums" data-testid="delivery-code">{o.delivery_code}</p>
              <p className="text-[13px] text-ink/80">{t("delivery_code_hint")}</p>
            </section>
          )}

          {o.driver && (
            <section className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4" aria-label="Delivery partner">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand"><Icon name="bike" size={22} /></span>
              <div className="min-w-0 flex-1"><p className="text-[12px] text-ink/70">{t("status_out_for_delivery")}</p><p className="truncate font-semibold">{o.driver.name}</p></div>
              {o.driver.phone && <a href={`tel:${o.driver.phone}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-3 font-semibold text-accent-on"><Icon name="phone" size={18} />{t("call_driver")}</a>}
              <a target="_blank" rel="noreferrer" href={mapsLink(o.driver_location?.lat != null ? { lat: o.driver_location.lat, lng: o.driver_location.lng } : { text: o.address?.text })} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line px-3 font-semibold"><Icon name="pin" size={18} />{t("open_map")}</a>
            </section>
          )}

          {err && <Banner tone="bad" action={err.action === "call" && phone ? <a className="inline-flex min-h-[44px] items-center font-bold underline" href={`tel:${phone}`}>{err.label}</a> : null}>{err.message}</Banner>}

          {o.status === "cancelled" && o.payment?.refunded > 0 && <Banner tone="good" icon="check"><b data-testid="refund-note">{t("refund_text").replace("{amt}", money(o.payment.refunded))}</b></Banner>}

          {unpaid && (
            <section className="rounded-2xl border-2 border-warn/40 bg-warn-soft p-4" data-testid="pay-panel" aria-live="polite">
              {expired ? (
                <>
                  <h2 className="font-display text-lg font-bold">{t("expired")}</h2>
                  <p className="mt-1 text-[14px]">{t("expired_hint")}</p>
                </>
              ) : pay.phase === "confirming" || pay.phase === "checking" ? (
                <p className="flex items-center gap-2 font-semibold"><span className="h-4 w-4 animate-spin rounded-full border-2 border-warn border-t-transparent" aria-hidden="true" />{t("verifying_payment")}</p>
              ) : pay.phase === "unconfirmed" ? (
                <>
                  <h2 className="font-display text-lg font-bold">{t("checking_payment")}</h2>
                  <p className="mt-1 text-[14px]">{t("checking_payment_hint")}</p>
                </>
              ) : (
                <>
                  <h2 className="font-display text-lg font-bold">{pay.phase === "notdone" ? t("payment_not_done") : t("status_pending_payment")}</h2>
                  <p className="mt-1 text-[14px]">{pay.phase === "notdone" ? t("payment_not_done_hint") : `${t("wait_pay")}: ${Math.max(1, minsLeft(o))} ${t("min")}`}</p>
                  {pay.err && <p className="mt-2 text-[14px] font-semibold text-bad" role="alert">{pay.err.message}</p>}
                  {o.payment?.checkout && (
                    <Button className="mt-3 w-full min-h-[48px]" busy={pay.phase === "opening"} onClick={startPay}>{pay.phase === "notdone" ? t("try_again") : `${t("pay_now")} · ${money(o.totals.total)}`}</Button>
                  )}
                </>
              )}
              {!confirm && pay.phase !== "confirming" && pay.phase !== "checking" && !expired && <Button variant="danger" className="mt-2 w-full" onClick={() => setConfirm(true)}>{t("cancel_order")}</Button>}
              {confirm && cancelBox}
            </section>
          )}

          <section className="rounded-2xl border border-line bg-white p-4"><Timeline order={o} /></section>

          <section className="rounded-2xl border border-line bg-white p-4">
            <ul className="divide-y divide-line">
              {o.lines.filter((l) => !l.fee).map((l, i) => (
                <li key={i} className="flex justify-between gap-3 py-2 text-[14px]">
                  <span className="min-w-0"><b>{l.qty} ×</b> {l.name}{l.note && <span className="block text-[12px] italic text-ink/70">“{l.note}”</span>}</span>
                  <span className="tabular-nums">{money(l.price * l.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 border-t border-line pt-2">
              {o.lines.filter((l) => l.fee).map((l, i) => <Row key={i} label={l.name} value={money(l.price * l.qty)} />)}
              {o.totals.discount > 0 && <Row label={t("discount")} value={`− ${money(o.totals.discount)}`} tone="good" />}
              <Row strong label={t("total")} value={money(o.totals.total)} />
              {o.payment && !isFinal(o.status) && o.status !== "pending_payment" && o.payment.due > 0 && <p className="mt-1 text-[13px] text-ink/70">{t("paid_note")}: {money(o.payment.due)} · {o.type === "delivery" ? "on delivery" : "at the counter"} (cash or UPI)</p>}
              {o.payment?.paid && <p className="mt-1 text-[13px] font-semibold text-good">{o.payment.method === "online" ? t("paid_online") : "Paid"}</p>}
            </div>
            {(o.address?.text || o.table || o.notes) && (
              <div className="mt-3 space-y-1 border-t border-line pt-3 text-[13px] text-ink/80">
                {o.address?.text && <p><b>{t("delivering_to")}:</b> {o.address.text}{o.address.landmark ? `, ${o.address.landmark}` : ""}</p>}
                {o.table && <p><b>{t("table")}:</b> {o.table}</p>}
                {o.notes && <p><b>{t("note")}:</b> {o.notes}</p>}
              </div>
            )}
          </section>

          <div className="flex flex-wrap gap-3">
            {o.status === "placed" && !confirm && <Button variant="danger" onClick={() => setConfirm(true)}>{t("cancel_order")}</Button>}
            {confirm && !unpaid && cancelBox}
            {isFinal(o.status) && <Button onClick={reorder}>{t("reorder")}</Button>}
            {phone && <a href={`tel:${phone}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line px-4 font-semibold"><Icon name="phone" size={18} />{t("call")}</a>}
          </div>
        </div>
      )}
    </div>
  );
}
