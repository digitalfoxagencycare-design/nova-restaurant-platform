import { useEffect, useState } from "react";
import { useApp } from "../state.jsx";
import { useI18n, LANG_NAMES } from "../i18n.js";
import { describeError } from "../lib/errors.js";
import { Banner, Button, Field, Icon, inputCls, PoweredBy } from "../components/ui.jsx";

export default function Account({ openSignIn }) {
  const { token, me, saveProfile, signOut, deleteAccount, storefront, flash, navigate, code, isNative } = useApp();
  const { t, lang, setLang, languages } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ text: "", landmark: "" });
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { setName(me?.name || ""); }, [me?.name]);

  async function run(fn, ok) {
    setBusy(true); setErr(null);
    try { await fn(); if (ok) flash(ok); } catch (e) { setErr(describeError(e, { storefront })); }
    setBusy(false);
  }
  const addresses = me?.addresses || [];

  return (
    <div className="space-y-5 p-4 pb-8">
      <h1 className="font-display text-2xl font-bold">{t("account")}</h1>
      {err && <Banner tone="bad">{err.message}</Banner>}

      {!token ? (
        <section className="rounded-2xl border border-line bg-white p-4 text-center">
          <p className="mb-3 text-[15px]">{t("sign_in_to_order")}</p>
          <Button onClick={openSignIn}>{t("sign_in")}</Button>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-line bg-white p-4">
            <p className="mb-3 flex items-center gap-2 text-[14px] text-ink/70"><Icon name="phone" size={16} />+{storefront?.locale?.country_code || "91"} {me?.phone}</p>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveProfile({ name: name.trim() }), "Saved"); }}>
              <Field label={t("name")} className="flex-1">{(p) => <input {...p} type="text" maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />}</Field>
              <Button type="submit" busy={busy} disabled={name.trim() === (me?.name || "")}>{t("save")}</Button>
            </form>
          </section>

          <section className="rounded-2xl border border-line bg-white p-4" aria-labelledby="addr-h">
            <h2 id="addr-h" className="mb-2 font-display text-lg font-bold">{t("saved")}</h2>
            {addresses.length === 0 && !adding && <p className="text-[14px] text-ink/70">No saved addresses yet.</p>}
            <ul className="divide-y divide-line">
              {addresses.map((a, i) => (
                <li key={i} className="flex items-center gap-3 py-2">
                  <Icon name="pin" size={18} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1 text-[14px]">{a.text}{a.landmark ? <span className="block text-[12px] text-ink/70">{a.landmark}</span> : null}</span>
                  <button type="button" onClick={() => run(() => saveProfile({ addresses: addresses.filter((_, j) => j !== i) }))} aria-label={`${t("remove")}: ${a.text}`} className="flex h-[44px] w-[44px] items-center justify-center rounded-xl text-bad"><Icon name="trash" size={20} /></button>
                </li>
              ))}
            </ul>
            {adding ? (
              <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); if (draft.text.trim().length < 6) return; run(async () => { await saveProfile({ addresses: [...addresses, { text: draft.text.trim(), landmark: draft.landmark.trim(), lat: null, lng: null }] }); setAdding(false); setDraft({ text: "", landmark: "" }); }); }}>
                <Field label={t("address")}>{(p) => <textarea {...p} data-autofocus rows={2} maxLength={200} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className={`${inputCls} py-2`} />}</Field>
                <Field label={t("landmark")}>{(p) => <input {...p} type="text" maxLength={80} value={draft.landmark} onChange={(e) => setDraft({ ...draft, landmark: e.target.value })} className={inputCls} />}</Field>
                <div className="flex gap-2"><Button type="submit" busy={busy} disabled={draft.text.trim().length < 6}>{t("save")}</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>{t("cancel")}</Button></div>
              </form>
            ) : (
              addresses.length < 10 && <Button variant="ghost" className="mt-2" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t("add_address")}</Button>
            )}
          </section>
        </>
      )}

      {languages.length > 1 && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <Field label={t("language")}>
            {(p) => <select {...p} value={lang} onChange={(e) => setLang(e.target.value)} className={inputCls}>{languages.map((l) => <option key={l} value={l}>{LANG_NAMES[l] || l}</option>)}</select>}
          </Field>
        </section>
      )}

      {!isNative && (
        <a href={`/s/${code}/about`} onClick={(e) => { e.preventDefault(); navigate(`/s/${code}/about`); }} className="flex min-h-[44px] items-center justify-between rounded-2xl border border-line bg-white px-4 font-semibold">
          {t("about")} {storefront?.brand?.name}<Icon name="chevron" size={18} />
        </a>
      )}

      {token && (
        <section className="space-y-3">
          <Button variant="ghost" className="w-full" onClick={() => signOut()}>{t("sign_out")}</Button>
          {confirmDel ? (
            <div className="rounded-2xl border border-bad/30 bg-bad-soft p-4" role="alertdialog" aria-label="Confirm account deletion">
              <p className="text-[14px] font-semibold text-bad">Delete your account? Your name and saved addresses are removed. Past orders stay with the restaurant for its tax records. This cannot be undone.</p>
              <div className="mt-3 flex gap-2">
                <Button variant="ghost" onClick={() => setConfirmDel(false)}>{t("cancel")}</Button>
                <Button variant="danger" busy={busy} onClick={() => run(deleteAccount)}>{t("delete_account")}</Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" className="w-full" onClick={() => setConfirmDel(true)}>{t("delete_account")}</Button>
          )}
        </section>
      )}

      <footer className="space-y-3 pt-4 text-center">
        <div className="flex justify-center gap-6 text-[13px]">
          <a href="#privacy" onClick={(e) => e.preventDefault()} className="inline-flex min-h-[44px] items-center underline">{t("privacy")}</a>
          <a href="#terms" onClick={(e) => e.preventDefault()} className="inline-flex min-h-[44px] items-center underline">{t("terms")}</a>
        </div>
        <PoweredBy />
      </footer>
    </div>
  );
}
