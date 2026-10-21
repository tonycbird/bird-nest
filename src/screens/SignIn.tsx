import { useState } from "react";
import { supabase, ALLOWED_EMAIL } from "../lib/supabase";

/** Sign in with email + password, typed in the app.
 *  Not a magic link: on iPhone a link opens Safari, not the installed app. And Supabase's free email
 *  can't be changed to send a code, so a password (saved in the iPhone's Passwords) is the simple, offline-friendly way. */
export default function SignIn({ compact, onDone }: { compact?: boolean; onDone?: () => void } = {}) {
  const [email, setEmail] = useState(ALLOWED_EMAIL);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "new">("in");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function go() {
    const e = email.trim().toLowerCase();
    if (ALLOWED_EMAIL && e !== ALLOWED_EMAIL) { setMsg("This nest is just for Anthony."); return; }
    if (password.length < 8) { setMsg("Use at least 8 characters."); return; }
    setBusy(true); setMsg("");
    const res = mode === "new"
      ? await supabase.auth.signUp({ email: e, password })
      : await supabase.auth.signInWithPassword({ email: e, password });
    setBusy(false);
    if (res.error) {
      const m = res.error.message;
      if (/invalid login/i.test(m)) setMsg("That email and password don't match. First time? Tap “First time here”.");
      else if (/already registered/i.test(m)) { setMode("in"); setMsg("You already have an account. Sign in instead."); }
      else if (/not allowed|disabled/i.test(m)) setMsg("New accounts are turned off in Supabase. Sign in with your existing one.");
      else setMsg(m);
      return;
    }
    if (!res.data.session) { setMsg("Turn off “Confirm email” in Supabase (Sign In / Providers → Email), then sign in."); return; }
    onDone?.();
  }

  return (
    <form className="stack" style={{ marginTop: compact ? 0 : "18vh" }} onSubmit={(ev) => { ev.preventDefault(); void go(); }}>
      {!compact && <div className="date">Bird Nest</div>}
      {compact ? <p><strong>{mode === "new" ? "Make your Nest account" : "Sign in"}</strong></p>
        : <h1 className="sentence">Welcome home.</h1>}
      <input className="field" type="email" inputMode="email" autoComplete="username" placeholder="Email"
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="field" type="password" autoComplete={mode === "new" ? "new-password" : "current-password"} placeholder="Password"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="btn primary" type="submit" disabled={busy || !email || !password}>{mode === "new" ? "✓ Make account" : "✓ Sign in"}</button>
      <button className="btn" type="button" disabled={busy} onClick={() => { setMode(mode === "new" ? "in" : "new"); setMsg(""); }}>
        {mode === "new" ? "I already have one" : "First time here"}
      </button>
      {msg && <p className="quiet">{msg}</p>}
    </form>
  );
}
