import { useState } from "react";
import { api } from "../session.js";
import { useApp } from "../ctx.js";
import { Button, Card, Empty, ErrorBox, Field, Icon, inputCls, Sheet, Spinner, useToast, usePoll } from "../ui.jsx";
import { SubHeader } from "../ui-extra.jsx";

const ROLES = [["manager", "Manager"], ["cashier", "Cashier"], ["captain", "Captain"], ["kitchen", "Kitchen"], ["delivery", "Delivery partner"], ["viewer", "Viewer"]];
const roleName = (r) => (r === "owner" ? "Owner" : (ROLES.find((x) => x[0] === r) || [0, r])[1]);

function InviteSheet({ onClose, onDone }) {
  const { session } = useApp();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("cashier");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [token, setToken] = useState("");

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api.post("/v2/users", { email: email.trim(), name: name.trim(), role });
      setToken(r.invite_token);
      await onDone();
    } catch (ex) { setErr(ex.code === "USER_EXISTS" ? "Someone with this email already exists." : ex.message); } finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(token); toast("Invite token copied", "good"); } catch { toast("Press and hold the token to copy it", "info"); }
  }

  if (token) {
    return (
      <Sheet open onClose={onClose} title="Invite created">
        <div className="space-y-4">
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">No email or message is sent yet. Give this token to {name || email} yourself. It is shown only now.</p>
          <div>
            <p className="mb-1 text-sm font-semibold">Invite token</p>
            <p data-testid="invite-token" className="break-all rounded-xl border border-line bg-brand-soft p-3 font-mono text-sm select-all">{token}</p>
          </div>
          <p className="text-sm opacity-80">They use it with the restaurant code <b>{session.tenant}</b> to set their password. The token expires after 72 hours.</p>
          <div className="flex gap-2">
            <Button kind="line" className="flex-1" onClick={copy}><Icon name="copy" className="h-4 w-4" />Copy token</Button>
            <Button className="flex-1" onClick={onClose}>Done</Button>
          </div>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title="Invite staff">
      <form onSubmit={send} className="space-y-4" noValidate>
        <Field label="Email" id="iemail"><input id="iemail" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoCapitalize="none" required /></Field>
        <Field label="Name" id="iname"><input id="iname" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <Field label="Role" id="irole"><select id="irole" className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
        {err ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{err}</p> : null}
        <Button type="submit" className="w-full" busy={busy} disabled={!/^\S+@\S+\.\S+$/.test(email)}>Create invite</Button>
      </form>
    </Sheet>
  );
}

function EditSheet({ user, me, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || "");
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isOwner = user.role === "owner";

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const body = {};
      if (name !== user.name) body.name = name.trim();
      if (phone !== (user.phone || "")) body.phone = phone;
      if (!isOwner && role !== user.role) body.role = role;
      if (!isOwner && status !== user.status) body.status = status;
      if (!Object.keys(body).length) { onClose(); return; }
      await api.patch(`/v2/users/${user.id}`, body);
      toast(`${user.name || user.email} updated`, "good");
      await onSaved();
    } catch (ex) { setErr(ex.status === 403 ? (ex.code === "OWNER_PROTECTED" ? "The owner account cannot be changed here." : "You are not allowed to change staff.") : ex.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={user.name || user.email}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <p className="text-sm opacity-80">{user.email}</p>
        <Field label="Name" id="uname"><input id="uname" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <Field label="Mobile number" id="uphone" hint="Digits only. Riders' numbers show to customers on delivery."><input id="uphone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 15))} inputMode="numeric" /></Field>
        {isOwner ? <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm">The owner's role and access cannot be changed.</p> : (
          <>
            <Field label="Role" id="urole"><select id="urole" className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
            {user.id !== me ? (
              <label className="flex min-h-[44px] items-center gap-3 font-semibold">
                <input type="checkbox" checked={status === "disabled"} onChange={(e) => setStatus(e.target.checked ? "disabled" : "active")} className="h-6 w-6 accent-[rgb(var(--accent))]" />
                Disabled (cannot sign in)
              </label>
            ) : null}
            {role !== user.role || status !== user.status ? <p className="text-xs text-warn">Changing the role or disabling signs this person out on every device.</p> : null}
          </>
        )}
        {err ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{err}</p> : null}
        <Button type="submit" className="w-full" busy={busy}>Save</Button>
      </form>
    </Sheet>
  );
}

export function Staff({ onBack }) {
  const { can, session } = useApp();
  const q = usePoll(() => api.get("/v2/users"), 0, []);
  const [sheet, setSheet] = useState(null);
  const manage = can("users.manage");
  return (
    <div className="space-y-3">
      <SubHeader title="Staff" onBack={onBack} right={manage ? <Button className="!min-h-[44px]" onClick={() => setSheet({ kind: "invite" })}><Icon name="plus" className="h-4 w-4" />Invite</Button> : null} />
      {q.error ? <ErrorBox message={q.error.status === 403 ? "You are not allowed to see staff." : q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div> : null}
      {q.data && !q.data.length ? <Empty icon="user" title="No staff yet" /> : null}
      <ul className="space-y-2">
        {(q.data || []).map((u) => (
          <li key={u.id}>
            <Card className="flex items-center gap-3 !p-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft font-display font-extrabold text-brand">{(u.name || u.email).slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{u.name || u.email}</p>
                <p className="truncate text-xs opacity-70">{u.email}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-bold">{roleName(u.role)}</p>
                <p className={`text-xs font-semibold ${u.status === "active" ? "text-good" : "text-bad"}`}>{u.status === "active" ? "Active" : u.status}</p>
              </div>
              {manage ? <button type="button" onClick={() => setSheet({ kind: "edit", user: u })} aria-label={`Edit ${u.name || u.email}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full"><Icon name="edit" /></button> : null}
            </Card>
          </li>
        ))}
      </ul>
      {!manage ? <p className="text-xs opacity-70">Only the owner can invite or change staff.</p> : null}
      {sheet && sheet.kind === "invite" ? <InviteSheet onClose={() => setSheet(null)} onDone={q.reload} /> : null}
      {sheet && sheet.kind === "edit" ? <EditSheet user={sheet.user} me={session.userId} onClose={() => setSheet(null)} onSaved={async () => { setSheet(null); await q.reload(); }} /> : null}
    </div>
  );
}
