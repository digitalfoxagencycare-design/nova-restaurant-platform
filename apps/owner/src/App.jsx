import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, getSession, getTenant, loadBrand, signOut as doSignOut, store, subscribe } from "./session.js";
import { AppCtx, DEFAULT_FLOWS, makeCan } from "./ctx.js";
import { beep, unlockAudio, vibrate } from "./alerts.js";
import { ErrorBox, Icon, Spinner, ToastHost, useToast, usePoll } from "./ui.jsx";
import Login from "./Login.jsx";
import Today from "./screens/Today.jsx";
import Orders from "./screens/Orders.jsx";
import Menu from "./screens/Menu.jsx";
import More from "./screens/More.jsx";

const POLL_MS = 10000;

function Shell({ session }) {
  const toast = useToast();
  const [tab, setTab] = useState("today");
  const [preset, setPreset] = useState(null);
  const [shop, setShop] = useState(null);
  const [rules, setRules] = useState(null);
  const [rulesErr, setRulesErr] = useState(null);
  const [flows, setFlows] = useState(DEFAULT_FLOWS);
  const [sound, setSoundState] = useState(store.get("sound") === "1");

  useEffect(() => { loadBrand(session.tenant).then(setShop).catch(() => {}); }, [session.tenant]);
  const loadRules = useCallback(() => {
    setRulesErr(null);
    api.get("/v2/pos/rules").then(setRules).catch((e) => setRulesErr(e));
  }, []);
  useEffect(loadRules, [loadRules]);

  const role = (rules && rules.role) || session.role;
  const can = useMemo(() => makeCan(role, rules ? rules.permissions : []), [role, rules]);

  useEffect(() => {
    if (!rules || !can("config.view")) return;
    api.get("/v2/tenants/me").then((t) => {
      const f = t.config && t.config.operations && t.config.operations.flows;
      if (f) setFlows({ ...DEFAULT_FLOWS, ...f });
    }).catch(() => {});
  }, [rules]); // eslint-disable-line react-hooks/exhaustive-deps

  function setSound(on) {
    if (on) unlockAudio();
    setSoundState(on);
    store.set("sound", on ? "1" : "0");
    if (on) beep();
  }
  useEffect(() => { if (sound) unlockAudio(); }, [sound]);

  // Background check for new online orders: badge, toast, vibration, optional beep.
  const canOrders = !!rules && can("orders.view");
  const watch = usePoll(async () => (canOrders ? api.get("/v2/orders", { query: { scope: "open", channel: "online", limit: 100 } }) : []), POLL_MS, [canOrders]);
  const placed = (watch.data || []).filter((o) => o.state === "placed");
  const known = useRef(null);
  useEffect(() => {
    if (!watch.data) return;
    const ids = new Set(placed.map((o) => o.id));
    if (known.current) {
      const fresh = placed.filter((o) => !known.current.has(o.id));
      if (fresh.length) {
        toast(fresh.length === 1 ? `New online order #${fresh[0].order_no}` : `${fresh.length} new online orders`, "good");
        vibrate();
        if (sound) beep();
      }
    }
    known.current = ids;
  }, [watch.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const goOrders = (p) => { setPreset(p ? { ...p, n: Date.now() } : null); setTab("orders"); };
  const ctx = { session, shop, rules, role, can, flows, sound, setSound, placed: placed.length, goOrders, reloadWatch: watch.reload };

  const tabs = [["today", "Today", "home"], ...(can("orders.view") ? [["orders", "Orders", "bag"]] : []), ...(can("menu.view") ? [["menu", "Menu", "dish"]] : []), ["more", "More", "menu"]];
  const brandName = shop && shop.brand && shop.brand.name;

  if (rulesErr && !rules) {
    return <div className="mx-auto w-full max-w-[520px] p-4"><ErrorBox message={rulesErr.message} onRetry={loadRules} /></div>;
  }
  if (!rules) {
    return <div className="grid min-h-dvh place-items-center"><Spinner className="h-8 w-8" /></div>;
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col bg-brand-soft">
        <header className="pt-safe sticky top-0 z-20 flex items-center justify-between bg-brand px-5 pb-3 pt-4 text-brand-on">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-extrabold">{brandName || "Restaurant"}</p>
            <p className="text-xs capitalize opacity-80">{role} app</p>
          </div>
          <button type="button" onClick={() => setSound(!sound)} aria-pressed={sound} aria-label={`Sound ${sound ? "on" : "off"}`}
            className="flex min-h-[44px] items-center gap-2 rounded-full bg-brand-on px-3 text-xs font-bold text-brand">
            <Icon name={sound ? "bell" : "bellOff"} className="h-4 w-4" />Sound {sound ? "on" : "off"}
          </button>
        </header>
        <main className="flex-1 px-4 pb-28 pt-4">
          {tab === "today" ? <Today /> : null}
          {tab === "orders" ? <Orders preset={preset} /> : null}
          {tab === "menu" ? <Menu /> : null}
          {tab === "more" ? <More onSignOut={doSignOut} /> : null}
        </main>
        <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-[520px] border-t border-line bg-surface">
          {tabs.map(([id, label, icon]) => (
            <button key={id} type="button" onClick={() => { if (id === "orders") setPreset(null); setTab(id); }} aria-current={tab === id ? "page" : undefined}
              className={`relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${tab === id ? "text-accent" : "text-ink opacity-70"}`}>
              <Icon name={icon} className="h-6 w-6" />
              {label}
              {id === "orders" && placed.length ? <span data-testid="orders-badge" className="absolute right-[26%] top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-on">{placed.length}</span> : null}
            </button>
          ))}
        </nav>
      </div>
    </AppCtx.Provider>
  );
}

export default function App() {
  const snap = useSyncExternalStore(subscribe, () => JSON.stringify(getSession()));
  const parsed = snap && snap !== "null" ? JSON.parse(snap) : null;
  useEffect(() => { if (!parsed && getTenant()) loadBrand(getTenant()).catch(() => {}); }, [parsed]);
  return <ToastHost>{parsed ? <Shell session={parsed} /> : <Login />}</ToastHost>;
}
