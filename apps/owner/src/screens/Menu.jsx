import { useMemo, useState } from "react";
import { money, toPaise } from "@nova/shared";
import { api } from "../session.js";
import { useApp } from "../ctx.js";
import { Button, Card, Chip, Empty, ErrorBox, Field, Icon, inputCls, Sheet, Spinner, Switch, useToast, usePoll } from "../ui.jsx";
import { ConfirmSheet, Segmented } from "../ui-extra.jsx";

const STATIONS = ["kitchen", "beverage", "bakery", "bar"];

function parseRupees(s) {
  const n = Number(String(s).replace(/[,\s₹]/g, ""));
  return Number.isFinite(n) && n >= 0 && String(s).trim() !== "" ? toPaise(n) : null;
}

function VegDot({ veg }) {
  if (veg == null) return null;
  return <span title={veg ? "Veg" : "Non-veg"} aria-label={veg ? "Veg" : "Non-veg"} className={`inline-grid h-4 w-4 shrink-0 place-items-center rounded-sm border-2 ${veg ? "border-good" : "border-bad"}`}><span className={`h-2 w-2 rounded-full ${veg ? "bg-good" : "bg-bad"}`} /></span>;
}

function DishSheet({ dish, categories, stations, onClose, onSaved }) {
  const toast = useToast();
  const edit = !!dish;
  const [name, setName] = useState(dish ? dish.name : "");
  const [price, setPrice] = useState(dish ? String(dish.price / 100) : "");
  const [category, setCategory] = useState(dish ? dish.category : categories[0] || "");
  const [veg, setVeg] = useState(dish && dish.veg != null ? dish.veg : true);
  const [desc, setDesc] = useState(dish ? dish.description : "");
  const [station, setStation] = useState(dish ? dish.station : "kitchen");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const paise = parseRupees(price);
  const valid = name.trim() && paise !== null && category.trim();

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const body = { name: name.trim(), price: paise, category: category.trim(), description: desc.trim(), station };
      if (edit) await api.patch(`/v2/pos/menu/${dish.id}`, body);
      else await api.post("/v2/pos/menu", { ...body, veg, available: true });
      toast(edit ? "Dish saved" : "Dish added", "good");
      await onSaved();
    } catch (ex) { setErr(ex.status === 403 ? "You are not allowed to change the menu." : ex.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={edit ? "Edit dish" : "Add dish"}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <Field label="Name" id="dname"><input id="dname" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)" id="dprice" error={price && paise === null ? "Enter an amount like 250 or 99.50" : ""}>
            <input id="dprice" className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="250" required />
          </Field>
          <Field label="Station" id="dstation">
            <select id="dstation" className={inputCls} value={station} onChange={(e) => setStation(e.target.value)}>
              {[...new Set([...STATIONS, ...stations, station])].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Category" id="dcat">
          <input id="dcat" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} list="cats" maxLength={40} required />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div>
          <p className="mb-1 text-sm font-semibold">Veg or non-veg</p>
          {edit ? <p className="text-sm opacity-80">{dish.veg == null ? "Not set" : dish.veg ? "Veg" : "Non-veg"}. This cannot be changed after the dish is created.</p>
            : <Segmented label="Veg or non-veg" value={veg} onChange={setVeg} options={[[true, "Veg"], [false, "Non-veg"]]} />}
        </div>
        <Field label="Description (optional)" id="ddesc"><textarea id="ddesc" rows={2} className={`${inputCls} py-2`} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={240} /></Field>
        {err ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{err}</p> : null}
        <Button type="submit" className="w-full" busy={busy} disabled={!valid}>{edit ? "Save changes" : "Add dish"}</Button>
      </form>
    </Sheet>
  );
}

