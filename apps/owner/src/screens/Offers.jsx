import { useState } from "react";
import { dateOf, money, toPaise } from "@nova/shared";
import { api } from "../session.js";
import { useApp } from "../ctx.js";
import { Button, Card, Empty, ErrorBox, Field, Icon, inputCls, Sheet, Spinner, Switch, useToast, usePoll } from "../ui.jsx";
import { ConfirmSheet, Segmented, SubHeader } from "../ui-extra.jsx";

const rupees = (s) => (String(s).trim() === "" ? null : Number(String(s).replace(/[,\s₹]/g, "")));

function describe(c) {
  const v = c.kind === "pct" ? `${c.value}% off` : `${money(c.value)} off`;
  const bits = [v];
  if (c.min_subtotal) bits.push(`on ${money(c.min_subtotal)}+`);
  if (c.kind === "pct" && c.max_discount) bits.push(`up to ${money(c.max_discount)}`);
  return bits.join(" ");
}

function CreateSheet({ onClose, onSaved }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("pct");
  const [value, setValue] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const v = rupees(value);
  const valueOk = v !== null && Number.isFinite(v) && v > 0 && (kind === "amount" || v <= 100);
  const codeOk = /^[A-Za-z0-9]{3,20}$/.test(code);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const body = { code: code.toUpperCase(), title: title.trim(), kind, value: kind === "pct" ? v : toPaise(v), active: true };
      const m = rupees(min);
      if (m) body.min_subtotal = toPaise(m);
      const mx = rupees(max);
      if (kind === "pct" && mx) body.max_discount = toPaise(mx);
      if (until) body.valid_to = `${until}T23:59:59+05:30`;
      await api.post("/v2/coupons", body);
      toast(`Offer ${body.code} created`, "good");
      await onSaved();
    } catch (ex) { setErr(ex.code === "COUPON_EXISTS" ? "That code is already used. Pick another." : ex.status === 403 ? "You are not allowed to create offers." : ex.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title="New offer">
      <form onSubmit={save} className="space-y-4" noValidate>
        <Field label="Code" id="ccode" hint="Letters and numbers, 3 to 20. Customers type this at checkout." error={code && !codeOk ? "Use 3 to 20 letters or numbers" : ""}>
          <input id="ccode" className={`${inputCls} uppercase`} value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, ""))} maxLength={20} autoCapitalize="characters" />
        </Field>
        <Field label="Title (optional)" id="ctitle"><input id="ctitle" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="10% off your order" /></Field>
        <Segmented label="Kind" value={kind} onChange={setKind} options={[["pct", "Percent off"], ["amount", "Rupees off"]]} />
        <Field label={kind === "pct" ? "Percent (1 to 100)" : "Amount off (₹)"} id="cvalue" error={value && !valueOk ? (kind === "pct" ? "Enter a number from 1 to 100" : "Enter an amount above zero") : ""}>
          <input id="cvalue" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum order (₹)" id="cmin"><input id="cmin" className={inputCls} value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" placeholder="0" /></Field>
          {kind === "pct" ? <Field label="Max discount (₹)" id="cmax"><input id="cmax" className={inputCls} value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" placeholder="No limit" /></Field> : <div />}
        </div>
        <Field label="Valid until (optional)" id="cuntil"><input id="cuntil" type="date" className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        {err ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{err}</p> : null}
        <Button type="submit" className="w-full" busy={busy} disabled={!codeOk || !valueOk}>Create offer</Button>
      </form>
    </Sheet>
  );
}

export function Offers({ onBack }) {
  const { can } = useApp();
  const toast = useToast();
  const q = usePoll(() => api.get("/v2/coupons"), 0, []);
  const [create, setCreate] = useState(false);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState("");
  const edit = can("coupons.edit");

  async function toggle(c, active) {
    setBusy(c.id);
    try { await api.patch(`/v2/coupons/${c.id}`, { active }); await q.reload(); } catch (e) { toast(e.message, "bad"); } finally { setBusy(""); }
  }
  async function remove() {
    setBusy("del");
    try { await api.del(`/v2/coupons/${del.id}`); toast(`Offer ${del.code} deleted`); setDel(null); await q.reload(); } catch (e) { toast(e.message, "bad"); } finally { setBusy(""); }
  }
  return (
    <div className="space-y-3">
      <SubHeader title="Offers" onBack={onBack} right={edit ? <Button className="!min-h-[44px]" onClick={() => setCreate(true)}><Icon name="plus" className="h-4 w-4" />New</Button> : null} />
      {q.error ? <ErrorBox message={q.error.status === 403 ? "You are not allowed to see offers." : q.error.message} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <div className="flex justify-center py-8"><Spinner className="h-7 w-7" /></div> : null}
      {q.data && !q.data.length ? <Empty icon="tag" title="No offers yet" hint={edit ? "Create a code customers can use at checkout." : undefined} /> : null}
      <ul className="space-y-2">
        {(q.data || []).map((c) => (
          <li key={c.id}>
            <Card className="!p-3" data-testid={`coupon-${c.code}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-extrabold tracking-wide">{c.code}</p>
                  <p className="text-sm">{describe(c)}</p>
                  {c.title ? <p className="truncate text-xs opacity-70">{c.title}</p> : null}
                  {c.valid_to ? <p className="text-xs opacity-60">Until {dateOf(c.valid_to)}</p> : null}
                </div>
                <Switch checked={c.active !== false} disabled={!edit || busy === c.id} label={`${c.code} active`} onChange={(v) => toggle(c, v)} />
              </div>
              {edit ? <button type="button" onClick={() => setDel(c)} className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-bad"><Icon name="trash" className="h-4 w-4" />Delete</button> : null}
            </Card>
          </li>
        ))}
      </ul>
      {create ? <CreateSheet onClose={() => setCreate(false)} onSaved={async () => { setCreate(false); await q.reload(); }} /> : null}
      <ConfirmSheet open={!!del} onClose={() => setDel(null)} danger busy={busy === "del"} onConfirm={remove} title="Delete this offer?" confirmLabel="Delete" message={del ? `${del.code} will stop working straight away.` : ""} />
    </div>
  );
}
