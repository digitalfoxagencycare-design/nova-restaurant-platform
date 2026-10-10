"use strict";
/* Live screens: overview, kitchen, live orders, menu, rules and printers. */
const mins = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const D = { day: null, tickets: [], bills: [], menu: [], roles: null, cfg: null, loaded: {} };
let beepOn = localStorage.getItem("nova_beep") !== "0", lastTicketIds = null;

function beep() {
  try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.25); } catch { /* sound is optional */ }
}
const guard = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, 4500); return null; } };

/* ---------------- loaders (called by the router before drawing) ---------------- */
const LOAD = {
  async home() {
    D.day = need("reports.view") ? await guard(() => api("GET", "/v2/pos/reports/day")) : null;
    D.bills = need("bills.view") ? (await guard(() => api("GET", "/v2/pos/bills?status=open&limit=100"))) || [] : [];
    D.tickets = need("kitchen.view") ? (await guard(() => api("GET", "/v2/pos/kitchen"))) || [] : [];
  },
  async kds() {
    const t = (await guard(() => api("GET", "/v2/pos/kitchen"))) || [];
    const ids = new Set(t.map((x) => x.id));
    if (lastTicketIds && beepOn && t.some((x) => !lastTicketIds.has(x.id))) beep();
    lastTicketIds = ids; D.tickets = t;
  },
  async ord() {
    D.bills = (await guard(() => api("GET", "/v2/pos/bills?status=open&limit=100"))) || [];
    D.paid = (await guard(() => api("GET", "/v2/pos/bills?status=paid&limit=20"))) || [];
    D.tickets = (await guard(() => api("GET", "/v2/pos/kitchen"))) || [];
  },
  async menu() { D.menu = (await guard(() => api("GET", "/v2/pos/menu"))) || []; },
  async rules() {
    D.cfg = need("config.view") ? await guard(() => api("GET", "/v2/tenants/me")) : null;
    D.roles = need("config.view") ? await guard(() => api("GET", "/v2/pos/roles")) : null;
  },
};

/* ---------------- overview ---------------- */
V.home = () => {
  const d = D.day, open = D.bills.length, cooking = D.tickets.filter((t) => t.status !== "ready").length;
  const late = D.tickets.filter((t) => t.status !== "ready" && mins(t.created_at) > 15).length;
  return head(esc(RULES.brand), "Today", `<button class="btn pri sm" data-go="pos">Open POS</button>`, true) +
    `<div class="grid g4">
      <div class="card kpi"><small>Sales today</small><strong>${d ? RS(d.sales) : "–"}</strong><span class="sub">${d ? d.bills_paid + " bills paid" : "Ask a manager for the day summary"}</span></div>
      <div class="card kpi"><small>Collected (after refunds)</small><strong>${d ? RS(d.net_collected) : "–"}</strong><span class="sub">${d ? Object.entries(d.by_mode).map(([k, v]) => `${esc(k)} ${RS(v)}`).join(" · ") || "Nothing yet" : ""}</span></div>
      <div class="card kpi"><small>Open bills</small><strong>${open}</strong><span class="sub">waiting for payment</span></div>
      <div class="card kpi"><small>In the kitchen</small><strong>${cooking}</strong><span class="delta ${late ? "dn" : "up"}">${late ? late + " running late" : "all on time"}</span></div></div>
    ${d ? `<div class="grid g3" style="margin-top:14px"><div class="card kpi"><small>Discounts given</small><strong>${RS(d.discounts)}</strong></div><div class="card kpi"><small>Refunds</small><strong>${RS(d.refunds)}</strong></div><div class="card kpi"><small>Voided bills</small><strong>${d.voided_bills}</strong></div></div>` : ""}
    <div class="sample-flag" style="margin-top:18px">Marketing, social, ads, traffic and WhatsApp pages are design previews with made-up numbers until each account is connected.</div>`;
};

