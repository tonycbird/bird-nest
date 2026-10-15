import { dayLabel } from "../lib/dayKey";

/** Phase 0: the frame of Today. The River and its steps arrive in Phase 1. */
export default function Today(props: { pending: number; online: boolean; onSettings: () => void; onApprovals: () => void }) {
  return (
    <>
      <header className="top">
        <div>
          <div className="date">{dayLabel()} {!props.online && <span className="offline">· offline</span>}</div>
          <h1 className="sentence">The nest is built. The River comes next.</h1>
        </div>
        <button className="gear" aria-label="Settings" onClick={props.onSettings}>⚙</button>
      </header>
      {props.pending > 0 && (
        <button className="card row" style={{ width: "100%", border: 0, textAlign: "left", marginBottom: 12 }} onClick={props.onApprovals}>
          <span style={{ fontSize: 20 }}>✓</span>
          <span><strong>{props.pending}</strong> waiting for you</span>
          <span style={{ marginLeft: "auto" }} className="quiet">›</span>
        </button>
      )}
      <div className="card">
        <div className="stack">
          <div className="row"><span className="dot body" /><span>Body</span><span className="quiet" style={{ marginLeft: "auto" }}>Phase 3</span></div>
          <div className="row"><span className="dot head" /><span>Head</span><span className="quiet" style={{ marginLeft: "auto" }}>Phase 2</span></div>
          <div className="row"><span className="dot money" /><span>Money</span><span className="quiet" style={{ marginLeft: "auto" }}>Phase 6</span></div>
        </div>
      </div>
    </>
  );
}
