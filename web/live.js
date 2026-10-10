"use strict";
/* Shared helpers for the real screens, the dashboard, and Orders (counter + online) on /v2/overview and /v2/orders.
   Everything is built with h() so server text is never parsed as HTML. */

/* ---------------- permissions ----------------
   /v2/pos/rules only lists POS permissions. The permissions below belong to the online/owner API and are fixed per role on the
   server (tenants can only grant or revoke POS permissions), so they are mirrored here to decide what to show. The server still
   enforces every call; a 403 is shown as a message. */
const EXTRA_PERMS = {
  manager: ["orders.view", "orders.create", "orders.update", "orders.refund", "customers.view", "customers.edit", "coupons.view", "coupons.edit", "users.view", "config.view"],
  cashier: ["orders.view", "orders.create", "orders.update", "customers.view", "config.view"],
  captain: ["config.view"],
  kitchen: ["orders.view", "orders.update"],
  delivery: ["orders.view"],
  viewer: ["orders.view", "config.view"],
};
const can = (p) => !!RULES && (RULES.role === "owner" || RULES.permissions.includes(p) || (EXTRA_PERMS[RULES.role] || []).includes(p));

/* ---------------- small helpers ---------------- */
const S = {};   /* slot -> { data, err } : last good data plus the last error, so a failed refresh never blanks a screen */
async function fetchSlot(slot, path) {
  const prev = S[slot];
  try {
    const data = await api("GET", path);
    const changed = !prev || prev.err || JSON.stringify(prev.data) !== JSON.stringify(data);
    S[slot] = { data, err: "", at: Date.now() };
    return changed;
  } catch (e) { S[slot] = { data: prev ? prev.data : null, err: e.message, at: Date.now() }; return true; }
}
const slotData = (slot, dflt) => (S[slot] && S[slot].data != null ? S[slot].data : dflt);
const pillN = (t, k = "mute") => h("span", { class: "pill p-" + k }, t);
const btnN = (label, attrs = {}, cls = "") => h("button", { type: "button", class: ("btn " + cls).trim(), ...attrs }, label);
const hm = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const dtm = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (iso) => { if (!iso) return "–"; const m = mins(iso); return m < 1 ? "<1 min" : m < 60 ? m + " min" : m < 1440 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : Math.floor(m / 1440) + " d"; };
const compactRs = (p) => { const r = p / 100; return r >= 1e5 ? "₹" + (r / 1e5).toFixed(1) + "L" : r >= 1e3 ? "₹" + (r / 1e3).toFixed(1) + "k" : "₹" + Math.round(r); };
const dayLabel = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
const cap = (s) => (String(s || "").toLowerCase() === "upi" ? "UPI" : String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1));
const headN = (eyebrow, title, actions = [], live = false) => h("div", { class: "head" }, h("div", null, h("div", { class: "eyebrow" }, live && h("i"), eyebrow), h("h1", null, title)), h("div", { class: "sp" }), h("div", { class: "row", style: "flex-wrap:wrap" }, actions));
const on = (el, fn, ev = "click") => { el.addEventListener(ev, fn); return el; };
const stateOf = (slot) => S[slot] || { data: null, err: "" };

function emptyN(msg, hint, action) { return h("div", { class: "empty" }, h("b", null, msg), hint && h("div", { class: "sub" }, hint), action || null); }
function errN(msg, retry) { return h("div", { class: "empty err-card", role: "alert" }, h("b", null, "Could not load this"), h("div", { class: "sub" }, msg), retry ? btnN("Try again", { "data-x": "retry" }, "sm") : null); }
function staleN(slot) { const s = stateOf(slot); return s.err && s.data != null ? h("div", { class: "sample-flag", role: "status" }, "Could not refresh just now (" + s.err + "). Showing the last data we have.") : document.createDocumentFragment(); }

/* responsive table: cols = [{h, r}], rows = [[cell|string,...]]; on a phone each row becomes a labelled card */
function rtable(cols, rows, label) {
  return h("div", { class: "tw" }, h("table", { class: "rtable", "aria-label": label || null },
    h("thead", null, h("tr", null, cols.map((c) => h("th", { class: c.r ? "r" : "" }, c.h)))),
    h("tbody", null, rows.map((r) => h("tr", null, r.map((cell, i) => h("td", { class: cols[i].r ? "r mono" : "", "data-label": cols[i].h || null }, cell)))))));
}

