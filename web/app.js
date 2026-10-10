"use strict";
/* Shell: login, navigation, routing, theme, command palette, printer status. */
let page = (location.hash || "#home").slice(1), range = 14, RULES = null, poll = null;
if (!PAGES[page]) page = "home";

function showLogin(msg = "") {
  $("#shell").hidden = true; $("#login").hidden = false;
  $("#login").innerHTML = `<form id="lf" autocomplete="on"><div class="brand" style="padding:0"><span class="mark">N</span><div><b>Nova</b><small>Restaurant OS</small></div></div><h1>Log in</h1>
    <label class="f">Restaurant<input id="lt" class="inp" name="tenant" value="${esc(AUTH.tenant)}" placeholder="e.g. hyderabadi-irani" autocapitalize="none" required></label>
    <label class="f">Email<input id="le" class="inp" name="email" type="email" autocomplete="username" required></label>
    <label class="f">Password<input id="lp" class="inp" name="password" type="password" autocomplete="current-password" required></label>
    <div class="err" id="lerr" role="alert">${esc(msg)}</div><button class="btn pri" style="min-height:48px;justify-content:center">Log in</button></form>`;
  $("#lf").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await login($("#lt").value.trim().toLowerCase(), $("#le").value.trim(), $("#lp").value); await boot(); } catch (er) { $("#lerr").textContent = er.status === 401 ? "Wrong restaurant, email or password." : er.message; }
  });
  ($("#lt").value ? $("#le") : $("#lt")).focus();
}

async function boot() {
  RULES = await api("GET", "/v2/pos/rules");
  $("#login").hidden = true; $("#shell").hidden = false;
  P.ready = false; P.bills = []; P.cur = null;
  await agent.status(); updateAgentPill();
  clearInterval(poll); poll = setInterval(tick, 5000); setInterval(async () => { await agent.status(); updateAgentPill(); }, 20000);
  go(page);
}

function updateAgentPill() {
  const el = $("#agent"); if (!el) return;
  el.className = "pill " + (agent.online ? "p-ok" : "p-warn");
  el.textContent = agent.online ? "Printer ready" : "Printer app not running";
  el.title = agent.online ? `Connected${agent.printer ? ": " + agent.printer : ""}` : "Start the Nova print app on this computer to print bills and kitchen tickets.";
}

function side() {
  $("#side").innerHTML = `<div class="brand"><span class="mark">N</span><div><b>Nova</b><small>${esc(RULES.brand)}</small></div></div>` +
    NAV.map((g) => `<div class="grp">${g[0]}</div>` + g[1].map((p) => `<button class="nav" data-go="${p[0]}" ${p[0] === page ? 'aria-current="page"' : ""}>${ic(I[p[2]])}<span>${p[1]}</span>${LIVE.has(p[0]) ? "" : '<span class="n">preview</span>'}</button>`).join("")).join("") +
    `<div class="tenant"><b>${esc(RULES.brand)}</b>${esc(RULES.role)}</div>`;
}

/* draw the current page (sync); data is loaded by go()/tick() */
function renderPage() {
  const keep = document.activeElement && document.activeElement.id;
  const view = V[page];
  $("#stage").innerHTML = (LIVE.has(page) || page === "con" ? "" : `<div class="sample-flag">DESIGN PREVIEW · made-up numbers, not connected yet</div>`) + (view ? view() : "");
  side(); document.title = (PAGES[page] ? PAGES[page].t + " · " : "") + "Nova";
  if (keep) { const n = document.getElementById(keep); if (n && n.focus) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch { /* not a text input */ } } }
}

async function go(p) {
  page = p; history.replaceState(null, "", "#" + p); $("#side").classList.remove("open");
  $("#stage").innerHTML = `<div class="sub" style="padding:24px">Loading…</div>`;
  try {
    if (p === "pos") await initPos(); else if (LOAD[p]) await LOAD[p]();
    if (p === "rules" && D.roles && RULES.role === "owner") startDraft();
  } catch (e) { toast(e.message, 4500); }
  renderPage(); $("#stage").scrollTop = 0;
}

/* keep live screens fresh without stealing focus from forms */
async function tick() {
  if (document.hidden || document.querySelector(".mod")) return;
  const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  try {
    if (page === "kds") { await LOAD.kds(); if (!typing) renderPage(); }
    else if (page === "ord") { await LOAD.ord(); renderPage(); }
    else if (page === "pos" && !typing && !P.busy) { await refreshBills(); }
  } catch { /* offline for a moment; the next tick will recover */ }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go]"); if (t) { go(t.dataset.go); return; }
  if (e.target.closest("[data-sample]")) { SAMPLE(); return; }
  const sw = e.target.closest("[data-sw]"); if (sw) { sw.setAttribute("aria-checked", sw.getAttribute("aria-checked") !== "true"); return; }
  const chip = e.target.closest(".chip"); if (chip && !chip.dataset.a && !chip.dataset.rl) chip.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
});
$("#menu").onclick = () => $("#side").classList.toggle("open");
$("#logout").onclick = async () => { await logout(); clearInterval(poll); showLogin(); };
$("#theme").onclick = () => { const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme:dark)").matches; r.dataset.theme = dark ? "light" : "dark"; };
window.addEventListener("nova-logout", () => { clearInterval(poll); showLogin("Your session ended. Please log in again."); });

/* command palette */
function pal() {
  if ($(".pal")) return;
  const all = Object.entries(PAGES).map(([k, v]) => [k, v.t]);
  const el = document.createElement("div"); el.className = "pal"; el.innerHTML = `<div><input id="pq" placeholder="Type a page" aria-label="Jump to a page"><div id="pr"></div></div>`; document.body.append(el);
  const q = $("#pq", el), r = $("#pr", el);
  const draw = () => { const f = all.filter((a) => a[1].toLowerCase().includes(q.value.toLowerCase())).slice(0, 8); r.innerHTML = f.map((a, i) => `<button class="${i ? "" : "on"}" data-p="${a[0]}">${esc(a[1])}</button>`).join("") || `<div class="sub" style="padding:14px 16px">No match</div>`; };
  q.oninput = draw; draw(); q.focus();
  el.onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { el.remove(); go(b.dataset.p); } else if (e.target === el) el.remove(); };
  q.onkeydown = (e) => { if (e.key === "Escape") el.remove(); if (e.key === "Enter") { const b = $("[data-p]", el); if (b) { el.remove(); go(b.dataset.p); } } };
}
$("#cmd").onclick = pal;
addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal(); } });
addEventListener("hashchange", () => { const p = location.hash.slice(1); if (PAGES[p] && p !== page && RULES) go(p); });

(async () => { if (await resume()) { try { await boot(); return; } catch { /* fall through to login */ } } showLogin(); })();
