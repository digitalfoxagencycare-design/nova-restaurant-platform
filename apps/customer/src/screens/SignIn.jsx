import { useEffect, useRef, useState } from "react";
import { useApp } from "../state.jsx";
import { useI18n } from "../i18n.js";
import { describeError } from "../lib/errors.js";
import { Banner, Button, Field, inputCls, Sheet } from "../components/ui.jsx";

const RESEND_SECS = 30;

export default function SignIn({ open, onClose, onDone }) {
  const { api, pub, signedIn, storefront } = useApp();
  const { t } = useI18n();
  const [step, setStep] = useState("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [left, setLeft] = useState(0);
  const codeRef = useRef(null);

  useEffect(() => { if (open) { setStep("phone"); setCode(""); setErr(null); setLeft(0); } }, [open]);
  useEffect(() => {
    if (left <= 0) return undefined;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);

  const digits = phone.replace(/\D/g, "");
  const phoneOk = digits.length >= 10;

  async function send(e) {
    e?.preventDefault();
    if (!phoneOk || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post(pub("/otp/send"), { phone: digits });
      setStep("code");
      setLeft(RESEND_SECS);
      setCode(r?.debug_otp ? String(r.debug_otp) : ""); // development servers only: the response carries the code
    } catch (x) { setErr(describeError(x, { storefront })); }
    setBusy(false);
  }
  async function verify(e) {
    e?.preventDefault();
    if (code.length < 4 || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post(pub("/otp/verify"), { phone: digits, code, name: name.trim() });
      signedIn(r);
      onDone?.(r);
    } catch (x) { setErr(describeError(x, { storefront })); }
    setBusy(false);
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("sign_in")}>
      {err && (
        <Banner tone="bad" className="mb-3" action={err.action === "resend" ? <Button variant="ghost" onClick={() => { setStep("phone"); setErr(null); }}>{err.label}</Button> : null}>
          {err.message}
        </Banner>
      )}
      {step === "phone" ? (
        <form onSubmit={send} className="space-y-4">
          <p className="text-[14px] text-ink/80">{t("sign_in_to_order")}</p>
          <p className="text-[13px] text-ink/70">{t("code_via_whatsapp")}</p>
          <Field label={t("phone")}>
            {(p) => (
              <div className="flex gap-2">
                <span className="flex min-h-[44px] items-center rounded-xl border border-line bg-white px-3 text-[15px] text-ink/70">+{storefront?.locale?.country_code || "91"}</span>
                <input {...p} data-autofocus type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className={inputCls} />
              </div>
            )}
          </Field>
          <Button type="submit" className="w-full" busy={busy} disabled={!phoneOk}>{t("send_code")}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-[14px] text-ink/80">{t("code_on_whatsapp")} (<b>{digits}</b>). <button type="button" className="min-h-[44px] font-semibold text-brand underline" onClick={() => { setStep("phone"); setErr(null); }}>Change</button></p>
          <Field label={t("code")}>
            {(p) => <input {...p} ref={codeRef} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${inputCls} text-center font-display text-2xl tracking-[.4em]`} />}
          </Field>
          <Field label={`${t("your_name")} (optional)`}>
            {(p) => <input {...p} type="text" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />}
          </Field>
          <Button type="submit" className="w-full" busy={busy} disabled={code.length < 4}>{t("verify")}</Button>
          <Button type="button" variant="ghost" className="w-full" disabled={left > 0 || busy} onClick={send}>
            {left > 0 ? `${t("resend_in")} ${left}s` : t("resend")}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
