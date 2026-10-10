import { useState } from "react";
import { useApp } from "../ctx.js";
import { Button, Card, Icon, PoweredBy, Switch } from "../ui.jsx";
import { Customers } from "./Customers.jsx";
import { Offers } from "./Offers.jsx";
import { Staff } from "./Staff.jsx";
import { DaySummary, Riders, Tables } from "./Misc.jsx";

export default function More({ onSignOut }) {
  const { can, role, session, shop, sound, setSound } = useApp();
  const [page, setPage] = useState(null);
  const back = () => setPage(null);

  const links = [
    can("customers.view") && ["customers", "Customers", "users", "Spend, orders, call and WhatsApp"],
    can("coupons.view") && ["offers", "Offers", "tag", "Coupon codes for online orders"],
    can("orders.view") && ["riders", "Riders", "bike", "Who is online and where"],
    can("bills.view") && ["tables", "Tables", "grid", "Free and occupied"],
    can("users.view") && ["staff", "Staff", "user", "People who can sign in"],
    can("reports.view") && ["day", "Day summary", "chart", "Sales, payments and refunds"],
  ].filter(Boolean);

  if (page === "customers") return <Customers onBack={back} />;
  if (page === "offers") return <Offers onBack={back} />;
  if (page === "riders") return <Riders onBack={back} />;
  if (page === "tables") return <Tables onBack={back} />;
  if (page === "staff") return <Staff onBack={back} />;
  if (page === "day") return <DaySummary onBack={back} />;

  const brand = (shop && shop.brand) || {};
  return (
    <div className="space-y-4">
      <Card>
        <p className="font-display text-lg font-extrabold">{brand.name || session.tenant}</p>
        <p className="text-sm opacity-80">{session.email} · <span className="capitalize">{role}</span></p>
        <p className="text-xs opacity-60">Restaurant code: {session.tenant}</p>
      </Card>
      <ul className="space-y-2">
        {links.map(([id, label, icon, sub]) => (
          <li key={id}>
            <button type="button" onClick={() => setPage(id)} className="active-press flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-left shadow-card">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={icon} /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">{label}</span><span className="block truncate text-xs opacity-70">{sub}</span></span>
              <Icon name="chev" className="h-5 w-5 opacity-50" />
            </button>
          </li>
        ))}
      </ul>
      <Card className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Sound for new orders</p>
          <p className="text-xs opacity-70">Plays a beep when an online order arrives while the app is open. Vibration is always on.</p>
        </div>
        <Switch checked={sound} onChange={setSound} label="Sound" />
      </Card>
      <Button kind="line" className="w-full" onClick={onSignOut}><Icon name="out" />Sign out</Button>
      <PoweredBy className="pt-4" />
    </div>
  );
}
