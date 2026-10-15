import { useEffect } from "react";
import { nowStep, toggleStep, type RiverBlock } from "../lib/river";

/** One block, one step at a time: a big step, a big ✓, the next step faded underneath. */
export default function StepPlayer(props: { block: RiverBlock; nextBlock: RiverBlock | null; onClose: () => void; onNext: (id: string) => void }) {
  const b = props.block;
  const cur = nowStep(b);
  const idx = cur ? b.steps.indexOf(cur) : b.steps.length;
  const after = cur ? b.steps[idx + 1] : null;
  const last = [...b.steps].reverse().find((s) => s.done_at);

  useEffect(() => {
    // Keep the screen awake during a workout where the browser allows it.
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { void lock?.release().catch(() => {}); };
  }, []);

  const style = { ["--k" as string]: `var(--${b.kind === "life" ? "ink-2" : b.kind})` };

  return (
    <div className="player" style={style} role="dialog" aria-label={`${b.title}, step by step`}>
      <div className="ph">
        <span style={{ fontSize: 22 }}>{b.icon}</span>
        <b>{b.title}</b>
        <button className="iconbtn" aria-label="Close" onClick={props.onClose}>✕</button>
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
          <button className="pbig" aria-label="Done with this step" onClick={() => void toggleStep(cur.id)}>✓</button>
          <div className="pfoot">
            <button className="btn sm" disabled={!last} onClick={() => last && void toggleStep(last.id)}>‹ Back</button>
            <span className="quiet">{b.doneCount}/{b.steps.length}</span>
          </div>
        </>
      ) : (
        <>
          <div className="pmain">
            <div style={{ fontSize: 64 }}>✓</div>
            <div className="pstep">{b.title} done.</div>
            {props.nextBlock && <div className="pnext">Next: {props.nextBlock.icon} {props.nextBlock.title}</div>}
          </div>
          <div className="stack">
            {props.nextBlock && props.nextBlock.steps.length > 0 && (
              <button className="btn primary" onClick={() => props.onNext(props.nextBlock!.id)}>▶ {props.nextBlock.title}</button>
            )}
            <button className="btn" onClick={props.onClose}>Back to the River</button>
          </div>
        </>
      )}
    </div>
  );
}
