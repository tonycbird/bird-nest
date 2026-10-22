import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type CalEvent } from "../lib/db";
import {
  completeBlock, copyDay, loadDay, loadSample, moveBlock, nowBlock, nowStep,
  setSentence, skipBlock, softDelete, toggleStep, type RiverBlock,
} from "../lib/river";
import { addDays, minutes, nowHHMM, shortTime, today } from "../lib/time";
import { useToast } from "../lib/toast";
import BlockSheet from "./BlockSheet";
import StepPlayer from "./StepPlayer";
import QuickRow from "./QuickRow";
import { fitApi } from "../body/host";
import { goTab, openTask, useHeadSettings } from "../head/useHead";
import { placeTimedTasks } from "../head/river-bridge";
import { acceptEvent, acceptedOn } from "../lib/calendar-accept";
import { I, Icon } from "../ui/Icon";
import { blockLook, colorFor } from "../ui/colors";

interface Props { pending: number; online: boolean; onSettings: () => void; onApprovals: () => void; }

const k = (color: string) => ({ ["--k" as string]: color }) as CSSProperties;

/** "35m", "1h", "1h 20m" */
export function dur(m: number): string {
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
}
/** What comes after this block: the next open one later in the day, else any open one left. */
function nextOpen(blocks: RiverBlock[], cur: RiverBlock): RiverBlock | null {
  const open = blocks.filter((x) => x.status === "open" && x.id !== cur.id);
  return open.find((x) => x.start > cur.start || (x.start === cur.start && blocks.indexOf(x) > blocks.indexOf(cur))) ?? open[0] ?? null;
}

/** End of a block in minutes. A block that runs past midnight ends "tomorrow" (+24h). */
const endMin = (start: string, end?: string | null) => {
  const s = minutes(start);
  if (!end) return s + 30;
  const e = minutes(end);
  return e < s ? e + 1440 : e;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function dateParts(key: string) {
  const [y, mo, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, 12));
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(t);
  return { weekday: f({ weekday: "long" }), md: f({ month: "short", day: "numeric" }), letter: f({ weekday: "narrow" }), num: d, dow: t.getUTCDay() };
}

/** Re-draw every 30 seconds (and when the phone wakes) so "now", "left" and "today" stay true. */
function useClock() {
  const [, tick] = useState(0);
  useEffect(() => {
    const bump = () => tick((n) => n + 1);
    const iv = window.setInterval(bump, 30_000);
    const vis = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", bump);
    return () => { window.clearInterval(iv); document.removeEventListener("visibilitychange", vis); window.removeEventListener("focus", bump); };
  }, []);
  return { nowMin: minutes(nowHHMM()), todayKey: today() };
}

