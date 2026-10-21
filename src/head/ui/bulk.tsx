import * as H from "../store";
import { db } from "../../lib/db";
import { toast } from "../../lib/toast";
import { clearMulti, multi } from "../useHead";
import * as A from "./actions";
import { I } from "../../ui/Icon";

/* Clearhead's bulk bar: act on every selected task at once. */
export function BulkBar() {
  const m = multi.use();
  if (!m.on) return null;
  const ids = m.ids;
  const dis = !ids.length;
  const run = (fn: () => Promise<unknown>) => async () => { await fn(); clearMulti(); };
  const top = async () => {
    const all = await db.tasks.toArray();
    const min = Math.min(...all.map((t) => t.todayOrder ?? t.order ?? 0), Date.now());
    const us: H.Undo[] = [];
    for (const [i, id] of ids.entries()) {
      const t = all.find((x) => x.id === id);
      if (t) us.push(await H.updateTask(id, { order: min - (ids.length - i) * 1000, todayOrder: min - (ids.length - i) * 1000 }));
    }
    toast("⤒ To the top", async () => { for (const u of us) await u(); });
  };
  return (
    <div className="bulkbar" role="toolbar" aria-label="Selected tasks">
      <span className="b-count">{ids.length}</span>
      <button className="iconbtn" disabled={dis} aria-label="Done" onClick={run(() => A.completeMany(ids))}><I n="tick" /></button>
      <button className="iconbtn" disabled={dis} aria-label="When" onClick={run(() => A.schedule(ids))}><I n="calendar" /></button>
      <button className="iconbtn" disabled={dis} aria-label="Move" onClick={run(() => A.move(ids))}><I n="arrow" /></button>
      <button className="iconbtn" disabled={dis} aria-label="Tag" onClick={run(() => A.setContexts(ids))}>@</button>
      <button className="iconbtn" disabled={dis} aria-label="Flag" onClick={run(() => A.toggleImportant(ids))}><I n="flag" /></button>
      <button className="iconbtn" disabled={dis} aria-label="To the top" onClick={run(top)}>⤒</button>
      <button className="iconbtn" disabled={dis} aria-label="Delete" onClick={run(() => A.remove(ids))}><I n="trash" /></button>
      <button className="iconbtn" aria-label="Cancel" onClick={clearMulti}><I n="close" /></button>
    </div>
  );
}
