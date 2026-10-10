import { useEffect, useState } from "react";
import { money } from "@nova/shared";
import { API_BASE, api, draft, niceError, storefrontLink, uploadLogo, useLoad } from "../lib/api";
import { PLANS, SLUG_RE, buildConfig, contrastWarnings, dataUrlToBlob, formFromConfig, monogram, slugify, validateForm } from "../lib/brand";
import { go, href } from "../lib/router";
import { ContactFields, LookFeelEditor, SellingFields } from "../Editors";
import ClientAccess from "../ClientAccess";
import Checklist from "../Checklist";
import { Button, Card, ErrorBox, Icon, LinkButton, Notice, Page, SkeletonPage, TextField, cx } from "../ui";
import { PLAN_LABEL } from "./common";

export const WIZARD_DRAFT = draft("nova.ops.wizard");
const STEPS = ["Basics", "Look & feel", "Contact & hours", "Selling", "Review"];
const EMAIL = /^\S+@\S+\.\S+$/;

export default function Wizard() {
  const q = useLoad(() => Promise.all([api.get("/v2/platform/tenant-template"), api.get("/v2/platform/tenants")]));
  if (q.loading) return <Page title="Add a restaurant"><SkeletonPage /></Page>;
  if (q.error) return <Page title="Add a restaurant"><ErrorBox text={niceError(q.error)} onRetry={q.retry} /></Page>;
  return <Body template={q.data[0]} taken={q.data[1].map((t) => t.slug)} />;
}

function initial(template) {
  const saved = WIZARD_DRAFT.load();
  if (saved && saved.form) return { ...saved, resumed: true };
  const pre = (saved && saved.prefill) || {};
  const form = { ...formFromConfig(template), name: pre.name || "", tagline: "" };
  return { step: 0, form, slug: slugify(pre.name || ""), slugEdited: false, ownerEmail: pre.ownerEmail || "", plan: "starter", logo: null, lead: pre.lead || null, resumed: false };
}

