import { useEffect, useState } from "react";
import { ApiError, FIXED_TENANT, getEmail, getTenant, loadBrand, login } from "./session.js";
import { Button, Field, inputCls, PoweredBy } from "./ui.jsx";

export default function Login() {
  const [code, setCode] = useState(FIXED_TENANT || getTenant());
  const [email, setEmail] = useState(getEmail());
  const [password, setPassword] = useState("");
  const [shop, setShop] = useState(null);
  const [codeErr, setCodeErr] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Look the restaurant up as the code is typed so its colours and name show before sign-in.
  useEffect(() => {
    const c = code.trim().toLowerCase();
    setShop(null);
    setCodeErr("");
    if (c.length < 3) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      loadBrand(c).then((sf) => { if (alive) setShop(sf); }).catch((e) => {
        if (alive) setCodeErr(e instanceof ApiError && e.status === 404 ? "No restaurant with this code." : e.message);
      });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [code]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(code, email, password);
    } catch (ex) {
      setErr(ex.status === 401 || ex.status === 400 ? "Wrong restaurant code, email or password." : ex.message);
    } finally {
      setBusy(false);
    }
  }

  const name = shop && shop.brand && shop.brand.name;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col bg-brand-soft">
      <header className="pt-safe bg-brand px-6 pb-10 pt-12 text-brand-on">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-on text-brand"><span className="font-display text-2xl font-extrabold">{(name || "N").slice(0, 1)}</span></span>
        <h1 className="font-display text-3xl font-extrabold leading-tight">{name || "Delivery partner"}</h1>
        <p className="mt-1 text-sm opacity-80">{name ? "Delivery partner sign in" : "Enter your restaurant code to begin"}</p>
      </header>
      <form onSubmit={submit} className="-mt-5 flex-1 space-y-4 rounded-t-3xl bg-surface px-6 pb-6 pt-7" noValidate>
        {FIXED_TENANT ? null : (
          <Field label="Restaurant code" id="code" hint="Ask the restaurant. Example: demo-biryani" error={codeErr}>
            <input id="code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="off" required />
          </Field>
        )}
        <Field label="Email" id="email">
          <input id="email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" required />
        </Field>
        <Field label="Password" id="password">
          <input id="password" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {err ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">{err}</p> : null}
        <Button type="submit" className="w-full" busy={busy} disabled={!code.trim() || !email || !password}>Sign in</Button>
      </form>
      <footer className="bg-surface px-6 pb-8 pt-2 pb-safe">
        <PoweredBy />
      </footer>
    </main>
  );
}
