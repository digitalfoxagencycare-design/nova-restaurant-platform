import { useEffect, useRef, useState } from "react";
import novaLogo from "@nova/shared/assets/nova-logo.png";
import { api, clearSession, getSession, onSessionChange, sessionState } from "./lib/api";
import { href, useRoute } from "./lib/router";
import { Icon, ToastProvider, cx } from "./ui";
import SignIn from "./pages/SignIn";
import Overview from "./pages/Overview";
import Restaurants from "./pages/Restaurants";
import Wizard from "./pages/Wizard";
import Detail from "./pages/Detail";
import WhatsApp from "./pages/WhatsApp";
import Enquiries from "./pages/Enquiries";
import { AuditPage, HealthPage } from "./pages/System";

const NAV = [
  { id: "", label: "Overview", icon: "home" },
  { id: "restaurants", label: "Restaurants", icon: "store" },
  { id: "enquiries", label: "Enquiries", icon: "inbox" },
  { id: "whatsapp", label: "WhatsApp", icon: "chat" },
  { id: "health", label: "Health", icon: "pulse" },
  { id: "audit", label: "Audit log", icon: "list" },
];

export default function App() {
  const [session, setSession] = useState(getSession);
  useEffect(() => {
    const sync = () => setSession((s) => { const n = getSession(); return n && s && n.token === s.token ? s : n; });
    const off = onSessionChange(sync);
    const t = setInterval(() => {
      if (!getSession() && session) { sessionState.expired = true; clearSession(); }
      sync();
    }, 10000);
    return () => { off(); clearInterval(t); };
  }, [session]);
  return <ToastProvider>{session ? <Shell session={session} /> : <SignIn expired={sessionState.expired} />}</ToastProvider>;
}

function Shell({ session }) {
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(Math.max(0, Math.round((session.exp - Date.now()) / 60000)));
  const [leadsNew, setLeadsNew] = useState(0);
  const menuBtn = useRef(null);
  const section = route[0] || "";

  useEffect(() => setOpen(false), [route.join("/")]);
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((session.exp - Date.now()) / 60000))), 20000);
    return () => clearInterval(t);
  }, [session]);
  useEffect(() => {
    let live = true;
    api.get("/v2/platform/overview").then((o) => live && setLeadsNew(o.leads_new || 0), () => {});
    return () => { live = false; };
  }, [section]);
  useEffect(() => {
    if (!open) return;
    const k = (e) => { if (e.key === "Escape") { setOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);

  let page;
  if (section === "") page = <Overview />;
  else if (section === "restaurants" && route[1] === "new") page = <Wizard />;
  else if (section === "restaurants" && route[1]) page = <Detail id={route[1]} tab={route[2] || "overview"} />;
  else if (section === "restaurants") page = <Restaurants />;
  else if (section === "enquiries") page = <Enquiries />;
  else if (section === "whatsapp") page = <WhatsApp />;
  else if (section === "health") page = <HealthPage />;
  else if (section === "audit") page = <AuditPage />;
  else page = <Overview />;

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map((n) => {
        const on = section === n.id;
        return (
          <a key={n.id} href={href("/" + n.id)} aria-current={on ? "page" : undefined} className={cx("flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] font-semibold", on ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white")}>
            <Icon name={n.icon} />
            <span className="flex-1">{n.label}</span>
            {n.id === "enquiries" && leadsNew ? <span className="rounded-full bg-action px-2 py-0.5 text-xs font-bold text-white" aria-label={`${leadsNew} new`}>{leadsNew}</span> : null}
          </a>
        );
      })}
    </nav>
  );
  const foot = (
    <div className="border-t border-white/15 pt-3 text-[13px] text-white/80">
      <p className="truncate" title={session.email}>{session.email}</p>
      <p className="mt-0.5">{left <= 5 ? `Signed in for ${left} more minute${left === 1 ? "" : "s"}` : "Signed in"}</p>
      <button type="button" onClick={() => { sessionState.expired = false; clearSession(); }} className="mt-2 flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 font-semibold text-white hover:bg-white/10">
        <Icon name="logout" className="h-4 w-4" />Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }} className="skip-link">Skip to the page</a>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 bg-brand p-4 lg:flex">
        <a href={href("/")} className="flex items-center gap-3 px-1 text-white">
          <img src={novaLogo} alt="" className="h-10 w-10 rounded-xl" />
          <span className="font-display text-lg font-extrabold leading-tight">Nova Console</span>
        </a>
        <div className="flex-1">{nav}</div>
        {foot}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-brand px-2 text-white lg:hidden">
        <button ref={menuBtn} type="button" aria-label="Open the menu" aria-expanded={open} onClick={() => setOpen(true)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-white/10"><Icon name="menu" /></button>
        <img src={novaLogo} alt="" className="h-8 w-8 rounded-lg" />
        <span className="font-display text-lg font-extrabold">Nova Console</span>
      </header>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-[#0b1f21]/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Menu" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-5 bg-brand p-4">
            <div className="flex items-center justify-between text-white">
              <span className="font-display text-lg font-extrabold">Menu</span>
              <button type="button" aria-label="Close the menu" autoFocus onClick={() => { setOpen(false); menuBtn.current?.focus(); }} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-white/10"><Icon name="x" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {foot}
          </div>
        </div>
      ) : null}

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">{page}</main>
    </div>
  );
}
