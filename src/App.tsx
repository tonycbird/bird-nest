import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useLiveQuery } from "dexie-react-hooks";
import { supabase, configured } from "./lib/supabase";
import { db } from "./lib/db";
import { refreshProposals } from "./lib/proposals";
import SignIn from "./screens/SignIn";
import Today from "./screens/Today";
import Approvals from "./screens/Approvals";
import Settings from "./screens/Settings";
import Later from "./screens/Later";
import UpdateToast from "./screens/UpdateToast";

type Tab = "today" | "head" | "body" | "ok" | "settings";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [online, setOnline] = useState(navigator.onLine);
  const pending = useLiveQuery(() => db.proposals.where("status").equals("pending").count(), [], 0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const on = () => { setOnline(true); void refreshProposals().catch(() => {}); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshProposals().catch(() => {});
    const t = window.setInterval(() => void refreshProposals().catch(() => {}), 60_000);
    const vis = () => { if (document.visibilityState === "visible") void refreshProposals().catch(() => {}); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [session]);

  if (!configured) {
    return <div className="app"><main className="main"><div className="empty"><div className="big">⚙</div><h2>Not set up</h2><p>Add the Supabase URL and key to .env</p></div></main></div>;
  }
  if (!ready) return <div className="app" />;
  if (!session) return <div className="app"><main className="main"><SignIn /></main><UpdateToast /></div>;

  return (
    <div className="app">
      <main className="main">
        {tab === "today" && <Today pending={pending} online={online} onSettings={() => setTab("settings")} onApprovals={() => setTab("ok")} />}
        {tab === "head" && <Later icon="🧠" title="Head" phase={2} />}
        {tab === "body" && <Later icon="🏋" title="Body" phase={3} />}
        {tab === "ok" && <Approvals />}
        {tab === "settings" && <Settings email={session.user.email ?? ""} online={online} />}
      </main>
      <nav className="tabs" aria-label="Main">
        <button className={"tab" + (tab === "today" ? " on" : "")} onClick={() => setTab("today")}><span className="ic">☀</span>Today</button>
        <button className={"tab" + (tab === "head" ? " on" : "")} onClick={() => setTab("head")}><span className="ic">🧠</span>Head</button>
        <button className={"tab" + (tab === "body" ? " on" : "")} onClick={() => setTab("body")}><span className="ic">🏋</span>Body</button>
        <button className={"tab" + (tab === "ok" ? " on" : "")} onClick={() => setTab("ok")}>
          <span className="ic">✓</span>Approve{pending > 0 && <span className="badge">{pending}</span>}
        </button>
      </nav>
      <UpdateToast />
    </div>
  );
}
