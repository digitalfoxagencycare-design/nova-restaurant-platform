import { money } from "@nova/shared";
import { useApp } from "../state.jsx";
import { useI18n, LANG_NAMES } from "../i18n.js";
import { storeUrl } from "../lib/env.js";
import { BrandMark, Banner, Button, Icon, PoweredBy, Skeleton, VegMark } from "../components/ui.jsx";
import { DishImage } from "../components/DishArt.jsx";

function Pattern() {
  // generated, brand-coloured pattern used when the restaurant has no hero photo
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[.16]" aria-hidden="true">
      <defs>
        <pattern id="hero-p" width="72" height="72" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
          <circle cx="12" cy="12" r="5" fill="rgb(var(--on-brand))" />
          <circle cx="48" cy="48" r="9" fill="none" stroke="rgb(var(--on-brand))" strokeWidth="2.5" />
          <path d="M44 10l8 8M52 10l-8 8" stroke="rgb(var(--on-brand))" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="16" cy="54" r="2.5" fill="rgb(var(--on-brand))" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hero-p)" />
    </svg>
  );
}

function Info({ icon, title, children }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon name={icon} size={20} /></div>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink/70">{title}</h3>
        <div className="mt-0.5 text-[15px] leading-snug">{children}</div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { storefront: sf, items, menu, code, navigate, sf: sfState } = useApp();
  const { t, lang, setLang, languages } = useI18n();
  if (!sf) return <div className="p-4"><Skeleton className="h-72" /><Skeleton className="mt-4 h-24" /></div>;
  const b = sf.brand;
  const o = sf.ordering;
  const d = sf.delivery;
  const phone = b.support?.phone || b.phone;
  const mapHref = b.map_url || (b.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}` : "");
  const go = () => navigate(storeUrl(code));
  const popular = (items || []).filter((i) => i.available).slice(0, 6);
  const slabs = d.fee_slabs || [];
  const hasDelivery = sf.ordering.channels.includes("delivery");

  return (
    <div className="mx-auto min-h-dvh max-w-6xl pb-28 md:pb-0">
      <header className="relative overflow-hidden bg-brand text-brand-on md:rounded-b-[2rem]">
        {b.hero_image_url ? (
          <>
            <img src={b.hero_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-brand/75" />
          </>
        ) : <Pattern />}
        <div className="relative px-5 pb-10 pt-6 pt-safe md:px-12 md:pb-16">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark brand={b} size={44} />
              <span className="truncate font-display text-lg font-bold">{b.name}</span>
            </div>
            {languages.length > 1 && (
              <label className="flex items-center gap-2 text-[13px]">
                <span className="sr-only">{t("language")}</span>
                <select value={lang} onChange={(e) => setLang(e.target.value)} className="min-h-[44px] rounded-xl border border-brand-on/30 bg-brand px-2 text-brand-on">
                  {languages.map((l) => <option key={l} value={l}>{LANG_NAMES[l] || l}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="mt-10 max-w-2xl md:mt-16">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold ${o.paused ? "bg-warn-soft text-warn" : "bg-good-soft text-good"}`}>
              <span className={`h-2 w-2 rounded-full ${o.paused ? "bg-warn" : "bg-good"}`} />
              {o.paused ? t("paused") : t("open_now")}
            </span>
            <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.05] md:text-6xl">{b.name}</h1>
            {b.tagline && <p className="mt-3 text-lg text-brand-on/90 md:text-xl">{b.tagline}</p>}
            {o.paused && o.notice && <p className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-[15px]">{o.notice}</p>}
            <div className="mt-7 hidden md:block">
              <Button onClick={go} className="min-h-[52px] px-8 text-base">{t("order_online")}</Button>
            </div>
          </div>
        </div>
      </header>

      <main className="space-y-10 px-4 pt-6 md:px-12 md:pt-10">
        {o.paused && <Banner tone="warn">{o.notice || t("paused")}</Banner>}

        <section aria-label={t("contact")} className="grid gap-3 md:grid-cols-3">
          {(b.address || mapHref) && (
            <Info icon="pin" title={t("about")}>
              {b.address && <p>{b.address}</p>}
              {mapHref && <a href={mapHref} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-brand underline">{t("directions")}</a>}
            </Info>
          )}
          {b.hours && <Info icon="clock" title={t("hours")}><p>{b.hours}</p></Info>}
          {phone && <Info icon="phone" title={t("call")}><a href={`tel:${phone}`} className="inline-flex min-h-[44px] items-center font-semibold text-brand underline">{phone}</a></Info>}
        </section>

        <section aria-labelledby="del-h">
          <h2 id="del-h" className="font-display text-2xl font-bold">{t("delivery")}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {hasDelivery && d.max_km != null && <Stat label={t("radius")} value={`${d.max_km} km`} />}
            {o.min_order > 0 && <Stat label={t("min_order")} value={money(o.min_order)} />}
            {o.prep_minutes != null && <Stat label={t("prep_time")} value={`${o.prep_minutes} ${t("min")}`} />}
            {hasDelivery && d.free_above != null && <Stat label={t("free_above")} value={money(Math.round(d.free_above * 100))} />}
          </div>
          {hasDelivery && slabs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" aria-label={t("delivery_fee")}>
              {slabs.map((s, i) => (
                <span key={i} className="rounded-full border border-line bg-white px-3 py-1.5 text-[14px]">
                  {t("up_to")} {s.up_to_km} {t("km")}: <b>{money(Math.round(s.fee * 100))}</b>
                </span>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="pop-h">
          <h2 id="pop-h" className="font-display text-2xl font-bold">{t("popular")}</h2>
          {menu.status === "loading" && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {popular.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={go} className="active-press flex w-full gap-3 rounded-2xl border border-line bg-white p-3 text-left shadow-card">
                  <DishImage item={it} className="h-20 w-20 shrink-0 rounded-xl" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><VegMark veg={it.veg} /><span className="truncate font-semibold">{it.name}</span></span>
                    {it.description && <span className="mt-1 line-clamp-2 block text-[13px] text-ink/70">{it.description}</span>}
                    <span className="mt-1 block font-bold">{money(it.price)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-h">
          <h2 id="how-h" className="font-display text-2xl font-bold">{t("how_it_works")}</h2>
          <ol className="mt-3 grid gap-3 md:grid-cols-3">
            {["step1", "step2", "step3"].map((k, i) => (
              <li key={k} className="flex items-center gap-4 rounded-2xl bg-brand-soft p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand font-display text-lg font-bold text-brand-on">{i + 1}</span>
                <span className="text-[15px] font-semibold leading-snug">{t(k)}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="mt-12 border-t border-line px-4 py-8 text-center md:px-12">
        <p className="font-display text-lg font-bold">{b.name}</p>
        {b.legal_name && b.legal_name !== b.name && <p className="text-[13px] text-ink/70">{b.legal_name}</p>}
        <PoweredBy className="mt-4" />
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 pb-safe pt-3 pb-3 backdrop-blur md:hidden">
        <Button onClick={go} className="w-full min-h-[52px] text-base">{t("order_online")}</Button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-[13px] text-ink/70">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
    </div>
  );
}
