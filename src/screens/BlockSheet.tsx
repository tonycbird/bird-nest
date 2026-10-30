import { useState, type CSSProperties } from "react";
import type { Kind } from "../lib/db";
import { addBlock, MAX_STEPS, softDelete, updateBlock, type RiverBlock } from "../lib/river";
import { nowHHMM } from "../lib/time";
import { useToast } from "../lib/toast";
import { I, Icon, iconName, type IconName } from "../ui/Icon";
import { colorFor, KIND_COLOR, KIND_DEFAULT_ICON } from "../ui/colors";
import { Layer } from "../ui/Layer";

const KINDS: { k: Kind; label: string }[] = [
  { k: "body", label: "Body" }, { k: "head", label: "Head" }, { k: "life", label: "Life" }, { k: "money", label: "Money" },
];
/* The icons a block can wear. */
const PICK: IconName[] = [
  "lift", "warmup", "stretch", "timer", "meal", "sleep", "morning", "study",
  "head", "doc", "job", "briefcase", "laptop", "mail", "call", "person",
  "home", "groceries", "drive", "coffee", "bill", "coin", "church", "heart",
];

function roundUp(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 45, Math.ceil((h * 60 + m) / 15) * 15);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export default function BlockSheet(props: { day: string; block?: RiverBlock; start?: string; onClose: () => void }) {
  const toast = useToast();
  const b = props.block;
  const [title, setTitle] = useState(b?.title ?? "");
  const [kind, setKind] = useState<Kind>(b?.kind ?? "head");
  const [icon, setIcon] = useState<IconName | null>(b?.icon ? iconName(b.icon) : null);
  const [start, setStart] = useState(b?.start ?? props.start ?? roundUp(nowHHMM()));
  const [end, setEnd] = useState(b?.end ?? "");
  const [steps, setSteps] = useState<{ label: string; value: string }[]>(
    b?.steps.length ? b.steps.map((s) => ({ label: s.label, value: s.value ?? "" })) : [{ label: "", value: "" }],
  );
  const [confirmDel, setConfirmDel] = useState(false);
  const shown = icon ?? KIND_DEFAULT_ICON[kind];

  const longStep = steps.find((s) => s.label.trim().split(/\s+/).length > 6);

  function setStep(i: number, patch: Partial<{ label: string; value: string }>) {
    setSteps((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  async function save() {
    if (!title.trim() || !start) return;
    const input = { start, end: end || null, kind, icon: shown, title, steps };
    if (b) toast("✓ Saved", await updateBlock(b.id, input));
    else toast("＋ Added", (await addBlock({ ...input, day: props.day })).undo);
    props.onClose();
  }

  return (
    <Layer><div className="scrim" onClick={props.onClose}>
      <div className="sheet has-x" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={b ? "Edit block" : "New block"}>
        <button className="sheet-x" aria-label="Close" onClick={props.onClose}><Icon n="close" size={18} tone={false} /></button>
        <h2>{b ? "Edit block" : "New block"}</h2>

        <input className="field" placeholder="Block name" value={title} autoFocus={!b} maxLength={48} onChange={(e) => setTitle(e.target.value)} />

        <div className="lbl">Kind</div>
        <div className="chips">
          {KINDS.map(({ k, label }) => (
            <button key={k} className={"chip" + (kind === k ? " on" : "")} onClick={() => setKind(k)}>
              <span className="dot" style={{ background: KIND_COLOR[k] }} />{label}
            </button>
          ))}
        </div>

        <div className="lbl">Icon</div>
        <div className="iconpick" style={{ ["--k" as string]: colorFor(shown, kind) } as CSSProperties}>
          {PICK.map((n) => (
            <button key={n} className={shown === n ? "on" : ""} aria-label={n} aria-pressed={shown === n} onClick={() => setIcon(n)}><Icon n={n} size={20} /></button>
          ))}
        </div>

        <div className="lbl">Time</div>
        <div className="two">
          <input className="field sm" type="time" aria-label="Start" value={start} onChange={(e) => setStart(e.target.value)} />
          <input className="field sm" type="time" aria-label="End" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>

        <div className="lbl">Steps · {steps.filter((s) => s.label.trim()).length}/{MAX_STEPS}</div>
        {steps.map((s, i) => (
          <div className="steprow" key={i}>
            <span className="num">{i + 1}</span>
            <input className="field sm" placeholder="Step" value={s.label} maxLength={48} onChange={(e) => setStep(i, { label: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && steps.length < MAX_STEPS) setSteps((xs) => [...xs, { label: "", value: "" }]); }} />
            <input className="field sm" placeholder="3×10" value={s.value} maxLength={16} onChange={(e) => setStep(i, { value: e.target.value })} />
            <button aria-label="Remove step" onClick={() => setSteps((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : [{ label: "", value: "" }]))}><Icon n="close" size={16} tone={false} /></button>
          </div>
        ))}
        {steps.length < MAX_STEPS && <button className="btn sm" onClick={() => setSteps((xs) => [...xs, { label: "", value: "" }])}><I n="plus" tone={false} /> Step</button>}
        {longStep && <p className="quiet" style={{ marginTop: 8 }}>Keep steps to 6 words.</p>}

        <div className="sheet-actions">
          {b && (confirmDel
            ? <button className="btn" style={{ color: "var(--warn-ink)" }} onClick={async () => { toast("🗑 In Trash", await softDelete(b.id)); props.onClose(); }}><I n="trash" /> Delete?</button>
            : <button className="btn" aria-label="Delete" style={{ flex: "none" }} onClick={() => setConfirmDel(true)}><I n="trash" /></button>)}
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim() || !start} onClick={save}>Save</button>
        </div>
      </div>
    </div></Layer>
  );
}