/* ---------------- kitchen ---------------- */
V.kds = () => {
  const cols = [["new", "New", "Start cooking"], ["cooking", "Cooking", "Mark ready"], ["ready", "Ready to serve", "Served"]];
  return head("Service", "Kitchen screen", `<div class="row"><span class="sub">Sound on new ticket</span><button class="sw" role="switch" aria-checked="${beepOn}" data-kd="beep" aria-label="Sound on new ticket"></button></div>`, true) +
    `<div class="pos xl"><div class="grid g3">${cols.map(([k, n, label]) => { const L = D.tickets.filter((t) => t.status === k);
      return `<div class="card"><div class="row sb"><h3>${n}</h3><span class="pill p-mute">${L.length}</span></div><div style="margin-top:12px">${L.map((t) => { const m = mins(t.created_at);
        return `<div class="tk ${m > 15 && k !== "ready" ? "late" : ""}"><div class="row sb"><b class="mono" style="font-size:1.3em">${t.table ? esc(t.table) : "#" + t.bill_no}</b><span class="pill p-${m > 15 ? "bad" : "mute"}">${m} min</span></div>
        <div class="sub">${esc(t.type)} · bill ${t.bill_no} · ${esc(t.station)}</div><div style="margin:8px 0;font-size:1.1em">${t.lines.map((l) => `${l.qty} × ${esc(l.name)}${l.note ? `<span class="note">“${esc(l.note)}”</span>` : ""}`).join("<br>")}</div>
        ${need("kitchen.update") ? `<button class="btn ${k === "new" ? "pri" : ""}" style="width:100%;justify-content:center;min-height:54px;font-weight:700" data-kd="adv" data-v="${t.id}">${label}</button>` : ""}</div>`; }).join("") || `<div class="sub">Nothing here</div>`}</div></div>`; }).join("")}</div></div>`;
};

/* ---------------- live orders (every bill, by where it is) ---------------- */
V.ord = () => {
  const byBill = {}; D.tickets.forEach((t) => (byBill[t.bill_id] = byBill[t.bill_id] || []).push(t));
  const stage = (b) => { const t = byBill[b.id]; if (!t) return "open"; return t.every((x) => x.status === "ready") ? "ready" : "kitchen"; };
  const cols = [["open", "Taking order"], ["kitchen", "In kitchen"], ["ready", "Ready · collect payment"]];
  const card = (b, extra) => `<div class="oc ${mins(b.created_at) > 40 && b.status === "open" ? "warn" : ""}"><div class="row sb"><span class="big">#${b.bill_no}</span><span class="pill p-mute">${mins(b.created_at)} min</span></div>
    <div class="sub" style="margin:4px 0 8px">${esc(b.type)}${b.table ? " · " + esc(b.table) : ""}${b.customer.phone ? " · " + esc(b.customer.phone) : ""}</div>
    <div style="margin-bottom:8px">${b.lines.map((l) => `${l.qty} × ${esc(l.name)}${l.note ? `<span class="note">“${esc(l.note)}”</span>` : ""}`).join("<br>") || '<span class="sub">No items yet</span>'}</div>
    <div class="row sb" style="margin-bottom:10px"><b class="mono">${RS(b.totals.total)}</b>${b.paid ? `<span class="pill p-warn">${RS(b.balance)} due</span>` : ""}</div>${extra}</div>`;
  return head("Service", "Live orders", "", true) + `<div class="pos xl"><div class="board" style="grid-template-columns:repeat(3,minmax(0,1fr))">${cols.map(([k, n]) => { const L = D.bills.filter((b) => stage(b) === k);
    return `<div><div class="colh"><span>${n}</span><span class="pill p-mute">${L.length}</span></div>${L.map((b) => card(b, `<button class="btn ${k === "ready" ? "pri" : ""}" data-go="pos" data-open="${b.id}">${k === "ready" ? "Collect payment" : "Open in POS"}</button>`)).join("") || '<div class="sub">Nothing here</div>'}</div>`; }).join("")}</div>
    <h3 style="margin:22px 0 10px">Paid recently</h3><div class="card"><div class="tw"><table><thead><tr><th>Bill</th><th>Type</th><th>Paid</th><th class="r">Total</th></tr></thead><tbody>${(D.paid || []).map((b) => `<tr><td>#${b.bill_no}</td><td>${esc(b.type)}${b.table ? " · " + esc(b.table) : ""}</td><td>${b.payments.map((p) => esc(p.mode)).join(" + ")}</td><td class="r mono">${RS(b.totals.total)}</td></tr>`).join("") || '<tr><td colspan="4" class="sub">Nothing paid yet today.</td></tr>'}</tbody></table></div></div></div>`;
};

