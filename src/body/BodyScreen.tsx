import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { appNav, goTab } from "../head/useHead";
import { toast } from "../lib/toast";
import { fitApi, fitState, setFrame, type FitPlan } from "./host";
import { missingFromRiver, putPlanOnRiver } from "./river-body";

const SECTIONS: [string, string, string][] = [["workout", "🏋", "Workout"], ["stretch", "🧘", "Stretch"], ["meals", "🍽", "Meals"], ["settings", "⚙︎", "Setup"]];

/* Where the frame should sit: under the Body chips, above Nest's tab bar. */
const slot = { top: 0, bottom: 0 };
const slotSubs = new Set<() => void>();
function setSlot(top: number, bottom: number) { if (slot.top !== top || slot.bottom !== bottom) { slot.top = top; slot.bottom = bottom; slotSubs.forEach((f) => f()); } }

/** The Body tab: four chips that drive the Fitness screens below them. */
export default function BodyScreen() {
  const st = fitState.use();
  const head = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const tabs = document.querySelector(".tabs") as HTMLElement | null;
      setSlot(Math.round(head.current?.getBoundingClientRect().bottom ?? 0), tabs?.offsetHeight ?? 0);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (head.current) ro.observe(head.current);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, []);
  return (
    <div className="body-head" ref={head}>
      <div className="hnav" role="tablist" aria-label="Body sections">
        {SECTIONS.map(([k, ic, label]) => (
          <button key={k} role="tab" aria-selected={st.tab === k} className={"hn" + (st.tab === k ? " on" : "")} onClick={() => fitApi()?.goTab(k)}>
            <span className="hn-ic">{ic}</span><span className="hn-l">{label}</span>
          </button>
        ))}
      </div>
      <button className="iconbtn" aria-label="Gym check-in barcode" onClick={() => fitApi()?.checkIn()}>🎫</button>
    </div>
  );
}

/** Always mounted, so a running rest timer keeps going while you look at the River. Shown only on Body. */
export function BodyFrame() {
  const tab = appNav.use().tab;
  const active = tab === "body";
  const [mounted, setMounted] = useState(active);
  const [, force] = useState(0);
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => { const f = () => force((n) => n + 1); slotSubs.add(f); return () => { slotSubs.delete(f); }; }, []);
  // Load it a moment after start so the River paints first.
  useEffect(() => { if (active) setMounted(true); else { const t = window.setTimeout(() => setMounted(true), 1200); return () => window.clearTimeout(t); } }, [active]);
  useEffect(() => () => setFrame(null), []);
  if (!mounted) return null;
  return (
    <iframe
      ref={ref}
      title="Body"
      src="/body.html"
      className={"bodyframe" + (active ? " on" : "")}
      style={{ top: slot.top, height: `calc(100% - ${slot.top + slot.bottom}px)` }}
      onLoad={() => setFrame(ref.current?.contentWindow ?? null)}
    />
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A small rest-timer pill on the other tabs. The timer runs on end time, so a locked phone doesn't stop it. */
export function TimerPill() {
  const { timer } = fitState.use();
  const tab = appNav.use().tab;
  const [, tick] = useState(0);
  useEffect(() => { if (!timer) return; const iv = window.setInterval(() => tick((n) => n + 1), 500); return () => window.clearInterval(iv); }, [timer]);
  if (!timer || tab === "body") return null;
  const left = Math.max(0, (timer.end - Date.now()) / 1000);
  const done = !timer.on || left <= 0;
  return (
    <button className={"timer-pill" + (done ? " done" : "")} onClick={() => goTab("body")}>
      ⏱ {done ? `${timer.label} done — go` : <><b>{fmt(left)}</b> {timer.label}</>}
    </button>
  );
}

/** Under the River: today's Body plan, ready to drop in as blocks. */
export function BodyTray({ day }: { day: string }) {
  const { ready, ver } = fitState.use();
  const [plan, setPlan] = useState<FitPlan | null>(null);
  const [missing, setMissing] = useState(0);
  useEffect(() => {
    let live = true;
    const api = fitApi();
    if (!ready || !api) { setPlan(null); return; }
    let p: FitPlan | null = null;
    try { p = api.plan(day); } catch { p = null; }
    setPlan(p);
    if (p) void missingFromRiver(p).then((m) => { if (live) setMissing(m.length); });
    return () => { live = false; };
  }, [ready, ver, day]);
  if (!plan || !plan.blocks.length || !missing) return null;
  const main = plan.blocks.find((b) => b.key === "main");
  return (
    <section className="tray body-tray">
      <div className="sec-head">
        <span>🏋</span>
        <span className="grow">{plan.workout ? `${plan.workout} day` : "Rest day · stretch"}{main ? ` · ${main.steps.length} lifts` : ""}</span>
        <button className="btn sm" onClick={() => { goTab("body"); if (main?.wid) fitApi()?.openWorkout(day, main.wid); else fitApi()?.openToday(day); }}>🏋 Open</button>
        <button className="btn sm" onClick={async () => { const u = await putPlanOnRiver(plan); setMissing(0); toast("🌊 On the River", u); }}>🌊 Add</button>
      </div>
      <div className="detail tray-note">{plan.blocks.map((b) => `${b.icon} ${b.title}`).join(" · ")}</div>
    </section>
  );
}