function listBars(rows, fmt) {
  const mx = Math.max(1, ...rows.map((r) => r.v));
  return h("div", { class: "lb" }, rows.map((r) => h("div", { class: "lbr" }, h("div", { class: "row sb" }, h("span", null, r.label), h("span", { class: "mono" }, fmt(r.v), r.note ? h("span", { class: "sub" }, " · " + r.note) : null)), h("div", { class: "bar" }, h("i", { style: `width:${Math.max(r.v ? 2 : 0, (r.v / mx) * 100)}%` })))));
}

/* dialogs and the side drawer: Escape closes, Tab stays inside, focus goes back where it came from */
const DRAWER = { close: null };
function openSheet(label, build, cls = "") {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    let el;
    const close = (v) => { document.removeEventListener("keydown", onKey, true); if (DRAWER.close === close) DRAWER.close = null; el.remove(); if (prev && prev.isConnected && prev.focus) prev.focus(); resolve(v === undefined ? null : v); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(null); return; }
      if (e.key !== "Tab") return;
      const f = [...el.querySelectorAll("button,input,select,textarea,a[href]")].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const box = h("div", { role: "dialog", "aria-modal": "true", "aria-label": label });
    el = h("div", { class: "mod " + cls }, box);
    box.append(build(close));
    el.addEventListener("mousedown", (e) => { if (e.target === el) close(null); });
    document.addEventListener("keydown", onKey, true);
    if (cls.includes("drw")) DRAWER.close = close;
    layer().append(el);
    const f = box.querySelector("[autofocus],input,select,textarea") || box.querySelector("button");
    if (f) f.focus();
  });
}
const confirmSheet = (title, text, okLabel, danger) => openSheet(title, (close) => h("div", null, h("h3", null, title), h("p", { class: "sub" }, text),
  h("div", { class: "row", style: "margin-top:14px" }, on(btnN("Cancel"), () => close(null)), h("div", { class: "sp" }), on(btnN(okLabel, {}, danger ? "danger" : "pri"), () => close(true)))));

/* ---------------- dashboard ---------------- */
const ORD = { scope: "open", channel: "all", q: "", seen: null, flash: new Map(), newCount: 0, sound: localStorage.getItem("nova_beep_orders") === "1", at: null };
const LOAD2 = {};

LOAD.home = async () => {
  const jobs = [refreshOpen()];
  if (can("reports.view")) { jobs.push(fetchSlot("ov", "/v2/overview")); jobs.push(fetchSlot("day", "/v2/pos/reports/day")); } else if (can("orders.view")) jobs.push(fetchSlot("openpos", "/v2/orders?scope=open&channel=pos&limit=100"));
  await Promise.all(jobs);
};

function tile(label, value, sub, cls = "") { return h("div", { class: "card kpi " + cls }, h("small", null, label), h("strong", null, value), sub ? h("span", { class: "sub" }, sub) : null); }

function bars7(last7) {
  const max = Math.max(1, ...last7.map((d) => d.sales));
  return h("div", { class: "b7", role: "img", "aria-label": "Sales for the last 7 days: " + last7.map((d) => dayLabel(d.date) + " " + RS(d.sales)).join(", ") },
    last7.map((d, i) => h("div", { class: "b7c" + (i === last7.length - 1 ? " today" : ""), title: dayLabel(d.date) + " " + RS(d.sales), "aria-hidden": "true" },
      h("span", { class: "b7v" }, d.sales ? compactRs(d.sales) : "–"), h("div", { class: "b7t" }, h("i", { style: `height:${d.sales ? Math.max(3, (d.sales / max) * 100) : 0}%` })), h("span", { class: "b7l" }, dayLabel(d.date)))));
}

