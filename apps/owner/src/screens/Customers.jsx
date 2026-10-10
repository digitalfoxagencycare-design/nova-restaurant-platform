import { useEffect, useState } from "react";
import { ago, money } from "@nova/shared";
import { api } from "../session.js";
import { useApp } from "../ctx.js";
import { Card, Empty, ErrorBox, Icon, inputCls, Spinner, usePoll } from "../ui.jsx";
import { SubHeader } from "../ui-extra.jsx";

export function Customers({ onBack }) {
  const { shop } = useApp();
  const [text, setText] = useState("");
  const [q2, setQ2] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ2(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const q = usePoll(() => api.get("/v2/customers", { query: { q: q2 } }), 0, [q2]);
  const cc = (shop && shop.locale && shop.locale.country_code) || "91";
  const rows = q.data || [];
  return (
    <div className="space-y-3">
      <SubHeader title="Customers" onBack={onBack} />
      <div className="relative">
        <label htmlFor="csearch" className="sr-only">Search customers</label>
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 opacity-60" />
        <input id="csearch" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search name or phone" className={`${inputCls} pl-10`} />
      </div>
      {q.error ? <ErrorBox message={q.error.status === 403 ? "You are not allowed to see customers." : q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div> : null}
      {q.data && !rows.length ? <Empty icon="users" title="No customers found" hint="Customers appear after their first order." /> : null}
      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.phone}>
            <Card className="!p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name || "No name"}</p>
                  <p className="text-sm opacity-80">{c.phone}</p>
                  <p className="text-xs opacity-60">{c.orders} orders · last {ago(c.last_order_at)}</p>
                </div>
                <div className="shrink-0 text-right"><p className="font-display text-lg font-extrabold">{money(c.spend)}</p><p className="text-xs opacity-60">spent</p></div>
              </div>
              <div className="mt-2 flex gap-2">
                <a href={`tel:${c.phone}`} className="active-press inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold"><Icon name="phone" className="h-4 w-4" />Call</a>
                <a href={`https://wa.me/${cc}${c.phone}`} target="_blank" rel="noopener noreferrer" className="active-press inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold"><Icon name="chat" className="h-4 w-4" />WhatsApp</a>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
