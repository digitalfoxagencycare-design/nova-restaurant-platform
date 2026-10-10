import { useEffect, useRef, useState } from "react";
import { money, onColor } from "@nova/shared";
import { logoSrc } from "./lib/api";
import { CHANNELS, COLOR_FIELDS, FONTS, PALETTES, contrastWarnings, isHex, loadPreviewFonts, monogram, readLogo } from "./lib/brand";
import { Button, Card, Icon, Notice, SelectField, TextField, Toggle, cx } from "./ui";

// ---------------------------------------------------------------- live preview (phone-shaped mock of the ordering page)
export function PhonePreview({ form, logo, existingLogoUrl, className }) {
  const c = form.colors;
  const col = (k) => (isHex(c[k]) ? c[k] : "#888888");
  const prim = col("primary"), sec = col("secondary"), bg = col("background"), fg = col("foreground"), mut = col("muted");
  const src = logo?.dataUrl || logoSrc(existingLogoUrl);
  const head = `'${form.fonts.heading}', 'Bricolage Grotesque', system-ui, sans-serif`;
  const body = `'${form.fonts.body}', 'Figtree', system-ui, sans-serif`;
  const name = form.name.trim() || "Your restaurant";
  return (
    <div className={cx("mx-auto w-[300px] rounded-[38px] border-[7px] border-[#1c2a2b] bg-[#1c2a2b] shadow-float", className)} data-testid="phone-preview" role="img" aria-label={`Preview of how ${name}'s ordering page will look on a phone`}>
      <div className="flex h-[560px] flex-col overflow-hidden rounded-[30px]" style={{ background: bg, color: fg, fontFamily: body }}>
        <div className="px-4 pb-3 pt-5" style={{ background: sec, color: onColor(sec) }}>
          <div className="flex items-center gap-2.5">
            {src ? (
              <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain" />
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-extrabold" style={{ background: prim, color: onColor(prim), fontFamily: head }}>{monogram(name)}</span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[17px] font-extrabold leading-tight" style={{ fontFamily: head }}>{name}</p>
              <p className="truncate text-[12px] opacity-85">{form.tagline || "Order online, ready fast"}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2 text-[12px] font-semibold">
            <span className="rounded-full px-2.5 py-1" style={{ background: prim, color: onColor(prim) }}>Delivery</span>
            <span className="rounded-full border px-2.5 py-1" style={{ borderColor: onColor(sec) + "66" }}>Takeaway</span>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-hidden px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-extrabold" style={{ fontFamily: head }}>Popular today</p>
            <span className="rounded-full px-2.5 py-0.5 text-[12px] font-bold" style={{ background: prim + "26", color: fg }}>
              <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: "#1B8548" }} />Open now
            </span>
          </div>
          <div className="flex gap-3 rounded-2xl border p-3" style={{ borderColor: mut, background: "#ffffff80" }}>
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl" style={{ background: mut }} aria-hidden="true">
              <span className="h-9 w-9 rounded-full" style={{ background: prim + "cc" }} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold leading-tight" style={{ fontFamily: head }}>Chicken Dum Biryani</p>
              <p className="mt-0.5 line-clamp-2 text-[12px] opacity-75">Slow-cooked basmati with tender chicken</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[14px] font-extrabold">{money(28000)}</span>
                <span className="rounded-lg px-4 py-1.5 text-[13px] font-bold" style={{ background: prim, color: onColor(prim) }}>Add</span>
              </div>
            </div>
          </div>
          <div className="flex gap-3 rounded-2xl border p-3" style={{ borderColor: mut, background: "#ffffff80" }}>
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl" style={{ background: mut }} aria-hidden="true">
              <span className="h-9 w-9 rounded-full" style={{ background: sec + "99" }} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold leading-tight" style={{ fontFamily: head }}>Paneer Tikka</p>
              <p className="mt-0.5 text-[12px] opacity-75">Charred cottage cheese, mint chutney</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[14px] font-extrabold">{money(24000)}</span>
                <span className="rounded-lg border px-4 py-1.5 text-[13px] font-bold" style={{ borderColor: prim, color: fg }}>Add</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: sec, color: onColor(sec) }}>
          <div>
            <p className="text-[12px] opacity-85">2 items</p>
            <p className="text-[15px] font-extrabold">{money(56000)}</p>
          </div>
          <span className="rounded-xl px-4 py-2 text-[14px] font-bold" style={{ background: prim, color: onColor(prim) }}>View basket</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- colours, palettes, fonts, logo
