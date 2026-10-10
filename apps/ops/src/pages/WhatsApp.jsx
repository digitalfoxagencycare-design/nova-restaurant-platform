import { useEffect, useState } from "react";
import { api, niceError, useLoad } from "../lib/api";
import { Button, Card, Chip, CopyButton, Empty, ErrorBox, Icon, Notice, Page, SelectField, SkeletonPage, TextField, Toggle, useToast } from "../ui";
import { StatTile, when } from "./common";

const TEMPLATE_TEXT = {
  otp: {
    title: "Sign-in code message",
    meta: "Category: Authentication. Language: English. Add the \"Copy code\" button.",
    body: "{{1}} is your verification code.",
    vars: [],
  },
  order_update: {
    title: "Order update message",
    meta: "Category: Utility. Language: English.",
    body: "{{1}}: your order #{{2}} is {{3}}. Track it here: {{4}}",
    vars: ["{{1}} is the restaurant's name", "{{2}} is the order number", "{{3}} is the order status in words", "{{4}} is the link to follow the order"],
  },
};

export default function WhatsApp() {
  const q = useLoad(() => Promise.all([api.get("/v2/platform/settings/whatsapp"), api.get("/v2/platform/overview")]));
  if (q.loading) return <Page title="WhatsApp"><SkeletonPage /></Page>;
  if (q.error) {
    return (
      <Page title="WhatsApp">
        <ErrorBox text={q.error.status === 403 ? "Your account can look at restaurants and enquiries, but only the Nova owner can change the WhatsApp connection." : niceError(q.error)} onRetry={q.error.status === 403 ? undefined : q.retry} />
      </Page>
    );
  }
  return <Loaded st={q.data[0]} ov={q.data[1]} reload={q.reload} />;
}