function BulkSheet({ items, categories, canStock, canPrice, initialCategory, onClose, onDone }) {
  const toast = useToast();
  const [mode, setMode] = useState(canStock ? "stock" : "price");
  const [category, setCategory] = useState(initialCategory || categories[0] || "");
  const [pct, setPct] = useState("");
  const [allDishes, setAllDishes] = useState(false);
  const [confirm, setConfirm] = useState(null); // {kind, available?}
  const [busy, setBusy] = useState(false);
  const pctNum = Number(pct);
  const pctOk = pct.trim() !== "" && Number.isFinite(pctNum) && pctNum >= -50 && pctNum <= 100 && pctNum !== 0;
  const scoped = items.filter((i) => allDishes || i.category === category);
  const sample = scoped.slice(0, 3).map((i) => ({ name: i.name, from: i.price, to: Math.max(100, Math.round((i.price * (1 + pctNum / 100)) / 100) * 100) }));

  async function run() {
    setBusy(true);
    try {
      let r;
      if (confirm.kind === "stock") r = await api.post("/v2/pos/menu/bulk-availability", { category, available: confirm.available });
      else r = await api.post("/v2/pos/menu/bulk-price", { category: allDishes ? null : category, pct: pctNum });
      toast(`${r.updated} dishes updated`, "good");
      await onDone();
    } catch (e) { toast(e.status === 403 ? "You are not allowed to do this." : e.message, "bad"); setConfirm(null); } finally { setBusy(false); }
  }

  return (
    <>
      <Sheet open={!confirm} onClose={onClose} title="Bulk changes">
        <div className="space-y-4">
          {canStock && canPrice ? <Segmented label="What to change" value={mode} onChange={setMode} options={[["stock", "Sold out"], ["price", "Prices"]]} /> : null}
          {mode === "stock" || !canPrice ? (
            <>
              <Field label="Category" id="bcat"><select id="bcat" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <p className="text-sm opacity-80">{items.filter((i) => i.category === category).length} dishes in {category}.</p>
              <div className="flex gap-2">
                <Button kind="danger" className="flex-1" onClick={() => setConfirm({ kind: "stock", available: false })}>Mark all sold out</Button>
                <Button kind="good" className="flex-1" onClick={() => setConfirm({ kind: "stock", available: true })}>Mark all available</Button>
              </div>
            </>
          ) : (
            <>
              <Field label="Change prices by (%)" id="bpct" hint="Use a minus sign to lower prices, for example -10. Allowed from -50 to 100. Prices round to a whole rupee.">
                <input id="bpct" className={inputCls} value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" placeholder="10" />
              </Field>
              <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={allDishes} onChange={(e) => setAllDishes(e.target.checked)} className="h-6 w-6 accent-[rgb(var(--accent))]" />Apply to every dish in the menu</label>
              {!allDishes ? <Field label="Category" id="bcat2"><select id="bcat2" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field> : null}
              {pctOk ? (
                <div className="rounded-xl bg-brand-soft p-3 text-sm">
                  <p className="mb-1 font-semibold">{scoped.length} dishes will change. For example:</p>
                  {sample.map((s) => <p key={s.name} className="flex justify-between gap-2"><span className="truncate">{s.name}</span><span className="shrink-0">{money(s.from)} to {money(s.to)}</span></p>)}
                </div>
              ) : null}
              <Button className="w-full" disabled={!pctOk || !scoped.length} onClick={() => setConfirm({ kind: "price" })}>Review change</Button>
            </>
          )}
        </div>
      </Sheet>
      <ConfirmSheet open={!!confirm} onClose={() => setConfirm(null)} busy={busy} onConfirm={run} danger={confirm && confirm.kind === "stock" && !confirm.available}
        title="Are you sure?" confirmLabel={confirm && confirm.kind === "price" ? `Change prices by ${pctNum}%` : confirm && confirm.available ? "Mark available" : "Mark sold out"}
        message={confirm && (confirm.kind === "price"
          ? `This changes the price of ${scoped.length} dishes ${allDishes ? "across the whole menu" : `in ${category}`} by ${pctNum}%. Customers see the new prices straight away.`
          : `This marks every dish in ${category} as ${confirm.available ? "available" : "sold out"}. Customers see it straight away.`)} />
    </>
  );
}

