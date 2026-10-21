import { useEffect, useState, type CSSProperties } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import * as C from "../head/core/clearhead.js";
import { db } from "../lib/db";
import { toast } from "../lib/toast";
import { go, goTab, openOverlay, openTask, useHeadData, useHeadSettings } from "../head/useHead";
import { fitApi, fitState, type FitPlan } from "../body/host";
import { missingFromRiver, putPlanOnRiver } from "../body/river-body";
import { Icon, type IconName } from "../ui/Icon";
import { colorFor, shortLabel, taskIcon } from "../ui/colors";

/* The circles at the top of Today: things that fit today but have no time yet.
   Tap one to open it. Claude's suggestions sit first. Nothing to show, no row. */

interface Q { key: string; icon: IconName; color: string; label: string; badge?: number; dashed?: boolean; aria?: string; run: () => void }

export default function QuickRow({ day, pending, onApprovals }: { day: string; pending: number; onApprovals: () => void }) {
  const { data, ready } = useHeadData();
  const s = useHeadSettings();
  const onRiver = useLiveQuery(async () => new Set((await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at && b.source_type === "task").map((b) => b.source_id!)), [day], new Set<string>());
  const plan = useBodyPlan(day);

  const items: Q[] = [];
  if (pending > 0) items.push({ key: "claude", icon: "claude", color: "var(--accent)", label: "Claude", badge: pending, dashed: true, aria: `${pending} from Claude`, run: onApprovals });
  if (plan) items.push({ key: "body", icon: "lift", color: colorFor("lift"), label: plan.label, aria: `Put ${plan.label} on today`,
    run: async () => { const u = await putPlanOnRiver(plan.plan); toast("🌊 On today", u); plan.done(); } });
  if (ready && day === C.today()) {
    const { main, overdue } = C.selectToday(data);
    for (const t of main.filter((x) => C.isOpen(x) && !onRiver.has(x.id))) {
      const { area } = C.homeOf(t, data);
      const icon = taskIcon(t.title, area?.icon);
      items.push({ key: t.id, icon, color: colorFor(icon, "head"), label: shortLabel(t.title), aria: t.title, run: () => openTask(t.id) });
    }
    if (overdue.length) items.push({ key: "late", icon: "warn", color: "var(--warn)", label: `${overdue.length} late`, run: () => { go("today"); goTab("head"); } });
    const inbox = C.selectInbox(data).length;
    if (inbox) items.push({ key: "inbox", icon: "inbox", color: colorFor("inbox"), label: `${inbox} to sort`, run: () => openOverlay("process") });
    if (s.lastPlan !== C.today() && (main.length || overdue.length || inbox)) items.push({ key: "plan", icon: "morning", color: colorFor("morning"), label: "Plan", run: () => openOverlay("plan") });
  }
  if (!items.length) return null;
  return (
    <div className="quick" role="list" aria-label="Fits today">
      {items.map((q) => (
        <button key={q.key} role="listitem" className="qc" aria-label={q.aria ?? q.label} onClick={q.run}>
          <span className={"c" + (q.dashed ? " dash" : "")} style={{ ["--k" as string]: q.color } as CSSProperties}>
            <Icon n={q.icon} size={24} />
            {q.badge ? <span className="badge">{q.badge}</span> : null}
          </span>
          <span className="t">{q.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Today's Body plan, if part of it isn't on the River yet. */
function useBodyPlan(day: string): { plan: FitPlan; label: string; done: () => void } | null {
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
  return { plan, label: plan.workout ? shortLabel(plan.workout) : "Stretch", done: () => setMissing(0) };
}
