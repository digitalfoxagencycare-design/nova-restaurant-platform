import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { money } from "@nova/shared";
import { useApp, uuid } from "../state.jsx";
import { useI18n } from "../i18n.js";
import { describeError } from "../lib/errors.js";
import { Banner, Button, Empty, Field, Icon, inputCls, Row, Sheet, Skeleton, Stepper, VegMark } from "../components/ui.jsx";

const MODE_ICON = { delivery: "bike", "dine-in": "table", takeaway: "store" };

export default function Checkout({ open, onClose, onPlaced, openSignIn, goOrders, registerAfterSignIn }) {
  const { api, pub, code, cart, cartApi, byId, mode, setMode, channels, table, setTable, storefront, token, me, saveProfile, markSoldOut, flash, reload } = useApp();
  const { t } = useI18n();
  const sf = storefront;

  const [addr, setAddr] = useState({ text: "", landmark: "", lat: null, lng: null });
  const [saveAddr, setSaveAddr] = useState(true);
  const [notes, setNotes] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponError, setCouponError] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [quote, setQuote] = useState({ status: "idle", data: null, error: null });
  const [payChoice, setPayChoice] = useState("online");
  const [wa, setWa] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [placeErr, setPlaceErr] = useState(null);
  const [geo, setGeo] = useState({ busy: false, error: "" });
  const attempt = useRef({ sig: "", key: "" });
  const addrRef = useRef(null);
  const tableRef = useRef(null);
  const couponRef = useRef(null);
  const seq = useRef(0);

  const lines = useMemo(() => cart.map((l) => ({ ...l, item: byId[l.item_id] })), [cart, byId]);
  const bad = lines.filter((l) => !l.item || !l.item.available);
  const good = lines.filter((l) => l.item && l.item.available);
  const localSub = good.reduce((n, l) => n + l.qty * l.item.price, 0);

  // prefill from saved addresses once
  useEffect(() => {
    if (open && !addr.text && me?.addresses?.length) setAddr({ text: "", landmark: "", lat: null, lng: null, ...me.addresses[0], pin: me.addresses[0].lat != null ? "saved" : null });
  }, [open, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsAddr = mode === "delivery";
  const readyForQuote = good.length > 0 && bad.length === 0 && (mode === "takeaway" || (mode === "delivery" && addr.text.trim().length >= 6) || (mode === "dine-in" && table.trim()));
  const body = useMemo(() => ({
    type: mode,
    items: good.map((l) => ({ item_id: l.item_id, qty: l.qty, note: l.note || "" })),
    ...(mode === "dine-in" ? { table: table.trim() } : {}),
    ...(mode === "delivery" ? { address: { text: addr.text.trim(), landmark: addr.landmark.trim(), lat: addr.lat, lng: addr.lng } } : {}),
    coupon,
  }), [mode, good, table, addr, coupon]);
  const sig = JSON.stringify(body);

  const handleSoldOut = useCallback((err) => {
    const id = err?.details?.item_id;
    if (id) {
      const name = byId[id]?.name || "A dish";
      markSoldOut(id);
      cartApi.removeItem(id);
      flash(`${name} just sold out and was removed from your cart.`, "warn");
    }
  }, [byId, markSoldOut, cartApi, flash]);

  // live quote, refreshed when anything that changes the price changes
  useEffect(() => {
    if (!open) return undefined;
    if (!readyForQuote) { setQuote({ status: "idle", data: null, error: null }); return undefined; }
    const my = ++seq.current;
    setQuote((q) => ({ ...q, status: "loading", error: null }));
    const timer = setTimeout(async () => {
      try {
        const d = await api.post(pub("/quote"), body);
        if (my !== seq.current) return;
        setQuote({ status: "ready", data: d, error: null });
      } catch (e) {
        if (my !== seq.current) return;
        if (e.code === "OUT_OF_STOCK") handleSoldOut(e);
        if (e.code?.startsWith("COUPON_")) { setCoupon(""); setCouponError(describeError(e, { storefront: sf })); }
        setQuote({ status: "error", data: null, error: describeError(e, { storefront: sf }) });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [open, sig, readyForQuote]); // eslint-disable-line react-hooks/exhaustive-deps

  const qErr = quote.error;
  const couponErr = couponError;
  const shownErr = placeErr || (qErr && !qErr.code?.startsWith("COUPON_") ? qErr : null);
  const q = quote.data;
  const totals = q?.totals;
  const fee = q?.delivery_fee || 0;

  function act(e) {
    switch (e?.action) {
      case "menu": onClose(); break;
      case "takeaway": setMode("takeaway"); setPlaceErr(null); break;
      case "address": addrRef.current?.focus(); break;
      case "location": locate(); break;
      case "table": tableRef.current?.focus(); break;
      case "coupon": setCoupon(""); setCouponInput(""); setTimeout(() => couponRef.current?.focus(), 0); break;
      case "orders": onClose(); goOrders?.(); break;
      case "refresh": reload(); setPlaceErr(null); break;
      case "call": { const p = sf?.brand?.support?.phone; if (p) window.location.href = `tel:${p}`; break; }
      case "dish": onClose(); break;
      default: setPlaceErr(null);
    }
  }

  function locate() {
    if (!navigator.geolocation) { setGeo({ busy: false, error: "Location is not available on this device. Type your address." }); return; }
    setGeo({ busy: true, error: "" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = +pos.coords.latitude.toFixed(6), lng = +pos.coords.longitude.toFixed(6);
        setAddr((a) => ({ ...a, lat, lng, pin: "gps", text: a.text.trim().length >= 6 ? a.text : `Pinned location ${lat.toFixed(4)}, ${lng.toFixed(4)}` }));
        setGeo({ busy: false, error: "" });
        setPlaceErr(null);
      },
      (err) => setGeo({ busy: false, error: err.code === 1 ? "Location permission is off. Allow it in your settings or type your address." : "We could not get your location. Try again or type your address." }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }

  async function place() {
    if (placing) return;
    if (!token) { openSignIn(); return; }
    setPlacing(true); setPlaceErr(null);
    const payload = { ...body, payment: method, whatsapp_updates: wa, notes: notes.trim(), name: me?.name || "" };
    const s = JSON.stringify(payload);
    if (attempt.current.sig !== s) attempt.current = { sig: s, key: uuid() }; // same payload => same key => safe retry
    try {
      const order = await api.post("/v2/me/orders", payload, { headers: { "Idempotency-Key": attempt.current.key } });
      attempt.current = { sig: "", key: "" };
      if (mode === "delivery" && saveAddr && addr.text.trim().length >= 6) {
        const have = (me?.addresses || []).some((a) => a.text === addr.text.trim());
        if (!have) saveProfile({ addresses: [...(me?.addresses || []), { text: addr.text.trim(), landmark: addr.landmark.trim(), lat: addr.lat, lng: addr.lng }].slice(-10) }).catch(() => {});
      }
      cartApi.clear();
      setCoupon(""); setCouponInput(""); setNotes("");
      onPlaced(order);
    } catch (e) {
      if (e.code === "OUT_OF_STOCK") handleSoldOut(e);
      if (e.code === "PAYMENT_NOT_AVAILABLE" && method === "online") { reload(); if (sf?.payments?.cod !== false) setPayChoice("cod"); }
      if (e.status !== 401) setPlaceErr(describeError(e, { storefront: sf }));
    }
    setPlacing(false);
  }
  const placeRef = useRef(place);
  placeRef.current = place;
  useEffect(() => { registerAfterSignIn?.(() => setTimeout(() => placeRef.current(), 50)); }, [registerAfterSignIn]);

  const codOk = sf?.payments?.cod !== false;
  const onlineOk = !!sf?.payments?.online;
  const method = onlineOk && (!codOk || payChoice === "online") ? "online" : "cod";
  const methodOk = method === "online" || codOk;
  const canPlace = good.length > 0 && bad.length === 0 && readyForQuote && quote.status === "ready" && !qErr && methodOk && !placing;
  const total = totals ? totals.total : localSub;
  const actionLabel = method === "online" ? `${t("pay_amount")} ${money(total)}` : t("place_order");
  const hint = mode === "delivery" && addr.text.trim().length < 6 ? "Enter your delivery address to see the delivery fee and place your order."
    : mode === "dine-in" && !table.trim() ? "Pick your table to continue." : "";
  const payLabel = mode === "delivery" ? "Pay on delivery" : "Pay at the counter";

  return (
    <Sheet open={open} onClose={onClose} title={t("your_cart")} tall={cart.length > 0}
      footer={cart.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] text-ink/70">{t("total")}{sf?.tax?.mode === "inclusive" ? ` (${t("gst_incl")})` : ""}</span>
            <span className="font-display text-xl font-extrabold tabular-nums">{money(totals ? totals.total : localSub)}</span>
          </div>
          {hint && <p className="mb-2 text-[13px] font-semibold text-ink/80" role="status">{hint}</p>}
          <Button className="w-full min-h-[52px] text-base" busy={placing} disabled={token ? !canPlace : !(good.length && bad.length === 0 && readyForQuote && quote.status === "ready" && !qErr && methodOk)} onClick={place}>
            {token ? actionLabel : `${t("sign_in")} & ${actionLabel.toLowerCase()}`}
          </Button>
        </div>
      )}>
      {cart.length === 0 ? (
        <Empty title={t("empty_cart")} hint={t("empty_cart_hint")} action={<Button onClick={onClose}>{t("browse_menu")}</Button>} />
      ) : (
        <div className="space-y-5">
          {shownErr && (
            <Banner tone="bad" action={shownErr.action ? <Button variant="ghost" className="shrink-0 !bg-white" onClick={() => act(shownErr)}>{shownErr.label || t("close")}</Button> : null}>
              {shownErr.message}
            </Banner>
          )}

          {channels.length > 1 && (
            <div role="radiogroup" aria-label={t("type_label")} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${channels.length}, minmax(0, 1fr))` }}>
              {channels.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={mode === c} onClick={() => { setMode(c); setPlaceErr(null); }}
                  className={`active-press flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 text-[13px] font-semibold ${mode === c ? "border-brand bg-brand text-brand-on" : "border-line bg-white"}`}>
                  <Icon name={MODE_ICON[c]} size={18} />{t(c)}
                </button>
              ))}
            </div>
          )}

          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {lines.map((l) => {
              const gone = !l.item || !l.item.available;
              return (
                <li key={l.key} className="p-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1"><VegMark veg={l.item?.veg} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-snug">{l.item?.name || "Unavailable dish"}</p>
                      {gone ? <p className="text-[13px] font-semibold text-bad">{l.item ? t("sold_out") : "No longer on the menu"}</p> : <p className="text-[14px] text-ink/70">{money(l.item.price)}</p>}
                      {l.note && noteFor !== l.key && <p className="mt-0.5 text-[13px] italic text-ink/70">“{l.note}”</p>}
                    </div>
                    {gone ? (
                      <Button variant="danger" onClick={() => cartApi.remove(l.key)}>{t("remove")}</Button>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <Stepper qty={l.qty} label={l.item.name} onInc={() => cartApi.inc(l.key)} onDec={() => cartApi.dec(l.key)} />
                        <span className="text-[14px] font-bold tabular-nums">{money(l.item.price * l.qty)}</span>
                      </div>
                    )}
                  </div>
                  {!gone && (noteFor === l.key ? (
                    <input autoFocus type="text" aria-label={`${t("note")}: ${l.item.name}`} maxLength={120} defaultValue={l.note} placeholder="e.g. less spicy"
                      onBlur={(e) => { cartApi.setNote(l.key, e.target.value.trim()); setNoteFor(null); }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={`${inputCls} mt-2`} />
                  ) : (
                    <button type="button" onClick={() => setNoteFor(l.key)} className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold text-brand">
                      <Icon name="note" size={16} />{l.note ? "Edit note" : "Add note"}
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>

          {/* coupon */}
          <div>
            {coupon && q?.coupon ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-good/30 bg-good-soft px-3 py-2 text-good">
                <span className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="tag" size={18} />{q.coupon.code} applied · you save {money(q.coupon.saves)}</span>
                <button type="button" className="min-h-[44px] px-2 text-[13px] font-bold underline" onClick={() => { setCoupon(""); setCouponInput(""); }}>{t("remove")}</button>
              </div>
            ) : (
              <Field label={t("coupon")} error={couponErr?.message}>
                {(p) => (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setCouponError(null); setCoupon(couponInput.trim().toUpperCase()); }}>
                    <input {...p} ref={couponRef} type="text" autoCapitalize="characters" value={couponInput} onChange={(e) => { setCouponInput(e.target.value); setCouponError(null); }} placeholder="WELCOME10" className={`${inputCls} uppercase`} />
                    <Button type="submit" variant="brand" disabled={!couponInput.trim()}>{t("apply")}</Button>
                  </form>
                )}
              </Field>
            )}
          </div>

          {/* where */}
          {needsAddr && (
            <section className="space-y-3">
              {me?.addresses?.length > 0 && (
                <div>
                  <p className="mb-1 text-[13px] font-semibold">{t("saved")}</p>
                  <div className="flex flex-wrap gap-2">
                    {me.addresses.map((a, i) => (
                      <button key={i} type="button" onClick={() => setAddr({ text: a.text, landmark: a.landmark || "", lat: a.lat ?? null, lng: a.lng ?? null, pin: a.lat != null ? "saved" : null })}
                        className={`active-press min-h-[44px] max-w-full truncate rounded-xl border px-3 text-left text-[13px] ${addr.text === a.text ? "border-accent bg-accent-soft" : "border-line bg-white"}`}>
                        <span className="block max-w-[260px] truncate"><Icon name="pin" size={14} className="mr-1 inline" />{a.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Field label={t("address")}>
                {(p) => <textarea {...p} ref={addrRef} rows={2} maxLength={200} autoComplete="street-address" value={addr.text} onChange={(e) => setAddr(addr.pin === "saved" ? { ...addr, text: e.target.value, lat: null, lng: null, pin: null } : { ...addr, text: e.target.value })} placeholder="Flat / house no., street, area" className={`${inputCls} py-2`} />}
              </Field>
              <Field label={t("landmark")}>
                {(p) => <input {...p} type="text" maxLength={80} value={addr.landmark} onChange={(e) => setAddr({ ...addr, landmark: e.target.value })} className={inputCls} />}
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" onClick={locate} busy={geo.busy}><Icon name="gps" size={18} />{t("use_location")}</Button>
                {addr.lat != null && (
                  <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-good"><Icon name="check" size={16} />Location pinned
                    <button type="button" className="min-h-[44px] px-1 text-ink/70 underline" onClick={() => setAddr({ ...addr, lat: null, lng: null, pin: null })}>{t("remove")}</button>
                  </span>
                )}
              </div>
              {geo.error && <p className="text-[13px] text-bad" role="alert">{geo.error}</p>}
              {token && <label className="flex min-h-[44px] items-center gap-3 text-[14px]"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} />Save this address for next time</label>}
            </section>
          )}
          {mode === "dine-in" && (
            <Field label={t("table")}>
              {(p) => sf?.tables?.length ? (
                <select {...p} ref={tableRef} value={table} onChange={(e) => { setTable(e.target.value); setPlaceErr(null); }} className={inputCls}>
                  <option value="">{t("pick_table")}</option>
                  {sf.tables.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              ) : <input {...p} ref={tableRef} type="text" maxLength={12} value={table} onChange={(e) => setTable(e.target.value)} className={inputCls} />}
            </Field>
          )}

          <Field label={t("notes")}>
            {(p) => <textarea {...p} rows={2} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} py-2`} />}
          </Field>

          {/* payment */}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-semibold">{t("pay_how")}</legend>
            {onlineOk && codOk ? (
              <div role="radiogroup" aria-label={t("pay_how")} className="space-y-2">
                {[["online", t("pay_online"), "wallet"], ["cod", t("pay_cod_delivery"), "bag"]].map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={payChoice === k} onClick={() => { setPayChoice(k); setPlaceErr(null); }}
                    className={`active-press flex min-h-[52px] w-full items-center gap-3 rounded-2xl border-2 p-3 text-left ${payChoice === k ? "border-brand bg-brand-soft" : "border-line bg-white"}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${payChoice === k ? "border-brand bg-brand text-brand-on" : "border-line bg-white"}`}>{payChoice === k && <Icon name="check" size={14} stroke={3} />}</span>
                    <span className="font-semibold">{label}</span>
                  </button>
                ))}
              </div>
            ) : onlineOk ? (
              <div className="flex items-center gap-3 rounded-2xl border-2 border-brand bg-brand-soft p-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-brand-on"><Icon name="check" size={14} stroke={3} /></span>
                <p className="font-semibold">{t("pay_online")}</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border-2 border-brand bg-brand-soft p-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-brand-on"><Icon name="check" size={14} stroke={3} /></span>
                <div>
                  <p className="font-semibold">{mode === "delivery" ? t("pay_on") : payLabel}</p>
                  <p className="text-[13px] text-ink/70">{t("pay_on_hint")}</p>
                </div>
              </div>
            )}
          </fieldset>
          {!codOk && !onlineOk && <Banner tone="warn">Pay-on-delivery is not available at this hour. Please try again a little later.</Banner>}

          {sf?.whatsapp?.order_updates !== false && (
            <div>
              <label className="flex min-h-[44px] items-center gap-3 text-[14px] font-semibold">
                <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={wa} onChange={(e) => setWa(e.target.checked)} />{t("wa_updates")}
              </label>
              <p className="pl-8 text-[12px] text-ink/70">{t("wa_note")}</p>
            </div>
          )}

          {/* totals */}
          <div className="rounded-2xl border border-line bg-white p-3" aria-live="polite" aria-busy={quote.status === "loading"}>
            {quote.status === "loading" && !q ? <Skeleton className="h-20" /> : (
              <>
                <Row label={t("subtotal")} value={money(totals ? totals.subtotal - fee : localSub)} />
                {totals?.discount > 0 && <Row label={t("discount")} value={`− ${money(totals.discount)}`} tone="good" />}
                {mode === "delivery" && (q ? <Row label={t("delivery_fee")} value={fee ? money(fee) : "Free"} /> : <Row label={t("delivery_fee")} value={<span className="text-ink/70">after address</span>} />)}
                {totals?.tax > 0 && <Row label={sf?.tax?.mode === "inclusive" ? `${t("gst_incl")}` : "GST"} value={sf?.tax?.mode === "inclusive" ? <span className="text-ink/70">{money(totals.tax)}</span> : money(totals.tax)} />}
                <div className="my-1 border-t border-line" />
                <Row strong label={t("total")} value={money(totals ? totals.total : localSub)} />
                {q?.distance_km != null && <p className="mt-1 text-[12px] text-ink/70">{q.distance_km} km away</p>}
                {sf?.ordering?.prep_minutes != null && <p className="text-[12px] text-ink/70">Ready in about {sf.ordering.prep_minutes} {t("min")}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