V.home = () => {
  const root = h("div");
  const open = slotData("open", []), fresh = open.filter((r) => r.state === "placed");
  root.append(headN(RULES.brand, "Dashboard", [can("bills.create") ? btnN("Open POS", { "data-go": "pos" }, "pri sm") : null], true));
  if (stateOf("open").err && !stateOf("open").data) root.append(errN(stateOf("open").err, true));
  if (fresh.length) {
    root.append(h("div", { class: "ai callout", role: "status" }, h("b", null, "New online orders"),
      h("h3", { style: "margin:8px 0" }, fresh.length + (fresh.length === 1 ? " order is" : " orders are") + " waiting for you"),
      h("div", { class: "sub", style: "margin-bottom:12px" }, fresh.slice(0, 3).map((r) => `#${r.order_no} · ${r.type} · ${RS(r.total)} · ${ago(r.created_at)} ago`).join("   |   ")),
      btnN("Review orders", { "data-go": "ord" }, "pri sm")));
  }
  const ov = slotData("ov", null);
  if (can("reports.view")) {
    const so = stateOf("ov");
    if (so.err && !ov) root.append(errN(so.err, true));
    else if (ov) {
      root.append(staleN("ov"));
      const y = ov.last7.length > 1 ? ov.last7[ov.last7.length - 2].sales : 0;
      const vs = y > 0 ? (ov.sales >= y ? "▲ " : "▼ ") + Math.abs(Math.round(((ov.sales - y) / y) * 100)) + "% vs yesterday" : "No sales yesterday to compare";
      root.append(h("div", { class: "tiles" },
        tile("Sales today", RS(ov.sales), vs), tile("Bills paid", String(ov.bills), "since opening"), tile("Average bill", RS(ov.avg_bill), ov.bills ? "per paid bill" : "no bills yet"),
        tile("Open online orders", String(ov.open_online), ov.new_online ? ov.new_online + " new, not accepted" : "none waiting", ov.new_online ? "attn" : ""), tile("To collect", RS(ov.to_collect), "cash or UPI on delivery/pickup"), tile("Open counter bills", String(ov.open_counter), "not paid yet")));
      const tot = ov.by_channel.online + ov.by_channel.pos;
      root.append(h("div", { class: "grid g21", style: "margin-top:14px" },
        h("div", { class: "card" }, h("h3", null, "Last 7 days"), h("div", { class: "sub", style: "margin-bottom:10px" }, "Sales collected, after refunds · business date " + ov.date), ov.last7.some((d) => d.sales) ? bars7(ov.last7) : emptyN("No sales in the last 7 days", "Paid bills will appear here.")),
        h("div", { class: "card" }, h("h3", null, "Best sellers today"), h("div", { class: "sub", style: "margin-bottom:10px" }, "Dishes sold, by quantity"), ov.top_items.length ? listBars(ov.top_items.map((t) => ({ label: t.name, v: t.qty })), (v) => v + " sold") : emptyN("Nothing sold yet today"))));
      root.append(h("div", { class: "grid g2", style: "margin-top:14px" },
        h("div", { class: "card" }, h("h3", null, "Online vs counter"), h("div", { class: "sub", style: "margin-bottom:10px" }, "Share of today's sales"), tot ? listBars([{ label: "Online", v: ov.by_channel.online, note: Math.round((ov.by_channel.online / tot) * 100) + "%" }, { label: "Counter", v: ov.by_channel.pos, note: Math.round((ov.by_channel.pos / tot) * 100) + "%" }], RS) : emptyN("No sales yet today")),
        h("div", { class: "card" }, h("h3", null, "How customers paid"), h("div", { class: "sub", style: "margin-bottom:10px" }, "After refunds"), Object.keys(ov.by_mode).length ? listBars(Object.entries(ov.by_mode).map(([k, v]) => ({ label: cap(k), v: Math.max(0, v) })), RS) : emptyN("No payments yet today"))));
      const d = slotData("day", null);
      if (d) root.append(h("div", { class: "grid g3", style: "margin-top:14px" }, tile("Discounts given", RS(d.discounts)), tile("Refunds", RS(d.refunds)), tile("Voided bills", String(d.voided_bills))));
    } else root.append(h("div", { class: "sub", style: "padding:24px" }, "Loading…"));
  } else {
    const openPos = slotData("openpos", []);
    root.append(h("div", { class: "sub", style: "margin-bottom:12px" }, "Sales figures are shown to managers and owners. Here is what needs your attention."));
    root.append(h("div", { class: "tiles" }, tile("Open online orders", String(open.length), fresh.length ? fresh.length + " new, not accepted" : "none waiting", fresh.length ? "attn" : ""),
      tile("To collect (online)", RS(open.reduce((a, r) => a + Math.max(0, r.balance), 0)), "cash or UPI on delivery/pickup"), tile("Open counter bills", String(openPos.length), "not paid yet")));
    root.append(h("div", { class: "row", style: "margin-top:14px" }, btnN("Orders", { "data-go": "ord" }, "pri"), can("bills.create") ? btnN("Open POS", { "data-go": "pos" }) : null));
  }
  root.append(h("div", { class: "sample-flag", style: "margin-top:18px" }, "Social, ads, traffic, WhatsApp, queue and reports pages are still design previews with made-up numbers until each is connected."));
  return root;
};

