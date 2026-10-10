import { useEffect, useMemo, useRef, useState } from "react";
import { money } from "@nova/shared";
import { useApp } from "../state.jsx";
import { useI18n } from "../i18n.js";
import { Banner, Button, Chip, Empty, Field, Icon, inputCls, Sheet, Skeleton, Stepper, VegMark } from "../components/ui.jsx";
import { DishImage } from "../components/DishArt.jsx";

function DishCard({ item, onOpen }) {
  const { qtyOf, cartApi, cart } = useApp();
  const { t } = useI18n();
  const qty = qtyOf(item.id);
  const lineKey = cart.filter((l) => l.item_id === item.id).slice(-1)[0]?.key;
  const sold = !item.available;
  return (
    <li className={`flex gap-3 rounded-2xl border border-line bg-white p-3 shadow-card ${sold ? "opacity-70" : ""}`}>
      <button type="button" onClick={() => onOpen(item)} className="h-24 w-24 shrink-0 self-start overflow-hidden rounded-xl" aria-label={`${item.name}, ${money(item.price)}`} tabIndex={-1}>
        <DishImage item={item} className={`h-full w-full ${sold ? "grayscale" : ""}`} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <button type="button" onClick={() => onOpen(item)} className="min-w-0 text-left">
          <span className="flex items-start gap-2"><span className="mt-0.5"><VegMark veg={item.veg} /></span><span className="font-semibold leading-snug">{item.name}</span></span>
          {item.description && <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-ink/70">{item.description}</span>}
        </button>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[15px] font-bold">{money(item.price)}</span>
          {sold ? (
            <span className="rounded-lg bg-line px-2.5 py-2 text-[12px] font-bold uppercase tracking-wide text-ink/80">{t("sold_out")}</span>
          ) : qty > 0 ? (
            <Stepper qty={qty} label={item.name} onInc={() => cartApi.add(item)} onDec={() => lineKey && cartApi.dec(lineKey)} />
          ) : (
            <button type="button" onClick={() => cartApi.add(item)} aria-label={`${t("add")} ${item.name}`} className="active-press min-h-[44px] min-w-[84px] rounded-xl border-2 border-accent bg-accent-soft px-4 text-[14px] font-extrabold tracking-wide text-ink">
              {t("add")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function DishSheet({ item, onClose }) {
  const { cartApi } = useApp();
  const { t } = useI18n();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  useEffect(() => { setQty(1); setNote(""); }, [item?.id]);
  if (!item) return null;
  return (
    <Sheet open onClose={onClose} title={item.name}
      footer={
        <div className="flex items-center gap-3">
          <Stepper qty={qty} label={item.name} onInc={() => setQty((q) => Math.min(99, q + 1))} onDec={() => setQty((q) => Math.max(1, q - 1))} />
          <Button className="flex-1" disabled={!item.available} onClick={() => { cartApi.add(item, qty, note.trim()); onClose(); }}>
            {item.available ? `${t("add_to_cart")} · ${money(item.price * qty)}` : t("sold_out")}
          </Button>
        </div>
      }>
      <DishImage item={item} className="h-48 w-full rounded-2xl" />
      <div className="mt-3 flex items-center gap-2"><VegMark veg={item.veg} /><span className="text-[13px] text-ink/70">{item.category}</span></div>
      {item.description && <p className="mt-2 text-[15px] leading-snug">{item.description}</p>}
      <p className="mt-2 text-lg font-bold">{money(item.price)}</p>
      <Field label={t("note")} hint="e.g. less spicy, no onion" className="mt-4">
        {(p) => <textarea {...p} rows={2} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} py-2`} />}
      </Field>
    </Sheet>
  );
}

export default function Menu({ searchTab, onOpenCart }) {
  const { menu, items, reload, storefront } = useApp();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [veg, setVeg] = useState(false);
  const [cat, setCat] = useState("all");
  const [dish, setDish] = useState(null);
  const searchRef = useRef(null);
  useEffect(() => { if (searchTab) searchRef.current?.focus(); }, [searchTab]);

  const cats = menu.data?.categories || [];
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items || []).filter((i) => (!veg || i.veg) && (cat === "all" || searchTab || i.category === cat) && (!s || `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(s)));
  }, [items, q, veg, cat, searchTab]);
  const grouped = useMemo(() => {
    const m = new Map();
    for (const i of list) { if (!m.has(i.category)) m.set(i.category, []); m.get(i.category).push(i); }
    return [...m.entries()];
  }, [list]);

  if (menu.status === "error") {
    return <div className="p-4"><Banner tone="bad" action={<Button variant="ghost" className="shrink-0" onClick={reload}>{t("retry")}</Button>}>{menu.error?.message}</Banner></div>;
  }

  return (
    <div>
      <div className="sticky top-[var(--hdr,64px)] z-20 space-y-2 bg-surface/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/60" />
          <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search_ph")} aria-label={t("search_ph")} className={`${inputCls} pl-10`} />
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1" role="toolbar" aria-label="Filters">
          <Chip active={veg} onClick={() => setVeg((v) => !v)}><span className="inline-flex items-center gap-2"><VegMark veg /> {t("veg_only")}</span></Chip>
          {!searchTab && <Chip active={cat === "all"} onClick={() => setCat("all")}>{t("all")}</Chip>}
          {!searchTab && cats.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
        </div>
      </div>

      <div className="space-y-6 px-4 pb-6 pt-2">
        {menu.status === "loading" && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[120px]" />)}
        {menu.status === "ready" && grouped.length === 0 && <Empty icon="search" title={t("search_empty")} />}
        {grouped.map(([c, its]) => (
          <section key={c} aria-labelledby={`c-${c}`}>
            <h2 id={`c-${c}`} className="mb-2 font-display text-xl font-bold">{c} <span className="text-[14px] font-medium text-ink/60">({its.length})</span></h2>
            <ul className="space-y-3">{its.map((it) => <DishCard key={it.id} item={it} onOpen={setDish} />)}</ul>
          </section>
        ))}
      </div>
      <DishSheet item={dish} onClose={() => setDish(null)} />
    </div>
  );
}