/* ---------------- menu ---------------- */
V.menu = () => head("Business", "Menu", need("menu.edit") ? `<button class="btn pri sm" data-mn="add">Add dish</button>` : "") +
  `<div class="card"><div class="tw"><table><thead><tr><th>Code</th><th>Dish</th><th>Category</th><th>Station</th><th class="r">Price</th><th>In stock</th><th></th></tr></thead><tbody>${D.menu.map((m) => `<tr><td class="mono">${m.code || ""}</td><td><b>${esc(m.name)}</b></td><td>${esc(m.category)}</td><td>${esc(m.station)}</td><td class="r mono">${RS(m.price)}</td>
  <td>${need("menu.stock") || need("menu.edit") ? `<button class="sw" role="switch" aria-checked="${m.available}" data-mn="stock" data-v="${m.id}" aria-label="In stock: ${esc(m.name)}"></button>` : m.available ? "Yes" : "No"}</td>
  <td>${need("menu.edit") ? `<button class="btn sm" data-mn="edit" data-v="${m.id}">Edit</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="sub">No dishes yet. Add your first one.</td></tr>`}</tbody></table></div></div>`;

async function menuForm(m) {
  const v = await modal(`<h3>${m ? "Edit dish" : "Add dish"}</h3>
   <label class="f">Name<input id="mn" class="inp" maxlength="80" value="${esc(m?.name)}" autofocus></label>
   <div class="row"><label class="f" style="flex:1">Price (₹)<input id="mp" class="inp" inputmode="decimal" value="${m ? m.price / 100 : ""}"></label><label class="f" style="flex:1">Code<input id="mc" class="inp" inputmode="numeric" value="${m?.code || ""}" ${m ? "disabled" : ""}></label></div>
   <div class="row"><label class="f" style="flex:1">Category<input id="mg" class="inp" maxlength="40" value="${esc(m?.category)}"></label><label class="f" style="flex:1">Kitchen station<input id="ms" class="inp" maxlength="24" value="${esc(m?.station || "kitchen")}"></label></div>
   <div class="row" style="margin-top:14px"><button class="btn" data-close>Cancel</button><div class="sp"></div><button class="btn pri" id="mok">Save</button></div>`, (el, close) => {
    el.querySelector("#mok").addEventListener("click", () => close({ name: el.querySelector("#mn").value.trim(), price: PAISE(el.querySelector("#mp").value), code: +el.querySelector("#mc").value || undefined, category: el.querySelector("#mg").value.trim(), station: el.querySelector("#ms").value.trim() || "kitchen" }));
  });
  if (!v) return;
  if (!v.name || !v.category) return toast("Name and category are needed");
  const body = m ? { name: v.name, price: v.price, category: v.category, station: v.station } : v;
  const r = await guard(() => (m ? api("PATCH", `/v2/pos/menu/${m.id}`, body) : api("POST", "/v2/pos/menu", body)));
  if (r) { P.ready = false; await LOAD.menu(); renderPage(); toast("Saved"); }
}

/* ---------------- rules and printers ---------------- */
const PERM_LABELS = {
  "bills.discount": "Give discounts", "bills.discount.override": "Discount above the limit", "bills.void_item": "Remove items already sent to the kitchen", "bills.void": "Void a bill",
  "bills.reopen": "Edit a paid bill", "bills.refund": "Refund money", "bills.reprint": "Reprint a paid bill", "bills.split": "Split bills", "menu.edit": "Change menu and prices", "menu.stock": "Mark dishes in or out of stock",
};
const LIMIT_LABELS = { discount_max_pct: ["Discount limit (%)", 1], refund_max_paise: ["Refund limit (₹)", 100], reopen_window_minutes: ["Edit paid bills for (minutes)", 1] };
const ROLE_NAMES = ["manager", "cashier", "captain"];
let RDRAFT = null;

V.rules = () => {
  const me = RULES, isOwner = me.role === "owner", cfgPos = (D.cfg && D.cfg.config.pos) || {};
  const printers = (RDRAFT && RDRAFT.printers) || cfgPos.printers || [];
  const matrix = D.roles && isOwner ? `<div class="card" style="margin-top:14px"><h3>Who can do what</h3><p class="sub">Owner always can. Turn rights on or off for each role in this restaurant.</p>
    <div class="toggle-grid"><div class="h">Action</div>${ROLE_NAMES.map((r) => `<div class="h">${r}</div>`).join("")}
    ${Object.entries(PERM_LABELS).map(([perm, label]) => `<div>${esc(label)}</div>${ROLE_NAMES.map((r) => { const on = (RDRAFT.roles[r] || []).includes(perm); return `<div><button class="sw" role="switch" aria-checked="${on}" data-rl="perm" data-role="${r}" data-perm="${perm}" aria-label="${esc(label)} for ${r}"></button></div>`; }).join("")}`).join("")}</div>
    <h3 style="margin-top:20px">Limits</h3><div class="toggle-grid"><div class="h">Limit</div>${ROLE_NAMES.map((r) => `<div class="h">${r}</div>`).join("")}
    ${Object.entries(LIMIT_LABELS).map(([k, [label, div]]) => `<div>${esc(label)}<div class="sub">blank = no limit</div></div>${ROLE_NAMES.map((r) => { const v = RDRAFT.limits[k][r]; return `<div><input class="inp" style="min-height:42px;width:100%" inputmode="numeric" data-rl="limit" data-lim="${k}" data-role="${r}" value="${v === null || v === undefined ? "" : v / div}" aria-label="${esc(label)} for ${r}"></div>`; }).join("")}`).join("")}</div>
    <h3 style="margin-top:20px">Reasons are required for</h3><div class="chips" style="margin-top:8px">${["discount", "void", "void_item", "refund", "reopen"].map((k) => `<button class="chip" aria-pressed="${RDRAFT.reasons.includes(k)}" data-rl="reason" data-v="${k}">${k.replace("_", " ")}</button>`).join("")}</div>
    <div class="row" style="margin-top:16px"><button class="btn pri" data-rl="save">Save rules</button></div></div>` : "";
  return head("Setup", "Rules & printers") +
    `<div class="grid g2"><div class="card"><h3>Your access</h3><p class="sub">Role: <b>${esc(me.role)}</b></p><div class="chips">${me.permissions.map((p) => `<span class="pill p-mute">${esc(p)}</span>`).join("") || '<span class="sub">View only</span>'}</div>
      <p class="sub" style="margin-top:12px">Discount limit: ${me.limits.discount_max_pct === null ? "none" : me.limits.discount_max_pct + "%"} · Refund limit: ${me.limits.refund_max_paise === null ? "none" : RS(me.limits.refund_max_paise)}</p>
      <h3 style="margin-top:18px">Your approval PIN</h3><p class="sub">Managers and owners set a PIN so they can approve a cashier's action at the counter.</p>
      <div class="row"><input id="pin1" class="inp" type="password" inputmode="numeric" maxlength="6" placeholder="New PIN (4 to 6 digits)" style="max-width:200px"><input id="pin2" class="inp" type="password" placeholder="Your password" style="max-width:200px"><button class="btn" data-rl="pin">Save PIN</button></div></div>
    <div class="card"><h3>Printers</h3><p class="sub">Printing works with the Nova print app running on the cashier PC. Status: ${agent.online ? `<b style="color:var(--ok)">connected${agent.printer ? " · " + esc(agent.printer) : ""}</b>` : `<b style="color:var(--warn)">not running</b>`}</p>
      ${printers.map((p, i) => `<div class="tk"><div class="row sb"><b>${esc(p.name)}</b><span class="pill p-mute">${esc((me.profiles || {})[p.profile] || p.profile)}</span></div><div class="sub">Prints: ${p.for.map(esc).join(" + ")}${p.station ? " · " + esc(p.station) : ""}${p.windows_name ? " · " + esc(p.windows_name) : ""}${p.cash_drawer ? " · opens cash drawer" : ""}</div>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-rl="test" data-v="${esc(p.id)}">Print test slip</button>${isOwner ? `<button class="btn sm" data-rl="delprn" data-v="${i}">Remove</button>` : ""}</div></div>`).join("") || `<div class="tk"><b>Default printer</b><div class="sub">80 mm TVS-style thermal printer, found automatically on this PC.</div><div class="row" style="margin-top:8px"><button class="btn sm" data-rl="test" data-v="">Print test slip</button></div></div>`}
      ${isOwner ? `<button class="btn" style="margin-top:8px" data-rl="addprn">Add a printer</button>` : ""}</div></div>${matrix}`;
};

function startDraft() {
  const roles = {}, limits = { discount_max_pct: {}, refund_max_paise: {}, reopen_window_minutes: {} };
  const src = D.roles;
  ROLE_NAMES.forEach((r) => { roles[r] = src.roles[r].effective.slice(); Object.keys(limits).forEach((k) => { limits[k][r] = src.roles[r].limits[k]; }); });
  RDRAFT = { roles, limits, reasons: src.reasons_required.slice(), printers: ((D.cfg.config.pos || {}).printers || []).slice() };
}
async function saveRules() {
  const cfg = JSON.parse(JSON.stringify(D.cfg.config)); const pos = cfg.pos || {};
  const rolesCfg = {};
  ROLE_NAMES.forEach((r) => {
    const base = new Set(D.roles.roles[r].base), eff = new Set(RDRAFT.roles[r]);
    const grant = [...eff].filter((p) => !base.has(p)), revoke = [...base].filter((p) => !eff.has(p));
    if (grant.length || revoke.length) rolesCfg[r] = { grant, revoke };
  });
  pos.roles = rolesCfg; pos.reasons_required = RDRAFT.reasons; pos.printers = RDRAFT.printers;
  const lim = {};
  Object.entries(RDRAFT.limits).forEach(([k, byRole]) => { lim[k] = {}; Object.entries(byRole).forEach(([r, v]) => { lim[k][r] = v; }); });
  pos.limits = lim; cfg.pos = pos;
  const r = await guard(() => api("PUT", "/v2/tenants/me/config", cfg));
  if (r) { toast("Rules saved. The server enforces them from now on."); await LOAD.rules(); startDraft(); renderPage(); }
}

/* ---------------- events for these screens ---------------- */
document.addEventListener("click", async (e) => {
  const kd = e.target.closest("[data-kd]"), mn = e.target.closest("[data-mn]"), rl = e.target.closest("[data-rl]"), go = e.target.closest("[data-open]");
  if (go) { P.cur = go.dataset.open; P.ready = P.ready; }
  if (kd) {
    if (kd.dataset.kd === "beep") { beepOn = !beepOn; localStorage.setItem("nova_beep", beepOn ? "1" : "0"); renderPage(); }
    if (kd.dataset.kd === "adv") { await guard(() => api("POST", `/v2/pos/kitchen/${kd.dataset.v}/advance`)); await LOAD.kds(); renderPage(); }
  }
  if (mn) {
    const m = D.menu.find((x) => x.id === mn.dataset.v);
    if (mn.dataset.mn === "add") menuForm(null);
    if (mn.dataset.mn === "edit") menuForm(m);
    if (mn.dataset.mn === "stock") { const r = await guard(() => api("PATCH", `/v2/pos/menu/${m.id}`, { available: !m.available })); if (r) { m.available = r.available; P.ready = false; renderPage(); } }
  }
  if (rl) {
    const k = rl.dataset.rl;
    if (k === "perm") { const set = RDRAFT.roles[rl.dataset.role], p = rl.dataset.perm, i = set.indexOf(p); if (i >= 0) set.splice(i, 1); else set.push(p); renderPage(); }
    if (k === "reason") { const i = RDRAFT.reasons.indexOf(rl.dataset.v); if (i >= 0) RDRAFT.reasons.splice(i, 1); else RDRAFT.reasons.push(rl.dataset.v); renderPage(); }
    if (k === "save") await saveRules();
    if (k === "test") { const j = await guard(() => api("POST", "/v2/pos/print/test", { printer_id: rl.dataset.v || null })); if (j) await printJob(j, "Test slip"); }
    if (k === "pin") {
      await guard(async () => { await api("PUT", "/v2/pos/me/pin", { pin: $("#pin1").value, password: $("#pin2").value }); toast("PIN saved"); $("#pin1").value = ""; $("#pin2").value = ""; });
    }
    if (k === "delprn") { RDRAFT.printers.splice(+rl.dataset.v, 1); renderPage(); }
    if (k === "addprn") {
      const v = await modal(`<h3>Add a printer</h3><label class="f">Name<input id="pn" class="inp" maxlength="60" placeholder="Counter printer" autofocus></label>
        <label class="f">Model<select id="pp" class="inp">${Object.entries(RULES.profiles || {}).map(([k2, l]) => `<option value="${k2}">${esc(l)}</option>`).join("")}</select></label>
        <label class="f">Prints<select id="pf" class="inp"><option value="receipt">Customer bills</option><option value="kot">Kitchen tickets</option><option value="both">Both</option></select></label>
        <label class="f">Kitchen station (only for kitchen tickets, optional)<input id="pst" class="inp" maxlength="24" placeholder="beverage"></label>
        <label class="f">Printer name on the PC (leave blank to find it automatically)<input id="pw" class="inp" maxlength="120"></label>
        <label class="row sub" style="gap:8px"><input type="checkbox" id="pd"> Open the cash drawer after cash bills</label>
        <div class="row" style="margin-top:14px"><button class="btn" data-close>Cancel</button><div class="sp"></div><button class="btn pri" id="pok">Add</button></div>`, (el, close) => {
        el.querySelector("#pok").addEventListener("click", () => {
          const name = el.querySelector("#pn").value.trim(); if (!name) return;
          const f = el.querySelector("#pf").value, id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "printer";
          const p = { id, name, profile: el.querySelector("#pp").value, for: f === "both" ? ["receipt", "kot"] : [f], cash_drawer: el.querySelector("#pd").checked };
          if (el.querySelector("#pst").value.trim()) p.station = el.querySelector("#pst").value.trim();
          if (el.querySelector("#pw").value.trim()) p.windows_name = el.querySelector("#pw").value.trim();
          close(p);
        });
      });
      if (v) { if (RDRAFT.printers.some((x) => x.id === v.id)) v.id += "-" + (RDRAFT.printers.length + 1); RDRAFT.printers.push(v); renderPage(); }
    }
  }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.rl === "limit") {
    const [, div] = LIMIT_LABELS[el.dataset.lim], raw = el.value.trim();
    RDRAFT.limits[el.dataset.lim][el.dataset.role] = raw === "" ? null : Math.round(parseFloat(raw) * div);
  }
});
