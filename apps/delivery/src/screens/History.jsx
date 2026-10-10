import { useState } from "react";
import { dateOf, money, timeOf } from "@nova/shared";
import { api } from "../session.js";
import { Card, Chip, Empty, ErrorBox, Spinner, usePoll } from "../ui.jsx";
import { StatsStrip } from "./Home.jsx";

export const RANGES = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All"]];

export function since(range) {
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "7d") return new Date(now.getTime() - 7 * 864e5);
  if (range === "30d") return new Date(now.getTime() - 30 * 864e5);
  return null;
}

export function RangeChips({ range, onChange }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Date range">
      {RANGES.map(([id, label]) => <Chip key={id} active={range === id} onClick={() => onChange(id)}>{label}</Chip>)}
    </div>
  );
}

export default function History({ onOpen }) {
  const [range, setRange] = useState("today");
  const q = usePoll(async () => {
    const [summary, orders] = await Promise.all([api.get("/v2/delivery/summary", { query: { range } }), api.get("/v2/delivery/orders")]);
    return { summary, history: orders.history };
  }, 0, [range]);
  const from = since(range);
  const rows = q.data ? q.data.history.filter((o) => !from || new Date(o.delivered_at || o.placed_at) >= from) : [];

  return (
    <div className="space-y-4">
      <RangeChips range={range} onChange={setRange} />
      {q.error ? <ErrorBox message={q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div> : null}
      {q.data ? (
        <>
          <StatsStrip s={q.data.summary} />
          {!q.data.summary.earnings_configured ? <p className="text-xs opacity-70">Earnings are not set up by the restaurant yet.</p> : null}
          {rows.length ? (
            <ul className="space-y-2">
              {rows.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => onOpen(o.id)} className="active-press block w-full text-left">
                    <Card className="flex items-center justify-between gap-3 !p-3">
                      <div className="min-w-0">
                        <p className="font-semibold">Order #{o.order_no}</p>
                        <p className="truncate text-xs opacity-70">{dateOf(o.delivered_at)} {timeOf(o.delivered_at)} · {o.distance_km != null ? `${o.distance_km} km` : ""}</p>
                        <p className="truncate text-xs opacity-70">{o.address && o.address.text}</p>
                      </div>
                      <p className="shrink-0 font-display font-extrabold">{money(o.total)}</p>
                    </Card>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty icon="history" title="No deliveries in this period" hint="Completed deliveries will be listed here." />}
        </>
      ) : null}
    </div>
  );
}
