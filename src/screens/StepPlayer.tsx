import { useEffect, useRef } from "react";
import { nowStep, toggleStep, type RiverBlock } from "../lib/river";
import { I, Icon } from "../ui/Icon";
import { blockLook } from "../ui/colors";

/** One block, one step at a time: a big step, a big ✓, the next step faded underneath. */
export default function StepPlayer(props: { block: RiverBlock; nextBlock: RiverBlock | null; onClose: () => void; onNext: (id: string) => void }) {
  const b = props.block;
  const cur = nowStep(b);
  const idx = cur ? b.steps.indexOf(cur) : b.steps.length;
  const after = cur ? b.steps[idx + 1] : null;
  const last = [...b.steps].reverse().find((s) => s.done_at);

  useEffect(() => {
    // Keep the screen awake during a workout where the browser allows it. The phone drops the lock when the
    // app goes to the background, so ask again on the way back; and never leave one behind after closing.
    type Lock = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } };
    let lock: Lock | null = null;
    let alive = true;
    const ask = () => {
      if (!nav.wakeLock || document.visibilityState !== "visible") return;
      nav.wakeLock.request("screen").then((l) => { if (alive) lock = l; else void l.release().catch(() => {}); }).catch(() => {});
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => { alive = false; document.removeEventListener("visibilitychange", ask); void lock?.release().catch(() => {}); };
  }, []);

  // One tap, one step: a quick double tap must not tick the step and then un-tick it.
  const ticking = useRef<string | null>(null);
  const tick = (id: string) => {
    if (ticking.current === id) return;
    ticking.current = id;
    void toggleStep(id).finally(() => window.setTimeout(() => { if (ticking.current === id) ticking.current = null; }, 350));
  };

  const look = blockLook(b);
  const style = { ["--k" as string]: look.color };

  return (
    <div className="player" style={style} role="dialog" aria-label={`${b.title}, step by step`}>
      <div className="ph">
        <span className="p-ic"><Icon n={look.icon} size={21} /></span>
        <b>{b.title}</b>
        <button className="iconbtn" aria-label="Close" onClick={props.onClose}><I n="close" /></button>
      </div>
      <div className="pdots">
        {b.steps.map((s, i) => <i key={s.id} className={s.done_at ? "ok" : i === idx ? "cur" : ""} />)}
      </div>

      {cur ? (
        <>
          <div className="pmain">
            <div className="pcount">Step {idx + 1} of {b.steps.length}</div>
            <div className="pstep">{cur.label}</div>
            {cur.value && <div className="pval">{cur.value}</div>}
            {after && <div className="pnext">Then: {after.label}</div>}
          </div>
          <button className="pbig" aria-label="Done with this step" onClick={() => tick(cur.id)}><Icon n="tick" size={58} tone={false} /></button>
          <div className="pfoot">
            <button className="btn sm" disabled={!last} onClick={() => last && tick(last.id)}><I n="chevL" /> Back</button>
            <span className="quiet">{b.doneCount}/{b.steps.length}</span>
          </div>
        </>
      ) : (
        <>
          <div className="pmain">
            <div className="pdone"><Icon n="tick" size={48} tone={false} /></div>
            <div className="pstep">{b.title} done.</div>
            {props.nextBlock && <div className="pnext">Next: {props.nextBlock.title}</div>}
          </div>
          <div className="stack">
            {props.nextBlock && props.nextBlock.steps.length > 0 && (
              <button className="btn primary" onClick={() => props.onNext(props.nextBlock!.id)}><I n="play" /> {props.nextBlock.title}</button>
            )}
            <button className="btn" onClick={props.onClose}>Back to Today</button>
          </div>
        </>
      )}
    </div>
  );
}
