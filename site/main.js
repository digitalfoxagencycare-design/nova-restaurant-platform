/* Nova landing page. No build step, no third-party code. */
"use strict";

/* ======================================================================
 * OWNER: FILL THESE IN BEFORE GOING LIVE (see README.md)
 * whatsapp: country code + number, digits only, e.g. "919876543210"
 * phone:    the number to show and dial, e.g. "+91 98765 43210"
 * Leave the placeholders and the WhatsApp/phone buttons simply stay hidden.
 * Also replace 91XXXXXXXXXX inside the <noscript> block in index.html.
 * The API address is set in index.html: <meta name="nova-api" content="...">
 * ====================================================================== */
const CONTACT = {
  whatsapp: "91XXXXXXXXXX",
  phone: "+91 XXXXX XXXXX",
  whatsappText: "Hello Nova, I run a restaurant and would like to know more.",
};
/* ====================================================================== */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var isSet = function (v) { return v && !/X/i.test(v); };

  /* ---- contact buttons ---- */
  var waOk = isSet(CONTACT.whatsapp), telOk = isSet(CONTACT.phone);
  var waUrl = waOk ? "https://wa.me/" + CONTACT.whatsapp.replace(/\D/g, "") + "?text=" + encodeURIComponent(CONTACT.whatsappText) : "";
  var telUrl = telOk ? "tel:" + CONTACT.phone.replace(/[^\d+]/g, "") : "";
  if (waOk) { var w = $("wa-link"); w.href = waUrl; w.hidden = false; }
  if (telOk) { var t = $("tel-link"); t.href = telUrl; $("tel-text").textContent = CONTACT.phone; t.hidden = false; }

  /* ---- palette demo ---- */
  var phones = [$("phone-demo")];
  var pal = $("palettes");
  if (pal) pal.addEventListener("change", function (e) {
    if (e.target && e.target.name === "palette") phones.forEach(function (p) { p.setAttribute("data-palette", e.target.value); });
  });

  /* ---- enquiry form ---- */
  var form = $("lead"), btn = $("send"), status = $("status"), thanks = $("thanks");
  if (!form) return;
  var meta = document.querySelector('meta[name="nova-api"]');
  var API = ((meta && meta.getAttribute("content")) || "").trim().replace(/\/+$/, "");
  var URL_ = API + "/v2/public/leads";
  var FIELDS = ["restaurant", "name", "phone", "city", "email", "message"];
  var sending = false;

  function setErr(f, msg) {
    var el = $(f), er = $(f + "-err");
    if (!el || !er) return;
    er.textContent = msg || "";
    if (msg) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", (f === "phone" ? "phone-hint " : "") + f + "-err"); }
    else { el.removeAttribute("aria-invalid"); el.setAttribute("aria-describedby", f === "phone" ? "phone-hint" : ""); if (f !== "phone") el.removeAttribute("aria-describedby"); }
  }
  function check(f) {
    var v = $(f).value.trim(), msg = "";
    if (f === "restaurant" && v.length < 2) msg = "Please enter your restaurant's name.";
    else if (f === "name" && v.length < 2) msg = "Please enter your name.";
    else if (f === "phone") {
      var digits = v.replace(/\D/g, "");
      if (!v) msg = "Please enter your mobile number.";
      else if (!/^[0-9+ \-]{10,16}$/.test(v) || digits.length < 10) msg = "Enter a valid mobile number, at least 10 digits. You can use +, spaces and dashes.";
    }
    else if (f === "city" && v.length < 2) msg = "Please enter your city.";
    else if (f === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = "That e-mail does not look right. Leave it empty if you prefer.";
    else if (f === "message" && v.length > 600) msg = "Please keep the message under 600 characters.";
    setErr(f, msg);
    return !msg;
  }
  FIELDS.forEach(function (f) {
    $(f).addEventListener("blur", function () { if ($(f).value || $(f + "-err").textContent) check(f); });
    $(f).addEventListener("input", function () { if ($(f + "-err").textContent) check(f); });
  });

  function fallbackHtml(lead) {
    status.textContent = "";
    var parts = [];
    if (waOk) {
      var msg = "Hello Nova. Restaurant: " + lead.restaurant + ". Name: " + lead.name + ". Phone: " + lead.phone + ". City: " + lead.city + ".";
      var a = document.createElement("a");
      a.href = "https://wa.me/" + CONTACT.whatsapp.replace(/\D/g, "") + "?text=" + encodeURIComponent(msg);
      a.textContent = "send it on WhatsApp"; parts.push(a);
    }
    if (telOk) { var c = document.createElement("a"); c.href = telUrl; c.textContent = "call " + CONTACT.phone; parts.push(c); }
    status.appendChild(document.createTextNode("We could not send your enquiry. Please check your internet and try again"));
    if (parts.length) {
      status.appendChild(document.createTextNode(", or "));
      parts.forEach(function (p, i) { if (i) status.appendChild(document.createTextNode(" or ")); status.appendChild(p); });
    }
    status.appendChild(document.createTextNode("."));
  }
  function fail(msg) { status.className = "status bad"; status.textContent = msg; }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (sending) return;
    status.className = "status"; status.textContent = "";
    var first = null;
    FIELDS.forEach(function (f) { if (!check(f) && !first) first = f; });
    if (first) { $(first).focus(); fail("Please fix the highlighted field" + (FIELDS.filter(function (f) { return $(f + "-err").textContent; }).length > 1 ? "s" : "") + " and send again."); return; }

    var lead = {
      restaurant: $("restaurant").value.trim(), name: $("name").value.trim(), phone: $("phone").value.trim(),
      city: $("city").value.trim(), email: $("email").value.trim(), message: $("message").value.trim(),
      website: $("website").value,
    };
    sending = true; btn.disabled = true; btn.textContent = "Sending...";
    status.textContent = "Sending your enquiry...";

    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    fetch(URL_, {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(lead), signal: ctl ? ctl.signal : undefined, credentials: "omit",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { return { r: r, data: data }; });
    }).then(function (x) {
      var s = x.r.status;
      if (s === 201) {
        status.textContent = ""; form.hidden = true; thanks.hidden = false; thanks.focus();
        return;
      }
      if (s === 422) {
        var d = x.data && x.data.detail, shown = false;
        if (Array.isArray(d)) d.forEach(function (e) {
          var f = e.loc && e.loc[e.loc.length - 1];
          if (FIELDS.indexOf(f) >= 0) { setErr(f, f === "phone" ? "Enter a valid mobile number, at least 10 digits." : "Please check this field."); if (!shown) { $(f).focus(); shown = true; } }
        });
        fail(shown ? "Please fix the highlighted field and send again." : "Some details look wrong. Please check the form and send again.");
        return;
      }
      if (s === 429) { fail("Too many enquiries from this connection. Please try again in an hour, or contact us on WhatsApp or phone."); return; }
      fail("Something went wrong on our side. Please try again in a little while.");
    }).catch(function () {
      status.className = "status bad"; fallbackHtml(lead);
    }).then(function () {
      if (timer) clearTimeout(timer);
      sending = false; btn.disabled = false; btn.textContent = "Send enquiry";
    });
  });
})();
