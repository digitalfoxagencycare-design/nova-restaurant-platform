"use strict";
/* Drill-down analysis panel: pick dates, split the figures by anything, click a slice/bar/row to filter, repeat, then open the bills
   and one bill in full. Talks to /v2/analytics (one restaurant) or /v2/platform/analytics (all restaurants).

   Drill.create({ prefix, mode, canOpenBill, openBill, state }) -> { el, load }
     prefix       "/v2/analytics" (default) or "/v2/platform/analytics"
     mode         "restaurant" (default) or "platform"
     canOpenBill  () => boolean  (default: always)
     openBill     (record) => void, replaces the built-in side drawer
     state        a plain object that survives a re-render; see DEFAULT_STATE.

   Everything is built with h() / s() (DOM APIs): server text never goes through innerHTML.
   Uses the globals of the other scripts: h, api, AUTH, refreshTokens, openSheet, RS, dtm, hm, cap, pillN, btnN, on, toast, STATE_TXT, STATE_KIND. */

const Drill = (() => {
  const SVGNS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs, ...kids) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v === true ? "" : String(v));
    kids.forEach((c) => c != null && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return el;
  };
  const MEASURE_MONEY = new Set(["sales", "avg_bill", "discount", "tax"]);
  const fmt = (m, v) => (MEASURE_MONEY.has(m) ? RS(v) : Number(v || 0).toLocaleString("en-IN"));
  const short = (m, v) => (MEASURE_MONEY.has(m) ? compactRs(v) : v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v)));
  const pct = (x) => (Math.round(x * 1000) / 10).toLocaleString("en-IN") + "%";
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayShort = (k) => new Date(k + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const PRESETS = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["month", "This month"], ["custom", "Custom"]];
  const PAGE = 50;

  function presetRange(p) {
    const t = new Date();
    if (p === "today") return [iso(t), iso(t)];
    if (p === "7d") return [iso(addDays(t, -6)), iso(t)];
    if (p === "30d") return [iso(addDays(t, -29)), iso(t)];
    if (p === "month") return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
    return null;
  }
  const DEFAULT_STATE = () => ({ preset: "7d", from: "", to: "", by: "channel", filters: [], measure: "sales", compare: true, scope: "sales", chart: "auto", showBills: false, sort: null, dir: -1, page: 0, billSort: "created_at" });

  const META = {};   /* prefix -> meta, fetched once */

  function create(opts = {}) {
    const prefix = opts.prefix || "/v2/analytics", platform = opts.mode === "platform" || prefix.includes("/platform/");
    const canOpen = opts.canOpenBill || (() => true);
    const W = opts.state || {};   /* the caller's object is mutated, so the choices survive a re-render */
    const dflt = DEFAULT_STATE();
    for (const k of Object.keys(dflt)) if (!(k in W)) W[k] = dflt[k];
    if (!W.from || !W.to) { const r = presetRange(W.preset) || presetRange("7d"); [W.from, W.to] = r; }
    let meta = META[prefix] || null, data = null, recs = null, err = "", recErr = "", busy = false, recBusy = false, seq = 0, rseq = 0, dateErr = "";

    const root = h("div", { class: "drill" });
    const live = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
    const bar = h("div", { class: "dbar" }), crumbs = h("nav", { class: "dcrumbs", "aria-label": "Layers you have drilled into" }), tilesBox = h("div", { class: "dtiles" }),
      chartCard = h("section", { class: "card dchart", "aria-label": "Chart" }), tableCard = h("section", { class: "card", "aria-label": "Breakdown table" }), billsCard = h("section", { class: "card", "aria-label": "Bills" });
    root.append(live, bar, crumbs, tilesBox, chartCard, tableCard, billsCard);

    const cmpOn = () => W.compare && !W.filters.some((f) => f.dim === "day" || f.dim === "month");
    const dimOf = (k) => (meta ? meta.dimensions.find((d) => d.key === k) : null) || { key: k, label: k, time: false };
    const measureLabel = (k) => ((meta && meta.measures.find((m) => m.key === k)) || { label: k }).label;
    const query = (extra = {}) => {
      const p = new URLSearchParams();
      p.set("from", W.from); p.set("to", W.to); p.set("scope", W.scope);
      W.filters.forEach((f) => p.append("f", `${f.dim}:${f.value}`));
      Object.entries(extra).forEach(([k, v]) => p.set(k, v));
      return p.toString();
    };

    /* ---------------- data ---------------- */
    async function load() {
      const my = ++seq;
      busy = true; err = ""; paint();
      try {
        if (!meta) { meta = META[prefix] = await api("GET", prefix + "/meta"); if (!meta.dimensions.some((d) => d.key === W.by)) W.by = meta.suggested_path[0]; }
        const d = await api("GET", `${prefix}/breakdown?${query({ by: W.by, compare: cmpOn() })}`);
        if (my !== seq) return;
        data = d;
        live.textContent = `${measureLabel(W.measure)} by ${d.label}: ${d.rows.filter((r) => r.orders).length} groups, ${fmt("sales", d.totals.sales)} from ${d.totals.orders} bills.`;
      } catch (e) { if (my !== seq) return; err = e.message; }
      busy = false; paint();
      if (!err && W.showBills) loadRecords();
    }
    async function loadRecords() {
      const my = ++rseq;
      recBusy = true; recErr = ""; paintBills();
      try {
        const r = await api("GET", `${prefix}/records?${query({ limit: PAGE, offset: W.page * PAGE, sort: W.billSort })}`);
        if (my !== rseq) return;
        recs = r;
      } catch (e) { if (my !== rseq) return; recErr = e.message; }
      recBusy = false; paintBills();
    }

    /* ---------------- drilling ---------------- */
    function nextDim(afterBy) {
      const used = new Set(W.filters.map((f) => f.dim));
      const path = (meta && meta.suggested_path) || [];
      const pick = path.find((k) => !used.has(k) && k !== afterBy) || (meta && meta.dimensions.map((d) => d.key).find((k) => !used.has(k) && !dimOf(k).time && k !== afterBy));
      return pick || afterBy;
    }
    function drillInto(row) {
      if (!row || !row.orders) return;
      const dim = W.by;
      W.filters = W.filters.filter((f) => f.dim !== dim).concat([{ dim, value: row.key, label: row.label }]);
      W.by = nextDim(dim); W.page = 0;
      live.textContent = `Filtered to ${dimOf(dim).label}: ${row.label}. Now split by ${dimOf(W.by).label}.`;
      load();
    }
    function truncateTo(n) { W.filters = W.filters.slice(0, n); W.page = 0; W.by = nextDim(null); load(); }
    function removeLayer(i) { const f = W.filters[i]; W.filters = W.filters.filter((_, j) => j !== i); W.page = 0; if (f && dimOf(f.dim).key) W.by = f.dim; load(); }

    /* ---------------- toolbar ---------------- */
    function paintBar() {
      const presets = h("div", { class: "seg dpresets", role: "group", "aria-label": "Dates" }, PRESETS.map(([k, l]) => on(h("button", { type: "button", "aria-pressed": W.preset === k }, l), () => {
        W.preset = k; const r = presetRange(k); if (r) [W.from, W.to] = r; W.page = 0; if (k === "custom") paintBar(); else load();
      })));
      const dFrom = h("input", { class: "inp dinp", type: "date", value: W.from, "aria-label": "From date", max: iso(new Date()) }), dTo = h("input", { class: "inp dinp", type: "date", value: W.to, "aria-label": "To date", max: iso(new Date()) });
      const apply = () => {
        if (!dFrom.value || !dTo.value) return;
        if (dFrom.value > dTo.value) { dateErr = "The start date is after the end date."; paintBar(); return; }
        if ((new Date(dTo.value) - new Date(dFrom.value)) / 864e5 >= 366) { dateErr = "Choose at most 366 days."; paintBar(); return; }
        dateErr = ""; W.from = dFrom.value; W.to = dTo.value; W.page = 0; load();
      };
      dFrom.addEventListener("change", apply); dTo.addEventListener("change", apply);
      const cmp = h("input", { type: "checkbox", checked: W.compare, id: "d-cmp" }); cmp.addEventListener("change", () => { W.compare = cmp.checked; load(); });
      const scope = h("input", { type: "checkbox", checked: W.scope === "all", id: "d-scope" }); scope.addEventListener("change", () => { W.scope = scope.checked ? "all" : "sales"; W.page = 0; load(); });
      bar.replaceChildren(...[
        h("div", { class: "row dbar1" }, presets,
          W.preset === "custom" ? h("div", { class: "row dcustom" }, h("label", { class: "sub" }, "From ", dFrom), h("label", { class: "sub" }, "To ", dTo)) : null,
          h("div", { class: "sp" }),
          on(btnN("Refresh", { "aria-label": "Refresh figures" }, "sm"), () => load()),
          on(btnN(platform ? "Download CSV (audited)" : "Download CSV", { "data-d": "csv" }, "sm"), downloadCsv)),
        dateErr ? h("div", { class: "err", role: "alert" }, dateErr) : null,
        h("div", { class: "row dbar2" }, h("label", { class: "dchk" }, cmp, " Compare with the previous period"), h("label", { class: "dchk" }, scope, " Include open and cancelled bills"),
          h("span", { class: "sub" }, `${dayShort(W.from)}${W.from === W.to ? "" : " to " + dayShort(W.to)}`), W.compare && !cmpOn() ? h("span", { class: "sub" }, "· comparison is off while a single day or month is chosen") : null)].filter(Boolean));
    }

    function paintCrumbs() {
      const kids = [on(h("button", { type: "button", class: "dcrumb" + (W.filters.length ? "" : " cur"), "aria-current": W.filters.length ? null : "true" }, W.scope === "all" ? "All bills" : "All sales"), () => W.filters.length && truncateTo(0))];
      W.filters.forEach((f, i) => {
        kids.push(h("span", { class: "dsep", "aria-hidden": "true" }, "›"));
        const last = i === W.filters.length - 1;
        kids.push(h("span", { class: "dchip" + (last ? " cur" : "") },
          on(h("button", { type: "button", class: "dcrumb", "aria-label": `Go back to ${dimOf(f.dim).label}: ${f.label}` }, h("span", { class: "sub" }, dimOf(f.dim).label + ": "), f.label), () => !last && truncateTo(i + 1)),
          on(h("button", { type: "button", class: "dx", "aria-label": `Remove filter ${dimOf(f.dim).label}: ${f.label}` }, "×"), () => removeLayer(i))));
      });
      crumbs.replaceChildren(...kids);
    }

    /* ---------------- tiles ---------------- */
    function delta(m, cur, prev) {
      if (!data || !data.previous) return null;
      const p = data.previous[m];
      if (!p) return h("span", { class: "delta sub" }, cur ? "new vs previous period" : "no change");
      const d = (cur - p) / p, good = m === "discount" ? d <= 0 : d >= 0;
      return h("span", { class: "delta " + (good ? "up" : "dn") }, (d >= 0 ? "▲ " : "▼ ") + pct(Math.abs(d)) + " vs " + fmt(m, p));
    }
    function paintTiles() {
      const ms = meta ? meta.measures : [];
      tilesBox.replaceChildren(...ms.map((m) => {
        const v = data ? data.totals[m.key] : null;
        return on(h("button", { type: "button", class: "card kpi dtile", "aria-pressed": W.measure === m.key, "aria-label": `${m.label}: ${v == null ? "loading" : fmt(m.key, v)}. Show the chart by ${m.label}` },
          h("small", null, m.label), h("strong", null, v == null ? "–" : fmt(m.key, v)), data ? (cmpOn() ? delta(m.key, v) : null) : null), () => { W.measure = m.key; paint(); });
      }));
      tilesBox.classList.toggle("busy", busy);
    }

    /* ---------------- chart ---------------- */
    const tip = h("div", { class: "dtip", role: "presentation", hidden: true });
    function showTip(target, lines, wrap) {
      tip.replaceChildren(...lines.map((l, i) => h(i ? "div" : "b", null, l)));
      tip.hidden = false;
      const a = (target.querySelector(".dbarv,.ddot") || target).getBoundingClientRect(), w = wrap.getBoundingClientRect();
      const x = Math.min(Math.max(a.left + a.width / 2 - w.left, 70), Math.max(70, w.width - 70));
      tip.style.left = x + "px"; tip.style.top = Math.max(a.top - w.top - 8, 0) + "px";
    }
    const hideTip = () => { tip.hidden = true; };
    /* roving focus: arrows move between points, Enter/Space picks */
    function rove(group) {
      const items = () => [...group.querySelectorAll("[data-pt]:not([aria-disabled])")];
      group.addEventListener("keydown", (e) => {
        const it = items(), i = it.indexOf(document.activeElement);
        if (i < 0) return;
        let n = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") n = it[(i + 1) % it.length];
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = it[(i - 1 + it.length) % it.length];
        else if (e.key === "Home") n = it[0]; else if (e.key === "End") n = it[it.length - 1];
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.activeElement.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
        if (n) { e.preventDefault(); it.forEach((x) => x.setAttribute("tabindex", "-1")); n.setAttribute("tabindex", "0"); n.focus(); }
      });
    }
    const ptLabel = (row, m, total) => `${row.label}: ${fmt(m, row[m])}${total ? ", " + pct(row[m] / total) + " of " + measureLabel(m).toLowerCase() : ""}. ${row.orders} bills.`;

    function colorOf(i) { return "c" + (i % 8); }

    function donut(rows, wrap) {
      const m = W.measure, vals = rows.filter((r) => r[m] > 0).sort((a, b) => b[m] - a[m]);
      const total = vals.reduce((a, r) => a + r[m], 0);
      let shown = vals, other = 0;
      if (vals.length > 8) { shown = vals.slice(0, 7); other = vals.slice(7).reduce((a, r) => a + r[m], 0); }
      const R = 100, r0 = 62, cx = 110, cy = 110;
      let a0 = -Math.PI / 2;
      const arc = (a, b) => {
        const e = Math.min(b, a + Math.PI * 2 - 0.0001), big = e - a > Math.PI ? 1 : 0, P = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
        return `M${P(R, a)}A${R} ${R} 0 ${big} 1 ${P(R, e)}L${P(r0, e)}A${r0} ${r0} 0 ${big} 0 ${P(r0, a)}Z`;
      };
      const svg = s("svg", { viewBox: "0 0 220 220", class: "ddonut", role: "group", "aria-label": `${measureLabel(m)} by ${data.label}. Arrow keys move between slices, Enter drills in.` });
      const pts = [];
      shown.forEach((row, i) => {
        const frac = row[m] / total, a1 = a0 + frac * Math.PI * 2;
        const p = s("path", { d: arc(a0, a1), class: "dslice " + colorOf(i), role: "button", tabindex: i === 0 ? "0" : "-1", "data-pt": row.key, "aria-label": ptLabel(row, m, total) + " Click to drill in." });
        p.addEventListener("click", () => drillInto(row));
        const sh = () => { p.classList.add("hot"); showTip(p, [row.label, fmt(m, row[m]) + " · " + pct(frac), row.orders + " bills"], wrap); };
        const hd = () => { p.classList.remove("hot"); hideTip(); };
        p.addEventListener("pointerenter", sh); p.addEventListener("pointerleave", hd); p.addEventListener("focus", sh); p.addEventListener("blur", hd);
        pts.push({ row, p, i }); svg.append(p); a0 = a1;
      });
      if (other > 0) { const p = s("path", { d: arc(a0, -Math.PI / 2 + Math.PI * 2), class: "dslice cO", "aria-hidden": "true" }); p.addEventListener("pointerenter", () => showTip(p, ["Everything else", fmt(m, other) + " · " + pct(other / total)], wrap)); p.addEventListener("pointerleave", hideTip); svg.append(p); }
      svg.append(s("text", { x: cx, y: cy - 2, "text-anchor": "middle", class: "dctr" }, fmt(m, total)), s("text", { x: cx, y: cy + 16, "text-anchor": "middle", class: "dctr2" }, "total " + measureLabel(m).toLowerCase()));
      rove(svg);
      const legend = h("ul", { class: "dlegend" }, shown.map((row, i) => h("li", null, (() => {
        const b = h("button", { type: "button", class: "dleg", "aria-label": ptLabel(row, m, total) + " Click to drill in." }, h("i", { class: "sw8 " + colorOf(i) }), h("span", { class: "dl" }, row.label), h("span", { class: "mono dv" }, fmt(m, row[m])), h("span", { class: "sub dp" }, pct(row[m] / total)));
        b.addEventListener("click", () => drillInto(row));
        const p = pts[i].p;
        b.addEventListener("pointerenter", () => { p.classList.add("hot"); showTip(p, [row.label, fmt(m, row[m]) + " · " + pct(row[m] / total), row.orders + " bills"], wrap); });
        b.addEventListener("pointerleave", () => { p.classList.remove("hot"); hideTip(); });
        b.addEventListener("focus", () => p.classList.add("hot")); b.addEventListener("blur", () => p.classList.remove("hot"));
        return b;
      })())).concat(other > 0 ? [h("li", { class: "sub dother" }, `Everything else · ${fmt(m, other)} · ${pct(other / total)} (see the table)`)] : []));
      return h("div", { class: "dsplit" }, svg, legend);
    }

    function columns(rows, wrap, asLine) {
      const m = W.measure, n = rows.length, mx = Math.max(1, ...rows.map((r) => r[m])) * 1.08;
      const Wd = 640, Ht = 260, L = 46, B = 28, T = 10, Rr = 8, pw = Wd - L - Rr, ph = Ht - B - T, slot = pw / n;
      const svg = s("svg", { viewBox: `0 0 ${Wd} ${Ht}`, class: "dcols", role: "group", "aria-label": `${measureLabel(m)} by ${data.label}. Arrow keys move between points, Enter drills in.` });
      const Y = (v) => T + ph - (ph * v) / mx;
      for (let k = 0; k <= 4; k++) {
        const y = Y((mx * k) / 4);
        svg.append(s("line", { x1: L, x2: Wd - Rr, y1: y, y2: y, class: "dgrid" }), s("text", { x: L - 6, y: y + 3, "text-anchor": "end", class: "dax" }, short(m, (mx * k) / 4)));
      }
      const step = Math.max(1, Math.ceil(n / 8));
      const focusable = rows.findIndex((r) => r.orders > 0);
      const total = rows.reduce((a, r) => a + r[m], 0);
      const xc = (i) => L + slot * i + slot / 2;
      if (asLine) {
        const pts = rows.map((r, i) => [xc(i), Y(r[m])]);
        svg.append(s("path", { d: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("") + `L${pts[n - 1][0]} ${T + ph}L${pts[0][0]} ${T + ph}Z`, class: "darea" }),
          s("path", { d: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(""), class: "dpath" }));
      }
      rows.forEach((r, i) => {
        const can = r.orders > 0, x = L + slot * i, v = r[m], bh = ph - (Y(v) - T);
        const g = s("g", { class: "dpt" + (can ? "" : " off"), "data-pt": r.key, role: can ? "button" : null, tabindex: can ? (i === focusable ? "0" : "-1") : null, "aria-disabled": can ? null : "true", "aria-label": can ? ptLabel(r, m, total) + " Click to drill in." : `${r.label}: no bills` });
        g.append(s("rect", { x, y: T, width: slot, height: ph, class: "dhit" }));
        if (asLine) g.append(s("circle", { cx: xc(i), cy: Y(v), r: n > 40 ? 3 : 4.5, class: "ddot" })); else g.append(s("rect", { x: x + slot * 0.15, y: Y(v), width: slot * 0.7, height: Math.max(v ? 2 : 0, bh), rx: 3, class: "dbarv" }));
        if (can) {
          g.addEventListener("click", () => drillInto(r));
          g.addEventListener("pointerenter", () => { g.classList.add("hot"); showTip(g, [r.label, fmt(m, v) + (total && m !== "avg_bill" ? " · " + pct(v / total) : ""), r.orders + " bills"], wrap); });
          g.addEventListener("pointerleave", () => { g.classList.remove("hot"); hideTip(); });
          g.addEventListener("focus", () => { g.classList.add("hot"); showTip(g, [r.label, fmt(m, v), r.orders + " bills"], wrap); });
          g.addEventListener("blur", () => { g.classList.remove("hot"); hideTip(); });
        }
        svg.append(g);
        if (i % step === 0) svg.append(s("text", { x: xc(i), y: Ht - 8, "text-anchor": "middle", class: "dax" }, dimOf(W.by).key === "day" ? dayShort(r.key) : r.label.length > 10 ? r.label.slice(0, 9) + "…" : r.label));
      });
      rove(svg);
      return h("div", { class: "dsplit one" }, svg);
    }

    function paintChart() {
      chartCard.replaceChildren();
      const dims = meta ? meta.dimensions : [];
      const sel = h("select", { class: "inp dsel", id: "d-by", "aria-label": "Split by" }, dims.map((d) => h("option", { value: d.key, selected: d.key === W.by }, d.label)));
      sel.addEventListener("change", () => { W.by = sel.value; W.page = 0; load(); });
      const timeDim = dimOf(W.by).time;
      const kind = W.chart !== "auto" ? W.chart : timeDim ? (data && data.rows.length > 31 ? "line" : "bars") : W.measure === "avg_bill" ? "bars" : "donut";
      const types = timeDim ? [["bars", "Bars"], ["line", "Line"]] : [["donut", "Donut"], ["bars", "Bars"]];
      const useKind = types.some((t) => t[0] === kind) ? kind : types[0][0];
      const tg = h("div", { class: "seg", role: "group", "aria-label": "Chart type" }, types.map(([k, l]) => on(h("button", { type: "button", "aria-pressed": useKind === k }, l), () => { W.chart = k; paintChart(); })));
      chartCard.append(h("div", { class: "row dtools" }, h("div", null, h("h3", null, `${measureLabel(W.measure)} by ${dimOf(W.by).label.toLowerCase()}`),
        h("div", { class: "sub" }, W.filters.length ? "Inside: " + W.filters.map((f) => f.label).join(" › ") : "Click a slice, bar or legend row to drill into it")),
        h("div", { class: "sp" }), h("label", { class: "row sub dby" }, "Split by", sel), tg));
      const wrap = h("div", { class: "dwrap" + (busy ? " busy" : ""), "aria-busy": busy ? "true" : "false" }, tip);
      chartCard.append(wrap);
      if (err) { wrap.append(errBox(err)); return; }
      if (!data) { wrap.append(h("div", { class: "sub dload" }, "Loading…")); return; }
      hideTip();
      const rows = data.rows;
      if (!rows.some((r) => r.orders > 0)) { wrap.append(h("div", { class: "empty" }, h("b", null, "No bills for this selection"), h("div", { class: "sub" }, "Try a longer date range or remove a filter above."))); return; }
      if (useKind === "donut") wrap.append(donut(rows, wrap));
      else if (timeDim) wrap.append(columns(rows, wrap, useKind === "line"));
      else wrap.append(columns([...rows].filter((r) => r.orders > 0).sort((a, b) => b[W.measure] - a[W.measure]).slice(0, 10), wrap, false));
      if (data.truncated) wrap.append(h("div", { class: "sample-flag", role: "status" }, "There are more bills than we can scan in one go. Narrow the dates to see everything."));
    }

    const errBox = (msg) => h("div", { class: "empty err-card", role: "alert" }, h("b", null, "Could not load this"), h("div", { class: "sub" }, msg), on(btnN("Try again", {}, "sm"), () => load()));

    /* ---------------- breakdown table ---------------- */
    const COLS = [["label", "", false], ["sales", "Sales", true], ["orders", "Orders", true], ["avg_bill", "Avg bill", true], ["items", "Items", true]];
    function sortedRows() {
      if (!data) return [];
      const rows = data.rows.filter((r) => r.orders > 0 || !dimOf(W.by).time);
      const key = W.sort, dir = W.dir;
      if (!key) return rows;
      return [...rows].sort((a, b) => (key === "label" ? String(a.label).localeCompare(String(b.label)) : a[key] - b[key]) * dir || String(a.label).localeCompare(String(b.label)));
    }
    function paintTable() {
      tableCard.replaceChildren();
      const label = dimOf(W.by).label;
      tableCard.append(h("div", { class: "row dtools" }, h("div", null, h("h3", null, "By " + label.toLowerCase()), h("div", { class: "sub" }, "Click a row to drill into it. Click a heading to sort.")), h("div", { class: "sp" }),
        (() => { const sel = h("select", { class: "inp dsel dsortsel", "aria-label": "Sort table by" }, [["", "Natural order"], ...COLS.map((c) => [c[0], c[1] || label])].map(([v, l]) => h("option", { value: v, selected: (W.sort || "") === v }, l))); sel.addEventListener("change", () => { W.sort = sel.value || null; W.dir = -1; paintTable(); }); return sel; })()));
      if (err) { tableCard.append(errBox(err)); return; }
      if (!data) { tableCard.append(h("div", { class: "sub dload" }, "Loading…")); return; }
      const rows = sortedRows();
      if (!rows.length) { tableCard.append(h("div", { class: "empty" }, h("b", null, "Nothing to show"))); return; }
      const head = h("tr", null, COLS.map(([k, l, r]) => {
        const b = on(h("button", { type: "button", class: "dsort" }, l || label, W.sort === k ? (W.dir > 0 ? " ▲" : " ▼") : ""), () => { if (W.sort === k) W.dir = -W.dir; else { W.sort = k; W.dir = k === "label" ? 1 : -1; } paintTable(); });
        return h("th", { class: r ? "r" : "", scope: "col", "aria-sort": W.sort === k ? (W.dir > 0 ? "ascending" : "descending") : "none" }, b);
      }).concat([h("th", { scope: "col" }, "Share")]));
      const tot = data.totals;
      const body = rows.map((r) => {
        const can = r.orders > 0, tr = h("tr", { class: "drow" + (can ? "" : " off") },
          h("td", { "data-label": label }, can ? h("button", { type: "button", class: "dlink", "aria-label": `Drill into ${label}: ${r.label}. ${fmt("sales", r.sales)} from ${r.orders} bills.` }, r.label) : h("span", null, r.label)),
          h("td", { class: "r mono", "data-label": "Sales" }, RS(r.sales)), h("td", { class: "r mono", "data-label": "Orders" }, String(r.orders)), h("td", { class: "r mono", "data-label": "Avg bill" }, RS(r.avg_bill)), h("td", { class: "r mono", "data-label": "Items" }, W.by === "payment_mode" ? "–" : String(r.items)),
          h("td", { class: "dshare", "data-label": "Share" }, h("div", { class: "row dsh" }, (() => { const bar = h("div", { class: "bar dsb", role: "img", "aria-label": pct(r.share) + " of sales" }, h("i")); bar.firstChild.style.width = Math.max(r.share ? 2 : 0, r.share * 100) + "%"; return bar; })(), h("span", { class: "mono sub" }, pct(r.share)))));
        if (can) tr.addEventListener("click", () => drillInto(r));
        return tr;
      });
      const foot = h("tr", { class: "dfoot" }, h("td", { "data-label": "Total" }, h("b", null, "Total")), h("td", { class: "r mono", "data-label": "Sales" }, RS(tot.sales)), h("td", { class: "r mono", "data-label": "Orders" }, String(tot.orders)), h("td", { class: "r mono", "data-label": "Avg bill" }, RS(tot.avg_bill)), h("td", { class: "r mono", "data-label": "Items" }, String(tot.items)), h("td"));
      tableCard.append(h("div", { class: "tw" }, h("table", { class: "rtable dtable", "aria-label": "Breakdown by " + label }, h("thead", null, head), h("tbody", null, body, foot))));
      const note = W.by === "item" || W.by === "category" ? "Dish and category figures count each line; a bill with several dishes appears under each." : W.by === "payment_mode" ? "Split payments appear under each mode used, so orders can add up to more than the bill count." : "";
      if (note) tableCard.append(h("div", { class: "sub dnote" }, note));
    }

    /* ---------------- bills ---------------- */
    function paintBills() {
      billsCard.replaceChildren();
      const n = W.showBills && recs ? recs.total_count : data ? data.totals.orders : 0;
      const tog = h("button", { type: "button", class: "btn pri sm", "aria-expanded": W.showBills, "aria-controls": "d-bills" }, (W.showBills ? "Hide bills (" : "Show bills (") + n + ")");
      tog.addEventListener("click", () => { W.showBills = !W.showBills; W.page = 0; if (W.showBills) loadRecords(); else paintBills(); });
      const sortSel = h("select", { class: "inp dsel", "aria-label": "Order bills by" }, [["created_at", "Newest first"], ["total", "Highest total first"]].map(([v, l]) => h("option", { value: v, selected: W.billSort === v }, l)));
      sortSel.addEventListener("change", () => { W.billSort = sortSel.value; W.page = 0; loadRecords(); });
      billsCard.append(h("div", { class: "row dtools" }, h("div", null, h("h3", null, "Bills"), h("div", { class: "sub" }, "Every bill behind the figures above" + (canOpen() ? ". Click one to see all of it." : ""))), h("div", { class: "sp" }), W.showBills ? sortSel : null, tog));
      if (!W.showBills) return;
      const box = h("div", { id: "d-bills", class: recBusy ? "busy" : "" }, "");
      billsCard.append(box);
      if (recErr) { box.replaceChildren(errBox(recErr)); return; }
      if (!recs) { box.replaceChildren(h("div", { class: "sub dload" }, "Loading…")); return; }
      if (!recs.rows.length) { box.replaceChildren(h("div", { class: "empty" }, h("b", null, "No bills in this selection"))); return; }
      const cols = [{ h: "Bill" }, { h: "When" }, ...(platform ? [{ h: "Restaurant" }] : []), { h: "Type" }, { h: "Customer" }, { h: "Paid by" }, { h: "Total", r: 1 }, { h: "Status" }];
      const rows = recs.rows.map((r) => {
        const num = canOpen() ? h("button", { type: "button", class: "dlink mono", "aria-label": `Open bill ${r.order_no}` }, "#" + r.order_no) : h("b", { class: "mono" }, "#" + r.order_no);
        const cells = [num, dtm(r.created_at), ...(platform ? [r.restaurant] : []), h("span", null, r.type, r.table ? " · " + r.table : "", r.channel === "online" ? h("span", { class: "sub" }, " · online") : null), r.customer || r.phone || "Walk-in",
          r.modes.map(cap).join(" + ") || "–", RS(r.total), pillN(STATE_TXT[r.state] || cap(r.state), STATE_KIND[r.state] || "mute")];
        const tr = h("tr", { class: "drow" }, cells.map((c, i) => h("td", { class: cols[i].r ? "r mono" : "", "data-label": cols[i].h }, c)));
        if (canOpen()) tr.addEventListener("click", () => openBillFor(r));
        return tr;
      });
      const from = W.page * PAGE + 1, to = W.page * PAGE + recs.rows.length;
      const pager = h("div", { class: "row dpager" }, h("span", { class: "sub", role: "status" }, `${from}–${to} of ${recs.total_count}`), h("div", { class: "sp" }),
        on(btnN("Previous", { disabled: W.page === 0 }, "sm"), () => { W.page--; loadRecords(); }), on(btnN("Next", { disabled: to >= recs.total_count }, "sm"), () => { W.page++; loadRecords(); }));
      box.replaceChildren(h("div", { class: "tw" }, h("table", { class: "rtable dtable", "aria-label": "Bills" }, h("thead", null, h("tr", null, cols.map((c) => h("th", { class: c.r ? "r" : "", scope: "col" }, c.h)))), h("tbody", null, rows))), pager);
      if (recs.truncated) box.append(h("div", { class: "sample-flag" }, "There are more bills than we can scan in one go. Narrow the dates."));
    }

    /* ---------------- one bill in full ---------------- */
    async function fetchBill(rec) {
      if (platform) return api("GET", `${prefix}/bill/${encodeURIComponent(rec.restaurant_id)}/${encodeURIComponent(rec.id)}`);
      try { return await api("GET", `/v2/orders/${encodeURIComponent(rec.id)}`); } catch (e) { if (e.status !== 403) throw e; return api("GET", `/v2/pos/bills/${encodeURIComponent(rec.id)}`); }
    }
    function openBillFor(rec) {
      if (opts.openBill) return opts.openBill(rec);
      return openSheet("Bill " + rec.order_no, (close) => {
        const body = h("div", { class: "dbody dbill" }, h("div", { class: "row sb" }, h("h3", null, "Bill #" + rec.order_no), on(btnN("Close", { "aria-label": "Close bill" }, "sm"), () => close(null))), h("div", { class: "sub" }, "Loading…"));
        fetchBill(rec).then((b) => { body.replaceChildren(billNode(b, close)); const f = body.querySelector("button"); if (f) f.focus(); })
          .catch((e) => body.replaceChildren(h("div", { class: "row sb" }, h("h3", null, "Bill #" + rec.order_no), on(btnN("Close", {}, "sm"), () => close(null))), errBox(e.message)));
        return body;
      }, "drw");
    }

    const kv = (k, v, cls = "") => h("div", { class: "row sb dkv " + cls }, h("span", { class: "sub" }, k), h("span", { class: "mono" }, v));
    const when = (iso2) => (iso2 ? dtm(iso2) : "–");
    function detailText(d) { return d ? Object.entries(d).map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ") : ""; }

    function billNode(b, close) {
      const o = b.online || {}, t = b.totals || {}, state = b.state || (b.channel === "online" ? o.status : b.status), live2 = (b.lines || []).filter((l) => l.qty > 0), per = t.lines || [];
      const exclusive = t.total === t.subtotal - t.discount + t.tax && t.tax > 0;
      const paid = (b.payments || []).reduce((a, p) => a + p.amount, 0), back = (b.refunds || []).reduce((a, r) => a + r.amount, 0);
      const sec = (title, ...kids) => h("div", { class: "dsec" }, h("h4", null, title), kids);
      return h("div", { class: "dbody dbill" },
        h("div", { class: "row sb" }, h("h3", null, "Bill #" + b.bill_no), on(btnN("Close", { "aria-label": "Close bill" }, "sm"), () => close(null))),
        h("div", { class: "row dpills" }, pillN(b.channel === "online" ? "Online" : "Counter", b.channel === "online" ? "info" : "mute"), pillN(b.type), b.table ? pillN("Table " + b.table) : null, pillN(STATE_TXT[state] || cap(state), STATE_KIND[state] || "mute"), b.restaurant ? pillN(b.restaurant, "info") : null),
        sec("When", kv("Created", when(b.created_at)), b.closed_at ? kv("Closed", when(b.closed_at)) : null, kv("Business day", b.business_date || "–"), kv("Taken by", String(b.created_by || "–").replace(/^customer:/, "customer ")), b.revision != null ? kv("Edits", String(b.revision), "sub") : null),
        sec("Customer", (b.customer && (b.customer.name || b.customer.phone)) ? h("div", null, [b.customer.name, b.customer.phone].filter(Boolean).join(" · ")) : h("div", { class: "sub" }, "Walk-in, no details"),
          o.address && o.address.text ? h("div", null, [o.address.text, o.address.landmark].filter(Boolean).join(", ")) : null, o.distance_km != null ? h("div", { class: "sub" }, o.distance_km + " km from the restaurant") : null,
          o.notes ? h("div", { class: "note" }, "“" + o.notes + "”") : null, o.driver ? h("div", null, "Rider: " + o.driver.name + (o.driver.phone ? " · " + o.driver.phone : "")) : null),
        sec(`Items (${live2.reduce((a, l) => a + (l.fee ? 0 : l.qty), 0)})`, live2.map((l, i) => {
          const pl = per[i] || {};
          return h("div", { class: "dline dli" }, h("span", null, `${l.qty} × ${l.name}`, l.fee ? h("span", { class: "sub" }, " (fee)") : null, l.note ? h("span", { class: "note" }, "Note: “" + l.note + "”") : null,
            h("span", { class: "sub dsmall" }, `${RS(l.price)} each${l.station && !l.fee ? " · " + l.station : ""}${pl.discount ? " · discount " + RS(pl.discount) : ""}${pl.tax ? " · GST " + RS(pl.tax) : ""}${l.kot_qty ? " · sent to kitchen" : ""}`)), h("span", { class: "mono" }, RS(l.price * l.qty)));
        })),
        sec("Money", kv("Subtotal", RS(t.subtotal || 0)), t.discount ? kv("Discount" + (b.discount && b.discount.reason ? ` (${b.discount.reason}${b.discount.by ? ", by " + b.discount.by : ""})` : ""), "− " + RS(t.discount)) : null,
          o.coupon ? kv("Offer", `${o.coupon.code}${o.coupon.saves ? " · saved " + RS(o.coupon.saves) : ""}`) : null, kv(exclusive ? "GST (added)" : "GST (included)", RS(t.tax || 0)), kv("Total", RS(t.total || 0), "tot"), kv("Collected", RS(paid)), back ? kv("Refunded", "− " + RS(back)) : null,
          kv("Kept", RS(paid - back)), b.balance > 0 && state !== "void" && state !== "cancelled" ? kv("Still to collect", RS(b.balance)) : null),
        sec("Payments", (b.payments || []).length ? b.payments.map((p) => h("div", { class: "dline" }, h("span", null, h("b", null, p.mode === "upi" ? "UPI" : cap(p.mode)), h("span", { class: "sub" }, ` · ${hm(p.at)}${p.by ? " · " + p.by : ""}${p.ref ? " · ref " + p.ref : ""}${p.change ? " · change given " + RS(p.change) : ""}`)), h("span", { class: "mono" }, RS(p.amount)))) : h("div", { class: "sub" }, o.payment_method === "cod" ? "Pay on delivery/pickup, not collected" : "No payment taken"),
          o.payment_method ? h("div", { class: "sub" }, "Customer chose: " + (o.payment_method === "cod" ? "pay on delivery/pickup" : "pay online" + (o.payment && o.payment.provider ? " (" + o.payment.provider + ", " + o.payment.status + ")" : ""))) : null),
        (b.refunds || []).length ? sec("Refunds", b.refunds.map((r) => h("div", { class: "dline" }, h("span", null, h("b", null, cap(r.mode)), h("span", { class: "sub" }, ` · ${dtm(r.at)} · ${r.by || ""}${r.reason ? " · " + r.reason : ""}`)), h("span", { class: "mono" }, "− " + RS(r.amount))))) : null,
        b.void ? sec("Cancelled", h("div", null, b.void.reason), h("div", { class: "sub" }, `by ${b.void.by} · ${when(b.void.at)}`)) : null,
        (o.timeline || []).length ? sec("Order timeline", h("ol", { class: "tl" }, o.timeline.map((x) => h("li", null, h("b", null, STATE_TXT[x.status] || cap(x.status)), h("span", { class: "sub" }, ` · ${when(x.at)} · ${x.by || ""}${x.reason ? " · " + x.reason : ""}`))))) : null,
        (b.history || []).length ? sec("Activity log (who did what)", h("ol", { class: "tl" }, b.history.map((x) => h("li", null, h("b", null, String(x.action).replace(/_/g, " ")), h("span", { class: "sub" }, ` · ${when(x.ts)} · ${x.by || ""}${x.detail ? " · " + detailText(x.detail) : ""}`))))) : null,
        b.kot_batches ? sec("Kitchen", h("div", { class: "sub" }, `${b.kot_batches} kitchen ticket${b.kot_batches === 1 ? "" : "s"} sent${b.reprints ? ", bill printed again " + b.reprints + " time(s)" : ""}`)) : null);
    }

    /* ---------------- CSV ---------------- */
    async function downloadCsv(ev) {
      const btn = ev.currentTarget; btn.disabled = true;
      try {
        const url = `${prefix}/records.csv?${query()}`;
        let r = await fetch(url, { headers: { Authorization: `Bearer ${AUTH.access}` } });
        if (r.status === 401) { await refreshTokens(); r = await fetch(url, { headers: { Authorization: `Bearer ${AUTH.access}` } }); }
        if (!r.ok) { let m = "The file could not be made."; try { const j = await r.json(); m = (j.detail && j.detail.message) || m; } catch { /* not json */ } throw new Error(m); }
        const blob = await r.blob(), name = ((r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) || [])[1] || `bills-${W.from}-to-${W.to}.csv`;
        const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast(r.headers.get("X-Truncated") === "true" ? "Downloaded, but there were more bills than fit. Narrow the dates." : "Downloaded " + name);
      } catch (e) { toast(e.message, 5000); } finally { btn.disabled = false; }
    }

    function paint() { paintBar(); paintCrumbs(); paintTiles(); paintChart(); paintTable(); paintBills(); }
    paint();
    return { el: root, load };
  }
  return { create };
})();

