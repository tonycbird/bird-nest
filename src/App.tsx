import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./lib/db";
import { cloud } from "./lib/sync";
import { setSetting, useSetting } from "./lib/settings";
import { ToastProvider } from "./lib/toast";
import Today from "./screens/Today";
import Approvals from "./screens/Approvals";
import Settings from "./screens/Settings";
import UpdateToast from "./screens/UpdateToast";
import HeadScreen, { HeadOverlays } from "./head/HeadScreen";
import { appNav, goTab, multi, openOverlay, type AppTab } from "./head/useHead";
import * as C from "./head/core/clearhead.js";
import BodyScreen, { BodyFrame, TimerPill } from "./body/BodyScreen";

export default function App() {
  const c = cloud.use();
  const tab = appNav.use().tab;
  const selecting = multi.use().on;
  const [online, setOnline] = useState(navigator.onLine);
  const details = useSetting<boolean>("details", false);
  const pending = useLiveQuery(() => db.proposals.where("status").equals("pending").count(), [], 0);
  const inbox = useLiveQuery(() => db.tasks.filter((t) => t.status === "open" && !t.areaId && !t.projectId && !t.list && !t.someday).count(), [], 0);

  // Quiet by default: anything marked .detail shows only after ⓘ.
  useEffect(() => { document.documentElement.classList.toggle("quiet", !details); }, [details]);

  useEffect(() => {
    // Ask the browser to keep this data (installed iPhone apps are kept; plain Safari tabs can be cleared).
    void navigator.storage?.persist?.().catch(() => false);
    // Sync runs on its own (src/lib/sync.ts); Nest never waits for the cloud or a sign-in.
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Scroll to top when switching tabs.
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);


  const T = (t: AppTab, icon: string, label: string, badge?: number) => (
    <button className={"tab" + (tab === t || (t === "today" && tab === "settings") ? " on" : "")} onClick={() => goTab(t)}>
      <span className="ic">{icon}</span>{label}{badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

  return (
    <ToastProvider>
      <div className="app">
        <main className="main">
          {tab === "today" && <Today pending={pending} online={online} details={details}
            onToggleDetails={() => void setSetting("details", !details)}
            onSettings={() => goTab("settings")} onApprovals={() => goTab("ok")} />}
          {tab === "head" && <HeadScreen />}
          {tab === "body" && <BodyScreen />}
          {tab === "ok" && <Approvals />}
          {tab === "settings" && <Settings email={c.email} online={online} />}
        </main>
        {(tab === "today" || tab === "head") && !selecting && (
          <button className="fab" aria-label="Quick add" onClick={() => openOverlay("quickadd", tab === "today" ? { defaults: { when: C.today() } } : {})}>＋</button>
        )}
        <nav className="tabs" aria-label="Main">
          {T("today", "☀", "Today")}
          {T("head", "🧠", "Head", inbox)}
          {T("body", "🏋", "Body")}
          {T("ok", "✓", "Approve", pending)}
        </nav>
        <BodyFrame />
        <TimerPill />
        <HeadOverlays />
        <UpdateToast />
      </div>
    </ToastProvider>
  );
}
