import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import * as C from "../head/core/clearhead.js";
import { db } from "../lib/db";
import { completeBlock, loadDay, moveBlock, nowStep, skipBlock, softDelete, toggleStep, type RiverBlock } from "../lib/river";
import { addDays, minutes, nowHHMM, shortTime, today } from "../lib/time";
import { useToast } from "../lib/toast";
import BlockSheet from "./BlockSheet";
import StepPlayer from "./StepPlayer";
import { fitApi } from "../body/host";
import { goTab, openOverlay, openTask, useHeadData } from "../head/useHead";
import { completeTask } from "../head/store";
import { placeTimedTasks } from "../head/river-bridge";
import { fmtMoney, isCurrent, placeBillBlocks, useMoney } from "../lib/money";
import { dur, endOf, fitOf, moment, startMin, tasksThatFit } from "../lib/coach";
import { slideUnfinished } from "../lib/slots";
import { WEEKDAY, dowOf, dropEvery, keepEvery, loadWeek, weekKeyOf, blocksFor, kindOf, swapDay, type DayKind } from "../lib/week";
import { justDone, markJustDone } from "../lib/motion";
import { Layer } from "../ui/Layer";
import { I, Icon } from "../ui/Icon";
import { blockLook, taskIcon } from "../ui/colors";
import type { Task } from "../head/types";

/* Today is a coach: one big card for what's now, a line for what's next and after.
   The whole day is one tap away. Nothing to plan, nothing to approve: his week, his gym days and his
   own calendar fill the River by themselves, and tasks show up where they fit (calls on the drive). */

interface Props { online: boolean; onSettings: () => void; }

const k = (color: string) => ({ ["--k" as string]: color }) as CSSProperties;
/* These effects can fire while another write is still open (a live query redraws Today mid-transaction);
   run them on their own, or they'd borrow that write's tables and fail ("objectStore not found"). */
const outside = <T,>(fn: () => Promise<T>) => Dexie.ignoreTransaction(fn);

function dateParts(key: string) {
  const [y, mo, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, 12));
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(t);
  return { weekday: f({ weekday: "long" }), md: f({ month: "short", day: "numeric" }) };
}

