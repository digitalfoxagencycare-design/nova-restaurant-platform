import { useEffect, useMemo, useState } from "react";
import { ago, money } from "@nova/shared";
import { API_BASE, api, downloadFile, niceError, uploadLogo, useLoad } from "../lib/api";
import { PLANS, buildConfig, dataUrlToBlob, formFromConfig, validateForm } from "../lib/brand";
import { go, href } from "../lib/router";
import { ContactFields, LookFeelEditor, SellingFields } from "../Editors";
import ClientAccess from "../ClientAccess";
import Checklist from "../Checklist";
import { Avatar, Button, Card, Chip, CopyRow, Dialog, Empty, ErrorBox, Icon, Notice, Page, Qr, SelectField, Skeleton, SkeletonPage, Tabs, TextField, useToast } from "../ui";
import { PLAN_LABEL, SalesChart, StatTile, describeAudit, statusChip, when } from "./common";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "look", label: "Look & feel" },
  { id: "settings", label: "Settings" },
  { id: "payments", label: "Payments" },
  { id: "access", label: "Access" },
  { id: "activity", label: "Activity" },
];

export default function Detail({ id, tab }) {
  const q = useLoad(() => api.get("/v2/platform/tenants/" + id), [id]);
  if (q.loading) return <Page title="Restaurant"><SkeletonPage /></Page>;
  if (q.error) {
    return (
      <Page title="Restaurant">
        <ErrorBox text={q.error.status === 404 ? "We could not find this restaurant. It may have been removed." : niceError(q.error)} onRetry={q.error.status === 404 ? undefined : q.retry} />
        <a className="prose-link mt-4 inline-block" href={href("/restaurants")}>Back to all restaurants</a>
      </Page>
    );
  }
  return <Loaded key={id + ":" + q.data.config_version} d={q.data} tab={TABS.some((t) => t.id === tab) ? tab : "overview"} reload={q.reload} />;
}

