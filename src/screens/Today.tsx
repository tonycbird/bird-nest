import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type CalEvent } from "../lib/db";
import {
  completeBlock, copyDay, defaultSentence, loadDay, loadSample, moveBlock, nextLine, nowBlock, nowStep,
  setSentence, skipBlock, softDelete, toggleStep, type RiverBlock,
} from "../lib/river";
import { addDays, keyLabel, shortTime, today } from "../lib/time";
import { useToast } from "../lib/toast";
import BlockSheet from "./BlockSheet";
import StepPlayer from "./StepPlayer";
import { HeadTray } from "../head/ui/tray";
import { BodyTray } from "../body/BodyScreen";
import { fitApi } from "../body/host";
import { goTab, openTask } from "../head/useHead";

interface Props { pending: number; online: boolean; details: boolean; onToggleDetails: () => void; onSettings: () => void; onApprovals: () => void; }

export default function Today(props: Props) {
  const toast = useToast();
  const [day, setDay] = useState(today());
  const isToday = day === today();
  const blocks = useLiveQuery(() => loadDay(day), [day], [] as RiverBlock[]);
  const dayRow = useLiveQuery(() => db.days.get(day), [day]);
  // Google Calendar events Claude copied in: thin, locked rows on the River.
  const cal = useLiveQuery(() => db.calendar.where("day").equals(day).toArray(), [day], [] as CalEvent[]);
  const timedCal = cal.filter((e) => !e.all_day && e.start).sort((a, b) => a.start!.localeCompare(b.start!));
  const allDay = cal.filter((e) => e.all_day || !e.start);
  const merged: ({ b: RiverBlock; e?: undefined; start: string } | { e: CalEvent; b?: undefined; start: string })[] =
    [...blocks.map((b) => ({ b, e: undefined, start: b.start })), ...timedCal.map((e) => ({ e, b: undefined, start: e.start! }))].sort((x, y) => x.start.localeCompare(y.start) || (x.e ? -1 : 1));
  const [openId, setOpenId] = useState<string | "auto">("auto");
  const [menu, setMenu] = useState<RiverBlock | null>(null);
  const [sheet, setSheet] = useState<{ block?: RiverBlock } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // Back to "auto" (follow the now block) when the day changes.
  useEffect(() => { setOpenId("auto"); }, [day]);

  const now = nowBlock(blocks);
  const open = openId === "auto" ? now?.id ?? null : openId;
  const sentence = dayRow?.sentence || defaultSentence(blocks);
  const next = nextLine(blocks);
  const playingBlock = useMemo(() => blocks.find((b) => b.id === playing) ?? null, [blocks, playing]);

  async function tick(stepId: string) {
    const { undo, blockDone } = await toggleStep(stepId);
    if (blockDone) { setOpenId("auto"); toast("✓ Block done", undo); }
  }

  return (
    <>
      <header className="top">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="date daynav">
            <button aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>‹</button>
            <span>{keyLabel(day)}</span>
            <button aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>›</button>
            {!isToday && <button className="todaypill" onClick={() => setDay(today())}>Today</button>}
            {!props.online && <span className="offline detail"> · offline</span>}
          </div>
          {editing ? (
            <input className="sentence-input" autoFocus defaultValue={dayRow?.sentence ?? ""} placeholder={defaultSentence(blocks)}
              onBlur={(e) => { void setSentence(day, e.target.value); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          ) : (
            <button className="sentence-btn" onClick={() => setEditing(true)}><h1 className="sentence">{sentence}</h1></button>
          )}
        </div>
        <div className="top-actions">
          <button className={"info" + (props.details ? " on" : "")} aria-label="Show details" onClick={props.onToggleDetails}>ⓘ</button>
          <button className="gear" aria-label="Settings" onClick={props.onSettings}>⚙</button>
        </div>
      </header>

      {next && (
        <div className="nextline">
          {now && <span className={"dot " + now.kind} />}
          <span>{next}</span>
        </div>
      )}

      {props.pending > 0 && isToday && (
        <button className="card row" style={{ width: "100%", textAlign: "left", marginBottom: 14 }} onClick={props.onApprovals}>
          <span style={{ fontSize: 20 }}>✓</span><span><strong>{props.pending}</strong> waiting for you</span>
          <span style={{ marginLeft: "auto" }} className="quiet">›</span>
        </button>
      )}

      {allDay.length > 0 && (
        <div className="chips" style={{ marginBottom: 10 }}>{allDay.map((e) => <span key={e.id} className="chip cal-chip">📅 {e.title}</span>)}</div>
      )}

      {blocks.length === 0 ? (
        <>
        {timedCal.length > 0 && (
          <div className="rv" style={{ marginBottom: 12 }}>{timedCal.map((e) => <CalRow key={e.id} e={e} />)}</div>
        )}
        <div className="empty">
          <div className="big">🪺</div>
          <h2>Nothing planned</h2>
          <p className="detail">Add a block, or start from a sample.</p>
          <div className="stack" style={{ marginTop: 18, maxWidth: 280, marginInline: "auto" }}>
            <button className="btn primary" onClick={() => setSheet({})}>＋ Block</button>
            <button className="btn" onClick={async () => toast("📋 Copied", await copyDay(addDays(day, -1), day))}>📋 Copy yesterday</button>
            <button className="btn" onClick={async () => toast("☀ Sample day", await loadSample(day))}>☀ Sample day</button>
          </div>
        </div>
        </>
      ) : (
        <>
          <div className="rv">
            {merged.map((r) => {
              if (r.e) return <CalRow key={r.e.id} e={r.e} />;
              const b = r.b;
              const isOpen = open === b.id;
              const cur = nowStep(b);
              const cls = ["rb", b.kind, b.status === "done" ? "done" : "", b.status === "skipped" ? "skipped" : "", now?.id === b.id ? "now" : "", isOpen ? "open" : ""].join(" ");
              return (
                <div key={b.id} className={cls}>
                  <span className="rb-time">{shortTime(b.start)}{Number(b.start.slice(0, 2)) >= 12 && <span className="ap">p</span>}</span>
                  <span className="rb-ic" aria-hidden="true">{b.status === "done" ? "✓" : b.icon}</span>
                  <div className="row" style={{ gap: 0 }}>
                    <button className="rb-head" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? "" : b.id)}>
                      <span className="rb-t">
                        <b>{b.title}</b>
                        <small className="detail">{shortTime(b.start)}{b.end ? `–${shortTime(b.end)}` : ""} · {b.steps.length} steps{b.source_type === "task" ? " · 🧠" : b.source_type === "workout" ? " · 🏋" : ""}</small>
                      </span>
                      <span className="rb-n">{b.status === "done" ? "✓" : b.status === "skipped" ? "⤼" : b.steps.length ? `${b.doneCount}/${b.steps.length}` : ""}</span>
                    </button>
                    <button className="rb-more" aria-label={`More for ${b.title}`} onClick={() => setMenu(b)}>⋯</button>
                  </div>
                  {isOpen && (
                    <>
                      {b.steps.length > 0 && (
                        <ol className="steps-l">
                          {b.steps.map((s) => (
                            <li key={s.id}>
                              <button className={"sp" + (s.done_at ? " ok" : cur?.id === s.id ? " cur" : "")} onClick={() => tick(s.id)}>
                                <span className="c">{s.done_at ? "✓" : s.n}</span>
                                <span className="w">{s.label}</span>
                                <span className="v">{s.value ?? ""}</span>
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                      {b.status !== "done" && (
                        <div className="rb-foot">
                          {b.steps.length > 0
                            ? <button className="btn sm" onClick={() => setPlaying(b.id)}>▶ Step by step</button>
                            : <button className="btn sm good" onClick={async () => toast("✓ Done", await completeBlock(b.id))}>✓ Done</button>}
                          {b.source_type === "task" && b.source_id && <button className="btn sm" onClick={() => openTask(b.source_id!)}>🧠 Task</button>}
                          {b.source_type === "workout" && <button className="btn sm" onClick={() => openBody(b.source_id)}>🏋 {b.source_id?.endsWith("|main") ? "Log" : "Open"}</button>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="add-row">
            <button className="btn sm" onClick={() => setSheet({})}>＋ Block</button>
            {isToday && <button className="btn sm" onClick={async () => toast("📋 Copied to tomorrow", await copyDay(day, addDays(day, 1)))}>📋 Copy to tomorrow</button>}
          </div>
        </>
      )}

      {dayRow?.recap && dayRow.recap.length > 0 && (
        <div className="card recap">
          <div className="lbl" style={{ marginTop: 0 }}>🌙 Recap</div>
          {dayRow.recap.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      )}

      <BodyTray day={day} />
      <HeadTray day={day} />

      {menu && (
        <div className="scrim" onClick={() => setMenu(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{menu.icon} {menu.title}</h2>
            <div className="menu">
              <button onClick={() => { setSheet({ block: menu }); setMenu(null); }}>✏ Edit</button>
              {menu.steps.length > 0 && menu.status !== "done" && <button onClick={() => { setPlaying(menu.id); setMenu(null); }}>▶ Step by step</button>}
              {menu.status !== "done" && <button onClick={async () => { const u = await completeBlock(menu.id); setMenu(null); toast("✓ Done", u); }}>✓ Mark done</button>}
              {menu.source_type === "task" && menu.source_id && <button onClick={() => { openTask(menu.source_id!); setMenu(null); }}>🧠 Open task</button>}
              {menu.source_type === "workout" && <button onClick={() => { openBody(menu.source_id); setMenu(null); }}>🏋 Open in Body</button>}
              <button onClick={async () => { const u = await moveBlock(menu.id); setMenu(null); toast("↪ Moved to tomorrow", u); }}>↪ Tomorrow</button>
              <button onClick={async () => { const u = await skipBlock(menu.id); setMenu(null); toast(menu.status === "skipped" ? "↺ Back on" : "⤼ Skipped", u); }}>{menu.status === "skipped" ? "↺ Un-skip" : "⤼ Skip today"}</button>
              <button className="danger" onClick={async () => { const u = await softDelete(menu.id); setMenu(null); toast("🗑 In Trash", u); }}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {sheet && <BlockSheet day={day} block={sheet.block} onClose={() => setSheet(null)} />}
      {playingBlock && (
        <StepPlayer block={playingBlock} nextBlock={blocks.find((x) => x.status === "open" && x.id !== playingBlock.id) ?? null}
          onClose={() => setPlaying(null)} onNext={(id) => setPlaying(id)} />
      )}
    </>
  );
}

/** A Body block on the River opens the matching Fitness screen: the logger for the workout, the stretch session otherwise. */
function openBody(sourceId?: string | null) {
  goTab("body");
  const api = fitApi();
  if (!api || !sourceId) return;
  const [date, key] = sourceId.split("|");
  const plan = api.plan(date);
  const main = plan.blocks.find((x) => x.key === "main");
  if (key === "main" && main?.wid) api.openWorkout(date, main.wid);
  else if (key === "cool") api.openStretch(date, "s2");
  else if (key === "warm") api.openToday(date);
  else api.openStretch(date, key);
}

/** A calendar event on the River: thin and locked. Change it in Google Calendar. */
function CalRow({ e }: { e: CalEvent }) {
  return (
    <div className="rb cal" aria-label={`Calendar: ${e.title}`}>
      <span className="rb-time">{shortTime(e.start)}{e.start && Number(e.start.slice(0, 2)) >= 12 && <span className="ap">p</span>}</span>
      <span className="rb-ic" aria-hidden="true">📅</span>
      <div className="cal-t"><b>{e.title}</b>{e.end && <small className="quiet"> · until {shortTime(e.end)}</small>}</div>
    </div>
  );
}