function Body({ template, taken }) {
  const [s, setS] = useState(() => initial(template));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const [slugErr, setSlugErr] = useState("");
  const [created, setCreated] = useState(null);

  useEffect(() => { if (!created) WIZARD_DRAFT.save({ ...s, resumed: undefined }); }, [s, created]);
  useEffect(() => { if (!created) document.title = "Add a restaurant - Nova Console"; }, [created]);

  const setForm = (patch) => setS((x) => ({ ...x, form: { ...x.form, ...patch } }));
  const patch = (p) => setS((x) => ({ ...x, ...p }));
  const setName = (name) => setS((x) => ({ ...x, form: { ...x.form, name }, slug: x.slugEdited ? x.slug : slugify(name) }));

  function errorsFor(step) {
    const e = {};
    if (step === 0) {
      if (!s.form.name.trim()) e.name = "Please enter the restaurant's name.";
      if (!SLUG_RE.test(s.slug)) e.slug = "Use 3 to 40 small letters, numbers or dashes (a-z, 0-9, -).";
      else if (taken.includes(s.slug) || slugErr) e.slug = slugErr || "Another restaurant already uses this web address. Please choose a different one.";
      if (!EMAIL.test(s.ownerEmail.trim())) e.ownerEmail = "Enter the owner's e-mail address.";
    }
    if (step === 1) Object.assign(e, validateForm(s.form, "look"));
    if (step === 2) Object.assign(e, validateForm(s.form, "contact"));
    if (step === 3) Object.assign(e, validateForm(s.form, "selling"));
    return e;
  }
  const errors = tried ? errorsFor(s.step) : {};

  function next() {
    if (Object.keys(errorsFor(s.step)).length) return setTried(true);
    setTried(false);
    patch({ step: s.step + 1 });
    window.scrollTo(0, 0);
  }
  const jump = (step) => { setTried(false); patch({ step }); window.scrollTo(0, 0); };

  function startOver() {
    WIZARD_DRAFT.clear();
    setS(initial(template));
    setS((x) => ({ ...x, resumed: false, step: 0 }));
    setTried(false);
  }

  async function create() {
    for (let st = 0; st < 4; st++) if (Object.keys(errorsFor(st)).length) { setTried(true); setServerErr(""); return patch({ step: st }); }
    setBusy(true);
    setServerErr("");
    let made;
    try {
      const tpl = await api.get("/v2/platform/tenant-template", { query: { slug: s.slug, name: s.form.name.trim() } });
      const config = buildConfig(tpl, s.form);
      config.slug = s.slug;
      made = await api.post("/v2/platform/tenants", { config, owner_email: s.ownerEmail.trim(), plan: s.plan });
    } catch (e) {
      setBusy(false);
      if (e.code === "SLUG_TAKEN") { setSlugErr("Another restaurant already uses this web address. Please choose a different one."); setTried(true); return patch({ step: 0 }); }
      if (e.status === 401) return; // signed out: the draft is kept and the sign-in page explains
      return setServerErr(niceError(e));
    }
    let logoError = "";
    if (s.logo) {
      try { await uploadLogo(made.id, dataUrlToBlob(s.logo.dataUrl)); } catch (e) { logoError = e.message; }
    }
    if (s.lead?.id) {
      try {
        await api.patch("/v2/platform/leads/" + s.lead.id, { status: "onboarded" });
        await api.patch("/v2/platform/leads/" + s.lead.id, { note: `Onboarded as ${made.slug}` });
      } catch { /* the restaurant exists; the enquiry can be moved by hand */ }
    }
    let detail = null;
    try { detail = await api.get("/v2/platform/tenants/" + made.id); } catch { /* links fall back below */ }
    WIZARD_DRAFT.clear();
    setBusy(false);
    setCreated({
      id: made.id,
      slug: made.slug,
      token: made.owner_invite_token,
      name: s.form.name.trim(),
      ownerEmail: s.ownerEmail.trim(),
      logoError,
      links: detail?.links ? { storefront: detail.links.storefront, admin: detail.links.admin } : { storefront: `${location.origin}/s/${made.slug}`, admin: `${API_BASE}/app/` },
      checklist: detail?.checklist || [],
    });
  }

  if (created) return <Success c={created} />;

  const warn = contrastWarnings(s.form.colors);
  return (
    <Page title="Add a restaurant" subtitle="Five short steps. Your answers are saved as you go, so you can leave and come back.">
      {s.resumed ? (
        <Notice tone="info" className="mb-4">
          <div className="flex flex-wrap items-center gap-3"><span className="flex-1">Welcome back. We kept what you had filled in.</span><Button variant="secondary" onClick={startOver}>Start again from scratch</Button></div>
        </Notice>
      ) : null}
      {s.lead ? (
        <Notice tone="info" title={`From the enquiry by ${s.lead.name}`} className="mb-4">
          <p>{[s.lead.phone, s.lead.city].filter(Boolean).join(" - ")}</p>
          {s.lead.message ? <p className="mt-1">"{s.lead.message}"</p> : null}
          {(s.lead.notes || []).map((n, i) => <p key={i} className="mt-1 text-[14px] text-ink/75">Note: {n.text}</p>)}
        </Notice>
      ) : null}

      <Stepper step={s.step} onJump={(i) => i < s.step && jump(i)} />

      <div className="mt-5">
        {s.step === 0 ? (
          <Card className="max-w-2xl space-y-4">
            <TextField label="Restaurant name" value={s.form.name} onChange={(e) => setName(e.target.value)} error={errors.name} autoFocus autoComplete="off" />
            <TextField
              label="Web address code"
              hint={errors.slug ? undefined : `Customers will find the restaurant at .../s/${s.slug || "your-code"}. Made from the name; change it if you like. It cannot be changed later.`}
              value={s.slug}
              onChange={(e) => { setSlugErr(""); patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""), slugEdited: true }); }}
              error={errors.slug}
              autoComplete="off"
              spellCheck="false"
              maxLength={40}
              inputClass="font-mono"
            />
            <TextField label="Owner's e-mail" type="email" inputMode="email" hint="The owner uses this e-mail to sign in to their admin page." value={s.ownerEmail} onChange={(e) => patch({ ownerEmail: e.target.value })} error={errors.ownerEmail} autoComplete="off" />
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">Plan</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {PLANS.map((p) => (
                  <label key={p.id} className={cx("flex min-h-[44px] cursor-pointer flex-col rounded-xl border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent", s.plan === p.id ? "border-brand bg-brand-soft" : "border-line bg-white")}>
                    <span className="flex items-center gap-2 font-bold"><input type="radio" name="plan" checked={s.plan === p.id} onChange={() => patch({ plan: p.id })} className="h-4 w-4 accent-[#133B40]" />{p.label}</span>
                    <span className="mt-1 text-[13px] text-ink/70">{p.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>
        ) : null}

        {s.step === 1 ? <LookFeelEditor form={s.form} set={setForm} errors={errors} logo={s.logo} onLogo={(logo) => patch({ logo })} /> : null}
        {s.step === 2 ? <div className="max-w-2xl"><ContactFields form={s.form} set={setForm} errors={errors} /></div> : null}
        {s.step === 3 ? <div className="max-w-3xl"><SellingFields form={s.form} set={setForm} errors={errors} /></div> : null}
        {s.step === 4 ? <Review s={s} warn={warn} jump={jump} serverErr={serverErr} /> : null}
      </div>

      {tried && Object.keys(errorsFor(s.step)).length ? <p role="alert" className="mt-4 font-semibold text-bad">Please fix the highlighted items to continue.</p> : null}
      <div className="sticky bottom-0 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-4">
        <Button variant="secondary" disabled={s.step === 0 || busy} onClick={() => jump(s.step - 1)}><Icon name="back" className="h-4 w-4" />Back</Button>
        <span className="text-[14px] text-ink/70 sm:hidden">Step {s.step + 1} of 5</span>
        {s.step < 4 ? <Button onClick={next}>Next<Icon name="chevron" className="h-4 w-4" /></Button> : <Button onClick={create} busy={busy}>Create the restaurant</Button>}
      </div>
    </Page>
  );
}

