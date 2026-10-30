import { db, nowISO, uid, type Report } from "./db";
import { cut } from "./text";
import { appNav, nav } from "../head/useHead";
import { fitState } from "../body/host";
import { getMode } from "./theme";

/* Testing mode. While it's on, Nest keeps a short trail of taps and any errors it catches,
   so a report says exactly where things went wrong without Anthony having to explain. */

let on = false;
export const setTestingOn = (v: boolean) => { on = v; };

const errors: { at: string; msg: string }[] = [];
const trail: { at: string; what: string }[] = [];
const clock = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const push = <T,>(list: T[], x: T, max: number) => { list.push(x); if (list.length > max) list.shift(); };

export function noteError(msg: string) { push(errors, { at: clock(), msg: cut(String(msg), 400) }, 15); }

export function installTesting() {
  (window as unknown as { __nestNoteError?: (m: string) => void }).__nestNoteError = noteError;
  addEventListener("error", (e) => noteError((e.message || "Error") + (e.filename ? ` @ ${e.filename.split("/").pop()}:${e.lineno}` : "")));
  addEventListener("unhandledrejection", (e) => { const r = (e as PromiseRejectionEvent).reason; noteError("Promise: " + ((r && (r.stack || r.message)) || r)); });
  const ce = console.error.bind(console);
  console.error = (...a: unknown[]) => { try { noteError(a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ").substring(0, 4000)); } catch { /* never break logging */ } ce(...a); };
  // The trail: what was tapped, in order. Only while testing.
  document.addEventListener("click", (e) => {
    if (!on) return;
    const el = (e.target as HTMLElement | null)?.closest?.("button,a,[role=button],input,textarea,select,label") as HTMLElement | null;
    if (!el || el.closest(".tflag, .tsheet")) return;
    const what = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).replace(/\s+/g, " ").trim();
    const whatShort = cut(what, 50);
    push(trail, { at: clock(), what: `${appNav.get().tab}: ${whatShort}` }, 20);
  }, true);
}

/** Where Anthony is right now, in plain facts. */
export function context(): Record<string, unknown> {
  const a = appNav.get(), n = nav.get(), f = fitState.get();
  const seen = new Set<string>();
  const open: string[] = [];
  document.querySelectorAll("[role=dialog], .sheet h2, .flow .ft-title, .player .ph b").forEach((el) => {
    const t = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+/u, "").trim();
    const tt = cut(t, 60);
    if (tt && !seen.has(tt)) { seen.add(tt); open.push(tt); }
  });
  const html = document.documentElement;
  return {
    tab: a.tab,
    head: a.tab === "head" ? { view: n.view, id: n.id } : undefined,
    body: a.tab === "body" ? { section: f.tab, depth: f.depth } : undefined,
    overlay: n.overlay?.name ?? null,
    task_open: !!n.selected,
    open,
    look: html.dataset.theme, look_setting: getMode(), details: !html.classList.contains("quiet"),
    version: __BUILD__,
    phone: navigator.userAgent, size: `${innerWidth}×${innerHeight}`, scroll: Math.round(document.querySelector(".scroller")?.scrollTop ?? scrollY),
    standalone: matchMedia("(display-mode: standalone)").matches, online: navigator.onLine,
    local_time: new Date().toLocaleString("en-US"),
  };
}

/** The screen as HTML, so Claude can redraw it with the app's styles. */
export function screenHtml(): { dom: string | null; frame_dom: string | null } {
  const root = document.getElementById("root");
  let dom = root ? root.outerHTML : null;
  if (dom && dom.length > 250_000) dom = cut(dom, 250_000);
  let frame_dom: string | null = null;
  if (appNav.get().tab === "body") {
    try {
      const d = (document.querySelector("iframe.bodyframe") as HTMLIFrameElement | null)?.contentDocument;
      frame_dom = d?.body ? cut(d.body.outerHTML, 150_000) : null;
    } catch { frame_dom = null; }
  }
  return { dom, frame_dom };
}

export type Snapshot = Pick<Report, "ctx" | "errors" | "trail" | "dom" | "frame_dom">;
/** Taken the moment the flag is tapped, before the report sheet covers the screen. */
export function snapshot(): Snapshot {
  return { ctx: context(), errors: [...errors], trail: [...trail], ...screenHtml() };
}

export async function saveReport(snap: Snapshot, kind: Report["kind"], text: string, photo: string | null): Promise<Report> {
  const t = nowISO();
  const r: Report = { id: uid(), created_at: t, updated_at: t, deleted_at: null, kind, text: text.trim(), photo, ...snap, status: "open", status_at: t, fix_note: null, fixed_at: null };
  await db.reports.put(r);
  return r;
}

export async function setReportStatus(id: string, status: Report["status"]) {
  const t = nowISO();
  await db.reports.update(id, { status, status_at: t, updated_at: t });
}

/** Shrink a photo to a small JPEG so reports stay light. */
export function shrinkPhoto(file: File, max = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.62));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that photo")); };
    img.src = url;
  });
}

/** Plain text for pasting into a chat with Claude. */
export function reportText(r: Report): string {
  const c = r.ctx as Record<string, unknown>;
  return [
    `• [${r.kind}] ${r.text || "(no words)"}`,
    `  ${c.tab}${c.overlay ? " › " + c.overlay : ""}${(c.open as string[] | undefined)?.length ? " › " + (c.open as string[]).join(" / ") : ""} · ${c.look} · ${c.version} · ${new Date(r.created_at).toLocaleString("en-US")}`,
    r.errors.length ? `  errors: ${r.errors.map((e) => e.msg).join(" | ").slice(0, 300)}` : "",
    r.trail.length ? `  taps: ${r.trail.slice(-6).map((x) => x.what).join(" → ")}` : "",
    `  id: ${r.id}`,
  ].filter(Boolean).join("\n");
}
