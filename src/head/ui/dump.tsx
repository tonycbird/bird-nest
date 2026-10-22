import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import * as C from "../core/clearhead.js";
import * as H from "../store";
import { toast } from "../../lib/toast";
import { closeOverlay, useHeadData, useHeadSettings } from "../useHead";
import { moveItem, sortDump, type DumpDest, type DumpItem } from "../dump-sort";
import { Check } from "./bits";
import { FlowShell } from "./flows";
import { openSheet } from "./sheets";
import { DatePicker, type WhenResult } from "./pickers";
import { openMenu } from "./actions";
import { useDictation } from "./ramble";
import { I, Icon, type IconName } from "../../ui/Icon";
import { colorFor, taskIcon } from "../../ui/colors";

/* Brain dump: get everything out of your head in one place, then let Nest separate it.
   1) Write or talk, run-on is fine.  2) Nest splits it into things and sorts each one:
   today, a date, no date yet, shopping, someday, or just a thought.  3) Fix anything, put it all away. */

const DRAFT = "nest-dump-draft";
const loadDraft = () => { try { return localStorage.getItem(DRAFT) || ""; } catch { return ""; } };
const saveDraft = (t: string) => { try { if (t) localStorage.setItem(DRAFT, t); else localStorage.removeItem(DRAFT); } catch { /* private mode */ } };

const SECTIONS: { d: DumpDest; label: string; icon: IconName; color: string }[] = [
  { d: "today", label: "Today", icon: "today", color: "var(--accent)" },
  { d: "date", label: "Coming up", icon: "calendar", color: "var(--c-stretch)" },
  { d: "later", label: "No date yet", icon: "inbox", color: "var(--c-head)" },
  { d: "shop", label: "Shopping", icon: "groceries", color: "var(--c-home)" },
  { d: "someday", label: "Someday", icon: "sleep", color: "var(--c-rest)" },
  { d: "thought", label: "Thoughts", icon: "talk", color: "var(--c-cal)" },
];

function useDump(onDone?: (ids: string[]) => void) {
  const { data } = useHeadData();
  const s = useHeadSettings();
  const [text, setText] = useState(loadDraft);
  const [items, setItems] = useState<DumpItem[] | null>(null);
  const later = useDeferredValue(text);
  useEffect(() => { saveDraft(text); }, [text]);
  const found = useMemo(() => (later.trim() ? sortDump(later, data, s).length : 0), [later, data, s]);
  const dict = useDictation((said) => setText((x) => (x && !/\s$/.test(x) ? x + " " : x) + said));
  const kept = (items ?? []).filter((i) => i.keep);

  const sort = () => { dict.stop(); setItems(sortDump(text, data, s)); };
  const update = (id: string, patch: Partial<DumpItem> | ((it: DumpItem) => DumpItem)) =>
    setItems((xs) => (xs ?? []).map((x) => (x.id === id ? (typeof patch === "function" ? patch(x) : { ...x, ...patch }) : x)));

  async function putAway() {
    const ids: string[] = [];
    const groc = C.areaList(data).find((a) => a.listMode === "groceries");
    const count: Record<string, number> = {};
    for (const it of kept) {
      count[it.dest] = (count[it.dest] ?? 0) + 1;
      if (it.dest === "thought") continue;
      if (it.dest === "shop") {
        const t = groc ? await H.addGrocery(it.title, groc.id) : await H.createTask({ title: "Buy " + it.title.toLowerCase() });
        if (t) ids.push(t.id);
        continue;
      }
      const t = await H.createTask({
        title: it.title, when: it.dest === "today" ? C.today() : it.dest === "date" ? it.when : null,
        due: it.dest === "someday" ? null : it.due, time: it.time, tod: (it.tod ?? null) as never, est: it.est, contexts: it.contexts,
        areaId: it.areaId, projectId: it.projectId, someday: it.dest === "someday",
      });
      ids.push(t.id);
    }
    const thoughts = kept.filter((i) => i.dest === "thought");
    if (thoughts.length) {
      const t = await H.createTask({ title: `Thoughts · ${C.relLabel(C.today())}`, notes: thoughts.map((x) => "- " + x.title).join("\n"), someday: true });
      ids.push(t.id);
    }
    const parts = SECTIONS.filter((x) => count[x.d]).map((x) => `${count[x.d]} ${x.label.toLowerCase()}`);
    toast(`✓ ${kept.length} put away${parts.length ? " · " + parts.slice(0, 3).join(" · ") : ""}`, async () => { for (const id of ids) await H.deleteTask(id); });
    saveDraft("");
    setText("");
    setItems(null);
    onDone?.(ids);
  }
  return { text, setText, items, setItems, found, kept, sort, update, putAway, dict };
}

