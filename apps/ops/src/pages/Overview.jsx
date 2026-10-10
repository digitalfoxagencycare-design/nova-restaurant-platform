import { useState } from "react";
import { money } from "@nova/shared";
import { api, niceError, useLoad } from "../lib/api";
import { href } from "../lib/router";
import { Button, Card, Chip, Empty, ErrorBox, Icon, LinkButton, Page, Skeleton } from "../ui";
import { RestaurantCard, StatTile } from "./common";

const LABEL = { brand: "logo and colours", owner: "owner has not signed up yet", menu: "no dishes on the menu", delivery: "shop location missing", payments: "no payment keys", first_order: "no orders yet" };
const SKIP = new Set(["whatsapp", "first_order"]); // WhatsApp is one shared connection, shown on its own; a first order is not a problem

async function loadAll() {
  const [overview, tenants, health] = await Promise.all([
    api.get("/v2/platform/overview"),
    api.get("/v2/platform/tenants"),
    api.get("/v2/platform/health").catch(() => null),
  ]);
  // One call per restaurant for its checklist. Fine for dozens of restaurants.
  const details = await Promise.all(tenants.slice(0, 60).map((t) => api.get("/v2/platform/tenants/" + t.id).catch(() => null)));
  return { overview, tenants, health, details: details.filter(Boolean) };
}

function attention({ overview, health, details }) {
  const out = [];
  if (health) {
    if (!health.database) out.push({ id: "db", tone: "bad", title: "The database is not answering", text: "Orders and sign-ins may fail right now. Tell your developer straight away.", to: "/health" });
    if (!health.secrets_key) out.push({ id: "sk", tone: "bad", title: "Payment keys cannot be stored safely", text: "The server is missing its secrets key, so restaurants' payment keys and the WhatsApp token cannot be saved. Ask your developer to set it.", to: "/health" });
    if (!health.public_base_url) out.push({ id: "pb", tone: "warn", title: "Customer links are incomplete", text: "The server does not know its public web address, so links you give to clients may be wrong.", to: "/health" });
  }
  if (!overview.whatsapp.connected) out.push({ id: "wa", tone: "warn", title: "WhatsApp is not connected", text: "Customers will not get sign-in codes or order updates until you connect Nova's WhatsApp number.", to: "/whatsapp", cta: "Connect WhatsApp" });
  for (const d of details.filter((x) => x.status === "active")) {
    const open = d.checklist.filter((c) => !c.done && !SKIP.has(c.key));
    if (open.length) out.push({ id: d.id, tone: "info", title: d.config.brand.name, text: "Still to do: " + open.map((c) => LABEL[c.key] || c.label).join(", "), to: "/restaurants/" + d.id, cta: "Open", restaurant: true });
  }
  return out;
}

export default function Overview() {
  const q = useLoad(loadAll);
  const [all, setAll] = useState(false);

  if (q.loading) {
    return (
      <Page title="Overview">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="mt-6 h-40" />
      </Page>
    );
  }
  if (q.error) return <Page title="Overview"><ErrorBox text={niceError(q.error)} onRetry={q.retry} /></Page>;

  const { overview: o, tenants, health } = q.data;
  const todo = attention(q.data);
  const shown = all ? todo : todo.slice(0, 6);
  const active = o.tenants.active || 0;
  return (
    <Page
      title="Overview"
      subtitle="How the business is doing right now."
      actions={<LinkButton variant="primary" href={href("/restaurants/new")}><Icon name="plus" className="h-4 w-4" />Add a restaurant</LinkButton>}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="tiles">
        <StatTile label="Active restaurants" value={active} sub={o.tenants.suspended ? `${o.tenants.suspended} paused` : "None paused"} to="/restaurants" />
        <StatTile label="Orders, last 30 days" value={o.orders_30d} />
        <StatTile label="Sales, last 30 days" value={money(o.gmv_30d)} />
        <StatTile label="New enquiries" value={o.leads_new} sub={o.leads_new ? "Waiting for a reply" : "All answered"} to="/enquiries" />
        <StatTile label="WhatsApp" value={o.whatsapp.connected ? "Connected" : "Not connected"} tone={o.whatsapp.connected ? "good" : "bad"} sub={`${o.whatsapp.sent_30d} sent, ${o.whatsapp.failed_30d} failed (30 days)`} to="/whatsapp" />
      </div>

      <section className="mt-8" aria-labelledby="attn">
        <h2 id="attn" className="mb-3 font-display text-xl font-bold">Needs your attention</h2>
        {todo.length === 0 ? (
          <Card className="flex items-center gap-3 text-[15px]"><span className="grid h-10 w-10 place-items-center rounded-full bg-good-soft text-good"><Icon name="check" /></span>Everything is in order. Nothing needs you right now.</Card>
        ) : (
          <ul className="space-y-2" data-testid="attention">
            {shown.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-3 pl-4 shadow-card sm:flex-nowrap">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.tone === "bad" ? "bg-bad" : a.tone === "warn" ? "bg-warn" : "bg-brand"}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{a.title}</p>
                  <p className="text-[14px] text-ink/75">{a.text}</p>
                </div>
                <LinkButton href={href(a.to)} className="shrink-0">{a.cta || "See details"}</LinkButton>
              </li>
            ))}
          </ul>
        )}
        {todo.length > 6 ? <Button variant="ghost" className="mt-2" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${todo.length - 6} more`}</Button> : null}
      </section>

      <section className="mt-8" aria-labelledby="rest">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="rest" className="font-display text-xl font-bold">Your restaurants</h2>
          {tenants.length ? <a className="prose-link text-[15px]" href={href("/restaurants")}>See all</a> : null}
        </div>
        {tenants.length === 0 ? (
          <Empty icon="store" title="No restaurants yet" hint="Add your first client. It takes about five minutes, and you finish with a message to send them." action={<LinkButton variant="primary" href={href("/restaurants/new")}>Add a restaurant</LinkButton>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tenants.slice(0, 9).map((t) => <RestaurantCard key={t.id} t={t} />)}</div>
        )}
      </section>
    </Page>
  );
}