/** Re-draw every 30 seconds (and when the phone wakes) so "now" stays true. */
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
  const blocks = useLiveQuery(() => loadDay(todayKey), [todayKey], undefined as RiverBlock[] | undefined);
  const tomorrow = useLiveQuery(() => loadDay(addDays(todayKey, 1)), [todayKey], [] as RiverBlock[]);
  const [menu, setMenu] = useState<RiverBlock | null>(null);
  const [sheet, setSheet] = useState<{ block?: RiverBlock; start?: string; day?: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [whole, setWhole] = useState<"" | "today" | "tomorrow">("");
  const [daySheet, setDaySheet] = useState(false);
  const kind = useLiveQuery(() => kindOf(todayKey), [todayKey], "usual" as DayKind);

  // Head tasks with a time today land on the River at that time, by themselves.
  const timed = useLiveQuery(() => db.tasks.where("when").equals(todayKey).filter((t) => !!t.time && t.status === "open").primaryKeys(), [todayKey], [] as string[]);
  const timedSig = timed.join(",");
  useEffect(() => { if (timedSig) void outside(() => placeTimedTasks(todayKey)); }, [timedSig, todayKey]);
  // Bills due today become small money blocks, once each.
  const { summary: money } = useMoney();
  const billSig = money?.today === todayKey ? money.due_today.map((b) => b.id).join(",") : "";
  useEffect(() => { if (billSig) void outside(() => placeBillBlocks(todayKey)); }, [billSig, todayKey]);

  // A task Nest gave a time that ran over (not done) moves to the next open time in the same stretch.
  useEffect(() => { void outside(() => slideUnfinished(todayKey, nowMin)); }, [todayKey, nowMin]);

  const list = blocks ?? [];
  const m = useMemo(() => moment(list, nowMin), [list, nowMin]);
  const all = [...list, ...tomorrow];
  const playingBlock = useMemo(() => all.find((b) => b.id === playing) ?? null, [all, playing]);
  const after = (b: RiverBlock) => { const day = b.day === todayKey ? list : tomorrow; return day.find((x) => x.status === "open" && x.id !== b.id && startMin(x) >= startMin(b)) ?? null; };

  const parts = dateParts(todayKey);
  return (
    <>
      <header className="t-head">
        <h1 className="t-date"><button className="t-day" onClick={() => setDaySheet(true)} aria-label={`${parts.weekday} ${parts.md}. Change what kind of day it is`}>{parts.weekday} <span>{parts.md}</span><Icon n="chevD" size={18} tone={false} className="t-chev" /></button>
          {kind !== "usual" && <button className="t-kind" onClick={() => setDaySheet(true)}>{KINDS.find((x) => x.k === kind)?.label}</button>}</h1>
        <div className="top-actions">
          {!props.online && <span className="offline detail">offline</span>}
          <button className="gear" aria-label="Settings" onClick={props.onSettings}><Icon n="settings" size={21} tone={false} /></button>
        </div>
      </header>

      {blocks !== undefined && (
        <Coach m={m} nowMin={nowMin} blocks={list} tomorrow={tomorrow} onPlay={setPlaying} onMenu={setMenu} onAdd={(start) => setSheet({ start })} />
      )}

      {m.next && (
        <div className="nx-list">
          {m.ahead.slice(0, 4).map((b, i) => <NextLine key={b.id} label={i === 0 ? "Next" : i === 1 ? "Later" : ""} b={b} nowMin={nowMin} onTap={() => setMenu(b)} />)}
        </div>
      )}

      <MoneyLine day={todayKey} />

      <div className="whole">
        <button className={"whole-t" + (whole ? " up" : "")} aria-expanded={!!whole} onClick={() => setWhole(whole ? "" : "today")}>
          <I n="river" /> {whole === "tomorrow" ? "Tomorrow" : "Whole day"}<Icon n="chevD" size={16} tone={false} />
        </button>
        {whole && (
          <button className="whole-day" onClick={() => setWhole(whole === "today" ? "tomorrow" : "today")}>{whole === "today" ? "Tomorrow" : "Today"}<Icon n="chevR" size={15} tone={false} /></button>
        )}
      </div>
      {whole && (
        <River day={whole === "today" ? todayKey : addDays(todayKey, 1)} blocks={whole === "today" ? list : tomorrow} nowMin={whole === "today" ? nowMin : -1}
          onMenu={setMenu} onPlay={setPlaying} onAdd={(day) => setSheet({ day })} />
      )}

      {menu && <BlockMenu b={menu} todayKey={todayKey} onClose={() => setMenu(null)} onEdit={() => { setSheet({ block: menu, day: menu.day }); setMenu(null); }}
        onPlay={() => { setPlaying(menu.id); setMenu(null); }} toast={toast} />}
      {daySheet && <DayKindSheet todayKey={todayKey} onClose={() => setDaySheet(false)} />}
      {sheet && <BlockSheet day={sheet.day ?? sheet.block?.day ?? todayKey} block={sheet.block} start={sheet.start} onClose={() => setSheet(null)} />}
      {playingBlock && <StepPlayer block={playingBlock} nextBlock={after(playingBlock)} onClose={() => setPlaying(null)} onNext={(id) => setPlaying(id)} />}
    </>
  );
}

/* ---------- the big card ---------- */

