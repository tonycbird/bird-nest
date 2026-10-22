import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Proposal } from "../lib/db";
import { ALREADY, approve, decline } from "../lib/apply";
import { cloud, dismissMail, syncNow } from "../lib/sync";
import { CLOUD } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { goTab } from "../head/useHead";
import { keyLabel, shortTime } from "../lib/time";
import { Icon, type IconName } from "../ui/Icon";
import { colorFor } from "../ui/colors";
import { I } from "../ui/Icon";

const ICON: Record<string, IconName> = {
  hello: "claude", day_plan: "today", task: "select", calendar_book: "calendar", workout_swap: "swap", makeup: "lift",
  grocery: "groceries", ramble_split: "talk", recap: "sleep", rollover: "arrow", weekly_review: "calendar",
};
const look = (kind: string) => { const n = ICON[kind] ?? "claude"; return { n, k: kind === "day_plan" ? "var(--accent)" : colorFor(n, "head") }; };
const DONE_MSG: Record<string, string> = {
  day_plan: "☀ River replaced", task: "☐ Task added", calendar_book: "📅 Booking within the hour", grocery: "🛒 Added to groceries",
  rollover: "↪ Moved to tomorrow", recap: "🌙 Saved", makeup: "🏋 Makeup set", workout_swap: "🔁 Swapped",
  ramble_split: "🗣 Tasks added", weekly_review: "🗓 On the River",
};

type J = Record<string, unknown>;
const list = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);

function title(p: Proposal): string {
  const t = p.payload?.["title"];
  if (typeof t === "string" && t) return t;
  const P = p.payload as J;
  if (p.kind === "day_plan") return `Plan for ${p.day_key ? keyLabel(p.day_key) : "today"}`;
  if (p.kind === "grocery") return `Groceries · ${list(P.items).length}`;
  if (p.kind === "rollover") return "Move to tomorrow";
  if (p.kind === "recap") return "Today's recap";
  if (p.kind === "makeup") return "Make up the missed workout";
  if (p.kind === "weekly_review") return "Weekly review";
  if (p.kind === "ramble_split") return `Tasks from a ramble · ${list(P.tasks).length}`;
  return p.kind.replace(/_/g, " ");
}

/** What ✓ would do, in a few lines. */
function Preview({ p }: { p: Proposal }) {
  const P = p.payload as J;
  if (p.kind === "day_plan") return (
    <>
    {typeof P.sentence === "string" && <p className="quiet" style={{ marginTop: 6 }}>“{P.sentence}”</p>}
    <ol className="prop-list">
      {list(P.blocks).map((b, i) => <li key={i}><b>{shortTime(String(b.start ?? ""))}</b> {String(b.icon ?? "")} {String(b.title ?? "")} <span className="quiet">· {list(b.steps).length} steps</span></li>)}
    </ol>
    </>
  );
  if (p.kind === "grocery") return <ol className="prop-list">{list(P.items).map((x, i) => <li key={i}>{String(x.name)} {x.amt ? <span className="quiet">· {String(x.amt)}</span> : null}</li>)}</ol>;
  if (p.kind === "recap") return <ol className="prop-list">{(Array.isArray(P.lines) ? P.lines : []).map((x, i) => <li key={i}>{String(x)}</li>)}</ol>;
  if (p.kind === "ramble_split") return <ol className="prop-list">{list(P.tasks).map((x, i) => <li key={i}>{String(x.title)}</li>)}</ol>;
  if (p.kind === "rollover") return <p className="quiet">{list(P.move).length} to tomorrow{list(P.someday).length ? ` · ${list(P.someday).length} to Someday` : ""}</p>;
  if (p.kind === "calendar_book") return <p className="quiet">{String(P.day ?? "")} {shortTime(String(P.start ?? ""))}–{shortTime(String(P.end ?? ""))}</p>;
  if (p.kind === "task") return <p className="quiet">{[P.when && `📅 ${P.when}`, P.due && `⚑ ${P.due}`, P.link && "📧 link"].filter(Boolean).join(" · ")}</p>;
  if (p.kind === "weekly_review") return <ol className="prop-list">{(Array.isArray(P.prompts) ? P.prompts : []).map((x, i) => <li key={i}>{String(x)}</li>)}</ol>;
  return null;
}

export default function Approvals() {
  const items = useLiveQuery(() => db.proposals.where("status").equals("pending").reverse().sortBy("created_at"), [], []);
  const waiting = useLiveQuery(() => db.proposals.where("status").equals("approved").toArray(), [], []);
  const mail = useLiveQuery(() => db.mail.orderBy("created_at").reverse().toArray(), [], []);
  const c = cloud.use();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);

  async function act(p: Proposal, yes: boolean) {
    try {
      const undo = yes ? await approve(p) : await decline(p);
      if (undo === ALREADY) return;
      toast(yes ? (DONE_MSG[p.kind] ?? "✓ Approved") : "✕ Skipped", undo);
    } catch (e) {
      toast("⚠ " + (e as Error).message);
    }
  }

  return (
    <>
      <header className="top"><div><div className="date">Suggestions</div><h1 className="sentence">Claude</h1></div></header>
      {CLOUD && !c.signedIn && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p><strong><I n="sync" /> Claude isn't connected</strong></p>
          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => goTab("settings")}><I n="settings" /> Connect</button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="empty"><div className="big"><Icon n="claude" size={36} /></div><h2>All clear</h2>
          {c.signedIn && <button className="btn sm" onClick={() => void syncNow()}><I n="refresh" /> Check now</button>}
        </div>
      ) : (
        <div className="stack">
          {items.map((p) => (
            <div key={p.id} className="card prop" onClick={() => setOpen(open === p.id ? null : p.id)}>
              <span className="p-ic" style={{ ["--k" as string]: look(p.kind).k } as React.CSSProperties}><Icon n={look(p.kind).n} size={21} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="what">{title(p)}</div>
                {p.reason && <div className="why">{p.reason}</div>}
                {open === p.id && <Preview p={p} />}
              </div>
              <div className="acts" onClick={(e) => e.stopPropagation()}>
                <button className="iconbtn" aria-label="Skip" onClick={() => act(p, false)}><I n="close" /></button>
                <button className="iconbtn yes" aria-label="Approve" onClick={() => act(p, true)}><I n="tick" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <>
          <div className="lbl"><I n="calendar" /> Waiting for Claude · {waiting.length}</div>
          <div className="card">{waiting.map((p) => <div key={p.id} className="kv"><span className="row" style={{ gap: 8 }}><Icon n={look(p.kind).n} size={18} />{title(p)}</span><span className="muted">next run</span></div>)}</div>
        </>
      )}
      {mail.length > 0 && (
        <>
          <div className="lbl"><I n="mail" /> Mail Claude flagged · {mail.length}</div>
          <div className="card">
            {mail.map((m) => (
              <div key={m.id} className="kv">
                <a href={m.link} target="_blank" rel="noreferrer" style={{ minWidth: 0, color: "inherit", display: "block", padding: "6px 0" }}>
                  <b>{m.ask || m.subject}</b><div className="quiet detail">{m.sender} · {m.subject}</div>
                </a>
                <button className="iconbtn" aria-label="Dismiss" onClick={() => void dismissMail(m.id)}><I n="close" /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
