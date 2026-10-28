/* Buzzing a locked phone: the app's side of the push helper (worker/).
   Each phone has its own id and key (kept on the phone, never synced), and its own helper on Cloudflare. */
import { useSyncExternalStore } from "react";

/** subKey: the helper's public key this phone subscribed with (a new key needs a new subscription). */
export interface PushPrefs { device: string; key: string; on: boolean; rest: boolean; shutdown: boolean; subKey?: string }
const LS = "nest:push";

function rand(n: number): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uBytes(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function load(): PushPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || "null") as Partial<PushPrefs> | null;
    if (v?.device && v.key) return { on: false, rest: true, shutdown: true, ...v } as PushPrefs;
  } catch { /* storage blocked */ }
  return { device: "n_" + rand(18), key: rand(32), on: false, rest: true, shutdown: true };
}

/* A tiny store so Settings redraws when buzzing turns on or off. */
let prefs = load();
const subs = new Set<() => void>();
export const pushPrefs = () => prefs;
export function setPushPrefs(p: Partial<PushPrefs>) {
  prefs = { ...prefs, ...p };
  try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch { /* storage blocked */ }
  subs.forEach((f) => f());
}
export const usePushPrefs = () => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => prefs, () => prefs);
export const onPushPrefs = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** "ok", or why this phone can't buzz: open from the Home Screen first, or the browser can't. */
export function pushSupport(): "ok" | "install" | "browser" {
  if (isIOS() && !standalone()) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "browser";
  return "ok";
}

async function api(op: string, body: Record<string, unknown> = {}): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const r = await fetch(`/api/push/${op}`, {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ device: prefs.device, key: prefs.key, ...body }),
    });
    return { ok: r.ok, status: r.status, data: (await r.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Is the helper on Cloudflare ready? "nokey" = secret not set, "mismatch" = secret from another key, null = offline. */
export async function helperReady(): Promise<"ok" | "nokey" | "mismatch" | null> {
  try {
    const k = (await (await fetch("/api/push/key", { cache: "no-store" })).json()) as { ready?: boolean; pair?: boolean };
    return !k.ready ? "nokey" : k.pair === false ? "mismatch" : "ok";
  } catch { return null; }
}

const swReady = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise<null>((r) => setTimeout(() => r(null), 6000)),
]);

function sameKey(sub: PushSubscription, key: string): boolean {
  const a = sub.options?.applicationServerKey;
  if (!a) return true;
  const x = new Uint8Array(a), y = b64uBytes(key);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function subscription(publicKey: string): Promise<PushSubscription | null> {
  const reg = await swReady();
  if (!reg) return null;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (or before Nest kept track) can't receive anything: start a new one.
  // (iPhones don't always say which key a subscription has, so Nest remembers it.)
  const stale = !prefs.subKey || prefs.subKey !== publicKey || !sameKey(sub ?? ({} as PushSubscription), publicKey);
  if (sub && stale) { await sub.unsubscribe().catch(() => false); sub = null; }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(publicKey) });
}

export type TurnOnResult = "ok" | "denied" | "dismissed" | "offline" | "failed";

/** Call straight from a tap: the iPhone only asks for permission from a tap. */
export async function turnOnPush(): Promise<TurnOnResult> {
  const perm = await Notification.requestPermission();
  if (perm === "denied") return "denied";
  if (perm !== "granted") return "dismissed";
  let k: { key?: string } | null = null;
  try { k = (await (await fetch("/api/push/key", { cache: "no-store" })).json()) as { key?: string }; } catch { return "offline"; }
  if (!k?.key) return "failed";
  try {
    const sub = await subscription(k.key);
    if (!sub) return "failed";
    const r = await api("subscribe", { sub: sub.toJSON() });
    if (!r.ok) return r.status === 0 ? "offline" : "failed";
  } catch {
    return "failed";
  }
  setPushPrefs({ on: true, subKey: k.key });
  return "ok";
}

export async function turnOffPush(): Promise<void> {
  setPushPrefs({ on: false });
  try { const reg = await swReady(); const sub = await reg?.pushManager.getSubscription(); await sub?.unsubscribe(); } catch { /* already gone */ }
  await api("off");
}

/** Send a test buzz now. `why` says what went wrong (e.g. "403 BadJwtToken"). */
export async function testPush(): Promise<{ ok: boolean; why: string }> {
  const r = await api("test");
  if (r.ok) return { ok: true, why: "" };
  if (r.status === 0) return { ok: false, why: "no connection" };
  return { ok: false, why: String(r.data?.why || r.data?.error || r.status).slice(0, 60) };
}

export interface Buzz { id: string; at: number; title: string; body?: string; tag?: string; url?: string; ttl?: number }

/** Plan buzzes (same id = moved, not doubled). `replace` clears every id that starts with it first. */
export async function scheduleBuzz(items: Buzz[], replace?: string): Promise<boolean> {
  if (!prefs.on) return false;
  return (await api("schedule", { items, replace })).ok;
}
export async function cancelBuzz(ids: string[], prefix?: string): Promise<boolean> {
  if (!prefs.on) return false;
  return (await api("cancel", { ids, prefix })).ok;
}

/** On each open: keep the helper's copy of this phone's address fresh; notice if the iPhone dropped it. */
export async function refreshPush(): Promise<void> {
  if (!prefs.on || pushSupport() !== "ok") return;
  if (Notification.permission !== "granted") { setPushPrefs({ on: false }); return; }
  let key: string | undefined;
  try { key = ((await (await fetch("/api/push/key", { cache: "no-store" })).json()) as { key?: string }).key; }
  catch { return; } // offline: try next time
  if (!key) return;
  let sub: PushSubscription | null = null;
  try { sub = await subscription(key); }
  catch { setPushPrefs({ on: false }); return; } // the iPhone dropped it and won't re-add without a tap: Settings shows "Turn on" again
  if (sub) { const r = await api("subscribe", { sub: sub.toJSON() }); if (r.ok && prefs.subKey !== key) setPushPrefs({ subKey: key }); }
}
