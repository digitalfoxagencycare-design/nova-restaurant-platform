import { useState } from "react";
import { money } from "@nova/shared";
import { api } from "../session.js";
import { Button, Card, ErrorBox, Icon, PoweredBy, Spinner, usePoll } from "../ui.jsx";
import { RangeChips } from "./History.jsx";

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-3 last:border-0">
      <dt className="text-sm opacity-80">{label}</dt>
      <dd className="font-display text-lg font-extrabold">{value}</dd>
    </div>
  );
}

export default function Profile({ session, shop, onSignOut }) {
  const [range, setRange] = useState("30d");
  const q = usePoll(() => api.get("/v2/delivery/summary", { query: { range } }), 0, [range]);
  const brand = (shop && shop.brand) || {};
  const s = q.data;

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand text-brand-on"><Icon name="bike" className="h-7 w-7" /></span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-extrabold">{session.email || "Delivery partner"}</p>
          <p className="truncate text-sm opacity-80">{brand.name || session.tenant}</p>
          <p className="truncate text-xs opacity-60">Restaurant code: {session.tenant}</p>
        </div>
      </Card>

      <section aria-label="Earnings">
        <h2 className="mb-2 font-display text-base font-bold">Earnings summary</h2>
        <RangeChips range={range} onChange={setRange} />
        <Card className="mt-3">
          {q.error ? <ErrorBox message={q.error.message} onRetry={q.reload} /> : null}
          {q.loading && !s ? <div className="flex justify-center py-6"><Spinner className="h-6 w-6" /></div> : null}
          {s ? (
            <dl>
              <Row label="Deliveries" value={s.deliveries} />
              <Row label="Distance" value={`${s.distance_km} km`} />
              <Row label="Cash collected" value={money(s.cash_collected)} />
              <Row label="Earnings" value={s.earnings_configured ? money(s.earnings) : "Not set up"} />
            </dl>
          ) : null}
          {s && !s.earnings_configured ? (
            <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">The restaurant has not set delivery pay rates yet, so earnings cannot be shown. Ask the owner to set them. Deliveries, distance and cash are still counted.</p>
          ) : null}
          {s && s.earnings_configured ? <p className="mt-3 text-xs opacity-70">Earnings are an estimate from the restaurant's pay rates. Payouts are not handled in this app.</p> : null}
        </Card>
      </section>

      <Button kind="line" className="w-full" onClick={onSignOut}><Icon name="out" />Sign out</Button>
      <PoweredBy className="pt-4" />
    </div>
  );
}
