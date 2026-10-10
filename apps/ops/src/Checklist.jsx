import { href } from "./lib/router";
import { Icon, cx } from "./ui";

const HELP = {
  brand: { tab: "look", text: "Add the logo and choose colours.", cta: "Open Look & feel" },
  owner: { tab: "access", text: "Send the owner their sign-up code.", cta: "Open Access" },
  menu: { text: "The owner adds dishes in the web admin. You can help them." },
  delivery: { tab: "settings", text: "Enter the shop location so delivery distance works.", cta: "Open Settings" },
  payments: { tab: "payments", text: "Add the restaurant's Razorpay keys to take online payments.", cta: "Open Payments" },
  whatsapp: { to: "/whatsapp", text: "Connect Nova's WhatsApp number once for every restaurant.", cta: "Open WhatsApp" },
  first_order: { text: "Place a test order from the ordering page to check everything works." },
};

export default function Checklist({ items, id }) {
  return (
    <ul className="divide-y divide-line" data-testid="checklist">
      {items.map((c) => {
        const h = HELP[c.key] || {};
        const to = h.to || (h.tab ? `/restaurants/${id}/${h.tab}` : null);
        return (
          <li key={c.key} className="flex items-start gap-3 py-3">
            <span className={cx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full", c.done ? "bg-good text-white" : "border-2 border-ink/30")} aria-hidden="true">{c.done ? <Icon name="check" className="h-4 w-4" /> : null}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold"><span className="sr-only">{c.done ? "Done: " : "To do: "}</span>{c.label}</p>
              {!c.done && h.text ? <p className="text-[14px] text-ink/75">{h.text}</p> : null}
            </div>
            {!c.done && to && h.cta ? <a href={href(to)} className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3 text-[14px] font-semibold text-brand underline">{h.cta}</a> : null}
          </li>
        );
      })}
    </ul>
  );
}
