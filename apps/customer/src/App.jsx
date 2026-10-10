import { useState } from "react";
import { AppProvider, useApp } from "./state.jsx";
import { useI18n } from "./i18n.js";
import { Banner, Button, Empty, Field, inputCls, PoweredBy, Skeleton } from "./components/ui.jsx";
import Landing from "./screens/Landing.jsx";
import Shell from "./screens/Shell.jsx";

function CodeEntry() {
  const { t } = useI18n();
  const { navigate } = useApp();
  const [v, setV] = useState("");
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="font-display text-3xl font-extrabold">{t("enter_code_title")}</h1>
      <p className="text-ink/80">{t("enter_code_hint")}</p>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const c = v.trim().toLowerCase(); if (c) navigate(`/s/${encodeURIComponent(c)}`); }}>
        <Field label="Restaurant code">{(p) => <input {...p} data-autofocus autoCapitalize="none" value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. demo-biryani" className={inputCls} />}</Field>
        <Button type="submit" className="w-full" disabled={!v.trim()}>{t("open")}</Button>
      </form>
      <PoweredBy className="mt-6" />
    </div>
  );
}

function Gate() {
  const { sf, page, reload, offline } = useApp();
  const { t } = useI18n();
  if (sf.status === "nocode") return <CodeEntry />;
  if (sf.status === "notfound") {
    return (
      <div className="mx-auto max-w-md pt-16">
        <Empty icon="store" title={t("not_found")} hint={t("not_found_hint")} action={<Button variant="ghost" onClick={() => window.location.assign("/")}>{t("enter_code_title")}</Button>} />
        <PoweredBy className="mt-6" />
      </div>
    );
  }
  if (sf.status === "error") {
    return <div className="mx-auto max-w-md p-4 pt-16"><Banner tone="bad" icon={offline ? "wifi" : "alert"} action={<Button variant="ghost" className="shrink-0" onClick={reload}>{t("retry")}</Button>}>{sf.error?.message || "Something went wrong"}</Banner></div>;
  }
  if (sf.status === "loading") {
    return <div className="mx-auto max-w-2xl space-y-3 p-4"><Skeleton className="h-28" /><Skeleton className="h-12" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;
  }
  return page === "landing" ? <Landing /> : <Shell />;
}

function Chrome() {
  const { offline, reload, toast, sf } = useApp();
  const { t } = useI18n();
  return (
    <>
      {offline && sf.status === "ready" && (
        <div className="fixed inset-x-0 top-0 z-[60] mx-auto max-w-2xl p-2 pt-safe">
          <Banner tone="bad" icon="wifi" action={<Button variant="ghost" className="shrink-0 !bg-white" onClick={reload}>{t("retry")}</Button>}>{t("offline")}</Banner>
        </div>
      )}
      <Gate />
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(140px+var(--sab))] z-[70] flex justify-center px-4">
        {toast && (
          <div key={toast.id} className={`toast-in pointer-events-auto max-w-sm rounded-xl px-4 py-3 text-[14px] font-semibold shadow-float ${toast.tone === "good" ? "bg-good text-white" : toast.tone === "warn" ? "bg-warn text-white" : "bg-ink text-white"}`}>{toast.msg}</div>
        )}
      </div>
    </>
  );
}

export default function App() {
  return <AppProvider><Chrome /></AppProvider>;
}