export default function Menu() {
  const { can } = useApp();
  const toast = useToast();
  const q = usePoll(() => api.get("/v2/pos/menu"), 0, []);
  const [text, setText] = useState("");
  const [cat, setCat] = useState("All");
  const [sheet, setSheet] = useState(null); // {kind:'dish', dish?} | {kind:'bulk'}
  const [busyId, setBusyId] = useState("");
  const [local, setLocal] = useState({});
  const canEdit = can("menu.edit");
  const canStock = can("menu.stock") || canEdit;

  const items = useMemo(() => (q.data || []).map((i) => (i.id in local ? { ...i, available: local[i.id] } : i)), [q.data, local]);
  const categories = useMemo(() => [...new Set((q.data || []).map((i) => i.category))], [q.data]);
  const stations = useMemo(() => [...new Set((q.data || []).map((i) => i.station))], [q.data]);
  const rows = items.filter((i) => (cat === "All" || i.category === cat) && (!text.trim() || i.name.toLowerCase().includes(text.trim().toLowerCase())));
  const soldOut = items.filter((i) => !i.available).length;

  async function toggle(i, available) {
    setBusyId(i.id);
    setLocal((l) => ({ ...l, [i.id]: available }));
    try {
      await api.patch(`/v2/pos/menu/${i.id}`, { available });
      await q.reload();
      setLocal((l) => { const { [i.id]: _, ...rest } = l; return rest; });
      toast(`${i.name} is ${available ? "available" : "sold out"}`, available ? "good" : "info");
    } catch (e) {
      setLocal((l) => { const { [i.id]: _, ...rest } = l; return rest; });
      toast(e.status === 403 ? "You are not allowed to change availability." : e.message, "bad");
    } finally { setBusyId(""); }
  }
  const saved = async () => { setSheet(null); setLocal({}); await q.reload(); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold opacity-80">{items.length} dishes{soldOut ? ` · ${soldOut} sold out` : ""}</p>
        <div className="flex gap-2">
          {canStock && items.length ? <Button kind="line" className="!min-h-[44px]" onClick={() => setSheet({ kind: "bulk" })}>Bulk</Button> : null}
          {canEdit ? <Button className="!min-h-[44px]" onClick={() => setSheet({ kind: "dish" })}><Icon name="plus" className="h-4 w-4" />Add dish</Button> : null}
        </div>
      </div>
      <div className="relative">
        <label htmlFor="msearch" className="sr-only">Search dishes</label>
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 opacity-60" />
        <input id="msearch" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search dishes" className={`${inputCls} pl-10`} />
      </div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Category">
        {["All", ...categories].map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
      </div>
      {q.error ? <ErrorBox message={q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div> : null}
      {q.data && !rows.length ? <Empty icon="dish" title={items.length ? "No dishes match" : "The menu is empty"} hint={canEdit && !items.length ? "Tap Add dish to create the first one." : undefined} /> : null}
      <ul className="space-y-2">
        {rows.map((i) => (
          <li key={i.id}>
            <Card className={`flex items-center gap-3 !p-3 ${i.available ? "" : "opacity-80"}`} data-testid={`dish-${i.name}`}>
              <button type="button" disabled={!canEdit} onClick={() => setSheet({ kind: "dish", dish: i })} className="min-w-0 flex-1 text-left disabled:cursor-default" aria-label={canEdit ? `Edit ${i.name}` : i.name}>
                <span className="flex items-center gap-2"><VegDot veg={i.veg} /><span className={`truncate font-semibold ${i.available ? "" : "line-through"}`}>{i.name}</span></span>
                <span className="mt-0.5 block text-sm opacity-80">{money(i.price)} · {i.category}</span>
                {!i.available ? <span className="mt-0.5 inline-block rounded-full bg-bad-soft px-2 py-0.5 text-xs font-bold text-bad">Sold out</span> : null}
              </button>
              {canEdit ? <Icon name="edit" className="h-4 w-4 shrink-0 opacity-50" /> : null}
              {canStock ? (
                <div className="flex shrink-0 flex-col items-center gap-0.5">
                  <Switch checked={i.available} disabled={busyId === i.id} onChange={(v) => toggle(i, v)} label={`${i.name} available`} />
                  <span className="text-[10px] font-semibold opacity-70">{i.available ? "Available" : "Sold out"}</span>
                </div>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      {!canStock ? <p className="text-xs opacity-70">Your role can view the menu but not change it.</p> : null}
      {sheet && sheet.kind === "dish" ? <DishSheet dish={sheet.dish} categories={categories} stations={stations} onClose={() => setSheet(null)} onSaved={saved} /> : null}
      {sheet && sheet.kind === "bulk" ? <BulkSheet items={items} categories={categories} canStock={can("menu.stock")} canPrice={canEdit} initialCategory={cat !== "All" ? cat : ""} onClose={() => setSheet(null)} onDone={saved} /> : null}
    </div>
  );
}