export default function Today(props: Props) {
  const toast = useToast();
  const { nowMin, todayKey } = useClock();
  const [day, setDay] = useState(todayKey);
  // Past midnight: if Anthony was looking at "today", follow the calendar to the new today.
  const lastToday = useRef(todayKey);
  useEffect(() => {
    if (lastToday.current === todayKey) return;
    const was = lastToday.current;
    lastToday.current = todayKey;
    setDay((d) => (d === was ? todayKey : d));
  }, [todayKey]);
  const isToday = day === todayKey;
  const blocks = useLiveQuery(() => loadDay(day), [day], [] as RiverBlock[]);
  const dayRow = useLiveQuery(() => db.days.get(day), [day]);
  // Google Calendar items Claude copied in: small faded lines until Anthony holds one to make it his own.
  const cal = useLiveQuery(() => db.calendar.where("day").equals(day).toArray(), [day], [] as CalEvent[]);
  const accepted = useLiveQuery(() => acceptedOn(day), [day], new Set<string>());
  const timedCal = useMemo(() => cal.filter((e) => !e.all_day && e.start && !accepted.has(e.id)).sort((a, b) => a.start!.localeCompare(b.start!)), [cal, accepted]);
  const allDay = cal.filter((e) => (e.all_day || !e.start) && !accepted.has(e.id));
  const accept = async (e: CalEvent) => {
    try { navigator.vibrate?.(12); } catch { /* not on iPhone */ }
    toast(e.all_day || !e.start ? "✓ Added to your tasks" : "✓ On your day", await acceptEvent(e));
  };
  const holdHint = () => toast("Hold to make it yours");
  const [openId, setOpenId] = useState<string | "auto">("auto");
  const [menu, setMenu] = useState<RiverBlock | null>(null);
  const [sheet, setSheet] = useState<{ block?: RiverBlock; start?: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => { setOpenId("auto"); }, [day]);
  // Head tasks with a time today land on the River at that time, by themselves.
  const timed = useLiveQuery(() => db.tasks.where("when").equals(todayKey).filter((t) => !!t.time && t.status === "open").primaryKeys(), [todayKey], [] as string[]);
  const timedSig = timed.join(",");
  useEffect(() => { if (timedSig) void placeTimedTasks(todayKey); }, [timedSig, todayKey]);

  const now = nowBlock(blocks);
  const open = openId === "auto" ? (isToday ? now?.id ?? null : null) : openId;
  const playingBlock = useMemo(() => blocks.find((b) => b.id === playing) ?? null, [blocks, playing]);

  // Blocks in time order with the free gaps between them; calendar lines slot in by their time.
  // A calendar item you haven't accepted doesn't take up time, so it doesn't shrink a gap.
  type Row = { t: "b"; b: RiverBlock } | { t: "e"; e: CalEvent } | { t: "gap"; from: string; mins: number };
  const rows: Row[] = useMemo(() => {
    const out: { key: string; row: Row }[] = [];
    let last = -1;
    for (const b of [...blocks].sort((x, y) => x.start.localeCompare(y.start))) {
      const s = minutes(b.start);
      if (last >= 0 && s - last >= 45) out.push({ key: hhmm(last) + "0", row: { t: "gap", from: hhmm(last), mins: s - last } });
      out.push({ key: b.start + "1", row: { t: "b", b } });
      last = Math.max(last, endMin(b.start, b.end));
    }
    for (const e of timedCal) out.push({ key: e.start! + "2", row: { t: "e", e } });
    return out.sort((x, y) => x.key.localeCompare(y.key)).map((x) => x.row);
  }, [blocks, timedCal]);

  const parts = dateParts(day);

  return (
    <>
      <header className="t-head">
        <button className="t-date" onClick={() => setDay(today())} aria-label="Back to today">{parts.weekday} <span>{parts.md}</span></button>
        <div className="top-actions">
          {!isToday && <button className="t-back" onClick={() => setDay(today())}>Today</button>}
          {!props.online && <span className="offline detail">offline</span>}
          <button className="gear" aria-label="Settings" onClick={props.onSettings}><Icon n="settings" size={21} tone={false} /></button>
        </div>
      </header>
      {editing ? (
        <input className="t-sentence-input" autoFocus defaultValue={dayRow?.sentence ?? ""} placeholder="One line for the day"
          onBlur={(e) => { void setSentence(day, e.target.value); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      ) : dayRow?.sentence ? (
        <button className="t-sentence" onClick={() => setEditing(true)}>{dayRow.sentence}</button>
      ) : null}

      <Week day={day} onPick={setDay} />

      {isToday && <QuickRow day={day} pending={props.pending} onApprovals={props.onApprovals} />}

      {allDay.length > 0 && <div className="allday" aria-label="All-day items from your calendar">{allDay.map((e) => <CalChip key={e.id} e={e} onAccept={() => void accept(e)} onTap={holdHint} />)}</div>}

      {rows.length > 0 && (
        <div className="tl">
          {rows.map((r, i) => {
            if (r.t === "gap") return (
              <div key={"g" + i} className="tl-gap">
                <button onClick={() => setSheet({ start: r.from })}><I n="plus" tone={false} />{dur(r.mins)} free</button>
              </div>
            );
            if (r.t === "e") return <CalLine key={r.e.id} e={r.e} onAccept={() => void accept(r.e)} onTap={holdHint} />;
            return (
              <BlockRow key={r.b.id} b={r.b} isNow={now?.id === r.b.id} isToday={isToday} nowMin={nowMin} open={open === r.b.id}
                onToggle={() => setOpenId(open === r.b.id ? "" : r.b.id)} onMenu={() => setMenu(r.b)} onPlay={() => setPlaying(r.b.id)} />
            );
          })}
        </div>
      )}

      {blocks.length === 0 ? (
        <div className="empty" style={rows.length ? { paddingTop: 28 } : undefined}>
          {rows.length === 0 && <><div className="big"><Icon n="nest" size={38} /></div><h2>Nothing planned</h2><p className="detail">Add a block, or start from a sample.</p></>}
          <div className="stack" style={{ marginTop: 18, maxWidth: 280, marginInline: "auto" }}>
            <button className="btn primary" onClick={() => setSheet({})}><I n="plus" tone={false} /> Block</button>
            <button className="btn" onClick={async () => toast("📋 Copied", await copyDay(addDays(day, -1), day))}><I n="copy" /> Copy yesterday</button>
            <button className="btn" onClick={async () => toast("☀ Sample day", await loadSample(day))}><I n="today" /> Sample day</button>
          </div>
        </div>
      ) : (
        <div className="tl-foot">
          <button onClick={() => setSheet({})}><I n="plus" tone={false} />Block</button>
          {isToday && <button onClick={async () => toast("📋 Copied to tomorrow", await copyDay(day, addDays(day, 1)))}><I n="copy" />Copy to tomorrow</button>}
        </div>
      )}

      {dayRow?.recap && dayRow.recap.length > 0 && (
        <div className="card recap">
          <div className="lbl" style={{ marginTop: 0 }}><I n="sleep" /> Recap</div>
          {dayRow.recap.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      )}

      {menu && (
        <div className="scrim" onClick={() => setMenu(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2><span className="ring on" style={k(blockLook(menu).color)}><Icon n={blockLook(menu).icon} size={17} /></span>{menu.title}</h2>
            <div className="menu">
              {menu.source_type === "workout" && <button onClick={() => { openBody(menu.source_id); setMenu(null); }}><I n="lift" /> Open in Body</button>}
              {menu.source_type === "task" && menu.source_id && <button onClick={() => { openTask(menu.source_id!); setMenu(null); }}><I n="head" /> Open task</button>}
              <button onClick={() => { setSheet({ block: menu }); setMenu(null); }}><I n="edit" /> Edit</button>
              {menu.steps.length > 0 && menu.status !== "done" && <button onClick={() => { setPlaying(menu.id); setMenu(null); }}><I n="play" /> Step by step</button>}
              {menu.status !== "done" && <button onClick={async () => { const u = await completeBlock(menu.id); setMenu(null); toast("✓ Done", u); }}><I n="check" /> Mark done</button>}
              <button onClick={async () => { const u = await moveBlock(menu.id); setMenu(null); toast("↪ Moved to tomorrow", u); }}><I n="arrow" /> Tomorrow</button>
              <button onClick={async () => { const u = await skipBlock(menu.id); setMenu(null); toast(menu.status === "skipped" ? "↺ Back on" : "⤼ Skipped", u); }}><I n={menu.status === "skipped" ? "undo" : "skip"} /> {menu.status === "skipped" ? "Un-skip" : "Skip today"}</button>
              <button className="danger" onClick={async () => { const u = await softDelete(menu.id); setMenu(null); toast("🗑 In Trash", u); }}><I n="trash" /> Delete</button>
            </div>
          </div>
        </div>
      )}

      {sheet && <BlockSheet day={day} block={sheet.block} start={sheet.start} onClose={() => setSheet(null)} />}
      {playingBlock && (
        <StepPlayer block={playingBlock} nextBlock={nextOpen(blocks, playingBlock)}
          onClose={() => setPlaying(null)} onNext={(id) => setPlaying(id)} />
      )}
    </>
  );
}

/* ---------- the week strip ---------- */

function Week({ day, onPick }: { day: string; onPick: (d: string) => void }) {
  const s = useHeadSettings();
  const ws = s.weekStart === 0 ? 0 : 1;
  const dow = dateParts(day).dow;
  const first = addDays(day, -((dow - ws + 7) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const t = today();
  const bars = useLiveQuery(async () => {
    const rows = await db.blocks.where("day").between(days[0], days[6], true, true).toArray();
    const by: Record<string, string[]> = {};
    for (const b of rows.filter((x) => !x.deleted_at).sort((a, b2) => a.start.localeCompare(b2.start))) {
      by[b.day] ??= [];
      if (by[b.day].length < 3) by[b.day].push(blockLook(b).color);
    }
    return by;
  }, [days[0]], {} as Record<string, string[]>);
  const x0 = useRef<number | null>(null);
  return (
    <div className="week" role="group" aria-label="This week"
      onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (x0.current ?? e.changedTouches[0].clientX);
        x0.current = null;
        if (Math.abs(dx) > 60) onPick(addDays(day, dx < 0 ? 7 : -7));
      }}>
      {days.map((d) => {
        const p = dateParts(d);
        const cls = ["wd", d === day ? "on" : "", d === t ? "today" : "", d < t ? "past" : ""].join(" ");
        return (
          <button key={d} className={cls} aria-pressed={d === day} aria-label={`${p.weekday} ${p.md}`} onClick={() => onPick(d)}>
            <span className="l">{p.letter}</span><span className="n">{p.num}</span>
            <span className="bars">{(bars[d] ?? []).map((c, i) => <i key={i} style={k(c)} />)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- one block ---------- */

function BlockRow(props: { b: RiverBlock; isNow: boolean; isToday: boolean; nowMin: number; open: boolean; onToggle: () => void; onMenu: () => void; onPlay: () => void }) {
  const { b, isNow, isToday, nowMin, open } = props;
  const toast = useToast();
  const [all, setAll] = useState(false);
  const look = blockLook(b);
  const s = minutes(b.start), e = endMin(b.start, b.end);
  const n = b.steps.length;
  const cur = nowStep(b);
  const live = isNow && isToday;
  const inside = live && !!b.end && nowMin >= s && nowMin < e;
  const frac = inside ? (nowMin - s) / (e - s) : n ? b.doneCount / n : 0;
  const done = b.status === "done", skipped = b.status === "skipped";
  const cls = ["tr", done ? "done" : "", skipped ? "skipped" : "", live && !done ? "now" : "", open ? "open" : ""].join(" ");

  let kick = "";
  if (live) {
    if (nowMin < s) kick = s - nowMin <= 120 ? `Next · in ${dur(s - nowMin)}` : "Next";
    else if (b.end && e - nowMin > 0) kick = `Now · ${dur(e - nowMin)} left`;
    else kick = "Now";
  }
  const sub = done ? "" : skipped ? "Skipped" : [b.doneCount > 0 && n ? `${b.doneCount}/${n}` : "", b.end ? dur(e - s) : n ? `${n} steps` : ""].filter(Boolean).join(" · ");

  async function finish() { toast("✓ Done", await completeBlock(b.id)); }
  async function tick(id: string) { const r = await toggleStep(id); if (r.blockDone) toast("✓ Block done", r.undo); }

  const ring = done
    ? <span className="ring on" aria-label="Done"><Icon n="tick" size={16} tone={false} /></span>
    : <button className="ring" aria-label={`Mark ${b.title} done`} onClick={finish} />;

  return (
    <div className={cls} style={k(look.color)}>
      <div className="tr-time">
        {shortTime(b.start)}
        {open && b.end && <span className="end">{shortTime(b.end)}</span>}
        {inside && open && <span className="nowt" style={{ top: `${Math.min(88, Math.max(18, frac * 100))}%` }}>{shortTime(nowHHMM())}</span>}
      </div>
      <div className="tp">
        {live && !done && frac > 0 && <div className="fill" style={{ height: `${Math.max(8, frac * 100)}%` }} />}
        <Icon n={look.icon} size={19} />
      </div>
      {!open ? (
        <div className="bc">
          <div className="bc-row">
            <button className="bc-main" aria-expanded={false} onClick={props.onToggle}>
              <b>{b.title}</b>{sub && <small>{sub}</small>}
            </button>
            {ring}
          </div>
        </div>
      ) : (
        <div className="bc bc-open">
          <div className="bc-top">
            <button className="bc-main" aria-expanded onClick={props.onToggle}>
              {kick ? <span className="bc-kick">{kick}</span> : <small>{shortTime(b.start)}{b.end ? `–${shortTime(b.end)}` : ""}</small>}
              <b>{b.title}</b>
            </button>
            {ring}
          </div>

          {n > 0 && (all || done) ? (
            <ol className="steps">
              {b.steps.map((st) => (
                <li key={st.id}>
                  <button className={(st.done_at ? "ok" : "") + (cur?.id === st.id ? " is-cur" : "")} onClick={() => tick(st.id)}>
                    <span className={"sc" + (st.done_at ? " ok" : cur?.id === st.id ? " cur-dot" : "")}>{st.done_at && <Icon n="tick" size={11} tone={false} />}</span>
                    <span className="w">{st.label}</span><span className="v">{st.value ?? ""}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : cur ? (
            <button className="bc-cur" onClick={() => tick(cur.id)} aria-label={`Done: ${cur.label}`}>
              <span className="sc cur-dot" /><span className="w">{cur.label}</span><span className="v">{cur.value ?? ""}</span>
            </button>
          ) : null}

          {!done && (
            <div className="bc-acts">
              {n > 0
                ? <button className="go" onClick={props.onPlay}><Icon n="play" size={14} />{b.doneCount ? "Resume" : "Start"}</button>
                : <button className="go" onClick={finish}><Icon n="tick" size={16} tone={false} />Done</button>}
              {n > 1 && <button className={"sec" + (all ? " up" : "")} aria-label={all ? "Hide steps" : `Show all ${n} steps`} onClick={() => setAll(!all)}>{Math.min(b.doneCount + 1, n)}/{n}<Icon n="chevD" size={16} tone={false} /></button>}
              <button className="sec icon" aria-label={`More for ${b.title}`} onClick={props.onMenu}><Icon n="more" size={18} tone={false} /></button>
            </div>
          )}
          {done && <div className="bc-acts"><button className="sec icon" aria-label={`More for ${b.title}`} onClick={props.onMenu}><Icon n="more" size={18} tone={false} /></button></div>}
        </div>
      )}
    </div>
  );
}

/** A Body block opens the matching Fitness screen: the logger for the workout, the stretch session otherwise. */
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

/** Hold to accept: a fill runs across while the finger stays down; let go early (or scroll) and nothing happens. */
const HOLD_MS = 550;
function useHold(onDone: () => void, onTap: () => void) {
  const [holding, setHolding] = useState(false);
  const t = useRef(0), at = useRef<{ x: number; y: number; t: number } | null>(null), fired = useRef(false);
  const stop = () => { window.clearTimeout(t.current); setHolding(false); at.current = null; };
  return {
    holding,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        fired.current = false;
        at.current = { x: e.clientX, y: e.clientY, t: Date.now() };
        setHolding(true);
        t.current = window.setTimeout(() => { fired.current = true; stop(); onDone(); }, HOLD_MS);
      },
      onPointerMove: (e: React.PointerEvent) => { const a = at.current; if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 10) stop(); },
      onPointerUp: () => { const a = at.current; const quick = !!a && Date.now() - a.t < 300; stop(); if (quick && !fired.current) onTap(); },
      onPointerLeave: stop, onPointerCancel: stop,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}

/** A calendar item you haven't accepted: one faded line. Hold it to make it a block. */
function CalLine({ e, onAccept, onTap }: { e: CalEvent; onAccept: () => void; onTap: () => void }) {
  const { holding, handlers } = useHold(onAccept, onTap);
  const s = minutes(e.start!), en = e.end ? minutes(e.end) : null;
  return (
    <div className={"tr calline" + (holding ? " holding" : "")} role="button" tabIndex={0} aria-label={`${e.title}, from your calendar. Hold to add it to your day`}
      onKeyDown={(k) => { if (k.key === "Enter") onAccept(); }} {...handlers}>
      <div className="tr-time">{shortTime(e.start)}</div>
      <div className="cl-dot"><Icon n="calendar" size={13} tone={false} /></div>
      <div className="cl-body"><span className="cl-fill" /><span className="cl-t">{e.title}</span>{en && en > s ? <span className="cl-d">{dur(en - s)}</span> : null}</div>
    </div>
  );
}

/** An all-day calendar item: a small chip. Hold it to make it a task for the day. */
function CalChip({ e, onAccept, onTap }: { e: CalEvent; onAccept: () => void; onTap: () => void }) {
  const { holding, handlers } = useHold(onAccept, onTap);
  return (
    <span className={"calchip" + (holding ? " holding" : "")} role="button" tabIndex={0} aria-label={`${e.title}, all day, from your calendar. Hold to add it to your tasks`}
      onKeyDown={(k) => { if (k.key === "Enter") onAccept(); }} {...handlers}>
      <span className="cl-fill" />{e.title}
    </span>
  );
}
