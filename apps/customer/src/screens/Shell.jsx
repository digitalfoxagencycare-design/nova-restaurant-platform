import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { money } from "@nova/shared";
import { useApp } from "../state.jsx";
import { useI18n } from "../i18n.js";
import { aboutUrl } from "../lib/env.js";
import { Banner, BrandMark, Button, Icon } from "../components/ui.jsx";
import Menu from "./Menu.jsx";
import Checkout from "./Checkout.jsx";
import SignIn from "./SignIn.jsx";
import { OrdersList, Track } from "./Orders.jsx";
import Account from "./Account.jsx";

const MODE_ICON = { delivery: "bike", "dine-in": "table", takeaway: "store" };

export default function Shell() {
  const { storefront: sf, channels, mode, setMode, table, cartCount, cartTotal, cartApi, flash, isNative, navigate, code } = useApp();
  const { t } = useI18n();
  const [tab, setTab] = useState("home");
  const [trackId, setTrackIdRaw] = useState(null);
  const [autoPay, setAutoPay] = useState(false);
  const setTrackId = (id, pay = false) => { setAutoPay(!!pay); setTrackIdRaw(id); };
  const [cartOpen, setCartOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const afterSignIn = useRef(null);
  const registerAfterSignIn = useCallback((fn) => { afterSignIn.current = fn; }, []);
  const hdr = useRef(null);
  const pausedRef = sf.ordering.paused;

  useLayoutEffect(() => {
    const el = hdr.current;
    if (!el) return undefined;
    const set = () => document.documentElement.style.setProperty("--hdr", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [tab, trackId]);

  const b = sf.brand;
  const showHeader = tab === "home" || tab === "search";
  const goOrders = () => { setTab("orders"); };

  function placed(order) {
    setCartOpen(false);
    setTab("orders");
    const unpaid = order.status === "pending_payment";
    setTrackId(order.id, unpaid);
    if (!unpaid) flash(`${t("order_placed")} #${order.order_no}`, "good");
  }

  const nav = [["home", "home", t("home")], ["search", "search", t("search")], ["orders", "orders", t("orders")], ["account", "user", t("account")]];

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-surface pb-[calc(140px+var(--sab))] md:border-x md:border-line">
      <div ref={hdr} className="sticky top-0 z-30 bg-brand pt-safe text-brand-on shadow-card">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <BrandMark brand={b} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-bold leading-tight">{b.name}</p>
            {b.tagline && <p className="truncate text-[12px] text-brand-on/80">{b.tagline}</p>}
          </div>
          {!isNative && (
            <a href={aboutUrl(code)} onClick={(e) => { e.preventDefault(); navigate(aboutUrl(code)); }} className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-[13px] font-semibold underline">{t("about")}</a>
          )}
        </div>
        {showHeader && channels.length > 0 && (
          <div className="px-4 pb-3">
            <div role="radiogroup" aria-label={t("type_label")} className="grid rounded-xl bg-brand-on/15 p-1" style={{ gridTemplateColumns: `repeat(${channels.length}, minmax(0, 1fr))` }}>
              {channels.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={mode === c} onClick={() => setMode(c)}
                  className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-bold xs:text-[14px] ${mode === c ? "bg-accent text-accent-on shadow-card" : "text-brand-on"}`}>
                  <Icon name={MODE_ICON[c]} size={17} />{t(c)}
                </button>
              ))}
            </div>
            {mode === "dine-in" && table && <p className="mt-1.5 text-[12px] text-brand-on/90">{t("table")}: <b>{table}</b></p>}
          </div>
        )}
      </div>

      {pausedRef && <div className="px-4 pt-3"><Banner tone="warn" icon="alert"><b>{t("paused")}.</b> {sf.ordering.notice || "The restaurant is not taking online orders right now. You can still browse the menu."}</Banner></div>}

      <main id="main">
        {(tab === "home" || tab === "search") && <Menu key={tab} searchTab={tab === "search"} onOpenCart={() => setCartOpen(true)} />}
        {tab === "orders" && (trackId
          ? <Track id={trackId} autoPay={autoPay} onBack={() => setTrackId(null)} onReorder={(it, q, n) => cartApi.add(it, q, n)} />
          : <OrdersList onOpen={setTrackId} openSignIn={() => setSignInOpen(true)} goMenu={() => setTab("home")} />)}
        {tab === "account" && <Account openSignIn={() => setSignInOpen(true)} />}
      </main>

      {cartCount > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-[calc(64px+var(--sab))] z-30 mx-auto max-w-2xl px-3 pb-2">
          <button type="button" onClick={() => setCartOpen(true)} className="active-press flex min-h-[52px] w-full items-center justify-between rounded-2xl bg-accent px-4 text-accent-on shadow-float">
            <span className="flex items-center gap-2 text-[15px] font-bold"><Icon name="bag" size={20} />{cartCount} {cartCount === 1 ? t("item") : t("items")}</span>
            <span className="flex items-center gap-2 text-[15px] font-bold">{money(cartTotal)} · {t("view_cart")}<Icon name="chevron" size={18} /></span>
          </button>
        </div>
      )}

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-2xl grid-cols-4 border-t border-line bg-white pb-safe">
        {nav.map(([k, icon, label]) => (
          <button key={k} type="button" aria-current={tab === k ? "page" : undefined} onClick={() => { setTab(k); if (k === "orders") setTrackId(null); }}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-[12px] font-semibold ${tab === k ? "text-brand" : "text-ink/70"}`}>
            <span className={`flex h-8 w-14 items-center justify-center rounded-full ${tab === k ? "bg-brand-soft" : ""}`}><Icon name={icon} size={22} /></span>{label}
          </button>
        ))}
      </nav>

      <Checkout open={cartOpen} onClose={() => setCartOpen(false)} onPlaced={placed} goOrders={goOrders}
        openSignIn={() => setSignInOpen(true)} registerAfterSignIn={registerAfterSignIn} />
      <SignIn open={signInOpen} onClose={() => setSignInOpen(false)} onDone={() => { setSignInOpen(false); const f = afterSignIn.current; if (cartOpen && f) f(); }} />
    </div>
  );
}
