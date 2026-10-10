import { ago, dateOf, money, timeOf } from "@nova/shared";
import { href } from "../lib/router";
import { Avatar, Chip, cx } from "../ui";

export const STATUS = { active: { label: "Active", tone: "good" }, suspended: { label: "Paused", tone: "warn" } };
export const statusChip = (s) => {
  const x = STATUS[s] || { label: s, tone: "mute" };
  return <Chip tone={x.tone}>{x.label}</Chip>;
};
export const PLAN_LABEL = { starter: "Starter", growth: "Growth", pro: "Pro" };

export const when = (iso) => (iso ? `${dateOf(iso)}, ${timeOf(iso)}` : "");

export function RestaurantCard({ t }) {
  return (
    <a href={href("/restaurants/" + t.id)} className="group block rounded-2xl border border-line bg-white p-4 shadow-card transition hover:border-brand/40 hover:shadow-float" data-testid="restaurant-card">
      <div className="flex items-start gap-3">
        <Avatar name={t.name} logoUrl={t.status === "active" ? t.logo_url : ""} color={t.colors?.primary} size={48} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words font-display text-lg font-bold leading-tight">{t.name}</p>
          <p className="truncate text-[13px] text-ink/65">{t.slug}</p>
        </div>
        {statusChip(t.status)}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[13px]">
        <div><dt className="text-ink/65">Orders (30 days)</dt><dd className="text-base font-bold">{t.orders_30d}</dd></div>
        <div><dt className="text-ink/65">Sales</dt><dd className="text-base font-bold">{money(t.gmv_30d)}</dd></div>
        <div><dt className="text-ink/65">Last order</dt><dd className="text-base font-bold">{t.last_order_at ? ago(t.last_order_at) : "None yet"}</dd></div>
      </dl>
    </a>
  );
}

export function StatTile({ label, value, sub, to, tone }) {
  const body = (
    <>
      <p className="text-[14px] font-semibold text-ink/70">{label}</p>
      <p className={cx("mt-1 font-display text-2xl font-extrabold tracking-tight sm:text-3xl", tone === "bad" && "text-bad", tone === "good" && "text-good")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[13px] text-ink/65">{sub}</p> : null}
    </>
  );
  const cls = "block rounded-2xl border border-line bg-white p-4 shadow-card";
  return to ? <a href={href(to)} className={cx(cls, "hover:border-brand/40")}>{body}</a> : <div className={cls}>{body}</div>;
}

/** 30 days of sales as plain bars. `daily` is [{date, sales}] in paise. */
export function SalesChart({ daily }) {
  const max = Math.max(1, ...daily.map((d) => d.sales));
  const total = daily.reduce((a, d) => a + d.sales, 0);
  const W = 600, H = 150, pad = 4, bw = (W - pad * 2) / daily.length;
  if (!total) {
    return <p className="rounded-xl bg-brand-soft p-4 text-[15px] text-ink/75">No sales in the last 30 days yet. Bars will appear here once orders are paid.</p>;
  }
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full" role="img" aria-label={`Sales per day over the last 30 days, ${money(total)} in total`}>
        {[0.5, 1].map((f) => <line key={f} x1="0" x2={W} y1={H - H * f * 0.92} y2={H - H * f * 0.92} stroke="rgb(var(--line))" strokeDasharray="3 4" />)}
        {daily.map((d, i) => {
          const h = Math.max(d.sales ? 3 : 0, (d.sales / max) * H * 0.92);
          return (
            <g key={d.date}>
              <rect x={pad + i * bw + 1.5} y={H - h} width={bw - 3} height={h} rx="2" fill="rgb(var(--accent))">
                <title>{`${dateOf(d.date)}: ${money(d.sales)}`}</title>
              </rect>
            </g>
          );
        })}
        <line x1="0" x2={W} y1={H} y2={H} stroke="rgb(var(--ink) / .3)" />
        <text x={pad} y={H + 16} fontSize="11" fill="rgb(var(--ink) / .7)">{dateOf(daily[0].date)}</text>
        <text x={W - pad} y={H + 16} fontSize="11" textAnchor="end" fill="rgb(var(--ink) / .7)">{dateOf(daily[daily.length - 1].date)}</text>
        <text x={W - pad} y={12} fontSize="11" textAnchor="end" fill="rgb(var(--ink) / .7)">Best day {money(max)}</text>
      </svg>
      <figcaption className="sr-only">Total sales {money(total)}</figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- audit wording
const SECRET = { "razorpay.key_id": "Razorpay key id", "razorpay.key_secret": "Razorpay key secret", "razorpay.webhook_secret": "Razorpay webhook secret" };
const SECTION = { brand: "look and feel", locale: "language and region", tax: "tax", ordering: "ordering", delivery: "delivery", payments: "payments", pos: "tables", integrations: "connections", loyalty: "loyalty", operations: "operations", receipt: "receipts" };
export function describeAudit(e) {
  const d = e.diff || {};
  switch (e.action) {
    case "tenant.create": return "Added the restaurant";
    case "tenant.suspend": return "Paused the restaurant (customers cannot order)";
    case "tenant.activate": return "Resumed the restaurant";
    case "tenant.config.update": return `Changed the restaurant's details (${(d.changed_sections || []).map((s) => SECTION[s] || s).join(", ") || "settings"})`;
    case "tenant.logo": return "Replaced the logo";
    case "tenant.plan": return `Changed the plan to ${PLAN_LABEL[d.plan] || d.plan}`;
    case "tenant.owner_invite": return "Made a new sign-up code for the owner";
    case "tenant.secret.set": return `Saved payment key: ${SECRET[d.name] || d.name}`;
    case "tenant.secret.delete": return `Removed payment key: ${SECRET[d.name] || d.name}`;
    case "tenant.export": return "Downloaded all of the restaurant's data";
    case "settings.whatsapp": return "Changed the WhatsApp connection settings";
    case "settings.whatsapp.token": return "Saved the WhatsApp access token";
    case "settings.whatsapp.test": return "Sent a WhatsApp test message";
    default: return e.action.replace(/[._]/g, " ");
  }
}
