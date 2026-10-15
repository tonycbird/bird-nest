import { useLiveQuery } from "dexie-react-hooks";
import { db, type ProposalStatus } from "../lib/db";
import { decide } from "../lib/proposals";
import { useToast } from "../lib/toast";

const ICON: Record<string, string> = {
  hello: "👋", day_plan: "☀", task: "☐", calendar_book: "📅", workout_swap: "🔁", makeup: "🏋",
  grocery: "🛒", ramble_split: "🗣", recap: "🌙", rollover: "↪", weekly_review: "🗓",
};

function title(p: { kind: string; payload: Record<string, unknown> }): string {
  const t = p.payload?.["title"];
  return typeof t === "string" && t ? t : p.kind.replace(/_/g, " ");
}

export default function Approvals() {
  const items = useLiveQuery(() => db.proposals.where("status").equals("pending").reverse().sortBy("created_at"), [], []);
  const toast = useToast();

  async function act(id: string, status: ProposalStatus) {
    toast(status === "approved" ? "✓ Approved" : "✕ Skipped", await decide(id, status));
  }

  return (
    <>
      <header className="top"><div><div className="date">From Claude</div><h1 className="sentence">✓ Approve</h1></div></header>
      {items.length === 0 ? (
        <div className="empty"><div className="big">✓</div><h2>All clear</h2><p className="detail">Claude's suggestions land here from Phase 4.</p></div>
      ) : (
        <div className="stack">
          {items.map((p) => (
            <div key={p.id} className="card prop">
              <span style={{ fontSize: 22 }}>{ICON[p.kind] ?? "•"}</span>
              <div style={{ minWidth: 0 }}>
                <div className="what">{title(p)}</div>
                {p.reason && <div className="why">{p.reason}</div>}
              </div>
              <div className="acts">
                <button className="iconbtn" aria-label="Skip" onClick={() => act(p.id, "declined")}>✕</button>
                <button className="iconbtn yes" aria-label="Approve" onClick={() => act(p.id, "approved")}>✓</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