/* ---------------- orders ---------------- */
const FINAL_STATES = new Set(["completed", "delivered", "cancelled"]);
const FLOW_DEFAULT = { "dine-in": ["placed", "preparing", "ready", "served", "completed"], takeaway: ["placed", "preparing", "ready", "completed"], delivery: ["placed", "preparing", "ready", "out_for_delivery", "delivered"] };
const STATE_TXT = { placed: "New", preparing: "Preparing", ready: "Ready", out_for_delivery: "Out for delivery", served: "Served", completed: "Completed", delivered: "Delivered", cancelled: "Cancelled", open: "Open bill", paid: "Paid", void: "Voided", refunded: "Refunded" };
const STATE_KIND = { placed: "warn", preparing: "info", ready: "ok", out_for_delivery: "info", served: "ok", completed: "mute", delivered: "mute", cancelled: "bad", open: "warn", paid: "ok", void: "bad", refunded: "mute" };
const flowFor = (type) => { const t = String(type || "").toLowerCase(); const cfg = slotData("cfg", null); return (cfg && cfg.config && cfg.config.operations && cfg.config.operations.flows && cfg.config.operations.flows[t]) || FLOW_DEFAULT[t] || []; };
const nextStep = (o) => { const f = flowFor(o.type), i = f.indexOf(o.state); return i >= 0 && i < f.length - 1 ? f[i + 1] : null; };
function stepLabel(o, to) {
  return { preparing: "Accept order", ready: "Mark ready", served: "Mark served", out_for_delivery: "Send out for delivery", delivered: "Mark delivered", completed: String(o.type).toLowerCase() === "takeaway" ? "Handed over" : "Complete order" }[to] || "Move to " + to;
}
const orderRow = (b) => ({ id: b.id, order_no: b.bill_no, channel: b.channel || "pos", type: b.type, state: b.state, driver: (b.online && b.online.driver) || null, balance: b.balance, total: b.totals.total });

function orderActions(o) {
  const out = [], online = o.channel === "online";
  if (online && !FINAL_STATES.has(o.state) && can("orders.update")) {
    const nx = nextStep(o), isDel = String(o.type).toLowerCase() === "delivery";
    if (nx === "out_for_delivery" && !o.driver) out.push(btnN("Assign rider", { "data-x": "assign", "data-id": o.id, "data-no": o.order_no }, "pri"));
    else if (nx) out.push(btnN(stepLabel(o, nx), { "data-x": "advance", "data-id": o.id, "data-to": nx, "data-no": o.order_no, "data-bal": o.balance, "data-type": o.type }, "pri"));
    if (isDel && ["preparing", "ready"].includes(o.state) && !(nx === "out_for_delivery" && !o.driver)) out.push(btnN(o.driver ? "Change rider" : "Assign rider", { "data-x": "assign", "data-id": o.id, "data-no": o.order_no }, "sm"));
    if (o.state !== "out_for_delivery") out.push(btnN("Cancel", { "data-x": "cancel", "data-id": o.id, "data-no": o.order_no }, "sm danger"));
  }
  if (!online && o.state === "open" && can("bills.view")) out.push(btnN("Open in POS", { "data-go": "pos", "data-open": o.id }, "pri"));
  return out;
}

