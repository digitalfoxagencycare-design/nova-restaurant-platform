"use strict";
/* Management screens backed by the owner API: customers, offers, tables, staff, online store switch, riders, menu (with bulk tools). */
const AUTO = { rid: 1, tab: 1 };   /* screens that refresh by themselves every 10 s */
const field = (label, input, hint) => h("label", { class: "f" }, label, input, hint ? h("span", { class: "sub", style: "font-weight:400" }, hint) : null);
const formRow = (...kids) => h("div", { class: "row frow" }, kids);
const sheetButtons = (close, okLabel, onOk, cls = "pri") => h("div", { class: "row", style: "margin-top:14px" }, on(btnN("Cancel"), () => close(null)), h("div", { class: "sp" }), on(btnN(okLabel, {}, cls), onOk));
const seg = (name, items, cur, onPick) => { const bs = items.map(([v, l]) => on(h("button", { type: "button", "aria-pressed": v === cur }, l), () => { bs.forEach((b, i) => b.setAttribute("aria-pressed", items[i][0] === v)); onPick(v); })); return h("div", { class: "pay", role: "group", "aria-label": name, style: `grid-template-columns:repeat(${items.length},1fr)` }, bs); };
const num = (s) => { const t = String(s ?? "").trim(); if (t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

/* ---------------- customers ---------------- */
const CUS = { q: "", timer: null };
LOAD.cus = async () => { await fetchSlot("cus", "/v2/customers?q=" + encodeURIComponent(CUS.q.trim())); };
function cusListNode() {
  const st = stateOf("cus");
  if (st.err && st.data == null) return errN(st.err, true);
  const rows = st.data || [];
  if (!rows.length) return emptyN(CUS.q ? "No customer matches that" : "No customers yet", CUS.q ? "Try a shorter name or the last digits of the phone." : "People appear here after they order online or are added to a counter bill with a phone number.");
  return rtable([{ h: "Customer" }, { h: "Phone" }, { h: "Orders", r: 1 }, { h: "Spend", r: 1 }, { h: "Last order" }, { h: "Status" }],
    rows.map((c) => [h("b", null, c.name || "No name"), h("span", { class: "mono" }, c.phone), String(c.orders), RS(c.spend), c.orders ? dtm(c.last_order_at) : "–", pillN(c.registered ? "Has an account" : "Guest", c.registered ? "ok" : "mute")]), "Customers");
}
V.cus = () => {
  const rows = slotData("cus", []), root = h("div");
  root.append(headN("Business", "Customers"));
  if (stateOf("cus").data != null) root.append(h("div", { class: "tiles" }, tile(CUS.q ? "Matching customers" : "Customers", String(rows.length), rows.length >= 300 ? "top 300 by spend shown" : "with a phone number"), tile("Came back", String(rows.filter((r) => r.orders > 1).length), "ordered more than once"), tile("Total spend", RS(rows.reduce((a, r) => a + r.spend, 0)), "paid bills only")));
  root.append(h("div", { class: "ofilters", style: "margin:14px 0" }, h("input", { id: "cusq", class: "inp osearch", type: "search", placeholder: "Search name or phone", "aria-label": "Search customers", value: CUS.q, autocomplete: "off" })), staleN("cus"), h("div", { class: "card", id: "cuslist" }, cusListNode()));
  return root;
};
document.addEventListener("input", (e) => {
  if (e.target.id !== "cusq") return;
  CUS.q = e.target.value; clearTimeout(CUS.timer);
  CUS.timer = setTimeout(async () => { await LOAD.cus(); const b = document.getElementById("cuslist"); if (b) b.replaceChildren(cusListNode()); }, 300);
});

/* ---------------- offers ---------------- */
LOAD.off = async () => { await fetchSlot("off", "/v2/coupons"); };
const endOfDayIso = (d) => new Date(d + "T23:59:59").toISOString().replace("Z", "+00:00");
const offerText = (c) => (c.kind === "pct" ? `${c.value}% off` + (c.max_discount ? ` up to ${RS(c.max_discount)}` : "") : `${RS(c.value)} off`);
V.off = () => {
  const st = stateOf("off"), rows = st.data || [], edit = can("coupons.edit"), root = h("div");
  root.append(headN("Business", "Offers", [edit ? btnN("New offer", { "data-x": "offerNew" }, "pri sm") : null]));
  if (st.err && st.data == null) { root.append(errN(st.err, true)); return root; }
  root.append(staleN("off"));
  if (!rows.length) { root.append(h("div", { class: "card" }, emptyN("No offers yet", "Customers can type an offer code when they order online.", edit ? btnN("Create the first offer", { "data-x": "offerNew" }, "pri sm") : null))); return root; }
  root.append(h("div", { class: "card" }, rtable([{ h: "Code" }, { h: "Offer" }, { h: "Rule" }, { h: "Valid until" }, { h: "Active" }, { h: "" }], rows.map((c) => {
    const expired = c.valid_to && c.valid_to < new Date().toISOString();
    return [h("b", { class: "mono" }, c.code), c.title || "–", offerText(c) + (c.min_subtotal ? ` · min order ${RS(c.min_subtotal)}` : ""), c.valid_to ? [dtm(c.valid_to).split(",")[0], expired ? " " : null, expired ? pillN("Expired", "bad") : null] : "No end date",
      edit ? h("button", { type: "button", class: "sw", role: "switch", "aria-checked": c.active !== false, "data-x": "offerActive", "data-id": c.id, "aria-label": `Offer ${c.code} is active` }) : pillN(c.active !== false ? "Active" : "Off", c.active !== false ? "ok" : "mute"),
      edit ? h("span", { class: "row", style: "gap:6px" }, btnN("Edit", { "data-x": "offerEdit", "data-id": c.id }, "sm"), btnN("Delete", { "data-x": "offerDel", "data-id": c.id, "data-code": c.code }, "sm danger")) : ""];
  }), "Offers")));
  return root;
};
function offerSheet(c) {
  let kind = c ? c.kind : "pct";
  return openSheet(c ? "Edit offer" : "New offer", (close) => {
    const code = h("input", { class: "inp", maxlength: "20", value: c ? c.code : "", disabled: !!c, autocomplete: "off", autocapitalize: "characters", "aria-label": "Code" }),
      title = h("input", { class: "inp", maxlength: "60", value: c ? c.title || "" : "", placeholder: "10% off your order" }),
      value = h("input", { class: "inp", inputmode: "decimal", value: c ? (c.kind === "pct" ? c.value : c.value / 100) : "" }),
      min = h("input", { class: "inp", inputmode: "decimal", value: c && c.min_subtotal ? c.min_subtotal / 100 : "", placeholder: "0" }),
      max = h("input", { class: "inp", inputmode: "decimal", value: c && c.max_discount ? c.max_discount / 100 : "", placeholder: "No cap" }),
      until = h("input", { class: "inp", type: "date", value: c && c.valid_to ? new Date(c.valid_to).toLocaleDateString("en-CA") : "" }),
      active = h("input", { type: "checkbox", checked: c ? c.active !== false : true }), err = h("div", { class: "err", role: "alert" });
    const valLabel = h("span", null, kind === "pct" ? "Percent off" : "Rupees off");
    const maxWrap = field("Most it can take off (₹, optional)", max);
    maxWrap.hidden = kind !== "pct";
    const ok = async () => {
      err.textContent = "";
      const codeV = code.value.trim().toUpperCase(), v = num(value.value), mn = num(min.value), mx = num(max.value);
      if (!c && !/^[A-Z0-9]{3,20}$/.test(codeV)) return void (err.textContent = "Code: 3 to 20 letters or numbers, no spaces.");
      if (!(v > 0)) return void (err.textContent = "Enter how much the offer takes off.");
      if (kind === "pct" && v > 100) return void (err.textContent = "A percent offer cannot be above 100.");
      if (Number.isNaN(mn) || Number.isNaN(mx) || mn < 0 || (mx !== null && mx <= 0)) return void (err.textContent = "Check the order amounts.");
      const body = { title: title.value.trim(), value: kind === "pct" ? v : Math.round(v * 100), min_subtotal: Math.round((mn || 0) * 100), max_discount: kind === "pct" && mx ? Math.round(mx * 100) : null, valid_to: until.value ? endOfDayIso(until.value) : null, active: active.checked };
      try { close(c ? await api("PATCH", `/v2/coupons/${c.id}`, body) : await api("POST", "/v2/coupons", { ...body, code: codeV, kind })); } catch (e) { err.textContent = e.message; }
    };
    return h("div", null, h("h3", null, c ? "Edit " + c.code : "New offer"),
      field("Code customers type", code), field("Title (shown to customers)", title),
      c ? h("p", { class: "sub" }, "Type: " + (c.kind === "pct" ? "percent off" : "rupees off") + " (cannot be changed; make a new offer instead).") : seg("Offer type", [["pct", "Percent off"], ["amount", "Rupees off"]], kind, (k) => { kind = k; valLabel.textContent = k === "pct" ? "Percent off" : "Rupees off"; maxWrap.hidden = k !== "pct"; }),
      field(valLabel, value), formRow(field("Minimum order (₹)", min), maxWrap), field("Valid until (end of that day, optional)", until),
      h("label", { class: "row sub", style: "gap:8px;margin-top:6px" }, active, "Active"), err, sheetButtons(close, c ? "Save" : "Create offer", ok));
  });
}

/* ---------------- tables ---------------- */
LOAD.tab = async () => { await fetchSlot("tab", "/v2/tables"); };
V.tab = () => {
  const st = stateOf("tab"), rows = st.data || [], root = h("div"), busy = rows.filter((t) => t.state === "occupied").length;
  root.append(headN("Service", "Tables", [], true));
  if (st.err && st.data == null) { root.append(errN(st.err, true)); return root; }
  root.append(staleN("tab"));
  if (!rows.length) { root.append(h("div", { class: "card" }, emptyN("No tables set up", "Table names come from the restaurant settings (pos.tables). Counter bills can still be opened without one."))); return root; }
  root.append(h("div", { class: "chips", style: "margin-bottom:14px" }, pillN(busy + " with an open bill", "warn"), pillN(rows.length - busy + " free", "ok")));
  root.append(h("div", { class: "tgrid" }, rows.map((t) => t.state === "occupied"
    ? h("button", { type: "button", class: "tbl occ", ...(can("bills.view") ? { "data-go": "pos", "data-open": t.bill.bill_id } : {}), "aria-label": `${t.table}, open bill ${t.bill.bill_no}, ${RS(t.bill.total)}` }, h("b", null, t.table), h("span", { class: "sub" }, "Bill #" + t.bill.bill_no), h("span", { class: "mono" }, RS(t.bill.total)), h("span", { class: "sub" }, ago(t.bill.since)))
    : h("div", { class: "tbl free", role: "group", "aria-label": t.table + ", free" }, h("b", null, t.table), h("span", { class: "sub" }, "Free")))));
  root.append(h("p", { class: "sub", style: "margin-top:14px" }, "Choose a table with an open bill to continue it in the POS. Updates every 10 seconds."));
  return root;
};

/* ---------------- staff ---------------- */
LOAD.stf = async () => { await fetchSlot("stf", "/v2/users"); };
const ROLE_TXT = { owner: "Owner", manager: "Manager", cashier: "Cashier", captain: "Captain", kitchen: "Kitchen", delivery: "Rider", viewer: "Viewer (read only)" };
const INVITE_ROLES = ["manager", "cashier", "captain", "kitchen", "delivery", "viewer"];
const STATUS_KIND = { active: "ok", invited: "warn", disabled: "bad" };
V.stf = () => {
  const st = stateOf("stf"), rows = st.data || [], manage = can("users.manage"), root = h("div");
  root.append(headN("Business", "Staff", [manage ? btnN("Invite staff", { "data-x": "staffInvite" }, "pri sm") : null]));
  if (st.err && st.data == null) { root.append(errN(st.err, true)); return root; }
  root.append(staleN("stf"));
  if (!manage) root.append(h("p", { class: "sub" }, "Only the owner can invite people or change roles."));
  if (!rows.length) { root.append(h("div", { class: "card" }, emptyN("No staff yet"))); return root; }
  root.append(h("div", { class: "grid g3" }, rows.map((u) => h("div", { class: "card scard" },
    h("div", { class: "row" }, h("span", { class: "mark", style: "width:38px;height:38px;border-radius:50%;flex:none" }, (u.name || u.email).charAt(0).toUpperCase()), h("div", { style: "min-width:0" }, h("b", null, u.name || u.email.split("@")[0]), h("div", { class: "sub", style: "overflow-wrap:anywhere" }, u.email))),
    h("div", { class: "row", style: "margin:12px 0;flex-wrap:wrap;gap:6px" }, pillN(ROLE_TXT[u.role] || u.role, "info"), pillN(u.status === "invited" ? "Invite not accepted yet" : cap(u.status), STATUS_KIND[u.status] || "mute")),
    manage && u.role !== "owner" ? h("div", { class: "row", style: "gap:6px" }, btnN("Edit", { "data-x": "staffEdit", "data-id": u.id }, "sm"), u.status === "active" ? btnN("Disable", { "data-x": "staffStatus", "data-id": u.id, "data-to": "disabled" }, "sm danger") : u.status === "disabled" ? btnN("Enable", { "data-x": "staffStatus", "data-id": u.id, "data-to": "active" }, "sm") : null) : null))));
  return root;
};
function inviteSheet() {
  return openSheet("Invite staff", (close) => {
    const email = h("input", { class: "inp", type: "email", autocomplete: "off", required: true }), name = h("input", { class: "inp", maxlength: "60", autocomplete: "off" }), role = h("select", { class: "inp" }, INVITE_ROLES.map((r) => h("option", { value: r }, ROLE_TXT[r]))), err = h("div", { class: "err", role: "alert" });
    const ok = async () => {
      err.textContent = ""; if (!email.value.trim()) return void (err.textContent = "Enter an email address.");
      try { const r = await api("POST", "/v2/users", { email: email.value.trim(), name: name.value.trim(), role: role.value }); close({ email: email.value.trim(), token: r.invite_token }); } catch (e) { err.textContent = e.message; }
    };
    return h("div", null, h("h3", null, "Invite staff"), field("Email", email), field("Name", name), field("Role", role), err, sheetButtons(close, "Create invite", ok));
  });
}
function tokenSheet(email, token) {
  return openSheet("Invite code", (close) => {
    const box = h("input", { class: "inp mono", readOnly: true, value: token, "aria-label": "Invite code" });
    box.addEventListener("focus", () => box.select());
    const copied = h("span", { class: "sub", role: "status" });
    return h("div", null, h("h3", null, "Invite created for " + email), h("p", { class: "sub" }, "No email or message is sent yet. Give this code to them yourself. It is shown only once, works one time, and expires (usually after 3 days)."),
      box, h("div", { class: "row", style: "margin-top:10px" }, on(btnN("Copy code", {}, "pri sm"), async () => { try { await navigator.clipboard.writeText(token); copied.textContent = "Copied"; } catch { box.select(); copied.textContent = "Press Ctrl+C to copy"; } }), copied),
      h("p", { class: "sub", style: "margin-top:12px" }, `They open this app, choose “Have an invite code?” on the log in page, and enter restaurant code ${AUTH.tenant || ""}, this code and a new password.`),
      h("div", { class: "row", style: "margin-top:14px" }, h("div", { class: "sp" }), on(btnN("Done", {}, "pri"), () => close(true))));
  });
}
function staffSheet(u) {
  return openSheet("Edit staff", (close) => {
    const name = h("input", { class: "inp", maxlength: "60", value: u.name || "" }), phone = h("input", { class: "inp", inputmode: "numeric", maxlength: "15", value: u.phone || "" }), role = h("select", { class: "inp" }, INVITE_ROLES.map((r) => h("option", { value: r, selected: r === u.role }, ROLE_TXT[r]))), err = h("div", { class: "err", role: "alert" });
    const ok = async () => {
      err.textContent = ""; const body = {};
      if (name.value.trim() !== (u.name || "")) body.name = name.value.trim();
      if (phone.value.trim() !== (u.phone || "")) body.phone = phone.value.trim();
      if (role.value !== u.role) body.role = role.value;
      if (!Object.keys(body).length) return close(null);
      try { close(await api("PATCH", `/v2/users/${u.id}`, body)); } catch (e) { err.textContent = e.message; }
    };
    return h("div", null, h("h3", null, "Edit " + (u.name || u.email)), field("Name", name), field("Phone (digits only)", phone), field("Role", role, "Changing the role signs them out so the new rights apply."), err, sheetButtons(close, "Save", ok));
  });
}

/* ---------------- online store ---------------- */
LOAD.store = async () => { await fetchSlot("store", "/v2/store"); };
V.store = () => {
  const st = stateOf("store"), s = st.data, root = h("div"), edit = can("orders.update");
  root.append(headN("Service", "Online store", [], true));
  if (st.err && !s) { root.append(errN(st.err, true)); return root; }
  if (!s) { root.append(h("div", { class: "sub", style: "padding:24px" }, "Loading…")); return root; }
  const row = (title, text, key, on_) => h("div", { class: "row sb setrow" }, h("div", null, h("b", null, title), h("div", { class: "sub" }, text)), h("button", { type: "button", class: "sw", role: "switch", "aria-checked": on_, "data-x": "storeFlag", "data-k": key, "aria-label": title, disabled: !edit }));
  root.append(h("div", { class: "card", style: "max-width:720px" },
    h("div", { class: "row sb" }, h("h3", null, "Taking online orders"), s.paused ? pillN("Paused", "bad") : pillN("Open", "ok")),
    row("Pause online orders", s.paused ? "Customers cannot place orders. They see the message below." : "Switch on if the kitchen is overloaded or you are closing early.", "paused", s.paused),
    row("Accept orders automatically", s.auto_accept ? "New online orders skip the New step." : "Staff accept each new order by hand.", "auto_accept", s.auto_accept),
    h("div", { class: "setrow" }, field("Message customers see (optional)", h("textarea", { id: "storenote", class: "inp", rows: "3", maxlength: "160", disabled: !edit, "aria-label": "Message customers see", placeholder: "For example: Kitchen is busy, orders take about 50 minutes today." }, s.notice || ""), "Up to 160 characters."),
      edit ? h("div", { class: "row" }, btnN("Save message", { "data-x": "storeNote" }, "pri sm")) : h("p", { class: "sub" }, "You can look at these settings but not change them."))));
  return root;
};

/* ---------------- riders ---------------- */
LOAD.rid = async () => { await fetchSlot("rid", "/v2/delivery/drivers"); };
V.rid = () => {
  const st = stateOf("rid"), rows = st.data || [], root = h("div");
  root.append(headN("Service", "Riders", [], true));
  if (st.err && st.data == null) { root.append(errN(st.err, true)); return root; }
  root.append(staleN("rid"));
  if (!rows.length) { root.append(h("div", { class: "card" }, emptyN("No delivery partners yet", "Invite someone with the role Rider from the Staff page.", can("users.view") ? btnN("Go to Staff", { "data-go": "stf" }, "sm") : null))); return root; }
  root.append(h("div", { class: "grid g3" }, rows.map((d) => h("div", { class: "card" },
    h("div", { class: "row sb" }, h("b", null, d.name), d.status !== "active" ? pillN(cap(d.status), "bad") : d.online ? pillN("Online", "ok") : pillN("Offline", "mute")),
    h("div", { class: "sub" }, d.phone || "No phone saved"),
    h("div", { class: "row", style: "margin-top:10px;gap:6px;flex-wrap:wrap" }, pillN(d.active_orders + (d.active_orders === 1 ? " order out" : " orders out"), d.active_orders ? "info" : "mute"), d.battery != null ? pillN("Battery " + d.battery + "%", d.battery < 20 ? "warn" : "mute") : null),
    h("div", { class: "sub", style: "margin-top:8px" }, d.seen_at ? `Last seen ${ago(d.seen_at)} ago` + (d.lat != null ? ` · ${(+d.lat).toFixed(4)}, ${(+d.lng).toFixed(4)}` : "") : "Has not shared a location yet")))));
  return root;
};

/* ---------------- menu ---------------- */
const roundRupee = (paise, pct) => Math.max(100, Math.round((paise * (1 + pct / 100)) / 100) * 100);
V.menu = () => {
  const root = h("div"), edit = can("menu.edit"), stock = can("menu.stock") || edit, cats = [...new Set(D.menu.map((m) => m.category))].sort();
  root.append(headN("Business", "Menu", [edit ? btnN("Add dish", { "data-mn": "add" }, "pri sm") : null]));
  if ((stock || edit) && cats.length) {
    root.append(h("div", { class: "card bulk" }, h("h3", null, "Bulk changes"), h("p", { class: "sub" }, "Change a whole category at once. You are asked to confirm first."),
      h("div", { class: "bulkrow" },
        stock ? h("div", { class: "bulkbox" }, field("Category", h("select", { id: "bulkcat", class: "inp" }, cats.map((c) => h("option", { value: c }, c)))), h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, btnN("Mark all sold out", { "data-x": "bulkStock", "data-a": "0" }, "sm danger"), btnN("Mark all in stock", { "data-x": "bulkStock", "data-a": "1" }, "sm"))) : null,
        edit ? h("div", { class: "bulkbox" }, formRow(field("Prices in", h("select", { id: "bulkpcat", class: "inp" }, h("option", { value: "" }, "All categories"), cats.map((c) => h("option", { value: c }, c)))), field("Change by %", h("input", { id: "bulkpct", class: "inp", inputmode: "decimal", placeholder: "e.g. 5 or -10", "aria-label": "Percent to change prices by" }))), btnN("Change prices…", { "data-x": "bulkPrice" }, "sm")) : null)));
  }
  root.append(h("div", { class: "card", style: "margin-top:14px" }, D.menu.length ? rtable([{ h: "Code" }, { h: "Dish" }, { h: "Category" }, { h: "Station" }, { h: "Price", r: 1 }, { h: "In stock" }, { h: "" }], D.menu.map((m) => [
    m.code ? h("span", { class: "mono" }, String(m.code)) : "", h("span", null, h("b", null, m.name), m.description ? h("span", { class: "sub dsc" }, m.description) : null, m.image_url ? h("span", { class: "sub" }, "Has a photo link") : null), m.category, m.station, RS(m.price),
    stock ? h("button", { type: "button", class: "sw", role: "switch", "aria-checked": m.available, "data-mn": "stock", "data-v": m.id, "aria-label": "In stock: " + m.name }) : (m.available ? "Yes" : "No"),
    edit ? btnN("Edit", { "data-mn": "edit", "data-v": m.id }, "sm") : ""]), "Menu") : emptyN("No dishes yet", "Add your first one.")));
  return root;
};

async function menuForm(m) {
  const cats = [...new Set(D.menu.map((x) => x.category))];
  const v = await openSheet(m ? "Edit dish" : "Add dish", (close) => {
    const f = {
      name: h("input", { class: "inp", maxlength: "80", value: m ? m.name : "", autofocus: true }), price: h("input", { class: "inp", inputmode: "decimal", value: m ? m.price / 100 : "" }),
      code: h("input", { class: "inp", inputmode: "numeric", value: m && m.code ? m.code : "", disabled: !!m }), cat: h("input", { class: "inp", maxlength: "40", list: "catlist", value: m ? m.category : "", autocomplete: "off" }),
      station: h("input", { class: "inp", maxlength: "24", value: m ? m.station || "kitchen" : "kitchen" }),
      desc: h("textarea", { class: "inp", rows: "3", maxlength: "240", placeholder: "Shown to online customers" }, m ? m.description || "" : ""),
      img: h("input", { class: "inp", type: "url", maxlength: "300", inputmode: "url", placeholder: "https://…", value: m ? m.image_url || "" : "" }),
    };
    const err = h("div", { class: "err", role: "alert" });
    const ok = () => {
      const price = Math.round(num(f.price.value) * 100), img = f.img.value.trim();
      if (!f.name.value.trim() || !f.cat.value.trim()) return void (err.textContent = "Name and category are needed.");
      if (!Number.isFinite(price) || price < 0) return void (err.textContent = "Enter the price in rupees.");
      if (img && !/^https?:\/\//i.test(img)) return void (err.textContent = "The photo link must start with http:// or https://");
      close({ name: f.name.value.trim(), price, code: +f.code.value || undefined, category: f.cat.value.trim(), station: f.station.value.trim() || "kitchen", description: f.desc.value.trim(), image_url: img });
    };
    return h("div", null, h("h3", null, m ? "Edit dish" : "Add dish"), field("Name", f.name), formRow(field("Price (₹)", f.price), field("Code", f.code)), formRow(field("Category", f.cat), field("Kitchen station", f.station)),
      h("datalist", { id: "catlist" }, cats.map((c) => h("option", { value: c }))), field("Description", f.desc, "Up to 240 characters."), field("Photo link", f.img, "A web address of the photo. Photos are not previewed here."), err, sheetButtons(close, "Save", ok));
  });
  if (!v) return;
  const body = m ? { name: v.name, price: v.price, category: v.category, station: v.station, description: v.description, image_url: v.image_url } : v;
  const r = await guard(() => (m ? api("PATCH", `/v2/pos/menu/${m.id}`, body) : api("POST", "/v2/pos/menu", body)));
  if (r) { P.ready = false; await LOAD.menu(); renderPage(); toast("Saved"); }
}

async function afterMenuBulk(res, what) { P.ready = false; await LOAD.menu(); renderPage(); toast(`${what}: ${res.updated} ${res.updated === 1 ? "dish" : "dishes"} updated`); }

Object.assign(XA, {
  async offerNew() { const r = await offerSheet(null); if (r) { toast("Offer " + r.code + " created"); await LOAD.off(); renderPage(); } },
  async offerEdit(el) { const c = slotData("off", []).find((x) => x.id === el.dataset.id); if (!c) return; const r = await offerSheet(c); if (r) { toast("Offer saved"); await LOAD.off(); renderPage(); } },
  async offerActive(el) { const c = slotData("off", []).find((x) => x.id === el.dataset.id); if (!c) return; el.disabled = true; try { await api("PATCH", `/v2/coupons/${c.id}`, { active: !(c.active !== false) }); } catch (e) { toast(e.message, 4500); } await LOAD.off(); renderPage(); },
  async offerDel(el) {
    if (!(await confirmSheet("Delete offer " + el.dataset.code + "?", "Customers will no longer be able to use this code. Orders already placed keep their discount.", "Delete", true))) return;
    try { await api("DELETE", `/v2/coupons/${el.dataset.id}`); toast("Offer deleted"); } catch (e) { toast(e.message, 4500); }
    await LOAD.off(); renderPage();
  },
  async staffInvite() {
    const r = await inviteSheet(); if (!r) return;
    await LOAD.stf(); renderPage();
    await tokenSheet(r.email, r.token);
  },
  async staffEdit(el) { const u = slotData("stf", []).find((x) => x.id === el.dataset.id); if (!u) return; const r = await staffSheet(u); if (r) { toast("Saved"); await LOAD.stf(); renderPage(); } },
  async staffStatus(el) {
    const u = slotData("stf", []).find((x) => x.id === el.dataset.id); if (!u) return;
    if (el.dataset.to === "disabled" && !(await confirmSheet("Disable " + (u.name || u.email) + "?", "They are signed out now and cannot log in until you enable them again.", "Disable", true))) return;
    try { await api("PATCH", `/v2/users/${u.id}`, { status: el.dataset.to }); toast(el.dataset.to === "active" ? "Enabled" : "Disabled"); } catch (e) { toast(e.message, 4500); }
    await LOAD.stf(); renderPage();
  },
  async storeFlag(el) {
    const k = el.dataset.k, cur = slotData("store", {})[k]; el.disabled = true;
    try { S.store = { data: await api("PUT", "/v2/store", { [k]: !cur }), err: "" }; toast(k === "paused" ? (S.store.data.paused ? "Online orders paused" : "Online orders are open again") : (S.store.data.auto_accept ? "Orders are accepted automatically" : "Orders need to be accepted by hand")); } catch (e) { toast(e.message, 4500); }
    renderPage();
  },
  async storeNote() {
    const v = document.getElementById("storenote").value.trim();
    try { S.store = { data: await api("PUT", "/v2/store", { notice: v }), err: "" }; toast(v ? "Message saved" : "Message cleared"); } catch (e) { toast(e.message, 4500); }
    renderPage();
  },
  async bulkStock(el) {
    const cat = document.getElementById("bulkcat").value, avail = el.dataset.a === "1", n = D.menu.filter((m) => m.category === cat).length;
    if (!(await confirmSheet(avail ? `Put all ${cat} back in stock?` : `Mark all ${cat} as sold out?`, `${n} ${n === 1 ? "dish" : "dishes"} in ${cat} will be ${avail ? "available" : "unavailable"} at the counter and online until you change them back.`, avail ? "Mark in stock" : "Mark sold out", !avail))) return;
    const res = await guard(() => api("POST", "/v2/pos/menu/bulk-availability", { category: cat, available: avail }));
    if (res) await afterMenuBulk(res, avail ? "Back in stock" : "Sold out");
  },
  async bulkPrice() {
    const pct = num(document.getElementById("bulkpct").value), cat = document.getElementById("bulkpcat").value;
    if (pct === null || Number.isNaN(pct) || pct === 0 || pct < -50 || pct > 100) return toast("Enter a percent between -50 and 100, not zero.", 4000);
    const items = D.menu.filter((m) => !cat || m.category === cat), eg = items[0];
    if (!items.length) return toast("There are no dishes there.");
    if (!(await confirmSheet(`${pct > 0 ? "Raise" : "Lower"} prices by ${Math.abs(pct)}%?`, `${items.length} ${items.length === 1 ? "dish" : "dishes"} in ${cat || "all categories"} change. Prices are rounded to a whole rupee, never below ₹1. For example ${eg.name}: ${RS(eg.price)} becomes ${RS(roundRupee(eg.price, pct))}. Open bills keep their old prices.`, "Change prices", pct > 0))) return;
    const res = await guard(() => api("POST", "/v2/pos/menu/bulk-price", { category: cat || null, pct }));
    if (res) await afterMenuBulk(res, "Prices changed");
  },
});
