import { useMemo, useState } from "react";
import { ago } from "@nova/shared";
import { api, niceError, useLoad } from "../lib/api";
import { go } from "../lib/router";
import { Button, Card, Chip, Empty, ErrorBox, Icon, Page, SelectField, Skeleton, TextField, Tabs, useToast } from "../ui";
import { WIZARD_DRAFT } from "./Wizard";
import { when } from "./common";

export const STAGES = [
  { id: "new", label: "New", hint: "Nobody has replied yet" },
  { id: "contacted", label: "Contacted", hint: "You have been in touch" },
  { id: "demo", label: "Demo", hint: "A demo is planned or done" },
  { id: "onboarded", label: "Onboarded", hint: "They are a client now" },
  { id: "lost", label: "Lost", hint: "Not going ahead" },
];
const digits = (p) => { const d = (p || "").replace(/\D/g, ""); return d.length === 10 ? "91" + d : d; };

export default function Enquiries() {
  const q = useLoad(() => api.get("/v2/platform/leads"));
  const [stage, setStage] = useState("new");
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.id, (q.data || []).filter((l) => (l.status || "new") === s.id).length])), [q.data]);
  const list = (q.data || []).filter((l) => (l.status || "new") === stage);
  const st = STAGES.find((s) => s.id === stage);

  return (
    <Page title="Enquiries" subtitle="Restaurants that asked about Nova. Move each one along until they are a client.">
      <Tabs tabs={STAGES.map((s) => ({ id: s.id, label: `${s.label} (${counts[s.id]})` }))} value={stage} onChange={setStage} label="Enquiry stages" />
      {q.loading ? (
        <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : q.error ? (
        <ErrorBox text={niceError(q.error)} onRetry={q.retry} />
      ) : !q.data.length ? (
        <Empty icon="inbox" title="No enquiries yet" hint="When a restaurant fills in the form on the Nova website, it appears here with their phone number." />
      ) : !list.length ? (
        <Empty icon="inbox" title={`Nothing in "${st.label}"`} hint={stage === "new" ? "You have answered everyone. Well done." : "Move an enquiry here from another stage when it is ready."} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="leads">
          <p className="sr-only" role="status">{list.length} enquiries in {st.label}</p>
          {list.map((l) => <LeadCard key={l.id} lead={l} onChange={q.reload} />)}
        </div>
      )}
    </Page>
  );
}

function LeadCard({ lead, onChange }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function patch(body, ok) {
    setBusy(true);
    setErr("");
    try {
      await api.patch("/v2/platform/leads/" + lead.id, body);
      if (ok) toast(ok);
      await onChange();
      return true;
    } catch (e) {
      setErr(niceError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function addNote(e) {
    e.preventDefault();
    if (!note.trim()) return setErr("Write a note first.");
    if (await patch({ note: note.trim() }, "Note added.")) setNote("");
  }
  function onboard() {
    WIZARD_DRAFT.save({
      prefill: {
        name: lead.restaurant,
        ownerEmail: lead.email || "",
        lead: { id: lead.id, name: lead.name, phone: lead.phone, city: lead.city, message: lead.message, notes: lead.notes || [] },
      },
    });
    go("/restaurants/new");
  }

  const wa = digits(lead.phone);
  return (
    <Card data-testid="lead">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-bold">{lead.restaurant}</h2>
          <p className="text-[15px]">{lead.name}{lead.city ? <span className="text-ink/65"> - {lead.city}</span> : null}</p>
        </div>
        <span className="shrink-0 text-[13px] text-ink/65">{ago(lead.created_at)}</span>
      </div>
      {lead.message ? <p className="mt-3 rounded-xl bg-brand-soft p-3 text-[15px]">{lead.message}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-white px-3 text-[15px] font-semibold hover:bg-brand-soft"><Icon name="phone" className="h-4 w-4" />{lead.phone}</a>
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1B7F4B] px-3 text-[15px] font-semibold text-white hover:opacity-90"><Icon name="chat" className="h-4 w-4" />WhatsApp</a>
        {lead.email ? <a href={`mailto:${lead.email}`} className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-[15px] font-semibold text-brand underline">{lead.email}</a> : null}
      </div>

      <div className="mt-4">
        <p className="mb-1 text-sm font-semibold">Notes</p>
        {(lead.notes || []).length ? (
          <ul className="space-y-1.5" data-testid="notes">
            {lead.notes.map((n, i) => <li key={i} className="rounded-lg bg-surface px-3 py-2 text-[14px]"><span>{n.text}</span><span className="block text-[12px] text-ink/60">{n.by}, {when(n.at)}</span></li>)}
          </ul>
        ) : <p className="text-[14px] text-ink/65">No notes yet.</p>}
        <form onSubmit={addNote} className="mt-2 flex flex-wrap items-start gap-2">
          <TextField label="Add a note" className="min-w-[200px] flex-1" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: called, wants a demo on Friday" />
          <Button type="submit" variant="secondary" className="mt-6" busy={busy} disabled={!note.trim()}>Add note</Button>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <SelectField label="Stage" className="w-44" value={lead.status || "new"} onChange={(e) => patch({ status: e.target.value }, `Moved to ${STAGES.find((s) => s.id === e.target.value).label}.`)} disabled={busy}>
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </SelectField>
        {lead.status !== "onboarded" ? <Button onClick={onboard}>Onboard this restaurant</Button> : <Chip tone="good">Already a client</Chip>}
      </div>
      {err ? <p role="alert" className="mt-2 text-[14px] font-semibold text-bad">{err}</p> : null}
    </Card>
  );
}
