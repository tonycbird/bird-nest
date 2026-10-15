import { useState } from "react";
import { supabase, ALLOWED_EMAIL } from "../lib/supabase";

/** Sign in with a 6-digit code typed in the app.
 *  Not a magic link: on iPhone a link opens Safari, not the installed app, and the session lands in the wrong place. */
export default function SignIn() {
  const [email, setEmail] = useState(ALLOWED_EMAIL);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function send() {
    const e = email.trim().toLowerCase();
    if (ALLOWED_EMAIL && e !== ALLOWED_EMAIL) { setMsg("This nest is just for Anthony."); return; }
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setStep("code");
  }
  async function verify() {
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setMsg("That code didn't work. Try again or resend.");
  }

  return (
    <div className="stack" style={{ marginTop: "18vh" }}>
      <div className="date">Bird Nest</div>
      <h1 className="sentence">{step === "email" ? "Welcome home." : "Check your email."}</h1>
      {step === "email" ? (
        <>
          <input className="field" type="email" inputMode="email" autoComplete="email" placeholder="Email"
            value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button className="btn primary" disabled={busy || !email} onClick={send}>✉ Send code</button>
        </>
      ) : (
        <>
          <input className="field code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && verify()} />
          <button className="btn primary" disabled={busy || code.length < 6} onClick={verify}>✓ Sign in</button>
          <button className="btn" disabled={busy} onClick={() => { setStep("email"); setCode(""); }}>↺ Resend</button>
        </>
      )}
      {msg && <p className="quiet">{msg}</p>}
    </div>
  );
}