function orderCard(o) {
  const online = o.channel === "online", flash = (ORD.flash.get(o.id) || 0) > Date.now();
  const cust = [o.customer && o.customer.name, o.customer && o.customer.phone].filter(Boolean).join(" · ");
  const due = o.balance > 0 && !["cancelled", "void"].includes(o.state);
  return h("article", { class: "ocard" + (flash ? " flash" : "") + (o.state === "placed" ? " fresh" : "") },
    h("div", { class: "row sb" }, h("button", { type: "button", class: "otitle", "data-x": "detail", "data-id": o.id, "aria-label": `Order ${o.order_no}, open details` }, "#" + o.order_no), h("span", { class: "sub" }, ago(o.created_at) + " ago")),
    h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" }, pillN(online ? "Online" : "Counter", online ? "info" : "mute"), pillN(o.type), o.table ? pillN(o.table) : null, pillN(STATE_TXT[o.state] || o.state, STATE_KIND[o.state] || "mute")),
    cust ? h("div", { class: "sub" }, cust) : null,
    h("div", { class: "oitems" }, o.items.slice(0, 3).join(" · ") || "No items", o.items.length > 3 ? h("span", { class: "sub" }, ` +${o.items.length - 3} more`) : null),
    o.address ? h("div", { class: "sub" }, "To: " + o.address) : null,
    o.driver ? h("div", { class: "sub" }, "Rider: " + o.driver.name) : null,
    o.notes ? h("div", { class: "note" }, "“" + o.notes + "”") : null,
    h("div", { class: "row sb" }, h("b", { class: "mono" }, RS(o.total)), due ? pillN(RS(o.balance) + " to collect", "warn") : pillN(o.state === "cancelled" || o.state === "void" ? "No charge" : "Paid", o.state === "cancelled" || o.state === "void" ? "mute" : "ok")),
    h("div", { class: "oact" }, orderActions(o), btnN("Details", { "data-x": "detail", "data-id": o.id }, "sm")));
}

function visibleOrders() {
  const q = ORD.q.trim().toLowerCase();
  let rows = slotData("orders", []);
  if (q) rows = rows.filter((o) => [String(o.order_no), o.customer && o.customer.name, o.customer && o.customer.phone, o.table, o.address, o.type, ...(o.items || [])].some((x) => x && String(x).toLowerCase().includes(q)));
  return rows;
}
function orderListNode() {
  const st = stateOf("orders");
  if (st.err && st.data == null) return errN(st.err, true);
  const rows = visibleOrders();
  if (!rows.length) return emptyN(ORD.q ? "No orders match that search" : { open: "No open orders right now", done: "No finished orders yet", cancelled: "No cancelled orders", all: "No orders yet" }[ORD.scope], ORD.scope === "open" && !ORD.q ? "New online orders show up here by themselves. This screen checks every 10 seconds." : null);
  return h("div", { class: "ordgrid" }, rows.map(orderCard));
}
function ordMeta() {
  const n = visibleOrders().length, st = stateOf("orders");
  return `${n} order${n === 1 ? "" : "s"} · updated ${ORD.at ? new Date(ORD.at).toLocaleTimeString("en-IN") : "–"}` + (st.err ? " · could not refresh" : "");
}
function drawOrders() {
  const box = document.getElementById("ordlist"); if (!box) return;
  box.replaceChildren(orderListNode());
  const m = document.getElementById("ordmeta"); if (m) m.textContent = ordMeta();
  for (const [k, t] of ORD.flash) if (t < Date.now()) ORD.flash.delete(k);
}
const chipGroup = (items, cur, key) => h("div", { class: "chips", role: "group", "aria-label": key === "scope" ? "Show orders" : "Where from" }, items.map(([v, l]) => h("button", { type: "button", class: "chip", "aria-pressed": cur === v, "data-x": "filter", "data-k": key, "data-v": v }, l)));

LOAD.ord = async () => { await Promise.all([fetchSlot("orders", `/v2/orders?scope=${ORD.scope}&channel=${ORD.channel}&limit=200`), can("config.view") && !slotData("cfg", null) ? fetchSlot("cfg", "/v2/tenants/me") : null]); ORD.at = Date.now(); };

V.ord = () => {
  const root = h("div");
  root.append(headN("Service", "Orders", [h("label", { class: "row sub", style: "gap:8px" }, "Sound on new online order", h("button", { type: "button", class: "sw", role: "switch", "aria-checked": ORD.sound, "data-x": "sound", "aria-label": "Sound on new online order" })), btnN("Refresh", { "data-x": "retry" }, "sm")], true));
  root.append(h("div", { class: "ofilters" }, chipGroup([["open", "Open"], ["done", "Done"], ["cancelled", "Cancelled"], ["all", "All"]], ORD.scope, "scope"), chipGroup([["all", "Online + counter"], ["online", "Online"], ["pos", "Counter"]], ORD.channel, "channel"),
    h("input", { id: "ordq", class: "inp osearch", type: "search", placeholder: "Search number, name, phone, dish", "aria-label": "Search orders", value: ORD.q, autocomplete: "off" })));
  root.append(h("div", { class: "sub", id: "ordmeta", role: "status", style: "margin:4px 0 12px" }, ordMeta()), staleN("orders"), h("div", { id: "ordlist" }, orderListNode()));
  return root;
};

