import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, getSession, getTenant, loadBrand, signOut as doSignOut, subscribe } from "./session.js";
import { batteryPercent, currentPosition } from "./location.js";
import { Icon, ToastHost, useToast, usePoll } from "./ui.jsx";
import Login from "./Login.jsx";
import Home from "./screens/Home.jsx";
import Order from "./screens/Order.jsx";
import History from "./screens/History.jsx";
import Profile from "./screens/Profile.jsx";

const POLL_MS = 10000;
const LOC_MS = 10000;

/** Online/offline switch. While online the position goes to the server every ~10 s; switching off posts online:false once. */
function useOnlineSwitch() {
  const toast = useToast();
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locError, setLocError] = useState("");
  const [lastPing, setLastPing] = useState(null);
  const last = useRef(null);

  const ping = useCallback(async (on) => {
    let pos = null;
    try { pos = await currentPosition(); last.current = pos; } catch (e) { if (on) throw e; pos = last.current; }
    const body = { lat: pos ? pos.lat : 0, lng: pos ? pos.lng : 0, online: on };
    if (pos && pos.speed !== undefined) body.speed = pos.speed;
    const battery = await batteryPercent();
    if (battery !== undefined) body.battery = battery;
    await api.post("/v2/delivery/location", body);
    setLastPing(new Date());
  }, []);

  const toggle = useCallback(async (next) => {
    setBusy(true);
    try {
      if (next) {
        await ping(true);
        setLocError("");
        setOnline(true);
        toast("You are online. Orders ready for pickup will show here.", "good");
      } else {
        setOnline(false);
        await ping(false).catch(() => {});
        toast("You are offline. Location sharing stopped.");
      }
    } catch (e) {
      setLocError(e.message);
      toast(e.message, "bad");
    } finally { setBusy(false); }
  }, [ping, toast]);

  useEffect(() => {
    if (!online) return undefined;
    const id = setInterval(() => {
      ping(true).then(() => setLocError("")).catch((e) => setLocError(e.message));
    }, LOC_MS);
    return () => clearInterval(id);
  }, [online, ping]);

  return { online, busy, locError, lastPing, toggle };
}

function Shell({ session }) {
  const toast = useToast();
  const sw = useOnlineSwitch();
  const [tab, setTab] = useState("home");
  const [openId, setOpenId] = useState(null);
  const [shop, setShop] = useState(null);

  useEffect(() => { loadBrand(session.tenant).then(setShop).catch(() => {}); }, [session.tenant]);

  const poll = usePoll(async () => {
    const [orders, today] = await Promise.all([api.get("/v2/delivery/orders"), api.get("/v2/delivery/summary", { query: { range: "today" } })]);
    return { orders, today };
  }, POLL_MS, []);

  // tell the rider when a new order lands in the pickup pool
  const seen = useRef(null);
  const poolIds = poll.data ? poll.data.orders.pickup.map((o) => o.id) : null;
  useEffect(() => {
    if (!poolIds) return;
    if (seen.current && sw.online) {
      const fresh = poolIds.filter((id) => !seen.current.has(id));
      if (fresh.length) {
        toast(fresh.length === 1 ? "A new order is ready for pickup" : `${fresh.length} new orders are ready for pickup`, "good");
        try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* not supported */ }
      }
    }
    seen.current = new Set(poolIds);
  }, [poolIds && poolIds.join(","), sw.online]); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useCallback(async () => {
    if (sw.online) await sw.toggle(false);
    doSignOut();
  }, [sw]);

  const orders = poll.data ? poll.data.orders : { pickup: [], active: [], history: [] };
  const open = openId ? [...orders.active, ...orders.history, ...orders.pickup].find((o) => o.id === openId) : null;
  const activeCount = orders.active.length;

  const tabs = [["home", "Home", "home"], ["history", "History", "history"], ["profile", "Profile", "user"]];
  const brandName = shop && shop.brand && shop.brand.name;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col bg-brand-soft">
      {open || openId ? (
        <Order order={open} orderId={openId} onBack={() => setOpenId(null)} onChanged={poll.reload} shop={shop} />
      ) : (
        <>
          <header className="pt-safe sticky top-0 z-20 flex items-center justify-between bg-brand px-5 pb-3 pt-4 text-brand-on">
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-extrabold">{brandName || "Delivery"}</p>
              <p className="text-xs opacity-80">Delivery partner</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${sw.online ? "bg-good-soft text-good" : "bg-brand-soft text-ink"}`}>{sw.online ? "Online" : "Offline"}</span>
          </header>
          <main className="flex-1 px-4 pb-28 pt-4">
            {tab === "home" ? <Home poll={poll} sw={sw} onOpen={setOpenId} /> : null}
            {tab === "history" ? <History onOpen={setOpenId} /> : null}
            {tab === "profile" ? <Profile session={session} shop={shop} onSignOut={signOut} /> : null}
          </main>
          <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-[520px] border-t border-line bg-surface">
            {tabs.map(([id, label, icon]) => (
              <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}
                className={`relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${tab === id ? "text-accent" : "text-ink opacity-70"}`}>
                <Icon name={icon} className="h-6 w-6" />
                {label}
                {id === "home" && activeCount ? <span className="absolute right-[28%] top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-on">{activeCount}</span> : null}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

export default function App() {
  const session = useSyncExternalStore(subscribe, () => JSON.stringify(getSession()));
  const parsed = session && session !== "null" ? JSON.parse(session) : null;

  useEffect(() => { if (!parsed && getTenant()) loadBrand(getTenant()).catch(() => {}); }, [parsed]);

  return (
    <ToastHost>
      {parsed ? <Shell session={parsed} /> : <Login />}
    </ToastHost>
  );
}
