"use strict";
/* POS & billing screen wired to /v2/pos. Server owns every total; this file only shows and asks. */
const P = { ready: false, bills: [], cur: null, menu: [], cat: "All", q: "", xl: localStorage.getItem("nova_xl") === "1", paying: false, pay: [{ mode: "cash", amt: "" }], disc: { kind: "pct", v: "" }, idem: {}, busy: false, autoPrint: localStorage.getItem("nova_autoprint") !== "0" };
const REASONS = ["Customer changed mind", "Wrong item", "Food quality", "Staff error", "Duplicate order"];
const layer = () => $("#layer");

const B = () => P.bills.find((b) => b.id === P.cur) || null;
const dueOf = (b) => Math.max(0, b ? b.balance : 0);
function setBill(nb) {
  const i = P.bills.findIndex((b) => b.id === nb.id);
  if (nb.status !== "open") { if (i >= 0) P.bills.splice(i, 1); if (P.cur === nb.id) P.cur = P.bills[0]?.id || null; } else if (i >= 0) P.bills[i] = nb; else P.bills.push(nb);
}

/* ---------------- modals ---------------- */
function modal(html, onMount) {
  return new Promise((resolve) => {
    const el = document.createElement("div"); el.className = "mod"; el.innerHTML = `<div role="dialog" aria-modal="true">${html}</div>`;
    const close = (v) => { el.remove(); resolve(v); };
    el.addEventListener("click", (e) => { if (e.target === el) close(null); const c = e.target.closest("[data-close]"); if (c) close(c.dataset.close === "ok" ? true : null); });
    layer().append(el); onMount && onMount(el, close);
    const f = el.querySelector("[autofocus],input,select,textarea,button"); f && f.focus();
  });
}