/* new online orders: checked every 10 seconds on every screen so the badge, title and sound still work elsewhere */
async function refreshOpen() {
  if (!RULES || !can("orders.view")) return;
  await fetchSlot("open", "/v2/orders?scope=open&channel=online&limit=100");
  const rows = slotData("open", []);
  if (ORD.seen) {
    const fresh = rows.filter((r) => r.state === "placed" && !ORD.seen.has(r.id));
    if (fresh.length) {
      fresh.forEach((r) => ORD.flash.set(r.id, Date.now() + 8000));
      toast(fresh.length === 1 ? `New online order #${fresh[0].order_no} · ${RS(fresh[0].total)}` : `${fresh.length} new online orders`, 6000);
      if (ORD.sound) beep();
    }
  }
  ORD.seen = new Set(rows.map((r) => r.id));
  ORD.newCount = rows.filter((r) => r.state === "placed").length;
  updateBadge();
}
function updateBadge() {
  const nav = document.querySelector('.nav[data-go="ord"]');
  if (nav) { let b = nav.querySelector(".n.live"); if (ORD.newCount) { if (!b) { b = h("span", { class: "n live" }); nav.append(b); } b.textContent = ORD.newCount + " new"; } else if (b) b.remove(); }
  document.title = (ORD.newCount ? `(${ORD.newCount}) ` : "") + (PAGES[page] ? PAGES[page].t + " · " : "") + "Nova";
}
async function pollTick() {
  if (!RULES) return;
  try {
    if (page === "home") { await LOAD.home(); if (!document.querySelector(".mod")) renderPage(); }
    else if (page === "ord") { await Promise.all([refreshOpen(), fetchSlot("orders", `/v2/orders?scope=${ORD.scope}&channel=${ORD.channel}&limit=200`)]); ORD.at = Date.now(); drawOrders(); }
    else if (AUTO[page]) { await Promise.all([refreshOpen(), LOAD[page]()]); if (!document.querySelector(".mod")) renderPage(); }
    else await refreshOpen();
  } catch { /* the next tick will recover */ }
}
let pollTimer = null;
function startPolling() { clearInterval(pollTimer); ORD.seen = null; ORD.newCount = 0; pollTimer = setInterval(pollTick, 10000); }
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

/* ---------------- order actions ---------------- */
async function reloadOrders() { await Promise.all([refreshOpen(), page === "ord" ? fetchSlot("orders", `/v2/orders?scope=${ORD.scope}&channel=${ORD.channel}&limit=200`) : null]); ORD.at = Date.now(); if (page === "ord") drawOrders(); else if (page === "home") { await LOAD.home(); renderPage(); } }

function paymentSheet(no, due) {
  let mode = "cash";
  return openSheet("Collect payment", (close) => {
    const err = h("div", { class: "err", role: "alert" }), ref = h("input", { class: "inp", maxlength: "40", placeholder: "Reference (optional)", "aria-label": "Payment reference", autocomplete: "off", hidden: true });
    const modes = ["cash", "upi", "card"].map((m) => on(h("button", { type: "button", "aria-pressed": m === mode }, m === "upi" ? "UPI" : cap(m)), () => { mode = m; modes.forEach((b, i) => b.setAttribute("aria-pressed", ["cash", "upi", "card"][i] === m)); ref.hidden = m === "cash"; }));
    return h("div", null, h("h3", null, "Collect payment · order #" + no), h("p", { class: "sub" }, "This order is not paid yet. Record how the " + RS(due) + " was received to complete it."),
      h("div", { class: "pay", role: "group", "aria-label": "Payment type" }, modes), h("div", { style: "margin-top:10px" }, ref), err,
      h("div", { class: "row", style: "margin-top:14px" }, on(btnN("Cancel"), () => close(null)), h("div", { class: "sp" }), on(btnN("Collect " + RS(due) + " and complete", {}, "pri"), () => close({ mode, ref: ref.value.trim() }))));
  });
}

