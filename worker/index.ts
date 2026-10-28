/* The Nest helper: a tiny Cloudflare Worker next to the app.
   The app itself is still plain files (dist/). Only /api/* reaches this code.
   Each phone gets its own Notifier (a Durable Object) that keeps its push address and a short
   list of buzzes to send, and wakes itself with an alarm at the exact second one is due. */
import { DurableObject } from "cloudflare:workers";
import { pushHostOk, sendPush, vapidPairOk, whyNot, type PushSub, type Vapid } from "./webpush";

export interface Env {
  ASSETS: Fetcher;
  NOTIFIER: DurableObjectNamespace<Notifier>;
  VAPID_PUBLIC?: string;
  VAPID_PRIVATE?: string; // secret, set in the Cloudflare dashboard
  VAPID_SUBJECT?: string;
  PUSH_DEV?: string; // "1" only in local tests: allows a localhost push address
}

export interface Item { id: string; at: number; title: string; body?: string; tag?: string; url?: string; ttl?: number }
type Reply = Record<string, string | number | boolean | null>;
interface State { sub: PushSub | null; keyHash: string; items: Item[]; sent: number; lastStatus: number; lastAt: number; lastWhy?: string }

const MAX_ITEMS = 40;
const LATE_MS = 90_000; // a buzz more than this late is dropped, not sent
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function sha256(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : undefined);

function cleanItems(raw: unknown, now: number): Item[] {
  if (!Array.isArray(raw)) return [];
  const out: Item[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const x = r as Record<string, unknown>;
    const id = clip(x.id, 64), at = Number(x.at), title = clip(x.title, 60);
    if (!id || !title || !Number.isFinite(at) || at < now - 60_000 || at > now + 9 * 864e5) continue;
    out.push({ id, at, title, body: clip(x.body, 160), tag: clip(x.tag, 40), url: clip(x.url, 120), ttl: Math.min(Math.max(Number(x.ttl) || 120, 30), 3600) });
  }
  return out;
}

export class Notifier extends DurableObject<Env> {
  private async load(): Promise<State> {
    return (await this.ctx.storage.get<State>("s")) ?? { sub: null, keyHash: "", items: [], sent: 0, lastStatus: 0, lastAt: 0 };
  }
  private async save(s: State): Promise<void> {
    s.items.sort((a, b) => a.at - b.at);
    await this.ctx.storage.put("s", s);
    if (s.sub && s.items.length) await this.ctx.storage.setAlarm(s.items[0].at);
    else await this.ctx.storage.deleteAlarm();
  }
  private vapid(): Vapid | null {
    const e = this.env;
    return e.VAPID_PUBLIC && e.VAPID_PRIVATE ? { publicKey: e.VAPID_PUBLIC, privateKey: e.VAPID_PRIVATE, subject: e.VAPID_SUBJECT || "https://bird-nest.tonyc-bird.workers.dev" } : null;
  }