function Loaded({ d, tab, reload }) {
  const toast = useToast();
  const initial = useMemo(() => formFromConfig(d.config), [d]);
  const [form, setForm] = useState(initial);
  const [logo, setLogo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || !!logo;
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const errors = tried ? validateForm(form) : {};
  const brand = d.config.brand;

  useEffect(() => {
    document.title = `${brand.name} - Nova Console`;
    if (!dirty) return;
    const f = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty, brand.name]);

  async function save() {
    setTried(true);
    setSaveErr("");
    if (Object.keys(validateForm(form)).length) return setSaveErr("Some details need fixing. They are marked in red on the Look & feel and Settings tabs.");
    setBusy(true);
    try {
      let base = d.config;
      if (logo) {
        await uploadLogo(d.id, dataUrlToBlob(logo.dataUrl));
        base = (await api.get("/v2/platform/tenants/" + d.id)).config; // the logo upload changed the stored settings
      }
      if (JSON.stringify(form) !== JSON.stringify(initial)) await api.put(`/v2/platform/tenants/${d.id}/config`, buildConfig(base, form));
      toast("Saved. The changes are live.");
      await reload();
    } catch (e) {
      if (e.code === "CONFIG_CONFLICT") { toast(niceError(e), "bad"); await reload(); } else setSaveErr(e.message && e.code === "BAD_LOGO" ? e.message : niceError(e));
    } finally {
      setBusy(false);
    }
  }

  const saveBar = dirty && (tab === "look" || tab === "settings") ? (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border" data-testid="savebar">
      {saveErr ? <p role="alert" className="mb-2 text-[14px] font-semibold text-bad">{saveErr}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[14px] font-semibold text-ink/75">You have changes that are not saved.</span>
        <Button variant="secondary" disabled={busy} onClick={() => { setForm(initial); setLogo(null); setTried(false); setSaveErr(""); }}>Undo changes</Button>
        <Button onClick={save} busy={busy}>Save changes</Button>
      </div>
    </div>
  ) : null;

  return (
    <Page
      title={
        <span className="flex items-center gap-3">
          <Avatar name={brand.name} logoUrl={d.status === "active" ? brand.logo_url : ""} color={brand.colors?.primary} size={48} />
          <span className="min-w-0 truncate">{brand.name}</span>
        </span>
      }
      subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-[14px]">{d.slug}</span>{statusChip(d.status)}<Chip tone="info">{PLAN_LABEL[d.plan] || d.plan} plan</Chip></span>}
      actions={<a className="prose-link inline-flex min-h-[44px] items-center text-[15px]" href={href("/restaurants")}>All restaurants</a>}
    >
      <Tabs tabs={TABS} value={tab} onChange={(t) => go(`/restaurants/${d.id}/${t}`)} label="Restaurant sections" />
      <div id="tabpanel" role="tabpanel" aria-labelledby={"tab-" + tab}>
        {d.status === "suspended" ? <Notice tone="warn" title="This restaurant is paused" className="mb-4">Customers cannot see the ordering page or place orders. Go to Access to resume it.</Notice> : null}
        {tab === "overview" ? <OverviewTab d={d} /> : null}
        {tab === "look" ? (
          <>
            <Card className="mb-6 max-w-xl"><TextField label="Restaurant name" value={form.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} /></Card>
            <LookFeelEditor form={form} set={set} errors={errors} logo={logo} onLogo={setLogo} existingLogoUrl={brand.logo_url} />
          </>
        ) : null}
        {tab === "settings" ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div><h2 className="mb-2 font-display text-xl font-bold">Contact & hours</h2><ContactFields form={form} set={set} errors={errors} /></div>
            <div><h2 className="mb-2 font-display text-xl font-bold">Selling</h2><SellingFields form={form} set={set} errors={errors} /></div>
          </div>
        ) : null}
        {tab === "payments" ? <PaymentsTab d={d} reload={reload} /> : null}
        {tab === "access" ? <AccessTab d={d} reload={reload} /> : null}
        {tab === "activity" ? <ActivityTab d={d} /> : null}
        {saveBar}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- overview
function OverviewTab({ d }) {
  const u = useLoad(() => api.get(`/v2/platform/tenants/${d.id}/usage`), [d.id]);
  const done = d.checklist.filter((c) => c.done).length;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-baseline justify-between"><h2 className="font-display text-lg font-bold">Getting started</h2><span className="text-[14px] font-semibold text-ink/70">{done} of {d.checklist.length} done</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-good" style={{ width: `${(done / d.checklist.length) * 100}%` }} /></div>
          <Checklist items={d.checklist} id={d.id} />
        </Card>
        <Card>
          <h2 className="mb-3 font-display text-lg font-bold">Links to give the client</h2>
          <div className="space-y-2">
            <CopyRow label="Ordering page for customers" value={d.links.storefront} mono={false} />
            <CopyRow label="Web admin for the client" value={d.links.admin} mono={false} />
            <CopyRow label="Restaurant code" value={d.slug} />
          </div>
          <div className="mt-4"><Qr text={d.links.storefront} name={`${d.slug}-ordering-page`} size={140} /></div>
        </Card>
      </div>
      <section aria-labelledby="sales">
        <h2 id="sales" className="mb-3 font-display text-xl font-bold">Last 30 days</h2>
        {u.loading ? <Skeleton className="h-52" /> : u.error ? <ErrorBox text={niceError(u.error)} onRetry={u.retry} /> : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Orders" value={u.data.orders} sub={`${u.data.online_orders} from the website`} />
              <StatTile label="Sales" value={money(u.data.gmv)} />
              <StatTile label="Last order" value={d.stats.last_order_at ? ago(d.stats.last_order_at) : "None yet"} />
              <StatTile label="WhatsApp messages" value={u.data.whatsapp.sent} sub={`${u.data.whatsapp.failed} failed`} />
            </div>
            <Card><h3 className="mb-2 font-semibold">Sales per day</h3><SalesChart daily={u.data.daily} /></Card>
          </>
        )}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatTile label="Dishes on the menu" value={d.counts.menu_items} />
          <StatTile label="Staff accounts" value={d.counts.users} />
          <StatTile label="Customers" value={d.counts.customers} />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- payments
const SECRETS = [
  { name: "razorpay.key_id", label: "Razorpay key id", hint: "Starts with rzp_. From the restaurant's Razorpay dashboard." },
  { name: "razorpay.key_secret", label: "Razorpay key secret", hint: "Shown by Razorpay only once when the key is made." },
  { name: "razorpay.webhook_secret", label: "Webhook secret", hint: "The secret you type in Razorpay when you add the webhook (step 2 below)." },
];

function SecretRow({ tid, spec, st, reload }) {
  const toast = useToast();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState(false);
  async function save() {
    const v = val.trim();
    if (v.length < 6 || /\s/.test(v)) return setErr("Paste the whole key. It has no spaces and is at least 6 letters long.");
    setBusy(true);
    setErr("");
    try {
      await api.put(`/v2/platform/tenants/${tid}/secrets/${spec.name}`, { value: v });
      setVal("");
      toast(`${spec.label} saved.`);
      await reload();
    } catch (e) {
      setErr(niceError(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api.del(`/v2/platform/tenants/${tid}/secrets/${spec.name}`);
      setAsk(false);
      toast(`${spec.label} removed.`, "info");
      await reload();
    } catch (e) {
      setErr(niceError(e));
      setAsk(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="py-4 first:pt-0 last:pb-0" data-testid={"secret-" + spec.name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{spec.label}</h3>
        {st?.set ? <Chip tone="good"><Icon name="lock" className="h-3.5 w-3.5" />Set, ending {st.last4}</Chip> : <Chip tone="warn">Not set</Chip>}
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <TextField label={st?.set ? "Replace with a new value" : "Paste the value"} className="min-w-[220px] flex-1" type="password" autoComplete="new-password" spellCheck="false" value={val} onChange={(e) => setVal(e.target.value)} hint={spec.hint} error={err} />
        <Button className="mt-6" onClick={save} busy={busy} disabled={!val}>Save</Button>
        {st?.set ? <Button className="mt-6" variant="ghost" onClick={() => setAsk(true)}>Remove</Button> : null}
      </div>
      <Dialog open={ask} onClose={() => setAsk(false)} title={`Remove ${spec.label}?`} footer={<><Button variant="secondary" onClick={() => setAsk(false)}>Keep it</Button><Button variant="danger" busy={busy} onClick={remove}>Remove it</Button></>}>
        <p>Online payment for this restaurant will stop working until a new value is saved.</p>
      </Dialog>
    </div>
  );
}

function PaymentsTab({ d, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const hook = `${API_BASE}/v2/webhooks/razorpay/${d.slug}`;
  const keys = d.secrets["razorpay.key_id"]?.set && d.secrets["razorpay.key_secret"]?.set;
  const methodOn = (d.config.payments?.methods || []).includes("razorpay");
  async function enable() {
    setBusy(true);
    try {
      await api.put(`/v2/platform/tenants/${d.id}/config`, buildConfig(d.config, { ...formFromConfig(d.config), online: true }));
      toast("Online payment is now switched on.");
      await reload();
    } catch (e) {
      toast(niceError(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <h2 className="font-display text-lg font-bold">Online payment (Razorpay)</h2>
          <p className="mb-3 text-[14px] text-ink/75">Money goes straight to the restaurant's own Razorpay account. Nova never holds it. Keys are stored scrambled and can never be shown again.</p>
          {keys && methodOn ? <Notice tone="good" title="Customers can pay online">Both keys are saved and online payment is switched on.</Notice> : null}
          {keys && !methodOn ? (
            <Notice tone="warn" title="Keys are saved, but online payment is switched off">
              <p>Customers will not see the online payment option yet.</p>
              <Button className="mt-2" onClick={enable} busy={busy}>Switch on online payment</Button>
            </Notice>
          ) : null}
          {!keys ? <Notice tone="warn" title="Online payment needs both the key id and the key secret">Add them below. Customers can still pay in cash while you do this.</Notice> : null}
          <div className="mt-4 divide-y divide-line">
            {SECRETS.map((s) => <SecretRow key={s.name} tid={d.id} spec={s} st={d.secrets[s.name]} reload={reload} />)}
          </div>
        </Card>
      </div>
      <Card className="h-fit">
        <h2 className="font-display text-lg font-bold">Webhook address</h2>
        <p className="mb-3 text-[14px] text-ink/75">Razorpay calls this address to tell Nova a payment worked, even if the customer closed the app.</p>
        <CopyRow label="Webhook address" value={hook} mono={false} />
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-[15px] marker:font-bold">
          <li>The client signs in to their Razorpay dashboard, opens <b>Account &amp; Settings</b>, then <b>API Keys</b>, and makes a key. Copy the key id and the key secret into the boxes on this page.</li>
          <li>In the same dashboard open <b>Webhooks</b> and click <b>Add new webhook</b>. Paste the address above, type a secret of your choice, and tick <b>payment.captured</b> and <b>order.paid</b>.</li>
          <li>Save the webhook in Razorpay, then type the same secret into the <b>Webhook secret</b> box on this page.</li>
        </ol>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- access
function AccessTab({ d, reload }) {
  const toast = useToast();
  const [plan, setPlan] = useState(d.plan);
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState(false);
  const active = d.status === "active";
  const owner = d.owner;

  async function run(key, fn, ok) {
    setBusy(key);
    setErr("");
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      setErr(niceError(e));
      toast(niceError(e), "bad");
    } finally {
      setBusy("");
    }
  }
  const reissue = () => run("invite", async () => {
    const r = await api.post(`/v2/platform/tenants/${d.id}/owner-invite`, {});
    setInvite(r);
  }, "New sign-up code made.");
  const savePlan = () => run("plan", async () => { await api.put(`/v2/platform/tenants/${d.id}/plan`, { plan }); await reload(); }, "Plan changed.");
  const toggle = () => run("status", async () => {
    await api.post(`/v2/platform/tenants/${d.id}/${active ? "suspend" : "activate"}`, {});
    setAsk(false);
    await reload();
  }, active ? "Restaurant paused." : "Restaurant resumed.");
  const exportAll = () => run("export", async () => {
    const data = await api.get(`/v2/platform/tenants/${d.id}/export`);
    downloadFile(`nova-${d.slug}-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
  }, "The file has been downloaded.");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <h2 className="font-display text-lg font-bold">Owner</h2>
          <dl className="mt-2 text-[15px]">
            <div className="flex gap-3 py-1"><dt className="w-28 text-ink/65">E-mail</dt><dd className="font-semibold break-all">{owner.email || "None"}</dd></div>
            <div className="flex gap-3 py-1"><dt className="w-28 text-ink/65">Status</dt><dd>{owner.status === "active" ? <Chip tone="good">Signed up</Chip> : <Chip tone="warn">Not signed up yet</Chip>}</dd></div>
          </dl>
          {owner.status === "active" ? (
            <p className="mt-2 text-[14px] text-ink/75">The owner has already chosen a password, so no sign-up code is needed.</p>
          ) : (
            <>
              <p className="mt-2 text-[14px] text-ink/75">The owner has not set a password yet. Make a new one-time sign-up code if the first one was lost or has expired.</p>
              <Button className="mt-3" onClick={reissue} busy={busy === "invite"}>Make a new sign-up code</Button>
            </>
          )}
        </Card>
        <Card>
          <h2 className="font-display text-lg font-bold">Plan</h2>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <SelectField label="Plan" className="min-w-[180px] flex-1" value={plan} onChange={(e) => setPlan(e.target.value)}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</SelectField>
            <Button onClick={savePlan} busy={busy === "plan"} disabled={plan === d.plan}>Save plan</Button>
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-lg font-bold">Pause or resume</h2>
          <p className="mt-1 text-[14px] text-ink/75">{active ? "Pausing stops customers from ordering. Nothing is deleted." : "This restaurant is paused. Resume it to let customers order again."}</p>
          <Button className="mt-3" variant={active ? "danger" : "primary"} onClick={() => setAsk(true)}>{active ? "Pause this restaurant" : "Resume this restaurant"}</Button>
        </Card>
        <Card>
          <h2 className="font-display text-lg font-bold">Download all data</h2>
          <p className="mt-1 text-[14px] text-ink/75">A file with the restaurant's settings, menu, staff list, customers, bills and history. Passwords, PINs and payment keys are never included. Use it to hand the data over when a client leaves.</p>
          <Button className="mt-3" variant="secondary" onClick={exportAll} busy={busy === "export"}><Icon name="download" className="h-4 w-4" />Download the data file</Button>
        </Card>
        {err ? <ErrorBox text={err} /> : null}
      </div>
      <div>
        {invite ? (
          <div>
            <h2 className="mb-3 font-display text-lg font-bold">New sign-up code</h2>
            <ClientAccess name={d.config.brand.name} slug={d.slug} ownerEmail={invite.email} token={invite.invite_token} links={d.links} />
          </div>
        ) : null}
      </div>
      <Dialog
        open={ask}
        onClose={() => setAsk(false)}
        title={active ? `Pause ${d.config.brand.name}?` : `Resume ${d.config.brand.name}?`}
        footer={<><Button variant="secondary" onClick={() => setAsk(false)}>Cancel</Button><Button variant={active ? "danger" : "primary"} busy={busy === "status"} onClick={toggle}>{active ? "Yes, pause it" : "Yes, resume it"}</Button></>}
      >
        {active ? (
          <div className="space-y-2">
            <p>What happens right away:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Customers can no longer open the ordering page or place orders. They see a "not found" page.</li>
              <li>The restaurant's staff cannot sign in.</li>
              <li>The logo stops showing publicly.</li>
            </ul>
            <p>Nothing is deleted. You can resume it at any time.</p>
          </div>
        ) : (
          <p>Customers will be able to order again and the staff can sign in again.</p>
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- activity
function ActivityTab({ d }) {
  const q = useLoad(() => api.get("/v2/platform/audit", { query: { limit: 300 } }), [d.id]);
  if (q.loading) return <SkeletonPage rows={4} />;
  if (q.error) return <ErrorBox text={niceError(q.error)} onRetry={q.retry} />;
  const rows = q.data.filter((e) => e.target === d.id);
  if (!rows.length) return <Empty icon="list" title="No changes recorded yet" hint="Every change the Nova team makes to this restaurant will be listed here, with who did it and when." />;
  return (
    <Card className="p-0 sm:p-0">
      <ul className="divide-y divide-line" data-testid="activity">
        {rows.map((e, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3">
            <span className="min-w-[10rem] text-[14px] text-ink/65">{when(e.ts)}</span>
            <span className="min-w-0 flex-1 font-semibold">{describeAudit(e)}</span>
            <span className="text-[14px] text-ink/70">{e.actor}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[13px] text-ink/65">Showing changes from the most recent 300 actions across all restaurants.</p>
    </Card>
  );
}