async function advanceOrder(id, to, no, bal, collect, type) {
  try {
    /* closing an unpaid order needs a payment: ask first instead of waiting for the server to refuse */
    const f = flowFor(type);
    if (!collect && Number(bal) > 0 && f.length && f[f.length - 1] === to) { const c = await paymentSheet(no, Number(bal)); if (!c) return false; collect = c; }
    await api("POST", `/v2/orders/${id}/status`, { status: to, ...(collect ? { collect } : {}) });
    toast(`Order #${no}: ${STATE_TXT[to] || to}`);
    return true;
  } catch (e) {
    if (e.code === "PAYMENT_DUE") { const c = await paymentSheet(no, Number(e.detail.due) || Number(bal) || 0); if (c) return advanceOrder(id, to, no, bal, c, type); return false; }
    toast(e.message, 5000); return false;
  }
}

function riderSheet(id, no) {
  return openSheet("Assign rider", (close) => {
    const list = h("div", { class: "pick" }, h("div", { class: "sub" }, "Loading riders…")), err = h("div", { class: "err", role: "alert" });
    api("GET", "/v2/delivery/drivers").then((rows) => {
      list.replaceChildren(...(rows.length ? rows.map((d) => {
        const b = h("button", { type: "button", class: "pickrow", disabled: d.status !== "active" },
          h("span", null, h("b", null, d.name), h("span", { class: "sub" }, d.phone ? " · " + d.phone : "")),
          h("span", { class: "row", style: "gap:6px" }, d.status !== "active" ? pillN(cap(d.status), "bad") : d.online ? pillN("Online", "ok") : pillN("Offline", "mute"), pillN(d.active_orders + " out", d.active_orders ? "info" : "mute")));
        return on(b, async () => { b.disabled = true; try { await api("POST", `/v2/orders/${id}/assign`, { driver_id: d.id }); close(d); } catch (e) { err.textContent = e.message; b.disabled = false; } });
      }) : [emptyN("No delivery partners yet", "Add a staff member with the role delivery, then assign here.")]));
    }).catch((e) => list.replaceChildren(errN(e.message, false)));
    return h("div", null, h("h3", null, "Assign rider · order #" + no), h("p", { class: "sub" }, "Pick who will deliver it. Offline riders can still be picked if you have told them."), list, err, h("div", { class: "row", style: "margin-top:14px" }, on(btnN("Close"), () => close(null))));
  });
}