  /** One call from the phone. `key` proves it's the phone that set this Notifier up. */
  async handle(op: string, key: string, body: Record<string, unknown>): Promise<{ status: number; body: Reply }> {
    const s = await this.load();
    const kh = await sha256(key);
    const now = Date.now();
    if (s.keyHash && s.keyHash !== kh) return { status: 403, body: { error: "not yours" } };

    if (op === "subscribe") {
      const sub = body.sub as PushSub | undefined;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth || !pushHostOk(sub.endpoint, this.env.PUSH_DEV === "1")) return { status: 400, body: { error: "bad subscription" } };
      s.sub = { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } };
      s.keyHash = kh;
      await this.save(s);
      return { status: 200, body: { ok: true } };
    }
    if (!s.keyHash) return { status: 404, body: { error: "not set up" } };

    if (op === "schedule") {
      // `replace` clears everything whose id starts with it first (e.g. "shutdown:" for the week).
      const replace = clip(body.replace, 40);
      const items = cleanItems(body.items, now);
      const ids = new Set(items.map((i) => i.id));
      s.items = s.items.filter((i) => !ids.has(i.id) && !(replace && i.id.startsWith(replace)) && i.at > now - LATE_MS).concat(items).slice(-MAX_ITEMS);
      await this.save(s);
      return { status: 200, body: { ok: true, count: s.items.length, next: s.items[0]?.at ?? null } };
    }
    if (op === "cancel") {
      const ids = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
      const prefix = clip(body.prefix, 40);
      s.items = s.items.filter((i) => !ids.has(i.id) && !(prefix && i.id.startsWith(prefix)));
      await this.save(s);
      return { status: 200, body: { ok: true, count: s.items.length } };
    }
    if (op === "test") {
      const v = this.vapid();
      if (!v || !s.sub) return { status: 503, body: { error: "not ready" } };
      let ok = false, status = 0, why = "";
      try {
        const r = await sendPush(s.sub, { title: "Nest", body: "Buzzing works.", tag: "test" }, v, 60);
        ok = r.ok; status = r.status;
        if (!ok) why = await whyNot(r);
        if (status === 404 || status === 410) s.sub = null;
      } catch (e) {
        why = "error " + String((e as Error)?.message ?? e).slice(0, 80);
      }
      s.lastStatus = status; s.lastAt = now; s.lastWhy = why;
      await this.save(s);
      return { status: ok ? 200 : 502, body: { ok, status, why } };
    }
    if (op === "status") return { status: 200, body: { ok: true, subscribed: !!s.sub, count: s.items.length, next: s.items[0]?.at ?? null, sent: s.sent, lastStatus: s.lastStatus, lastWhy: s.lastWhy ?? "" } };
    if (op === "off") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { error: "unknown" } };
  }

  /** The alarm: send what's due, drop what's too late, set the next alarm. */
  async alarm(): Promise<void> {
    const s = await this.load();
    const v = this.vapid();
    const now = Date.now();
    const due = s.items.filter((i) => i.at <= now + 250);
    s.items = s.items.filter((i) => i.at > now + 250);
    const sub = s.sub;
    if (sub && v) {
      for (const it of due) {
        if (now - it.at > LATE_MS) continue;
        try {
          const r = await sendPush(sub, { title: it.title, body: it.body, tag: it.tag, url: it.url }, v, it.ttl);
          s.lastStatus = r.status; s.lastAt = now;
          if (r.ok) { s.sent++; s.lastWhy = ""; } else s.lastWhy = await whyNot(r);
          if (r.status === 404 || r.status === 410) { s.sub = null; s.items = []; break; } // the phone dropped this address
        } catch (e) {
          s.lastStatus = -1; s.lastWhy = "error " + String((e as Error)?.message ?? e).slice(0, 80);
        }
      }
    }
    await this.save(s);
  }
}

const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;
const KEY = /^[A-Za-z0-9_-]{32,64}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (url.pathname === "/api/push/key") {
      const ready = !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE);
      // pair: do the public key here and the secret in Cloudflare belong together?
      const pair = ready ? await vapidPairOk({ publicKey: env.VAPID_PUBLIC!, privateKey: env.VAPID_PRIVATE!, subject: "" }) : false;
      return json({ key: env.VAPID_PUBLIC || null, ready, pair });
    }
    const m = url.pathname.match(/^\/api\/push\/(subscribe|schedule|cancel|test|status|off)$/);
    if (!m) return json({ error: "not found" }, 404);
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const text = await req.text();
    if (text.length > 16_000) return json({ error: "too big" }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { return json({ error: "bad json" }, 400); }
    const device = String(body.device ?? ""), key = String(body.key ?? "");
    if (!DEVICE.test(device) || !KEY.test(key)) return json({ error: "bad device" }, 400);
    const stub = env.NOTIFIER.get(env.NOTIFIER.idFromName(device));
    try {
      const r = await stub.handle(m[1], key, body);
      return json(r.body, r.status);
    } catch (e) {
      return json({ ok: false, why: "error " + String((e as Error)?.message ?? e).slice(0, 120) }, 500);
    }
  },
};