function Stepper({ step, onJump }) {
  return (
    <nav aria-label="Steps">
      <p className="mb-2 font-semibold sm:hidden" aria-live="polite">Step {step + 1} of 5: {STEPS[step]}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-line sm:hidden"><div className="h-full bg-action transition-all" style={{ width: `${((step + 1) / 5) * 100}%` }} /></div>
      <ol className="hidden items-center gap-2 sm:flex">
        {STEPS.map((l, i) => (
          <li key={l} className="flex flex-1 items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <button type="button" onClick={() => onJump(i)} disabled={i >= step} className={cx("flex min-h-[44px] items-center gap-2 rounded-xl pr-2 text-left text-[15px] font-semibold", i > step && "text-ink/55")}>
              <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold", i < step ? "bg-good text-white" : i === step ? "bg-action text-white" : "bg-line text-ink/70")}>{i < step ? <Icon name="check" className="h-4 w-4" /> : i + 1}</span>
              {l}
            </button>
            {i < 4 ? <span className="h-px flex-1 bg-line" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Row({ k, children }) {
  return <div className="flex flex-wrap gap-x-3 py-1.5"><dt className="w-40 shrink-0 text-ink/65">{k}</dt><dd className="min-w-0 flex-1 break-words font-semibold">{children || <span className="font-normal text-ink/50">Not set</span>}</dd></div>;
}
function Section({ title, step, jump, children }) {
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between"><h3 className="font-display text-lg font-bold">{title}</h3><Button variant="ghost" onClick={() => jump(step)}>Change</Button></div>
      <dl className="text-[15px]">{children}</dl>
    </Card>
  );
}

function Review({ s, warn, jump, serverErr }) {
  const f = s.form;
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-[15px] text-ink/75">Check everything below. When you press "Create the restaurant" it goes live straight away, and you get the sign-up code for the owner.</p>
      {serverErr ? <ErrorBox text={serverErr} /> : null}
      {warn.length ? <Notice tone="warn" title="Some colours are hard to read">Go back to Look & feel to fix it, or create the restaurant anyway and change it later.</Notice> : null}
      <Section title="Basics" step={0} jump={jump}>
        <Row k="Name">{f.name}</Row><Row k="Web address code">{s.slug}</Row><Row k="Owner's e-mail">{s.ownerEmail}</Row><Row k="Plan">{PLAN_LABEL[s.plan]}</Row>
      </Section>
      <Section title="Look & feel" step={1} jump={jump}>
        <Row k="Logo">{s.logo ? `${s.logo.name} (${Math.round(s.logo.size / 1000)} KB)` : "No logo yet (a monogram is shown)"}</Row>
        <Row k="Colours"><span className="flex items-center gap-1" aria-label="Chosen colours">{Object.entries(f.colors).map(([k, v]) => <span key={k} title={k} className="h-6 w-6 rounded-md border border-line" style={{ background: v }} />)}</span></Row>
        <Row k="Fonts">{f.fonts.heading} and {f.fonts.body}</Row>
        <Row k="Tagline">{f.tagline}</Row>
      </Section>
      <Section title="Contact & hours" step={2} jump={jump}>
        <Row k="Address">{f.address}</Row><Row k="Opening hours">{f.hours}</Row><Row k="Phone">{f.phone}</Row><Row k="Map link">{f.mapUrl}</Row>
      </Section>
      <Section title="Selling" step={3} jump={jump}>
        <Row k="Ways to order">{f.channels.join(", ")}</Row>
        <Row k="Smallest order">{money(Number(f.minOrder || 0) * 100)}</Row>
        <Row k="Preparation time">{f.prep} minutes</Row>
        {f.channels.includes("delivery") ? (<>
          <Row k="Delivery distance">{f.maxKm} km</Row>
          <Row k="Delivery fees">{f.slabs.filter((x) => x.km !== "").map((x) => `up to ${x.km} km: Rs ${x.fee}`).join(" | ")}</Row>
          <Row k="Free delivery above">{f.freeAbove ? money(Number(f.freeAbove) * 100) : ""}</Row>
          <Row k="Shop location">{f.lat && f.lng ? `${f.lat}, ${f.lng}` : ""}</Row>
        </>) : null}
        <Row k="Tax">{f.taxRate}% ({f.taxMode === "inclusive" ? "included in prices" : "added on top"}){f.gstin ? ", GST " + f.gstin : ""}</Row>
        <Row k="Payment">{[f.cod && "Pay on delivery", f.online && "Online payment"].filter(Boolean).join(", ") || "Pay at the restaurant only"}</Row>
        <Row k="Tables">{f.tables}</Row>
      </Section>
    </div>
  );
}

function Success({ c }) {
  useEffect(() => { document.title = "Give access to the client - Nova Console"; }, []);
  return (
    <Page title="Give access to the client" subtitle={`${c.name} is ready. Send the client what is below so they can start.`}>
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-good-soft p-4 text-[#14633a]" role="status" data-testid="created">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-good text-white"><Icon name="check" /></span>
        <p className="font-bold">{c.name} has been created.</p>
      </div>
      {c.logoError ? <Notice tone="warn" title="The restaurant was created, but the logo was not saved" className="mb-4">{c.logoError} You can add the logo later under Look & feel.</Notice> : null}
      <ClientAccess name={c.name} slug={c.slug} ownerEmail={c.ownerEmail} token={c.token} links={c.links} />
      <Card className="mt-4">
        <h3 className="font-display text-lg font-bold">Still to do</h3>
        {c.checklist.length ? <Checklist items={c.checklist} id={c.id} /> : <p className="text-[15px] text-ink/75">Open the restaurant to see what is left to set up.</p>}
      </Card>
      <div className="mt-5 flex flex-wrap gap-2">
        <LinkButton variant="primary" href={href("/restaurants/" + c.id)}>Open {c.name}</LinkButton>
        <Button variant="secondary" onClick={() => { WIZARD_DRAFT.clear(); go("/restaurants"); }}>Back to the list</Button>
        <Button variant="secondary" onClick={() => { WIZARD_DRAFT.clear(); location.reload(); }}>Add another restaurant</Button>
      </div>
    </Page>
  );
}