function ColorRow({ spec, value, onChange, error }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${spec.label}, colour picker`} value={isHex(value) ? value.toLowerCase() : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-11 w-14 shrink-0 rounded-lg border border-line bg-white" />
        <div className="min-w-0 flex-1">
          <label htmlFor={"hex-" + spec.key} className="block text-sm font-semibold leading-tight">{spec.label}</label>
          <input id={"hex-" + spec.key} value={value} maxLength={7} onChange={(e) => onChange(e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value)} aria-invalid={error ? true : undefined} className={cx("mt-1 min-h-[44px] w-28 rounded-lg border bg-white px-2 font-mono text-sm uppercase", error ? "border-bad" : "border-line")} />
        </div>
      </div>
      <p className="mt-0.5 pl-16 text-[12px] text-ink/65">{error || spec.hint}</p>
    </div>
  );
}

export function LogoPicker({ logo, existingLogoUrl, onChange, hint }) {
  const [err, setErr] = useState("");
  const input = useRef(null);
  const src = logo?.dataUrl || logoSrc(existingLogoUrl);
  async function pick(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      onChange(await readLogo(f));
      setErr("");
    } catch (x) {
      setErr(x.message);
    }
  }
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">Logo</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed border-ink/30 bg-white">
          {src ? <img src={src} alt="Logo preview" className="h-full w-full object-contain" /> : <Icon name="upload" className="h-6 w-6 text-ink/50" />}
        </span>
        <div className="min-w-0">
          <input ref={input} id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} className="sr-only" aria-describedby="logo-hint" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => input.current.click()}>{src ? "Choose a different logo" : "Choose a logo"}</Button>
            {logo ? <Button variant="ghost" onClick={() => { onChange(null); setErr(""); }}>Remove</Button> : null}
          </div>
          {logo ? <p className="mt-1 truncate text-[13px] text-ink/70">{logo.name} ({Math.round(logo.size / 1000)} KB){hint ? " - " + hint : ""}</p> : null}
        </div>
      </div>
      <p id="logo-hint" className="mt-1 text-[13px] text-ink/70">PNG, JPEG or WebP, up to 400 KB. A square picture on a plain background looks best.</p>
      {err ? <p role="alert" className="mt-1 text-[13px] font-medium text-bad" data-testid="logo-error">{err}</p> : null}
    </div>
  );
}

/** Step 2 of the wizard and the "Look & feel" tab: one editor, one live preview. */
export function LookFeelEditor({ form, set, errors, logo, onLogo, existingLogoUrl }) {
  useEffect(loadPreviewFonts, []);
  const setColor = (k, v) => set({ colors: { ...form.colors, [k]: v } });
  const warnings = contrastWarnings(form.colors);
  const preview = <PhonePreview form={form} logo={logo} existingLogoUrl={existingLogoUrl} />;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0 space-y-6">
        <Card>
          <LogoPicker logo={logo} existingLogoUrl={existingLogoUrl} onChange={onLogo} />
          <div className="mt-4">
            <TextField label="Tagline" optional hint="One short line under the name, for example: Dum biryani and Irani chai" value={form.tagline} maxLength={80} onChange={(e) => set({ tagline: e.target.value })} error={errors.tagline} />
          </div>
        </Card>

        <Card>
          <h3 className="font-display text-lg font-bold">Colours</h3>
          <p className="mb-3 text-[14px] text-ink/75">Click a ready-made set, or choose each colour yourself. The phone picture shows the result.</p>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Ready-made colour sets">
            {PALETTES.map((p) => {
              const on = COLOR_FIELDS.every((f) => (form.colors[f.key] || "").toLowerCase() === p[f.key].toLowerCase());
              return (
                <button key={p.name} type="button" aria-pressed={on} onClick={() => set({ colors: { ...form.colors, ...Object.fromEntries(COLOR_FIELDS.map((f) => [f.key, p[f.key]])) } })} className={cx("flex min-h-[44px] items-center gap-2 rounded-xl border p-2 text-left text-[14px] font-semibold", on ? "border-action ring-2 ring-action/40" : "border-line hover:bg-brand-soft")}>
                  <span className="flex shrink-0 overflow-hidden rounded-md border border-line" aria-hidden="true">
                    {["secondary", "primary", "background"].map((k) => <span key={k} className="h-6 w-4" style={{ background: p[k] }} />)}
                  </span>
                  <span className="min-w-0 leading-tight">{p.name}</span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {COLOR_FIELDS.map((f) => <ColorRow key={f.key} spec={f} value={form.colors[f.key] || ""} onChange={(v) => setColor(f.key, v)} error={errors["color_" + f.key]} />)}
          </div>
          {warnings.length ? (
            <div className="mt-4 space-y-2" data-testid="contrast-warnings">
              {warnings.map((w) => (
                <Notice key={w.id} tone="warn" title="Hard to read">
                  <p>{w.text}</p>
                  {w.fix ? <Button variant="secondary" className="mt-2" onClick={() => setColor(Object.keys(w.fix.set)[0], Object.values(w.fix.set)[0])}>{w.fix.label}</Button> : null}
                </Notice>
              ))}
            </div>
          ) : (
            <p className="mt-4 flex items-center gap-1.5 text-[14px] font-semibold text-good"><Icon name="check" className="h-4 w-4" />These colours are easy to read.</p>
          )}
        </Card>

        <div className="lg:hidden">{preview}</div>

        <Card>
          <h3 className="mb-3 font-display text-lg font-bold">Fonts</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Heading font" hint="Names and titles" value={form.fonts.heading} onChange={(e) => set({ fonts: { ...form.fonts, heading: e.target.value } })}>
              {FONTS.map((f) => <option key={f}>{f}</option>)}
            </SelectField>
            <SelectField label="Text font" hint="Descriptions and details" value={form.fonts.body} onChange={(e) => set({ fonts: { ...form.fonts, body: e.target.value } })}>
              {FONTS.map((f) => <option key={f}>{f}</option>)}
            </SelectField>
          </div>
          <p className="mt-3 rounded-xl bg-brand-soft p-3 text-[16px]" style={{ fontFamily: `'${form.fonts.body}', system-ui` }}>
            <span className="block text-[20px] font-extrabold" style={{ fontFamily: `'${form.fonts.heading}', system-ui` }}>{form.name || "Your restaurant"}</span>
            Fresh food, made with care.
          </p>
        </Card>
      </div>
      <aside className="hidden lg:block" aria-label="Live preview">
        <div className="sticky top-6">
          <p className="mb-2 text-center text-sm font-bold text-ink/70">Live preview</p>
          {preview}
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- contact and hours
export function ContactFields({ form, set, errors }) {
  return (
    <Card className="space-y-4">
      <TextField label="Address" hint="Shown to customers on the ordering page" value={form.address} onChange={(e) => set({ address: e.target.value })} error={errors.address} autoComplete="off" />
      <TextField label="Opening hours" hint="For example: Every day, 11:00 am to 11:00 pm" value={form.hours} onChange={(e) => set({ hours: e.target.value })} error={errors.hours} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Phone number" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} error={errors.phone} hint="The number customers can call" />
        <TextField label="E-mail for customers" optional type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} error={errors.email} />
      </div>
      <TextField label="Map link" optional type="url" inputMode="url" hint="Open the restaurant in Google Maps, tap Share, and paste the link here" value={form.mapUrl} onChange={(e) => set({ mapUrl: e.target.value })} error={errors.mapUrl} />
    </Card>
  );
}

// ---------------------------------------------------------------- selling
export function SellingFields({ form, set, errors }) {
  const [geoMsg, setGeoMsg] = useState("");
  const has = (id) => form.channels.includes(id);
  const toggle = (id) => set({ channels: has(id) ? form.channels.filter((c) => c !== id) : [...form.channels, id] });
  const setSlab = (i, patch) => set({ slabs: form.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg("This device cannot share its location. Type the numbers instead.");
    setGeoMsg("Finding your location...");
    navigator.geolocation.getCurrentPosition(
      (p) => { set({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }); setGeoMsg("Done. This is where you are right now, so use it only if you are at the restaurant."); },
      (e) => setGeoMsg(e.code === 1 ? "Location was blocked. Allow it in your browser, or type the numbers instead." : "We could not find your location. Type the numbers instead."),
      { timeout: 10000 },
    );
  };
  const mapsHref = form.lat !== "" && form.lng !== "" && !errors.lat ? `https://www.google.com/maps?q=${form.lat},${form.lng}` : "https://www.google.com/maps";
  return (
    <div className="space-y-5">
      <Card>
        <fieldset>
          <legend className="font-display text-lg font-bold">How customers can order</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {CHANNELS.map((c) => (
              <label key={c.id} className={cx("flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-4 font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent", has(c.id) ? "border-brand bg-brand-soft" : "border-line bg-white")}>
                <input type="checkbox" checked={has(c.id)} onChange={() => toggle(c.id)} className="h-5 w-5 accent-[#133B40]" />
                {c.label}
              </label>
            ))}
          </div>
          {errors.channels ? <p role="alert" className="mt-1 text-[13px] font-medium text-bad">{errors.channels}</p> : null}
        </fieldset>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField label="Smallest order (Rs)" type="number" inputMode="decimal" min="0" value={form.minOrder} onChange={(e) => set({ minOrder: e.target.value })} error={errors.minOrder} hint="0 means no minimum" />
          <TextField label="Preparation time (minutes)" type="number" inputMode="numeric" min="5" max="120" value={form.prep} onChange={(e) => set({ prep: e.target.value })} error={errors.prep} hint="How long an order usually takes" />
        </div>
      </Card>

      {has("delivery") ? (
        <Card>
          <h3 className="font-display text-lg font-bold">Delivery</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField label="Delivery distance (km)" type="number" inputMode="decimal" min="0" step="0.5" value={form.maxKm} onChange={(e) => set({ maxKm: e.target.value })} error={errors.maxKm} hint="Farthest place you deliver to" />
            <TextField label="Free delivery above (Rs)" optional type="number" inputMode="decimal" min="0" value={form.freeAbove} onChange={(e) => set({ freeAbove: e.target.value })} error={errors.freeAbove} hint="Orders above this amount pay no delivery fee" />
          </div>
          <div className="mt-5">
            <p className="text-sm font-semibold">Delivery fee by distance</p>
            <p className="mb-2 text-[13px] text-ink/70">For example: up to 2 km costs Rs 20, up to 3 km costs Rs 30.</p>
            <ul className="space-y-2">
              {form.slabs.map((s, i) => (
                <li key={i} className="flex flex-wrap items-start gap-2">
                  <TextField label="Up to (km)" className="w-32" type="number" inputMode="decimal" min="0" step="0.5" value={s.km} onChange={(e) => setSlab(i, { km: e.target.value })} error={errors["slab_km_" + i]} />
                  <TextField label="Fee (Rs)" className="w-32" type="number" inputMode="decimal" min="0" value={s.fee} onChange={(e) => setSlab(i, { fee: e.target.value })} error={errors["slab_fee_" + i]} />
                  <Button variant="ghost" className="mt-6" aria-label={`Remove fee row ${i + 1}`} onClick={() => set({ slabs: form.slabs.filter((_, j) => j !== i) })}><Icon name="trash" className="h-4 w-4" />Remove</Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" className="mt-3" onClick={() => set({ slabs: [...form.slabs, { km: "", fee: "" }] })}><Icon name="plus" className="h-4 w-4" />Add a fee row</Button>
          </div>
          <div className="mt-6">
            <p className="text-sm font-semibold">Shop location</p>
            <p className="mb-2 text-[13px] text-ink/70">Used to check whether a customer is inside your delivery distance.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Latitude" inputMode="decimal" value={form.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="17.4126" error={errors.lat} />
              <TextField label="Longitude" inputMode="decimal" value={form.lng} onChange={(e) => set({ lng: e.target.value })} placeholder="78.4482" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={locate}><Icon name="pin" className="h-4 w-4" />Use my current location</Button>
              <a href={mapsHref} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-white px-4 text-[15px] font-semibold hover:bg-brand-soft"><Icon name="external" className="h-4 w-4" />Open Google Maps</a>
            </div>
            <p className="mt-2 text-[13px] text-ink/70" role="status">{geoMsg || "Tip: in Google Maps, press and hold on the shop, then tap the two numbers at the top to copy them."}</p>
          </div>
        </Card>
      ) : null}

      <Card>
        <h3 className="font-display text-lg font-bold">Tax and payment</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <SelectField label="Prices on the menu" value={form.taxMode} onChange={(e) => set({ taxMode: e.target.value })}>
            <option value="inclusive">Already include tax</option>
            <option value="exclusive">Tax is added on top</option>
          </SelectField>
          <TextField label="Tax rate (%)" type="number" inputMode="decimal" step="0.5" min="0" max="40" value={form.taxRate} onChange={(e) => set({ taxRate: e.target.value })} error={errors.taxRate} />
          <TextField label="GST number" optional value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} error={errors.gstin} />
        </div>
        <div className="mt-3 divide-y divide-line">
          <Toggle checked={form.cod} onChange={(v) => set({ cod: v })} label="Pay on delivery" hint="Customers can pay cash or UPI to the rider" />
          <Toggle checked={form.online} onChange={(v) => set({ online: v })} label="Allow online payment" hint="Customers pay by card, UPI or net banking. The restaurant's payment keys are needed (added later)." />
        </div>
        <div className="mt-4 max-w-xs">
          <TextField label="Number of tables" type="number" inputMode="numeric" min="0" max="200" value={form.tables} onChange={(e) => set({ tables: e.target.value })} error={errors.tables} hint="Tables are named T-01, T-02, ... Use 0 if there is no dine-in." />
        </div>
      </Card>
    </div>
  );
}
