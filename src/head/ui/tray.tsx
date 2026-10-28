import { useLiveQuery } from "dexie-react-hooks";
import * as C from "../core/clearhead.js";
import { db } from "../../lib/db";
import { toast } from "../../lib/toast";
import { goTab, go, openOverlay, openTask, useHeadData, useHeadSettings } from "../useHead";
import { Check } from "./bits";
import * as A from "./actions";
import { putTaskOnRiver, putTasksOnRiver } from "../river-bridge";
import { I } from "../../ui/Icon";

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
        <span><I n="head" /></span><span className="grow">Fits today{loose.length ? ` · ${loose.length}` : ""}</span>
        {!planned && <button className="btn sm" onClick={() => openOverlay("plan")}><I n="morning" /> Plan</button>}
        {loose.length > 1 && <button className="btn sm" onClick={async () => toast("🌊 On the River", await putTasksOnRiver(loose.map((t) => t.id), day))}><I n="river" /> All</button>}
      </div>
      {loose.map((t) => (
        <div key={t.id} className="task tray-row" role="button" tabIndex={0} onClick={() => openTask(t.id)}>
          <Check on={false} important={t.important} onToggle={() => A.complete(t.id)} />
          <div className="t-body"><div className="t-title">{t.title}</div>{(t.est || t.time) && <div className="t-meta">{t.time && <span><I n="later" /> {C.fmtTime(t.time)}</span>}{t.est && <span><I n="timer" /> {C.fmtMinutes(t.est)}</span>}</div>}</div>
          <button className="iconbtn" aria-label={"Put on River: " + t.title} onClick={async (e) => { e.stopPropagation(); toast("🌊 On the River", await putTaskOnRiver(t.id, day)); }}><I n="river" /></button>
        </div>
      ))}
      <div className="chips" style={{ marginTop: 8 }}>
        {overdue.length > 0 && <button className="chip" onClick={() => { go("today"); goTab("head"); }}><I n="later" /> {overdue.length} from earlier</button>}
        {inbox > 0 && <button className="chip" onClick={() => openOverlay("process")}><I n="inbox" /> {inbox} to sort</button>}
      </div>
    </section>
  );
}
