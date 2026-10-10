import { useState } from "react";
import novaLogo from "@nova/shared/assets/nova-logo.png";
import { api, niceError, saveSession, sessionState } from "../lib/api";
import { Button, Notice, TextField } from "../ui";

export default function SignIn({ expired }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setErr("Please enter your e-mail and password.");
    setBusy(true);
    setErr("");
    try {
      const r = await api.post("/v2/platform/auth/login", { email: email.trim(), password });
      sessionState.expired = false;
      saveSession(email.trim(), r.access_token, r.expires_in);
    } catch (x) {
      setErr(x.status === 401 ? "That e-mail or password is not right. Please try again." : x.status === 422 || x.code === "VALIDATION" ? "Please enter a valid e-mail address." : niceError(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="grid min-h-screen place-items-center bg-brand px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-float sm:p-8">
        <img src={novaLogo} alt="Nova" className="mx-auto h-16 w-16 rounded-2xl" />
        <h1 className="mt-4 text-center font-display text-2xl font-extrabold">Nova Console</h1>
        <p className="mb-5 text-center text-[15px] text-ink/70">Sign in with your Nova team account.</p>
        {expired ? (
          <Notice tone="warn" title="Please sign in again" className="mb-4">
            For your safety you are signed out after 30 minutes. Anything you were filling in is kept, so you can carry on.
          </Notice>
        ) : null}
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextField label="E-mail" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {err ? <p role="alert" className="text-[14px] font-medium text-bad">{err}</p> : null}
          <Button type="submit" busy={busy} className="w-full">Sign in</Button>
        </form>
      </div>
    </main>
  );
}
