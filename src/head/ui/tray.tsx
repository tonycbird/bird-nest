import { useLiveQuery } from "dexie-react-hooks";
import * as C from "../core/clearhead.js";
import { db } from "../../lib/db";
import { toast } from "../../lib/toast";
import { goTab, go, openOverlay, openTask, useHeadData, useHeadSettings } from "../useHead";
import { Check } from "./bits";
import * as A from "./actions";
import { putTaskOnRiver, putTasksOnRiver } from "../river-bridge";

/* Under the River: today's Head tasks that aren't on it yet. Tap 🌊 to give one a block. */
export function HeadTray({ day }: { day: string }) {
  const { data, ready } = useHeadData();
  const s = useHeadSettings();
  const onRiver = useLiveQuery(async () => new Set((await db.blocks.where("day").equals(day).toArray()).filter((b) => !b.deleted_at && b.source_type === "task").map((b) => b.source_id!)), [day], new Set<string>());
  if (!ready || day !== C.today()) return null;
  const { main, overdue } = C.selectToday(data);
  const loose = main.filter((t) => C.isOpen(t) && !onRiver.has(t.id));
  const inbox = C.selectInbox(data).length;
  const planned = s.lastPlan === C.today();
  if (!loose.length && !overdue.length && planned && !inbox) return null;
  return (
    <section className="tray">
      <div className="sec-head">
        <span>🧠</span><span className="grow">Fits today{loose.length ? ` · ${loose.length}` : ""}</span>
        {!planned && <button className="btn sm" onClick={() => openOverlay("plan")}>🌅 Plan</button>}
        {loose.length > 1 && <button className="btn sm" onClick={async () => toast("🌊 On the River", await putTasksOnRiver(loose.map((t) => t.id), day))}>🌊 All</button>}
      </div>
      {loose.map((t) => (
        <div key={t.id} className="task tray-row" role="button" tabIndex={0} onClick={() => openTask(t.id)}>
          <Check on={false} important={t.important} onToggle={() => A.complete(t.id)} />
          <div className="t-body"><div className="t-title">{t.title}</div>{(t.est || t.time) && <div className="t-meta">{t.time && <span>⏰ {C.fmtTime(t.time)}</span>}{t.est && <span>⏱ {C.fmtMinutes(t.est)}</span>}</div>}</div>
          <button className="iconbtn" aria-label={"Put on River: " + t.title} onClick={async (e) => { e.stopPropagation(); toast("🌊 On the River", await putTaskOnRiver(t.id, day)); }}>🌊</button>
        </div>
      ))}
      <div className="chips" style={{ marginTop: 8 }}>
        {overdue.length > 0 && <button className="chip" onClick={() => { go("today"); goTab("head"); }}>⚠ {overdue.length} from earlier</button>}
        {inbox > 0 && <button className="chip" onClick={() => openOverlay("process")}>📥 {inbox} to sort</button>}
      </div>
    </section>
  );
}
