import { useMemo, useState } from "react";
import { api, niceError, useLoad } from "../lib/api";
import { href } from "../lib/router";
import { Button, Card, Chip, Empty, ErrorBox, Icon, Page, SkeletonPage } from "../ui";
import { describeAudit, when } from "./common";

// ---------------------------------------------------------------- audit log
export function AuditPage() {
  const q = useLoad(() => Promise.all([api.get("/v2/platform/audit", { query: { limit: 300 } }), api.get("/v2/platform/tenants")]));
  const [text, setText] = useState("");
  const names = useMemo(() => Object.fromEntries((q.data?.[1] || []).map((t) => [t.id, t])), [q.data]);
  const rows = (q.data?.[0] || []).filter((e) => {
    if (!text.trim()) return true;
    const s = text.trim().toLowerCase();
    return [e.actor, describeAudit(e), names[e.target]?.name].some((x) => (x || "").toLowerCase().includes(s));
  });
  return (
    <Page title="Audit log" subtitle="Who changed what, and when. The newest change is at the top.">
      {q.loading ? <SkeletonPage rows={5} /> : q.error ? <ErrorBox text={niceError(q.error)} onRetry={q.retry} /> : !q.data[0].length ? (
        <Empty icon="list" title="Nothing has been changed yet" hint="Every change made in this console will be listed here." />
      ) : (
        <>
          <div className="mb-3 max-w-sm">
            <label htmlFor="asearch" className="sr-only">Search the log</label>
            <input id="asearch" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by person, restaurant or action" className="min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-[15px]" />
          </div>
          {rows.length ? (
            <Card className="overflow-hidden p-0 sm:p-0">
              <table className="hidden w-full text-left text-[15px] md:table" data-testid="audit-table">
                <thead className="bg-brand-soft text-[13px] uppercase tracking-wide text-ink/70">
                  <tr><th className="px-4 py-2.5 font-bold">When</th><th className="px-4 py-2.5 font-bold">Who</th><th className="px-4 py-2.5 font-bold">What they did</th><th className="px-4 py-2.5 font-bold">Restaurant</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((e, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-4 py-3 text-ink/75">{when(e.ts)}</td>
                      <td className="px-4 py-3">{e.actor}</td>
                      <td className="px-4 py-3 font-semibold">{describeAudit(e)}</td>
                      <td className="px-4 py-3"><Target e={e} names={names} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="divide-y divide-line md:hidden">
                {rows.map((e, i) => (
                  <li key={i} className="px-4 py-3">
                    <p className="font-semibold">{describeAudit(e)}</p>
                    <p className="text-[14px]"><Target e={e} names={names} /></p>
                    <p className="text-[13px] text-ink/65">{e.actor}, {when(e.ts)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : <Empty icon="search" title="Nothing matches" hint="Try a different word." />}
        </>
      )}
    </Page>
  );
}
function Target({ e, names }) {
  if (e.target === "platform") return <span className="text-ink/70">Nova settings</span>;
  const t = names[e.target];
  return t ? <a className="prose-link" href={href("/restaurants/" + t.id)}>{t.name}</a> : <span className="text-ink/60">{e.target ? "A removed restaurant" : "-"}</span>;
}

// ---------------------------------------------------------------- health
export function HealthPage() {
  const q = useLoad(() => api.get("/v2/platform/health"));
  const [checkedAt, setCheckedAt] = useState(new Date());
  const h = q.data;
  const checks = h ? [
    { id: "database", ok: h.database, good: "The database is working.", bad: "The database is not answering.", fix: "Orders and sign-ins may fail. Tell your developer straight away." },
    { id: "secrets", ok: h.secrets_key, good: "Payment keys and the WhatsApp token can be stored safely.", bad: "The server has no secrets key, so payment keys and the WhatsApp token cannot be saved.", fix: "Ask your developer to set the SECRETS_KEY on the server and restart it. Keep a copy somewhere safe: if it is lost, every payment key must be entered again." },
    { id: "url", ok: !!h.public_base_url, good: `Customer links use ${h.public_base_url}.`, bad: "The server does not know its public web address, so the links you give to clients may be wrong.", fix: "Ask your developer to set PUBLIC_BASE_URL to the address of the ordering website." },
    { id: "wa", ok: h.whatsapp_connected, good: "WhatsApp is connected.", bad: "WhatsApp is not connected, so customers get no sign-in codes or order updates.", fix: "Open the WhatsApp page and add the phone number id and access token.", to: "/whatsapp", cta: "Open WhatsApp" },
  ] : [];
  return (
    <Page title="Health" subtitle="Is everything Nova needs working? Red items tell you what to do." actions={<Button variant="secondary" onClick={async () => { await q.retry(); setCheckedAt(new Date()); }}>Check again</Button>}>
      {q.loading ? <SkeletonPage rows={4} /> : q.error ? <ErrorBox text={niceError(q.error)} onRetry={q.retry} /> : (
        <>
          <ul className="space-y-3" data-testid="checks">
            {checks.map((c) => (
              <li key={c.id}>
                <Card className="flex items-start gap-3" data-ok={c.ok}>
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-white ${c.ok ? "bg-good" : "bg-bad"}`}><Icon name={c.ok ? "check" : "x"} className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold"><span className="sr-only">{c.ok ? "Working: " : "Problem: "}</span>{c.ok ? c.good : c.bad}</p>
                    {!c.ok ? <p className="mt-1 text-[15px] text-ink/80"><b>What to do:</b> {c.fix}</p> : null}
                    {!c.ok && c.to ? <a className="prose-link mt-1 inline-flex min-h-[44px] items-center" href={href(c.to)}>{c.cta}</a> : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex items-center gap-2 text-[14px] text-ink/70">
            <Chip tone={h.env === "production" ? "good" : "warn"}>{h.env === "production" ? "Live" : "Test setup"}</Chip>
            {h.env === "production" ? "This is the live server." : `This server is running in "${h.env}" mode, not live.`} Checked at {checkedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.
          </p>
        </>
      )}
    </Page>
  );
}
