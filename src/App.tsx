import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./lib/db";
import { cloud } from "./lib/sync";
import { useSetting } from "./lib/settings";
import { ToastProvider } from "./lib/toast";
import Today from "./screens/Today";
import Settings from "./screens/Settings";
import Money from "./screens/Money";
import UpdateToast from "./screens/UpdateToast";
import HeadScreen, { HeadOverlays } from "./head/HeadScreen";
import { appNav, goTab, multi, openOverlay, type AppTab } from "./head/useHead";
import * as C from "./head/core/clearhead.js";
import BodyScreen, { BodyFrame, TimerPill } from "./body/BodyScreen";
import { Icon, type IconName } from "./ui/Icon";
import { TestFlag } from "./screens/Testing";
import { setTestingOn } from "./lib/testing";
import { startBuzz } from "./lib/buzz";

export default function App() {
  const c = cloud.use();
  const tab = appNav.use().tab;
  const selecting = multi.use().on;
  const [online, setOnline] = useState(navigator.onLine);
  const details = useSetting<boolean>("details", false);
  const testing = useSetting<boolean>("testing", false);
  useEffect(() => { setTestingOn(testing); }, [testing]);
  const inbox = useLiveQuery(() => db.tasks.filter((t) => t.status === "open" && !t.areaId && !t.projectId && !t.list && !t.someday).count(), [], 0);

  // Quiet by default: anything marked .detail shows only when "Show details" is on (Settings).
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

  // Buzzes: plan them (rest timer, shutdown), and open the right place when one is tapped.
  useEffect(() => {
    startBuzz();
    void import("./lib/autofill").then((m) => m.startAutofill()).catch(() => undefined); // the day fills itself
    void import("./lib/budget").then((m) => m.startMoney()).catch(() => undefined); // a new day: this month's numbers
    const open = (href: string) => {
      const what = new URL(href, location.origin).searchParams.get("open");
      if (what === "body") goTab("body");
      else if (what === "shutdown") { goTab("head"); openOverlay("shutdown"); }
    };
    if (location.search.includes("open=")) { open(location.href); history.replaceState(null, "", location.pathname); }
    const msg = (e: MessageEvent) => { const d = e.data as { type?: string; url?: string } | null; if (d?.type === "nest-open" && d.url) open(d.url); };
    navigator.serviceWorker?.addEventListener("message", msg);
    return () => navigator.serviceWorker?.removeEventListener("message", msg);
  }, []);

  // Scroll to top when switching tabs (the page itself never scrolls: .scroller does).
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [tab]);
  // iPhone still nudges the page itself to show a field above the keyboard. Once typing is done, put it back,
  // or the tab bar and the Body frame would sit off where they belong.
  useEffect(() => {
    const typing = () => !!document.activeElement?.matches("input, textarea, select, [contenteditable]");
    const home = () => { if (!typing() && (window.scrollY || document.documentElement.scrollTop)) window.scrollTo(0, 0); };
    const later = () => window.setTimeout(home, 120);
    window.addEventListener("scroll", home, { passive: true });
    window.addEventListener("focusout", later);
    window.visualViewport?.addEventListener("resize", later);
    return () => { window.removeEventListener("scroll", home); window.removeEventListener("focusout", later); window.visualViewport?.removeEventListener("resize", later); };
  }, []);


  const T = (t: AppTab, icon: IconName, label: string, badge?: number) => {
    const on = tab === t;
    return (
      <button className={"tab" + (on ? " on" : "")} aria-current={on ? "page" : undefined} onClick={() => goTab(t)}>
        <Icon n={icon} size={23} tone={on} />{label}{badge ? <span className="badge">{badge}</span> : null}
      </button>
    );
  };

  return (
    <ToastProvider>
      <div className={"app" + (tab === "body" ? " body-on" : "")}>
        <div className="scroller" ref={scroller}>
        <main className="main" key={tab}>
          {tab === "today" && <Today online={online} onSettings={() => goTab("settings")} />}
          {tab === "head" && <HeadScreen />}
          {tab === "body" && <BodyScreen />}
          {tab === "settings" && <Settings email={c.email} online={online} />}
          {tab === "money" && <Money />}
        </main>
        </div>
        <nav className="tabs" aria-label="Main">
          {T("today", "today", "Today")}
          {T("head", "head", "Head", inbox)}
          <div className="tab-add">
            {!selecting && <button aria-label="Quick add" onClick={() => openOverlay("quickadd", tab === "today" ? { defaults: { when: C.today() } } : tab === "head" ? {} : { defaults: {} })}><Icon n="plus" size={26} tone={false} /></button>}
          </div>
          {T("body", "body", "Body")}
          {T("money", "coin", "Money")}
        </nav>
        <BodyFrame />
        <TimerPill />
        <HeadOverlays />
        <UpdateToast />
        {testing && <TestFlag />}
      </div>
    </ToastProvider>
  );
}