function askReason(title) {
  return modal(`<h3>${esc(title)}</h3><div class="chipset">${REASONS.map((r) => `<button type="button" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div>
    <label class="f">Or write the reason<input id="rs" class="inp" maxlength="200" autocomplete="off"></label>
    <div class="row" style="margin-top:14px"><button class="btn" data-close>Cancel</button><div class="sp"></div><button class="btn pri" id="rok">Continue</button></div>`, (el, close) => {
    el.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => { el.querySelector("#rs").value = b.dataset.r; }));
    const go = () => { const v = el.querySelector("#rs").value.trim(); if (v.length >= 3) close(v); else el.querySelector("#rs").focus(); };
    el.querySelector("#rok").addEventListener("click", go); el.querySelector("#rs").addEventListener("keydown", (e) => e.key === "Enter" && go());
  });
}

function askApproval(permission, why, billId) {
  return modal(`<h3>Manager approval needed</h3><p class="sub">${esc(why)}</p>
    <label class="f">Manager PIN<input id="pin" class="inp" type="password" inputmode="numeric" maxlength="6" autocomplete="off" autofocus></label>
    <div class="err" id="perr"></div>
    <div class="row" style="margin-top:8px"><button class="btn" data-close>Cancel</button><div class="sp"></div><button class="btn pri" id="pok">Approve</button></div>`, (el, close) => {
    const go = async () => {
      try {
        const r = await api("POST", "/v2/pos/approvals", { pin: el.querySelector("#pin").value, permission, bill_id: billId || "" });
        close(r.approval_token);
      } catch (e) { el.querySelector("#perr").textContent = e.message; el.querySelector("#pin").value = ""; el.querySelector("#pin").focus(); }
    };
    el.querySelector("#pok").addEventListener("click", go); el.querySelector("#pin").addEventListener("keydown", (e) => e.key === "Enter" && go());
  });
}

/* run an action; if the server says a manager must approve it, ask for the PIN and run it again with the token */
async function guarded(fn, billId) {
  try { return await fn(undefined); } catch (e) {
    if (e.code === "APPROVAL_REQUIRED" && e.detail.permission) {
      const tok = await askApproval(e.detail.permission, e.message, billId);
      if (!tok) return null;
      return await fn(tok);
    }
    throw e;
  }
}
const attempt = async (fn) => { try { P.busy = true; return await fn(); } catch (e) { if (e.code === "STALE_BILL") { await refreshBills(); toast(e.message); } else toast(e.message, 4000); return null; } finally { P.busy = false; } };

/* ---------------- data ---------------- */
async function refreshBills() {
  P.bills = await api("GET", "/v2/pos/bills?status=open&limit=50");
  P.bills.sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!B()) P.cur = P.bills[0]?.id || null;
  renderPage();
}
async function initPos() {
  if (!P.ready) { P.menu = await api("GET", "/v2/pos/menu"); P.ready = true; }
  await refreshBills();
  if (!P.bills.length && RULES.permissions.includes("bills.create")) await newBill();
}
async function newBill() {
  const b = await attempt(() => api("POST", "/v2/pos/bills", { type: "Dine-in", table: RULES.tables[0] }));
  if (b) { P.bills.push(b); P.cur = b.id; P.paying = false; P.pay = [{ mode: "cash", amt: "" }]; renderPage(); }
}

/* ---------------- printing ---------------- */
async function printJob(job, label) {
  try { await agent.send(job); toast(label + " sent to the printer"); } catch (e) { toast(e.message, 5000); }
  updateAgentPill();
}
async function printReceipt(b) {
  const j = await attempt(() => api("POST", `/v2/pos/bills/${b.id}/print`, {}));
  if (j) await printJob(j, j.duplicate ? "Duplicate bill" : "Bill");
}

/* ---------------- actions ---------------- */
const need = (p) => RULES.role === "owner" || RULES.permissions.includes(p);
const ACT = {
  async cat(v) { P.cat = v; renderPage(); },
  async add(v) {
    const b = B(); if (!b) return;
    const nb = await attempt(() => api("POST", `/v2/pos/bills/${b.id}/lines`, { item_id: v, qty: 1, revision: b.revision }));
    if (nb) { setBill(nb); renderPage(); }
  },
  async tab(v) { P.cur = v; P.paying = false; P.pay = [{ mode: "cash", amt: "" }]; renderPage(); },
  async nbill() { if (P.bills.length >= 6) return toast("Finish or void a bill first. Up to 6 can stay open."); await newBill(); },
  async inc(v) { await lineQty(v, +1); },
  async dec(v) { await lineQty(v, -1); },
  async note(v) {
    const b = B(), ln = b.lines.find((l) => l.lid === v);
    const QUICK = ["Less spicy", "Extra spicy", "No onion", "No garlic", "Less oil", "Pack separately", "Serve first"];
    const val = await modal(`<h3>Note for ${esc(ln.name)}</h3><div class="chipset">${QUICK.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <label class="f">The kitchen will read this<input id="nt" class="inp" maxlength="140" value="${esc(ln.note)}" autocomplete="off" autofocus></label>
      <div class="row" style="margin-top:14px"><button class="btn" data-close>Cancel</button><div class="sp"></div><button class="btn pri" id="nok">Save note</button></div>`, (el, close) => {
      el.querySelectorAll("[data-q]").forEach((x) => x.addEventListener("click", () => { const i = el.querySelector("#nt"); i.value = (i.value ? i.value + ", " : "") + x.dataset.q; }));
      el.querySelector("#nok").addEventListener("click", () => close(el.querySelector("#nt").value));
      el.querySelector("#nt").addEventListener("keydown", (e) => e.key === "Enter" && close(el.querySelector("#nt").value));
    });
    if (val === null) return;
    const nb = await attempt(() => api("PATCH", `/v2/pos/bills/${b.id}/lines/${v}`, { note: val, revision: b.revision }));
    if (nb) { setBill(nb); renderPage(); }
  },
  async type(v) { await header({ type: v }); },
  async clear() {
    const b = B(); if (!b || !b.lines.length) return;
    for (const ln of [...b.lines]) { const nb = await attempt(() => guarded(async (tok) => api("PATCH", `/v2/pos/bills/${b.id}/lines/${ln.lid}`, { qty: 0, reason: "Cleared bill", approval_token: tok }), b.id)); if (nb) setBill(nb); else break; }
    renderPage();
  },
  async discount() {
    const b = B(); if (!b) return;
    const cur = b.discount;
    const body = await modal(`<h3>Discount on bill ${b.bill_no}</h3><div class="row"><input id="dv" class="inp" style="flex:1" inputmode="decimal" placeholder="0" value="${cur ? (cur.kind === "amount" ? cur.value / 100 : cur.value) : ""}" autofocus>
      <button class="chip" style="min-height:46px;padding:0 16px" id="dk1" aria-pressed="${!cur || cur.kind === "pct"}">%</button><button class="chip" style="min-height:46px;padding:0 16px" id="dk2" aria-pressed="${cur && cur.kind === "amount"}">₹</button></div>
      <p class="sub">Your limit: ${RULES.limits.discount_max_pct === null ? "none" : RULES.limits.discount_max_pct + "%"}. Above it, a manager types their PIN.</p>
      <div class="row" style="margin-top:14px"><button class="btn" data-close>Cancel</button>${cur ? '<button class="btn" id="drm">Remove discount</button>' : ""}<div class="sp"></div><button class="btn pri" id="dok">Apply</button></div>`, (el, close) => {
      let kind = !cur || cur.kind === "pct" ? "pct" : "amount";
      const set = (k) => { kind = k; el.querySelector("#dk1").setAttribute("aria-pressed", k === "pct"); el.querySelector("#dk2").setAttribute("aria-pressed", k === "amount"); };
      el.querySelector("#dk1").addEventListener("click", () => set("pct")); el.querySelector("#dk2").addEventListener("click", () => set("amount"));
      const ok = () => { const v = parseFloat(el.querySelector("#dv").value || "0") || 0; close({ kind, value: kind === "amount" ? PAISE(v) : v }); };
      el.querySelector("#dok").addEventListener("click", ok); el.querySelector("#dv").addEventListener("keydown", (e) => e.key === "Enter" && ok());
      const rm = el.querySelector("#drm"); if (rm) rm.addEventListener("click", () => close({ kind: "pct", value: 0 }));
    });
    if (!body) return;
    let reason = "";
    if (RULES.reasons_required.includes("discount") && body.value) { reason = await askReason("Why this discount?"); if (!reason) return; }
    const nb = await attempt(() => guarded(async (tok) => api("PUT", `/v2/pos/bills/${b.id}/discount`, { ...body, reason, approval_token: tok, revision: b.revision }), b.id));
    if (nb) { setBill(nb); renderPage(); toast(body.value ? "Discount applied" : "Discount removed"); }
  },
  async kot() {
    const b = B(); if (!b) return;
    const r = await attempt(() => api("POST", `/v2/pos/bills/${b.id}/kot`, {}));
    if (!r) return;
    setBill(r.bill); renderPage(); toast("Sent to the kitchen");
    for (const j of r.prints) await printJob(j, "Kitchen ticket (" + j.station + ")");
  },
  async print() { const b = B(); if (b) await printReceipt(b); },
  async addpay() { P.pay.push({ mode: "upi", amt: "" }); renderPage(); },
  async delpay(v) { P.pay.splice(+v, 1); if (!P.pay.length) P.pay = [{ mode: "cash", amt: "" }]; renderPage(); },
  async paymode(v) { const [i, m] = v.split(":"); P.pay[+i].mode = m; if (m !== "cash") { /* exact for UPI/card */ } renderPage(); },
  async tend(v) { const [i, amt] = v.split(":"); P.pay[+i].amt = String(amt === "exact" ? dueOf(B()) / 100 : amt); renderPage(); },
  async size() { P.xl = !P.xl; localStorage.setItem("nova_xl", P.xl ? "1" : "0"); renderPage(); },
  async autoprint() { P.autoPrint = !P.autoPrint; localStorage.setItem("nova_autoprint", P.autoPrint ? "1" : "0"); renderPage(); },
  async openpay() { const b = B(); if (!b || !b.lines.length || dueOf(b) <= 0) return; P.paying = true; P.pay = [{ mode: "cash", amt: "" }]; renderPage(); },
  async backpay() { P.paying = false; renderPage(); },
  async collect() {
    const b = B(); if (!b || !b.lines.length || P.busy) return;
    const due = dueOf(b);
    const rows = P.pay.map((r, i) => ({ mode: r.mode, amount: r.amt === "" ? (i === 0 && P.pay.length === 1 ? due : 0) : PAISE(r.amt) })).filter((r) => r.amount > 0);
    if (!rows.length) return toast("Enter how much the customer is giving");
    const total = rows.reduce((a, r) => a + r.amount, 0);
    if (total < due) return toast(`Still ${RS(due - total)} to collect`);
    P.idem[b.id] = P.idem[b.id] || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    const nb = await attempt(() => api("POST", `/v2/pos/bills/${b.id}/pay`, { payments: rows }, { "Idempotency-Key": P.idem[b.id] }));
    if (!nb) return;
    delete P.idem[b.id];
    const change = nb.payments.reduce((a, p) => a + p.change, 0);
    setBill(nb); P.paying = false; P.pay = [{ mode: "cash", amt: "" }];
    toast(`Bill ${nb.bill_no} paid` + (change ? ` · give back ${RS(change)}` : ""), 5000);
    if (P.autoPrint && agent.online) printReceipt(nb);
    if (!P.bills.length) await newBill(); else renderPage();
  },
  async split() {
    const b = B(); if (!b || b.lines.length < 1) return;
    const picks = {};
    const html = `<h3>Split bill ${b.bill_no}</h3><p class="sub">Choose what moves to a new bill, for guests who pay separately.</p>
      ${b.lines.map((l) => `<div class="ln" style="grid-template-columns:1fr auto"><div><b>${esc(l.name)}</b>${l.note ? `<span class="note">${esc(l.note)}</span>` : ""}<small>${RS(l.price)} each · on bill: ${l.qty}</small></div>
        <div class="qty"><button type="button" data-s="${l.lid}:-1">−</button><span id="sq-${l.lid}">0</span><button type="button" data-s="${l.lid}:1">+</button></div></div>`).join("")}
      <div class="err" id="serr"></div><div class="row" style="margin-top:14px"><button class="btn" data-close>Cancel</button><div class="sp"></div><button class="btn pri" id="sok">Move to new bill</button></div>`;
    const res = await modal(html, (el, close) => {
      el.querySelectorAll("[data-s]").forEach((x) => x.addEventListener("click", () => {
        const [lid, d] = x.dataset.s.split(":"); const l = b.lines.find((q) => q.lid === lid);
        picks[lid] = Math.max(0, Math.min(l.qty, (picks[lid] || 0) + +d)); el.querySelector("#sq-" + lid).textContent = picks[lid];
      }));
      el.querySelector("#sok").addEventListener("click", () => { const p = Object.entries(picks).filter(([, q]) => q > 0).map(([lid, qty]) => ({ lid, qty })); if (!p.length) el.querySelector("#serr").textContent = "Pick at least one item"; else close(p); });
    });
    if (!res) return;
    const r = await attempt(() => api("POST", `/v2/pos/bills/${b.id}/split`, { picks: res, revision: b.revision }));
    if (r) { setBill(r.bill); setBill(r.new_bill); P.cur = r.new_bill.id; renderPage(); toast(`Moved to bill ${r.new_bill.bill_no}`); }
  },
  async void() {
    const b = B(); if (!b) return;
    const reason = await askReason(`Void bill ${b.bill_no}?`); if (!reason) return;
    const nb = await attempt(() => guarded(async (tok) => api("POST", `/v2/pos/bills/${b.id}/void`, { reason, approval_token: tok }), b.id));
    if (nb) { setBill(nb); toast(`Bill ${nb.bill_no} voided`); if (!P.bills.length) await newBill(); else renderPage(); }
  },
  async recent() {
    const paid = await attempt(() => api("GET", "/v2/pos/bills?status=paid&limit=30")) || [];
    await modal(`<div class="row sb"><h3>Paid bills</h3><button class="btn sm" data-close>Close</button></div>
      <div class="tw"><table><thead><tr><th>Bill</th><th>Type</th><th class="r">Total</th><th></th></tr></thead><tbody>${paid.map((b) => `<tr><td>#${b.bill_no}</td><td>${esc(b.type)}${b.table ? " · " + esc(b.table) : ""}</td><td class="r mono">${RS(b.totals.total)}</td>
        <td><button class="btn sm" data-rp="${b.id}">Reprint</button> <button class="btn sm" data-ro="${b.id}">Edit</button> <button class="btn sm" data-rf="${b.id}">Refund</button></td></tr>`).join("") || `<tr><td colspan="4" class="sub">No paid bills yet today.</td></tr>`}</tbody></table></div>`, (el, close) => {
      el.addEventListener("click", async (e) => {
        const t = e.target.closest("button[data-rp],button[data-ro],button[data-rf]"); if (!t) return;
        const b = paid.find((x) => x.id === (t.dataset.rp || t.dataset.ro || t.dataset.rf));
        close(null);
        if (t.dataset.rp) await printReceipt(b);
        if (t.dataset.ro) {
          const reason = await askReason(`Reopen bill ${b.bill_no} to edit?`); if (!reason) return;
          const nb = await attempt(() => guarded(async (tok) => api("POST", `/v2/pos/bills/${b.id}/reopen`, { reason, approval_token: tok }), b.id));
          if (nb) { setBill(nb); P.cur = nb.id; renderPage(); toast(`Bill ${nb.bill_no} is open for editing`); }
        }
        if (t.dataset.rf) await refundFlow(b);
      });
    });
  },
};
async function refundFlow(b) {
  const max = b.paid;
  const body = await modal(`<h3>Refund bill ${b.bill_no}</h3><p class="sub">Paid so far: ${RS(max)}</p>
    <label class="f">Amount to return (₹)<input id="ra" class="inp" inputmode="decimal" value="${(max / 100).toString()}"></label>
    <label class="f">How<select id="rm" class="inp"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></label>
    <div class="row" style="margin-top:14px"><button class="btn" data-close>Cancel</button><div class="sp"></div><button class="btn pri" id="rok">Continue</button></div>`, (el, close) => {
    el.querySelector("#rok").addEventListener("click", () => close({ amount: PAISE(el.querySelector("#ra").value), mode: el.querySelector("#rm").value }));
  });
  if (!body || body.amount <= 0) return;
  const reason = await askReason("Why is this refunded?"); if (!reason) return;
  const nb = await attempt(() => guarded(async (tok) => api("POST", `/v2/pos/bills/${b.id}/refund`, { ...body, reason, approval_token: tok }), b.id));
  if (nb) toast(`Refunded ${RS(body.amount)} on bill ${nb.bill_no}`);
}
async function lineQty(lid, d) {
  const b = B(); const ln = b.lines.find((l) => l.lid === lid); if (!ln) return;
  const q = Math.max(0, ln.qty + d);
  const reason = q < ln.kot_qty && RULES.reasons_required.includes("void_item") ? await askReason(`Remove ${ln.name} from the kitchen order?`) : "";
  if (q < ln.kot_qty && !reason) return;
  const nb = await attempt(() => guarded(async (tok) => api("PATCH", `/v2/pos/bills/${b.id}/lines/${lid}`, { qty: q, reason, approval_token: tok, revision: b.revision }), b.id));
  if (nb) { setBill(nb); renderPage(); }
}
async function header(patch) {
  const b = B(); if (!b) return;
  const nb = await attempt(() => api("PATCH", `/v2/pos/bills/${b.id}`, { ...patch, revision: b.revision }));
  if (nb) { setBill(nb); renderPage(); }
}

/* ---------------- view ---------------- */
V.pos = () => {
  const b = B();
  if (!b) return head("Service", "POS & Billing") + `<div class="card"><p>${need("bills.create") ? "Opening a bill…" : "You can look at bills but not start one."}</p></div>`;
  const cats = ["All", ...new Set(P.menu.map((m) => m.category))];
  const items = P.menu.filter((m) => (P.cat === "All" || m.category === P.cat) && (!P.q || m.name.toLowerCase().includes(P.q.toLowerCase()) || String(m.code || "").startsWith(P.q)));
  const due = dueOf(b), unsent = b.lines.reduce((a, l) => a + (l.qty - l.kot_qty), 0);
  const given = P.pay.reduce((a, r) => a + PAISE(r.amt), 0);
  const cashRow = P.pay.findIndex((r) => r.mode === "cash");
  const change = cashRow >= 0 && given > due ? given - due : 0, short = given > 0 && given < due;
  return `<div class="pos ${P.xl ? "xl" : ""}">
<div class="ptop">${P.bills.map((x) => `<button class="btab" aria-pressed="${x.id === b.id}" data-a="tab" data-v="${x.id}"><b>Bill ${x.bill_no}</b><span>${esc(x.type)}${x.table ? " · " + esc(x.table) : ""} · ${RS(x.totals.total)}</span></button>`).join("")}
 ${need("bills.create") ? `<button class="btn" data-a="nbill">+ New bill</button>` : ""}<div class="sp"></div>
 <input id="psearch" class="inp" style="max-width:260px" placeholder="Search or type item code (F2)" value="${esc(P.q)}" aria-label="Search dish or code" autocomplete="off">
 <button class="btn" data-a="recent">Paid bills</button><button class="btn" data-a="size">${P.xl ? "Normal text" : "Bigger text"}</button></div>
<div class="pgrid"><div class="cats">${cats.map((k) => `<button class="cat" aria-pressed="${k === P.cat}" data-a="cat" data-v="${esc(k)}">${esc(k)}<small>${k === "All" ? P.menu.length : P.menu.filter((m) => m.category === k).length}</small></button>`).join("")}</div>
<div class="items">${items.map((m) => { const q = b.lines.filter((l) => l.item_id === m.id).reduce((a, l) => a + l.qty, 0); return `<button class="it ${m.available ? "" : "out"}" data-a="add" data-v="${m.id}"><span class="cd">${m.code || ""}</span><b>${esc(m.name)}</b><span class="pr">${RS(m.price)}</span>${q ? `<span class="qb">${q}</span>` : ""}</button>`; }).join("") || `<div class="sub" style="padding:20px">${P.menu.length ? "No dish matches your search." : "No dishes yet. Add them in Menu."}</div>`}</div>
<button class="mbar" data-a="gobill"><span>View bill · ${b.lines.reduce((a, l) => a + l.qty, 0)} items</span><span class="mono">${RS(b.totals.total)}</span></button>
<div class="billp" id="billp">${P.paying ? paySheet(b, due, given, short, change) : orderPanel(b, due, unsent)}</div></div></div></div>`;
};

function orderPanel(b, due, unsent) {
  return `<div class="sec"><div class="row sb"><b style="font:600 1.2em var(--display)">Bill ${b.bill_no}</b><span class="row">${need("bills.split") ? `<button class="btn sm" data-a="split" ${b.lines.length ? "" : "disabled"}>Split</button>` : ""}<button class="btn sm" data-a="void">Void</button></span></div>
 <div class="chips" style="margin:8px 0">${["Dine-in", "Takeaway", "Delivery"].map((t) => `<button class="chip" style="min-height:42px;padding:0 14px" aria-pressed="${b.type === t}" data-a="type" data-v="${t}">${t}</button>`).join("")}</div>
 ${b.type === "Dine-in" ? `<select id="ptable" class="inp" style="min-height:42px" aria-label="Table">${RULES.tables.map((t) => `<option ${t === b.table ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` : `<input id="pphone" class="inp" inputmode="numeric" placeholder="Customer mobile" value="${esc(b.customer.phone)}" aria-label="Customer mobile" maxlength="15">`}</div>
<div class="lines">${b.lines.length ? b.lines.map((l) => `<div class="ln"><button class="cell-btn" data-a="note" data-v="${l.lid}" aria-label="Edit note for ${esc(l.name)}"><b>${esc(l.name)}</b><small>${RS(l.price)} each ${l.kot_qty >= l.qty ? '<span class="sent">· in kitchen</span>' : l.kot_qty ? `<span class="sent">· ${l.kot_qty} in kitchen</span>` : ""}</small>${l.note ? `<span class="note">“${esc(l.note)}”</span>` : `<small class="tkn">+ add note</small>`}</button>
  <div class="qty"><button aria-label="Less" data-a="dec" data-v="${l.lid}">−</button><span>${l.qty}</span><button aria-label="More" data-a="inc" data-v="${l.lid}">+</button></div><b class="mono">${RS(l.price * l.qty)}</b></div>`).join("") : `<div class="sub" style="padding:28px 14px;text-align:center">Tap a dish to start this bill.<br>Up to 6 bills can stay open for other guests.</div>`}</div>
<div class="sec"><div class="row sb sub"><span>Subtotal</span><span class="mono">${RS(b.totals.subtotal)}</span></div>${b.totals.discount ? `<div class="row sb sub"><span>Discount</span><span class="mono">−${RS(b.totals.discount)}</span></div>` : ""}<div class="row sb sub"><span>GST ${RULES.tax.mode === "inclusive" ? "(included)" : ""}</span><span class="mono">${RS(b.totals.tax)}</span></div>
 <div class="row sb" style="margin-top:4px"><b>${b.paid ? "Due" : "Total"}</b><span class="tot">${RS(b.paid ? b.balance : b.totals.total)}</span></div></div>
<div class="sec" style="display:grid;gap:8px"><div class="row"><button class="btn" style="flex:1;justify-content:center" data-a="kot" ${unsent ? "" : "disabled"}>Send to kitchen${unsent ? " (" + unsent + ")" : ""}</button><button class="btn" data-a="discount" ${b.lines.length ? "" : "disabled"}>${b.totals.discount ? "Discount ✓" : "Discount"}</button>${need("bills.print") ? `<button class="btn" data-a="print" ${b.lines.length ? "" : "disabled"}>Print</button>` : ""}</div>
 <button class="btn pri collect" data-a="openpay" ${b.lines.length && need("bills.pay") && due > 0 ? "" : "disabled"}>${!b.lines.length ? "Add items first" : need("bills.pay") ? "Pay " + RS(due) : "Cashier collects"}</button></div>`;
}

function paySheet(b, due, given, short, change) {
  return `<div class="sec"><div class="row sb"><b style="font:600 1.2em var(--display)">Collect payment · bill ${b.bill_no}</b><button class="btn sm" data-a="backpay">Back</button></div>
 <div class="tot" style="margin-top:6px;font-size:2.4em">${RS(due)}</div></div>
<div class="lines" style="padding:6px 14px">${P.pay.map((r, i) => `<div class="prow"><select class="inp" data-pm="${i}" aria-label="Payment type"><option value="cash" ${r.mode === "cash" ? "selected" : ""}>Cash</option><option value="upi" ${r.mode === "upi" ? "selected" : ""}>UPI</option><option value="card" ${r.mode === "card" ? "selected" : ""}>Card</option></select>
  <input class="inp" inputmode="decimal" data-pa="${i}" placeholder="${P.pay.length === 1 ? RS(due).replace("₹", "") + " (exact)" : "Amount"}" value="${esc(r.amt)}" aria-label="Amount" ${i === 0 ? "autofocus" : ""}><button class="btn" data-a="delpay" data-v="${i}" aria-label="Remove payment" ${P.pay.length > 1 ? "" : "hidden"}>✕</button></div>
  ${r.mode === "cash" ? `<div class="quick" style="margin-bottom:8px"><button data-a="tend" data-v="${i}:exact">Exact</button>${[100, 200, 500, 2000].map((v) => `<button data-a="tend" data-v="${i}:${v}">₹${v}</button>`).join("")}</div>` : `<div class="sub" style="margin-bottom:8px">${r.mode === "upi" ? "Confirm after the UPI payment arrives." : "Confirm after the card is approved."}</div>`}`).join("")}
 <button class="btn sm" data-a="addpay">+ Split payment (two ways to pay)</button></div>
<div class="sec"><div class="row sb"><span class="sub">${short ? "Still to collect" : "Change to return"}</span><b class="mono" style="font-size:1.8em;color:${short ? "var(--bad)" : "var(--ok)"}">${RS(short ? due - given : change)}</b></div>
 <label class="row sub" style="gap:8px;margin-top:6px"><button class="sw" role="switch" aria-checked="${P.autoPrint}" data-a="autoprint" aria-label="Print bill after payment"></button>Print bill after payment</label></div>
<div class="sec"><button class="btn pri collect" data-a="collect" ${short ? "disabled" : ""}>Confirm payment</button></div>`;
}

/* inputs that must not re-render on every keystroke */
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "psearch") { P.q = el.value; renderPage(); const n = $("#psearch"); n.focus(); n.setSelectionRange(P.q.length, P.q.length); }
    else if (el.dataset && el.dataset.pa !== undefined) P.pay[+el.dataset.pa].amt = el.value;
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "ptable") header({ table: el.value });
  else if (el.id === "pphone") header({ phone: el.value.replace(/\D/g, "") });
  else if (el.dataset && el.dataset.pm !== undefined) { P.pay[+el.dataset.pm].mode = el.value; renderPage(); }
});
document.addEventListener("keydown", (e) => {
  if (page !== "pos") return;
  if (e.target.id === "psearch" && e.key === "Enter") {
    const code = P.menu.find((m) => String(m.code) === P.q.trim() && m.available);
    const hit = code || (P.menu.filter((m) => m.available && m.name.toLowerCase().includes(P.q.toLowerCase())).length === 1 ? P.menu.find((m) => m.available && m.name.toLowerCase().includes(P.q.toLowerCase())) : null);
    if (hit) { P.q = ""; ACT.add(hit.id); }
  }
  if (e.key === "F2") { e.preventDefault(); const s = $("#psearch"); s && s.focus(); }
  if (e.key === "F4") { e.preventDefault(); P.paying ? null : ACT.openpay(); }
  if (e.key === "F9") { e.preventDefault(); ACT.kot(); }
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-a]"); if (!t || t.disabled) return;
  if (t.dataset.a === "gobill") { $("#billp")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (ACT[t.dataset.a]) ACT[t.dataset.a](t.dataset.v);
});