function Loaded({ st, ov, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ phone_number_id: st.phone_number_id, waba_id: st.waba_id, api_version: st.api_version, enabled: st.enabled, otpName: st.templates.otp.name, otpLang: st.templates.otp.lang, ouName: st.templates.order_update.name, ouLang: st.templates.order_update.lang });
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState("");
  const [tokErr, setTokErr] = useState("");
  const [tokBusy, setTokBusy] = useState(false);
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("order_update");
  const [testBusy, setTestBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  useEffect(() => { document.title = "WhatsApp - Nova Console"; }, []);

  const wa = ov.whatsapp;
  const tokenSet = st.token?.set;
  const missing = [!st.phone_number_id && "the phone number id", !tokenSet && "the access token", !st.enabled && "switching it on"].filter(Boolean);

  async function save(e) {
    e.preventDefault();
    const x = {};
    if (!/^\d{6,20}$/.test(f.phone_number_id.trim())) x.phone_number_id = "The phone number id is made of digits only (6 to 20 of them).";
    if (!/^\d{0,20}$/.test(f.waba_id.trim())) x.waba_id = "The business account id is made of digits only.";
    if (!/^v\d{1,2}\.\d$/.test(f.api_version.trim())) x.api_version = "Use a version like v21.0.";
    for (const [k, label] of [["otpName", "sign-in code"], ["ouName", "order update"]]) if (!/^[A-Za-z0-9_]+$/.test(f[k].trim())) x[k] = `The ${label} template name uses letters, numbers and underscores only.`;
    for (const [k, label] of [["otpLang", "sign-in code"], ["ouLang", "order update"]]) if (!f[k].trim()) x[k] = `Enter the ${label} template language, for example en.`;
    setErr(x);
    if (Object.keys(x).length) return;
    setSaving(true);
    try {
      await api.put("/v2/platform/settings/whatsapp", {
        phone_number_id: f.phone_number_id.trim(), waba_id: f.waba_id.trim(), api_version: f.api_version.trim(), enabled: f.enabled,
        templates: { otp: { name: f.otpName.trim(), lang: f.otpLang.trim() }, order_update: { name: f.ouName.trim(), lang: f.ouLang.trim() } },
      });
      toast("WhatsApp settings saved.");
      await reload();
    } catch (e2) {
      setErr({ form: niceError(e2) });
    } finally {
      setSaving(false);
    }
  }
  async function saveToken() {
    const v = token.trim();
    if (v.length < 6 || /\s/.test(v)) return setTokErr("Paste the whole token. It has no spaces.");
    setTokBusy(true);
    setTokErr("");
    try {
      await api.put("/v2/platform/settings/whatsapp/token", { value: v });
      setToken("");
      toast("Access token saved.");
      await reload();
    } catch (e2) {
      setTokErr(niceError(e2));
    } finally {
      setTokBusy(false);
    }
  }
  async function test(e) {
    e.preventDefault();
    const digits = to.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return setResult({ ok: false, text: "Enter the phone number with the country code, for example 919876543210." });
    setTestBusy(true);
    setResult(null);
    try {
      const r = await api.post("/v2/platform/settings/whatsapp/test", { to: digits, kind });
      setResult({ ok: true, text: `WhatsApp accepted the message${r.message_id ? ` (reference ${r.message_id})` : ""}. It should arrive on ${digits} in a few seconds.`, at: new Date().toISOString() });
    } catch (e2) {
      setResult({ ok: false, text: niceError(e2) });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <Page title="WhatsApp" subtitle="All restaurants send sign-in codes and order updates from this one Nova number.">
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Connection" value={wa.connected ? "Connected" : "Not connected"} tone={wa.connected ? "good" : "bad"} />
        <StatTile label="Messages sent" value={wa.sent_30d} sub="last 30 days" />
        <StatTile label="Messages that failed" value={wa.failed_30d} tone={wa.failed_30d ? "bad" : undefined} sub="last 30 days" />
      </div>
      {!wa.connected ? (
        <Notice tone="warn" title="WhatsApp is not connected yet" className="mb-6">
          {missing.length ? `Still needed: ${missing.join(", ")}.` : "Save the settings below."} Until then customers cannot receive sign-in codes or order updates.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-lg font-bold">Connection details</h2>
            <p className="mb-3 text-[14px] text-ink/75">You find these in your Meta developer account, under WhatsApp, API setup.</p>
            <form onSubmit={save} className="space-y-4" noValidate>
              <TextField label="Phone number id" inputMode="numeric" value={f.phone_number_id} onChange={(e) => set({ phone_number_id: e.target.value })} error={err.phone_number_id} hint="A long number. It is not the phone number itself." autoComplete="off" />
              <TextField label="Business account id" optional inputMode="numeric" value={f.waba_id} onChange={(e) => set({ waba_id: e.target.value })} error={err.waba_id} autoComplete="off" />
              <TextField label="API version" value={f.api_version} onChange={(e) => set({ api_version: e.target.value })} error={err.api_version} hint="Leave as it is unless Meta asks you to change it." />
              <div className="rounded-xl bg-brand-soft p-3">
                <p className="mb-2 font-semibold">Message templates (names as created in Meta)</p>
                <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
                  <TextField label="Sign-in code template name" value={f.otpName} onChange={(e) => set({ otpName: e.target.value })} error={err.otpName} />
                  <TextField label="Language" value={f.otpLang} onChange={(e) => set({ otpLang: e.target.value })} error={err.otpLang} />
                  <TextField label="Order update template name" value={f.ouName} onChange={(e) => set({ ouName: e.target.value })} error={err.ouName} />
                  <TextField label="Language" value={f.ouLang} onChange={(e) => set({ ouLang: e.target.value })} error={err.ouLang} />
                </div>
              </div>
              <Toggle checked={f.enabled} onChange={(v) => set({ enabled: v })} label="Send WhatsApp messages" hint="Switch off to stop all messages without losing the settings" />
              {err.form ? <p role="alert" className="text-[14px] font-semibold text-bad">{err.form}</p> : null}
              <Button type="submit" busy={saving}>Save settings</Button>
            </form>
          </Card>

          <Card data-testid="token-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold">Access token</h2>
              {tokenSet ? <Chip tone="good"><Icon name="lock" className="h-3.5 w-3.5" />Set, ending {st.token.last4}</Chip> : <Chip tone="warn">Not set</Chip>}
            </div>
            <p className="mb-3 text-[14px] text-ink/75">The permanent token from your Meta system user. It is stored scrambled and is never shown again.{tokenSet && st.token.updated_at ? ` Last saved ${when(st.token.updated_at)}.` : ""}</p>
            <div className="flex flex-wrap items-start gap-2">
              <TextField label={tokenSet ? "Replace with a new token" : "Paste the token"} className="min-w-[220px] flex-1" type="password" autoComplete="new-password" spellCheck="false" value={token} onChange={(e) => setToken(e.target.value)} error={tokErr} />
              <Button className="mt-6" onClick={saveToken} busy={tokBusy} disabled={!token}>Save token</Button>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-lg font-bold">Send a test message</h2>
            <p className="mb-3 text-[14px] text-ink/75">Sends one real message so you can see it arrive on a phone. Use your own number first.</p>
            <form onSubmit={test} className="space-y-4" noValidate>
              <TextField label="Phone number with country code" type="tel" inputMode="tel" placeholder="919876543210" value={to} onChange={(e) => setTo(e.target.value)} hint="India starts with 91, then the 10-digit number" />
              <SelectField label="Which message" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="order_update">Order update</option>
                <option value="otp">Sign-in code</option>
              </SelectField>
              <Button type="submit" busy={testBusy}><Icon name="send" className="h-4 w-4" />Send the test</Button>
            </form>
            {result ? (
              <div className="mt-4" data-testid="test-result">
                <Notice tone={result.ok ? "good" : "bad"} title={result.ok ? "Sent" : "It did not work"}>{result.text}</Notice>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="font-display text-lg font-bold">Templates to create in Meta</h2>
            <p className="mb-3 text-[14px] text-ink/75">WhatsApp only lets businesses start a chat with an approved template. Create these two in Meta Business Manager, under WhatsApp Manager, Message templates. Use the names saved on the left.</p>
            {Object.entries(TEMPLATE_TEXT).map(([k, t]) => (
              <div key={k} className="mb-4 rounded-xl border border-line p-3 last:mb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{t.title}</h3>
                  <Chip tone="info">{k === "otp" ? f.otpName : f.ouName}</Chip>
                </div>
                <p className="mt-1 text-[13px] text-ink/70">{t.meta}</p>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-brand-soft p-3 font-mono text-[14px]" data-testid={"tpl-" + k}>{t.body}</pre>
                {t.vars.length ? <ul className="mt-2 list-disc pl-5 text-[13px] text-ink/75">{t.vars.map((v) => <li key={v}>{v}</li>)}</ul> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyButton text={t.body} label="Copy the text" done="Text copied" />
                  <CopyButton text={k === "otp" ? f.otpName : f.ouName} label="Copy the name" done="Name copied" />
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Page>
  );
}