function WriteStep({ d, bare }: { d: ReturnType<typeof useDump>; bare?: boolean }) {
  return (
    <>
      {!bare && <><h2>Empty your head</h2><p className="lede">Type or talk. Run-on is fine. Nest sorts it.</p></>}
      <textarea className="dump" autoFocus aria-label="Brain dump" value={d.text} onChange={(e) => d.setText(e.target.value)}
        placeholder={"call dave about the quote tomorrow, pay avista, out of milk eggs and diapers, greek reading due friday, maybe build a garden box someday…"} />
      {d.dict.interim && <p className="quiet" style={{ marginTop: 6 }}>{d.dict.interim}…</p>}
      <div className="dump-tools">
        {d.dict.supported
          ? <button className={"btn sm" + (d.dict.on ? " rec" : "")} onClick={d.dict.on ? d.dict.stop : d.dict.start}><I n="mic" /> {d.dict.on ? "Stop" : "Talk"}</button>
          : <span className="quiet">Tip: the mic on your keyboard works here.</span>}
        <span className="grow" />
        {d.found > 0 && <span className="pill">{d.found} found</span>}
      </div>
    </>
  );
}

function SortStep({ d }: { d: ReturnType<typeof useDump> }) {
  const { data } = useHeadData();
  const items = d.items ?? [];
  async function move(it: DumpItem) {
    const go = (dest: DumpDest, date?: string | null) => d.update(it.id, (x) => moveItem(x, dest, date));
    await openMenu(it.title, [
      { text: "Today", icon: "today", run: () => go("today") },
      { text: "Tomorrow", icon: "morning", run: () => go("date", C.addDays(C.today(), 1)) },
      { text: "Pick a day", icon: "calendar", run: async () => { const r = await openSheet<WhenResult>(DatePicker, { value: it.when, mode: "when" }); if (r?.when) go(r.when === C.today() ? "today" : "date", r.when); else if (r?.someday) go("someday"); } },
      { text: "No date yet", icon: "inbox", run: () => go("later") },
      { text: "Shopping list", icon: "groceries", run: () => go("shop") },
      { text: "Someday", icon: "sleep", run: () => go("someday") },
      { text: "Just a thought", icon: "talk", run: () => go("thought") },
    ]);
  }
  if (!items.length) return <><h2>Nothing to sort</h2><p className="lede">Go back and write a little more.</p></>;
  return (
    <>
      <h2>{d.kept.length} {d.kept.length === 1 ? "thing" : "things"}</h2>
      <p className="lede">Tap a name to fix it. Tap <I n="arrow" /> to move it. Uncheck to leave it out.</p>
      {SECTIONS.map((sec) => {
        const list = items.filter((i) => i.dest === sec.d);
        if (!list.length) return null;
        return (
          <section key={sec.d} className="hsec dsec">
            <div className="sec-head" style={{ color: sec.color }}><Icon n={sec.icon} size={16} />{sec.label} · {list.length}</div>
            <div className="tlist">
              {list.map((it) => <Row key={it.id} it={it} data={data} onChange={(p) => d.update(it.id, p)} onMove={() => void move(it)} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Row({ it, data, onChange, onMove }: { it: DumpItem; data: ReturnType<typeof useHeadData>["data"]; onChange: (p: Partial<DumpItem>) => void; onMove: () => void }) {
  const home = it.projectId ? data.projects.get(it.projectId) : null;
  const area = !home && it.areaId ? data.areas.get(it.areaId) : null;
  const icon: IconName = it.dest === "shop" ? "groceries" : it.dest === "thought" ? "talk" : taskIcon(it.title, area?.icon);
  const meta: ReactNode[] = [];
  if (it.dest === "date" && it.when) meta.push(<span key="w"><I n="calendar" /> {C.relLabel(it.when)}</span>);
  if (it.time) meta.push(<span key="t"><I n="later" /> {C.fmtTime(it.time)}</span>);
  if (it.due) meta.push(<span key="d"><I n="flag" /> {C.relLabel(it.due)}</span>);
  if (home) meta.push(<span key="p"><I n="project" /> {home.name}</span>);
  else if (area) meta.push(<span key="a">{area.name}</span>);
  return (
    <div className={"task drow" + (it.keep ? "" : " off")}>
      <Check on={it.keep} onToggle={(v) => onChange({ keep: v })} label={it.keep ? "Leave out" : "Keep"} />
      <span className="d-ic" style={{ ["--k" as string]: colorFor(icon, "head") } as CSSProperties}><Icon n={icon} size={15} /></span>
      <div className="t-body">
        <input className="d-in" value={it.title} aria-label="Name" onChange={(e) => onChange({ title: e.target.value })} />
        {meta.length > 0 && <div className="t-meta">{meta}</div>}
      </div>
      <button className="iconbtn sm" aria-label={"Move " + it.title} onClick={onMove}><Icon n="arrow" size={16} tone={false} /></button>
    </div>
  );
}

/** The full-screen Brain dump (＋ → Dump, Head → Dump). */
export function DumpFlow() {
  const d = useDump(() => closeOverlay());
  const sorting = d.items !== null;
  const foot = sorting
    ? <><button className="btn" onClick={() => d.setItems(null)}><I n="chevL" /> Back</button><span className="grow" />
        <button className="btn primary" disabled={!d.kept.length} onClick={() => void d.putAway()}><I n="tick" /> Put away {d.kept.length || ""}</button></>
    : <>{d.text && <button className="btn" onClick={() => d.setText("")}>Clear</button>}<span className="grow" />
        <button className="btn primary" disabled={!d.found} onClick={d.sort}>Sort{d.found ? ` ${d.found}` : ""} <I n="chevR" /></button></>;
  return (
    <FlowShell title="Brain dump" onBack={sorting ? () => d.setItems(null) : null} foot={foot}>
      {sorting ? <SortStep d={d} /> : <WriteStep d={d} />}
    </FlowShell>
  );
}

/** Inside Shutdown and Weekly review: the same dump, without its own screen. */
export function DumpInline(props: { onDone?: (ids: string[]) => void }) {
  const d = useDump(props.onDone);
  const sorting = d.items !== null;
  return (
    <div className="qa">
      {sorting ? <SortStep d={d} /> : <WriteStep d={d} bare />}
      <div className="row" style={{ marginTop: 12 }}>
        {sorting && <button className="btn sm" onClick={() => d.setItems(null)}><I n="chevL" /> Back</button>}
        <span className="grow" />
        {sorting
          ? <button className="btn primary" disabled={!d.kept.length} onClick={() => void d.putAway()}><I n="tick" /> Put away {d.kept.length || ""}</button>
          : <button className="btn primary" disabled={!d.found} onClick={d.sort}>Sort{d.found ? ` ${d.found}` : ""} <I n="chevR" /></button>}
      </div>
    </div>
  );
}