/* ---------------- Reports screen (permission reports.view) and entry points for the dashboard ---------------- */
const REP = { state: null };
/* open Reports already drilled to something: openReport({preset:"today", by:"hour", measure:"sales", filters:[{dim:"channel",value:"online",label:"Online orders"}]}) */
function openReport(init = {}) {
  REP.state = Object.assign({ preset: "today", by: "channel", measure: "sales", filters: [], scope: "sales", compare: true, showBills: false, chart: "auto", sort: null, dir: -1, page: 0, billSort: "created_at" }, init);
  if (init.from && init.to) REP.state.preset = "custom"; else { delete REP.state.from; delete REP.state.to; }
  go("rep");
}
LIVE.add("rep"); NEEDS.rep = "reports.view";
V.rep = () => {
  const root = h("div", null, headN("Growth", "Reports"));
  if (!can("reports.view")) return h("div", null, headN("Growth", "Reports"), emptyN("Reports are for managers and owners", "Ask the owner if you need to see sales figures."));
  if (!REP.state) REP.state = {};
  const d = Drill.create({ prefix: "/v2/analytics", mode: "restaurant", state: REP.state, canOpenBill: () => can("orders.view") || can("bills.view") });
  root.append(h("p", { class: "sub dintro" }, "Pick dates, then click any slice, bar or row to go one layer deeper: online or counter, order type, how they paid, menu category, dish. At any layer open the bills, and any bill in full."), d.el);
  d.load();
  return root;
};