function detailNode(b, close) {
  const o = b.online || {}, row = orderRow(b), money = (p) => RS(p), lines = (b.lines || []);
  const t = b.totals || {};
  const kv = (k, v) => h("div", { class: "row sb" }, h("span", { class: "sub" }, k), h("span", { class: "mono" }, v));
  const cust = [b.customer && b.customer.name, b.customer && b.customer.phone].filter(Boolean);
  const addr = o.address && o.address.text ? [o.address.text, o.address.landmark].filter(Boolean).join(", ") : "";
  return h("div", { class: "dbody" },
    h("div", { class: "row sb" }, h("h3", null, "Order #" + b.bill_no), on(btnN("Close", { "aria-label": "Close details" }, "sm"), () => close(null))),
    h("div", { class: "row", style: "flex-wrap:wrap;gap:6px;margin:8px 0" }, pillN(row.channel === "online" ? "Online" : "Counter", row.channel === "online" ? "info" : "mute"), pillN(b.type), b.table ? pillN(b.table) : null, pillN(STATE_TXT[b.state] || b.state, STATE_KIND[b.state] || "mute")),
    h("div", { class: "sub" }, "Placed " + dtm(b.created_at) + " (" + ago(b.created_at) + " ago)"),
    h("div", { class: "oact", style: "margin:12px 0" }, orderActions(row)),
    h("div", { class: "dsec" }, h("h4", null, "Customer"), cust.length ? h("div", null, cust.join(" · ")) : h("div", { class: "sub" }, "Walk-in, no details"), addr ? h("div", null, addr) : null,
      o.distance_km != null ? h("div", { class: "sub" }, o.distance_km + " km from the restaurant") : null, o.notes ? h("div", { class: "note" }, "“" + o.notes + "”") : null,
      o.driver ? h("div", null, "Rider: " + o.driver.name + (o.driver.phone ? " · " + o.driver.phone : "")) : null),
    h("div", { class: "dsec" }, h("h4", null, "Items"), lines.map((l) => h("div", { class: "dline" }, h("span", null, `${l.qty} × ${l.name}`, l.note ? h("span", { class: "note" }, "“" + l.note + "”") : null), h("span", { class: "mono" }, money(l.price * l.qty))))),
    h("div", { class: "dsec" }, h("h4", null, "Money"), kv("Subtotal", money(t.subtotal || 0)), t.discount ? kv("Discount", "− " + money(t.discount)) : null, o.coupon ? kv("Offer", o.coupon.code || "applied") : null,
      kv("Tax (included)", money(t.tax || 0)), kv("Total", money(t.total || 0)), kv("Paid", money(b.paid || 0)), b.balance > 0 && b.status !== "void" ? kv("To collect", money(b.balance)) : null,
      (b.payments || []).map((p) => h("div", { class: "sub" }, `${cap(p.mode)} ${money(p.amount)}${p.ref ? " · ref " + p.ref : ""}`)), o.payment_method ? h("div", { class: "sub" }, "Customer chose: " + (o.payment_method === "cod" ? "pay on delivery/pickup" : o.payment_method)) : null),
    b.void ? h("div", { class: "dsec" }, h("h4", null, "Cancelled"), h("div", null, b.void.reason), h("div", { class: "sub" }, "by " + b.void.by + " · " + dtm(b.void.at))) : null,
    o.timeline && o.timeline.length ? h("div", { class: "dsec" }, h("h4", null, "Timeline"), h("ol", { class: "tl" }, o.timeline.map((x) => h("li", null, h("b", null, STATE_TXT[x.status] || x.status), h("span", { class: "sub" }, " · " + hm(x.at) + " · " + (x.by || "") + (x.reason ? " · " + x.reason : "")))))) : null);
}

const XA = {
  async retry() { if (page === "home") { await LOAD.home(); renderPage(); } else if (LOAD[page]) { await LOAD[page](); renderPage(); } },
  async filter(el) { ORD[el.dataset.k === "scope" ? "scope" : "channel"] = el.dataset.v; await LOAD.ord(); renderPage(); },
  sound(el) { ORD.sound = !ORD.sound; localStorage.setItem("nova_beep_orders", ORD.sound ? "1" : "0"); el.setAttribute("aria-checked", ORD.sound); if (ORD.sound) beep(); },
  async detail(el) {
    const id = el.dataset.id;
    openSheet("Order details", (close) => {
      const body = h("div", { class: "dbody" }, h("div", { class: "sub" }, "Loading…"));
      api("GET", `/v2/orders/${id}`).then((b) => { body.replaceChildren(detailNode(b, close)); const f = body.querySelector("button"); if (f) f.focus(); }).catch((e) => body.replaceChildren(errN(e.message, false), on(btnN("Close", {}, "sm"), () => close(null))));
      return body;
    }, "drw");
  },
  async advance(el) {
    el.disabled = true;
    const ok = await advanceOrder(el.dataset.id, el.dataset.to, el.dataset.no, el.dataset.bal, undefined, el.dataset.type);
    if (ok && DRAWER.close) DRAWER.close(); if (ok) await reloadOrders(); else el.disabled = false;
  },
  async assign(el) {
    const d = await riderSheet(el.dataset.id, el.dataset.no);
    if (d) { toast(`Order #${el.dataset.no} assigned to ${d.name}`); if (DRAWER.close) DRAWER.close(); await reloadOrders(); }
  },
  async cancel(el) {
    const reason = await askReason(`Cancel order #${el.dataset.no}?`);
    if (!reason) return;
    try { await api("POST", `/v2/orders/${el.dataset.id}/status`, { status: "cancelled", reason }); toast(`Order #${el.dataset.no} cancelled`); if (DRAWER.close) DRAWER.close(); await reloadOrders(); } catch (e) { toast(e.message, 5000); }
  },
};
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-x]"); if (!el || el.disabled) return;
  const fn = XA[el.dataset.x]; if (fn) await fn(el, e);
});
document.addEventListener("input", (e) => { if (e.target.id === "ordq") { ORD.q = e.target.value; drawOrders(); } });