function Coach(props: { m: ReturnType<typeof moment>; nowMin: number; blocks: RiverBlock[]; tomorrow: RiverBlock[]; onPlay: (id: string) => void; onMenu: (b: RiverBlock) => void; onAdd: (start: string) => void }) {
  const { m, nowMin } = props;
  const toast = useToast();
  const { data, ready } = useHeadData();
  const onRiver = new Set(props.blocks.filter((b) => b.source_type === "task").map((b) => b.source_id));
  const b = m.now;
  const fit = fitOf(b);
  const tasks = useMemo(() => {
    if (!ready) return [] as Task[];
    const { main, overdue } = C.selectToday(data);
    const seen = new Set<string>();
    const pool = [...overdue, ...main, ...C.selectInbox(data)].filter((t: Task) => C.isOpen(t) && !onRiver.has(t.id) && !seen.has(t.id) && seen.add(t.id));
    return tasksThatFit(fit, pool, (t) => C.areaOfTask(t, data)?.name ?? "", b ? 2 : 3);
  }, [data, ready, fit, b, onRiver.size]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doneTask(t: Task) { toast("✓ Done", await completeTask(t.id)); }
  const taskRows = tasks.length > 0 && (
    <div className="now-fits">
      {b && <div className="now-sub">{fit === "drive" ? "On the drive" : fit === "handyman" ? "Jobs" : fit === "study" ? "For class" : "Fits now"}</div>}
      {tasks.map((t) => (
        <div key={t.id} className="now-row">
          <button className="sc" aria-label={`Done: ${t.title}`} onClick={() => void doneTask(t)} />
          <button className="w" onClick={() => openTask(t.id)}><Icon n={taskIcon(t.title)} size={15} tone={false} />{t.title}</button>
          {t.due && <span className="v">{t.due === C.today() ? "today" : t.due < (C.today() as string) ? "late" : shortDue(t.due)}</span>}
        </div>
      ))}
    </div>
  );

  // Nothing running: free time, or rest before/after the day.
  if (!b) {
    const tmr = props.tomorrow.find((x) => x.status === "open");
    const empty = !props.blocks.length;
    const resting = m.over || (m.free?.from == null && !empty);
    const until = m.free?.until;
    const kick = resting ? <span className="now-k">Rest</span> : <><span className="now-k">Free</span>{until != null ? `until ${shortTime(hhmm(until))} · ${dur(until - nowMin)}` : ""}</>;
    const title = m.over ? "Done for today" : resting ? "Sleep well" : empty ? "A clear day" : "Free time";
    return (
      <section className="now free" style={k("var(--c-rest)")} aria-label="Now">
        <div className="now-kick">{kick}</div>
        <div className="now-top">
          <span className="now-ic"><Icon n={resting ? "sleep" : "compass"} size={26} /></span>
          <h2>{title}</h2>
        </div>
        {m.over && tmr && <p className="now-p">Tomorrow starts {shortTime(tmr.start)} with {tmr.title}.</p>}
        {!resting && taskRows}
        {!resting && !tasks.length && <p className="now-p">Nothing due. Your call.</p>}
        {!resting && <div className="now-acts"><button className="sec" onClick={() => props.onAdd(hhmm(Math.ceil(nowMin / 15) * 15))}><I n="plus" tone={false} /> Block</button></div>}
      </section>
    );
  }

  const look = blockLook(b);
  const left = endOf(b) - nowMin;
  const cur = nowStep(b);
  const n = b.steps.length;
  const shown = n > 4 && cur ? b.steps.slice(Math.max(0, Math.min(b.steps.indexOf(cur), n - 4)), Math.max(0, Math.min(b.steps.indexOf(cur), n - 4)) + 4) : b.steps.slice(0, 4);
  const isShutdown = b.icon === "shutdown";
  const isMorning = b.icon === "morning";
  const isTask = b.source_type === "task" && n === 0;
  async function tick(id: string) { markJustDone(b!.id); const r = await toggleStep(id); if (r.blockDone) toast("✓ Block done", r.undo); }
  async function finish() { markJustDone(b!.id); toast("✓ Done", await completeBlock(b!.id)); }
  return (
    <section className="now" style={k(look.color)} aria-label="Now">
      <div className="now-kick"><span className="now-k">Now</span>{shortTime(b.start)}{b.end ? `–${shortTime(b.end)}` : ""} · {dur(left)} left</div>
      <div className="now-top">
        <span className="now-ic"><Icon n={look.icon} size={26} /></span>
        <h2>{b.title}</h2>
        <button className="now-more" aria-label={`More for ${b.title}`} onClick={() => props.onMenu(b)}><Icon n="more" size={20} tone={false} /></button>
      </div>
      {n > 0 && (
        <ol className="now-steps">
          {shown.map((st) => (
            <li key={st.id}>
              <button className={"now-row" + (st.done_at ? " ok" : "") + (cur?.id === st.id ? " cur" : "")} onClick={() => void tick(st.id)} aria-label={`${st.done_at ? "Undo" : "Done"}: ${st.label}`}>
                <span className={"sc" + (st.done_at ? " ok" : "")} data-pop={st.done_at && justDone(b.id) ? "" : undefined}>{st.done_at && <Icon n="tick" size={12} tone={false} />}</span>
                <span className="w">{st.label}</span><span className="v">{st.value ?? ""}</span>
              </button>
            </li>
          ))}
          {n > shown.length && <li className="now-more-steps">{b.doneCount}/{n} done</li>}
        </ol>
      )}
      {taskRows}
      {isMorning && <button className="now-dump" onClick={() => openOverlay("dump")}><Icon n="head" size={18} tone={false} /><span><b>Empty your head</b><small>Talk it out. Nest gives each thing its time.</small></span><Icon n="chevR" size={16} tone={false} /></button>}
      {isTask && <div className="now-acts"><button className="go" onClick={() => void finish()}><Icon n="tick" size={16} tone={false} />Done</button></div>}
      {(isShutdown || n > 1) && (
        <div className="now-acts">
          {isShutdown
            ? <button className="go" onClick={() => openOverlay("shutdown")}><Icon n="shutdown" size={16} tone={false} />Start shutdown</button>
            : <button className="go" onClick={() => props.onPlay(b.id)}><Icon n="play" size={14} />{b.doneCount ? "Keep going" : "Start"}</button>}
          {!isShutdown && b.doneCount < n && <button className="sec" onClick={() => void finish()}><Icon n="tick" size={15} tone={false} />All done</button>}
        </div>
      )}
    </section>
  );
}

function NextLine({ label, b, nowMin, onTap }: { label: string; b: RiverBlock; nowMin: number; onTap: () => void }) {
  const look = blockLook(b);
  const inMin = startMin(b) - nowMin;
  return (
    <button className="nx" style={k(look.color)} onClick={onTap} aria-label={`${label || "Then"}: ${b.title} at ${shortTime(b.start)}`}>
      <span className="nx-l">{label}</span>
      <span className="nx-t">{shortTime(b.start)}</span>
      <span className="nx-ic"><Icon n={look.icon} size={16} /></span>
      <b>{b.title}</b>
      {label === "Next" && inMin > 0 && inMin <= 180 && <small>in {dur(inMin)}</small>}
    </button>
  );
}

/** One money line: what's left for groceries (a bill due today is its own block). Tap for Money. */
function MoneyLine({ day }: { day: string }) {
  const { summary: s } = useMoney();
  if (!isCurrent(s, day)) return null;
  const g = s.groceries;
  const text = g ? `${fmtMoney(g.left, true)} left · groceries` : `${fmtMoney(s.left.total, true)} left this month`;
  return (
    <button className="nx tmoney" style={k("var(--c-money)")} onClick={() => goTab("money")} aria-label={`${text}. Open Money`}>
      <span className="nx-l">Money</span><span className="nx-t" />
      <span className="nx-ic"><Icon n="coin" size={16} /></span>
      <b>{text}</b><Icon n="chevR" size={16} tone={false} />
    </button>
  );
}

/* ---------- the whole day ---------- */

function River(props: { day: string; blocks: RiverBlock[]; nowMin: number; onMenu: (b: RiverBlock) => void; onPlay: (id: string) => void; onAdd: (day: string) => void }) {
  const toast = useToast();
  const sorted = [...props.blocks].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <>
      {sorted.length > 0 && (
        <div className="tl">
          {sorted.map((b) => {
            const look = blockLook(b);
            const done = b.status === "done", skipped = b.status === "skipped";
            const past = props.nowMin >= 0 && !done && endOf(b) <= props.nowMin;
            const live = props.nowMin >= 0 && !done && startMin(b) <= props.nowMin && props.nowMin < endOf(b);
            const n = b.steps.length;
            const sub = done ? "" : skipped ? "Skipped" : [b.doneCount > 0 && n ? `${b.doneCount}/${n}` : "", b.end ? `${shortTime(b.start)}–${shortTime(b.end)}` : ""].filter(Boolean).join(" · ");
            return (
              <div key={b.id} className={["tr", done ? "done" : "", skipped ? "skipped" : "", past ? "past" : "", live ? "live" : ""].join(" ")} style={k(look.color)}>
                <div className="tr-time">{shortTime(b.start)}</div>
                <div className="tp"><Icon n={look.icon} size={19} /></div>
                <div className="bc">
                  <div className="bc-row">
                    <button className="bc-main" onClick={() => props.onMenu(b)}><b>{b.title}</b>{sub && <small>{sub}</small>}</button>
                    {done
                      ? <span className="ring on" aria-label="Done" data-pop={justDone(b.id) ? "" : undefined}><Icon n="tick" size={16} tone={false} /></span>
                      : past ? null // it went by: nothing to tick
                      : n > 1
                        ? <button className="ring play" aria-label={`Start ${b.title}`} onClick={() => props.onPlay(b.id)}><Icon n="play" size={12} tone={false} /></button>
                        : <button className="ring" aria-label={`Mark ${b.title} done`} onClick={async () => { markJustDone(b.id); toast("✓ Done", await completeBlock(b.id)); }} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="tl-foot">
        <button onClick={() => props.onAdd(props.day)}><I n="plus" tone={false} />Block</button>
      </div>
    </>
  );
}

/* ---------- a day that isn't like the rest ---------- */

const KINDS: { k: DayKind; label: string; icon: "today" | "briefcase" | "job" | "weekend" }[] = [
  { k: "usual", label: "Usual", icon: "today" }, { k: "work", label: "Work", icon: "briefcase" },
  { k: "handyman", label: "Handyman", icon: "job" }, { k: "off", label: "Day off", icon: "weekend" },
];
/** Tap the date: Thanksgiving week, a sick day, a Saturday job. Today or tomorrow becomes another kind of day. */
function DayKindSheet({ todayKey, onClose }: { todayKey: string; onClose: () => void }) {
  const toast = useToast();
  const days = [todayKey, addDays(todayKey, 1)];
  const kinds = useLiveQuery(() => Promise.all(days.map(kindOf)), [todayKey], ["usual", "usual"] as DayKind[]);
  const pick = async (day: string, k: DayKind) => {
    const u = await swapDay(day, k);
    toast(k === "usual" ? "↺ Back to usual" : `✓ ${day === todayKey ? "Today" : "Tomorrow"}: ${KINDS.find((x) => x.k === k)!.label.toLowerCase()}`, u);
  };
  return (
    <Layer><div className="scrim" onClick={onClose}>
      <div className="sheet has-x" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="What kind of day">
        <button className="sheet-x" aria-label="Close" onClick={onClose}><Icon n="close" size={18} tone={false} /></button>
        <h2>Not a usual day?</h2>
        {days.map((d, i) => (
          <div key={d} className="dk">
            <div className="lbl" style={{ marginTop: i ? 18 : 0 }}>{i ? "Tomorrow" : "Today"} · {WEEKDAY[dowOf(d)]}</div>
            <div className="dk-row" role="group">
              {KINDS.map((x) => (
                <button key={x.k} className={"dk-c" + (kinds[i] === x.k ? " on" : "")} aria-pressed={kinds[i] === x.k} onClick={() => void pick(d, x.k)}>
                  <Icon n={x.icon} size={20} tone={kinds[i] === x.k} /><span>{x.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="quiet" style={{ marginTop: 14 }}>Your calendar's events stay. Blocks you've ticked stay.</p>
      </div>
    </div></Layer>
  );
}

/* ---------- a block's menu ---------- */

function BlockMenu({ b, todayKey, onClose, onEdit, onPlay, toast }: { b: RiverBlock; todayKey: string; onClose: () => void; onEdit: () => void; onPlay: () => void; toast: (t: string, u?: () => unknown) => void }) {
  const look = blockLook(b);
  const wd = WEEKDAY[dowOf(b.day)];
  const key = weekKeyOf(b);
  // "Every Wednesday" shows when this block isn't the week's yet (one he made, or one he changed).
  const differs = useLiveQuery(async () => {
    if (b.source_type && b.source_type !== "week") return false;
    if (!key) return true;
    const w = (blocksFor(await loadWeek(), b.day)).find((x) => x.key === key);
    return !w || w.start !== b.start || w.end !== b.end || w.title !== b.title;
  }, [b.id, b.start, b.end, b.title], false);
  return (
    <Layer><div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2><span className="ring on" style={k(look.color)}><Icon n={look.icon} size={17} /></span>{b.title}</h2>
        <p className="quiet" style={{ margin: "-6px 0 10px" }}>{b.day === todayKey ? "Today" : wd} · {shortTime(b.start)}{b.end ? `–${shortTime(b.end)}` : ""}</p>
        <div className="menu">
          {b.source_type === "workout" && <button onClick={() => { openBody(b.source_id); onClose(); }}><I n="lift" /> Open in Body</button>}
          {b.source_type === "task" && b.source_id && <button onClick={() => { openTask(b.source_id!); onClose(); }}><I n="head" /> Open task</button>}
          {b.steps.length > 0 && b.status !== "done" && <button onClick={onPlay}><I n="play" /> Step by step</button>}
          <button onClick={onEdit}><I n="edit" /> Change time or steps</button>
          {differs && <button onClick={async () => { const u = await keepEvery(b, b.steps.map((s) => ({ label: s.label, value: s.value })), todayKey); onClose(); toast(`✓ Every ${wd}`, u); }}><I n="calendar" /> Every {wd}</button>}
          {b.status !== "done" && <button onClick={async () => { const u = await completeBlock(b.id); onClose(); toast("✓ Done", u); }}><I n="check" /> Mark done</button>}
          <button onClick={async () => { const u = await skipBlock(b.id); onClose(); toast(b.status === "skipped" ? "↺ Back on" : "⤼ Skipped", u); }}><I n={b.status === "skipped" ? "undo" : "skip"} /> {b.status === "skipped" ? "Un-skip" : "Skip today"}</button>
          {!key && <button onClick={async () => { const u = await moveBlock(b.id); onClose(); toast("↪ Moved to tomorrow", u); }}><I n="arrow" /> Tomorrow</button>}
          {key
            ? <button className="danger" onClick={async () => { const u = await dropEvery(b, todayKey); onClose(); toast(`🗑 Off on ${wd}s`, u); }}><I n="trash" /> Not on {wd}s</button>
            : <button className="danger" onClick={async () => { const u = await softDelete(b.id); onClose(); toast("🗑 In Trash", u); }}><I n="trash" /> Delete</button>}
        </div>
      </div>
    </div></Layer>
  );
}

/* ---------- bits ---------- */

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function shortDue(d: string): string {
  const [y, mo, dd] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, mo - 1, dd, 12)));
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
