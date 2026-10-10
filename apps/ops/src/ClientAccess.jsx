import { useState } from "react";
import { CopyButton, CopyRow, Card, Notice, Qr, Icon } from "./ui";

export function clientMessage({ name, slug, ownerEmail, token, admin, storefront }) {
  return [
    `Hello! ${name} is now set up on Nova.`,
    "",
    "To get started you need three things:",
    `1. Your restaurant code: ${slug}`,
    `2. Your one-time sign-up code: ${token}`,
    `3. Your admin page: ${admin}`,
    "",
    `Open the admin page, enter the restaurant code, and use your e-mail (${ownerEmail}) with the sign-up code to choose your own password. The code works only once.`,
    "",
    `Your customers can order here: ${storefront}`,
    "",
    "If you need any help, just reply to this message. - Team Nova",
  ].join("\n");
}

/** Everything the client needs, ready to copy or send. Used after creating a restaurant and after making a new sign-up code. */
export default function ClientAccess({ name, slug, ownerEmail, token, links }) {
  const text = clientMessage({ name, slug, ownerEmail, token, admin: links.admin, storefront: links.storefront });
  const [msg, setMsg] = useState(text);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <CopyRow label="Restaurant code" value={slug} hint="The client types this when signing in." />
        <CopyRow label="One-time sign-up code" value={token} hint="Shown only now. It works once." />
        <CopyRow label="Ordering page for customers" value={links.storefront} mono={false} />
        <CopyRow label="Web admin for the client" value={links.admin} mono={false} />
      </div>
      <Notice tone="warn" title="Save the sign-up code now">
        For safety the sign-up code is shown only on this screen. If you lose it, open the restaurant, go to Access and make a new one.
      </Notice>
      <Card>
        <h3 className="font-display text-lg font-bold">Message to send to the client</h3>
        <p className="mb-2 text-[14px] text-ink/75">You can change the words before sending.</p>
        <label htmlFor="client-msg" className="sr-only">Message to the client</label>
        <textarea id="client-msg" value={msg} onChange={(e) => setMsg(e.target.value)} rows={13} className="w-full rounded-xl border border-line bg-white p-3 text-[15px]" />
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={msg} label="Copy message" done="Message copied" />
          <a href={"https://wa.me/?text=" + encodeURIComponent(msg)} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1B7F4B] px-4 text-[15px] font-semibold text-white hover:opacity-90">
            <Icon name="send" className="h-4 w-4" />Open in WhatsApp
          </a>
        </div>
      </Card>
      <Card className="flex flex-wrap items-center gap-5">
        <Qr text={links.storefront} name={`${slug}-ordering-page`} />
        <div className="min-w-[200px] flex-1">
          <h3 className="font-display text-lg font-bold">QR code for the ordering page</h3>
          <p className="text-[14px] text-ink/75">Print it for tables and the counter. Customers scan it with their phone camera to order.</p>
        </div>
      </Card>
    </div>
  );
}
