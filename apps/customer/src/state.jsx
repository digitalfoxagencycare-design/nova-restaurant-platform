import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { applyBrand, createClient } from "@nova/shared";
import { API_BASE, isNative, readLocation } from "./lib/env.js";
import { I18nProvider } from "./i18n.js";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : "k-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const ORDER_ORDER = ["delivery", "dine-in", "takeaway"];

export function AppProvider({ children }) {
  const [loc, setLoc] = useState(() => readLocation());
  const code = loc.code;

  // navigation (landing <-> storefront) without a router library
  const navigate = useCallback((url) => {
    window.history.pushState({}, "", url);
    setLoc(readLocation());
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const on = () => setLoc(readLocation());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);

  // ---- session
  const tokenKey = `nova.customer.${code}`;
  const [token, setToken] = useState(() => store.get(tokenKey));
  const [me, setMe] = useState(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => { setToken(store.get(tokenKey)); setMe(null); }, [tokenKey]);
  const flash = useCallback((msg, tone = "info") => {
    setToast({ msg, tone, id: Math.random() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const signOut = useCallback((why) => {
    store.set(tokenKey, null);
    tokenRef.current = null;
    setToken(null);
    setMe(null);
    if (why) flash(why);
  }, [tokenKey, flash]);

  const api = useMemo(() => {
    const raw = createClient({
      baseUrl: API_BASE,
      getToken: () => tokenRef.current,
      onUnauthorized: () => { if (tokenRef.current) signOut("Your session ended. Please sign in again."); },
    });
    const wrap = (m) => async (...a) => {
      try { const r = await raw[m](...a); setOffline(false); return r; }
      catch (e) { if (e.code === "NETWORK" || e.code === "TIMEOUT") setOffline(true); throw e; }
    };
    return { get: wrap("get"), post: wrap("post"), put: wrap("put"), del: wrap("del") };
  }, [signOut]);

  const pub = useCallback((p) => `/v2/public/${code}${p}`, [code]);

  // ---- storefront + menu
  const [sf, setSf] = useState({ status: "loading", data: null, error: null });
  const [menu, setMenu] = useState({ status: "loading", data: null, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!code) { setSf({ status: "nocode", data: null }); return undefined; }
    let live = true;
    setSf((s) => (s.data && s.data.slug === code ? s : { status: "loading", data: null, error: null }));
    api.get(pub("/storefront")).then((d) => {
      if (!live) return;
      applyBrand(d.brand);
      setSf({ status: "ready", data: d, error: null });
    }).catch((e) => {
      if (!live) return;
      setSf((s) => (s.data ? s : { status: e.status === 404 ? "notfound" : "error", data: null, error: e }));
    });
    return () => { live = false; };
  }, [code, tick, api, pub]);

  useEffect(() => {
    if (!code || sf.status !== "ready") return undefined;
    let live = true;
    api.get(pub("/menu")).then((d) => live && setMenu({ status: "ready", data: d, error: null })).catch((e) => live && setMenu((m) => (m.data ? m : { status: "error", data: null, error: e })));
    return () => { live = false; };
  }, [code, sf.status, tick, api, pub]);

  // refresh the menu when the tab comes back (dishes sell out)
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", on);
    window.addEventListener("online", reload);
    return () => { document.removeEventListener("visibilitychange", on); window.removeEventListener("online", reload); };
  }, [reload]);

  const storefront = sf.data;
  const items = menu.data?.items;
  const byId = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);

  // ---- customer profile
  const loadMe = useCallback(async () => {
    if (!tokenRef.current) return null;
    try { const m = await api.get("/v2/me"); setMe(m); return m; } catch { return null; }
  }, [api]);
  useEffect(() => { if (token) loadMe(); }, [token, loadMe]);

  const signedIn = useCallback((res) => {
    store.set(tokenKey, res.access_token);
    tokenRef.current = res.access_token;
    setToken(res.access_token);
    setMe(res.customer);
  }, [tokenKey]);

  const saveProfile = useCallback(async (patch) => {
    const m = await api.put("/v2/me", patch);
    setMe(m);
    return m;
  }, [api]);

  const deleteAccount = useCallback(async () => {
    await api.del("/v2/me");
    signOut();
    store.set(`nova.cart.${code}`, null);
  }, [api, signOut, code]);

  // ---- order mode
  const channels = useMemo(() => {
    const c = storefront?.ordering?.channels || [];
    return ORDER_ORDER.filter((x) => c.includes(x));
  }, [storefront]);
  const [mode, setModeState] = useState(() => store.get(`nova.mode.${code}`));
  const [table, setTable] = useState(loc.table || "");
  useEffect(() => { if (loc.table) setTable(loc.table); }, [loc.table]);
  const activeMode = channels.includes(mode) ? mode : (loc.table && channels.includes("dine-in") ? "dine-in" : channels[0]);
  const setMode = useCallback((m) => { setModeState(m); store.set(`nova.mode.${code}`, m); }, [code]);

  // ---- cart
  const cartKey = `nova.cart.${code}`;
  const [cart, setCart] = useState(() => { try { return JSON.parse(store.get(cartKey) || "[]"); } catch { return []; } });
  useEffect(() => { try { setCart(JSON.parse(store.get(cartKey) || "[]")); } catch { setCart([]); } }, [cartKey]);
  useEffect(() => { store.set(cartKey, cart.length ? JSON.stringify(cart) : null); }, [cart, cartKey]);
  const cartApi = useMemo(() => ({
    add: (item, qty = 1, note = "") => setCart((c) => {
      const k = `${item.id}|${note}`;
      const i = c.findIndex((l) => l.key === k);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: Math.min(99, l.qty + qty) } : l));
      return [...c, { key: k, item_id: item.id, qty, note }];
    }),
    inc: (key) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + 1) } : l))),
    dec: (key) => setCart((c) => c.flatMap((l) => (l.key !== key ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []))),
    remove: (key) => setCart((c) => c.filter((l) => l.key !== key)),
    removeItem: (id) => setCart((c) => c.filter((l) => l.item_id !== id)),
    setNote: (key, note) => setCart((c) => c.map((l) => (l.key === key ? { ...l, note: note.slice(0, 120) } : l))),
    clear: () => setCart([]),
  }), []);
  const qtyOf = useCallback((id) => cart.reduce((n, l) => n + (l.item_id === id ? l.qty : 0), 0), [cart]);
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cart.reduce((n, l) => n + l.qty * (byId[l.item_id]?.price || 0), 0);

  const markSoldOut = useCallback((id) => {
    setMenu((m) => (m.data ? { ...m, data: { ...m.data, items: m.data.items.map((i) => (i.id === id ? { ...i, available: false } : i)) } } : m));
  }, []);

  const value = {
    code, page: loc.page, navigate, loc, api, pub, token, me, setMe, signedIn, signOut, saveProfile, deleteAccount, loadMe, flash, toast,
    sf, menu, storefront, items, byId, reload, offline, setOffline, channels, mode: activeMode, setMode, table, setTable,
    cart, cartApi, qtyOf, cartCount, cartTotal, markSoldOut, isNative,
  };
  const langs = useMemo(() => (storefront?.locale?.languages?.length ? storefront.locale.languages : ["en"]), [storefront]);
  return <Ctx.Provider value={value}><I18nProvider languages={langs}>{children}</I18nProvider></Ctx.Provider>;
}
