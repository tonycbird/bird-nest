/* Web Push from the Nest helper, with nothing but WebCrypto:
   VAPID sign-in (RFC 8292) and the aes128gcm payload lock (RFC 8291). */

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
/** Base64url, raw P-256: a 65-byte public key and a 32-byte private key. */
export interface Vapid { publicKey: string; privateKey: string; subject: string }

const te = new TextEncoder();
const bytes = (s: string) => new Uint8Array(te.encode(s));

export function b64uEncode(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, len: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

/** Lock a message so only the phone that subscribed can read it (one aes128gcm record). */
export async function encrypt(sub: PushSub, payload: Uint8Array<ArrayBuffer>, salt?: Uint8Array<ArrayBuffer>, asKeys?: CryptoKeyPair): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64uDecode(sub.keys.p256dh);
  const auth = b64uDecode(sub.keys.auth);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error("bad subscription keys");
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const as = asKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", as.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // (The standard field is `public`; spelled through the parameter type so both DOM and Workers typings accept it.)
  const ecdh = { name: "ECDH", public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(bytes("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(s, ikm, bytes("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(s, ikm, bytes("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the message, then 0x02 ("last record"), no padding.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(s, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

async function vapidSigner(v: Vapid): Promise<CryptoKey> {
  const pub = b64uDecode(v.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("bad VAPID public key");
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d: v.privateKey, ext: true };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Do the two halves of the key belong together? (A pasted secret from an old key won't.) */
export async function vapidPairOk(v: Vapid): Promise<boolean> {
  try {
    const signer = await vapidSigner(v);
    const pub = await crypto.subtle.importKey("raw", b64uDecode(v.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const msg = bytes("nest");
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, msg);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, msg);
  } catch {
    return false;
  }
}

/** A short reason from a push service's "no" (Apple sends {"reason":"BadJwtToken"}). */
export async function whyNot(r: Response): Promise<string> {
  const t = (await r.text().catch(() => "")).slice(0, 300);
  let reason = "";
  try { reason = String((JSON.parse(t) as { reason?: string }).reason ?? ""); } catch { reason = t.replace(/\s+/g, " ").trim().slice(0, 60); }
  return `${r.status}${reason ? " " + reason : ""}`;
}

/** The Authorization header that tells the push service this message is from Nest. Good for 1 hour. */
export async function vapidAuth(endpoint: string, v: Vapid, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64uEncode(bytes(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(bytes(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 3600 - 60, sub: v.subject })));
  // WebCrypto's ECDSA signature is already r||s, which is what ES256 wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidSigner(v), bytes(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64uEncode(sig)}, k=${v.publicKey}`;
}

export interface PushMessage { title: string; body?: string; tag?: string; url?: string }

export async function sendPush(sub: PushSub, msg: PushMessage, v: Vapid, ttl = 300): Promise<Response> {
  const body = await encrypt(sub, bytes(JSON.stringify(msg)));
  return fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(sub.endpoint, v),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "high",
    },
    body,
  });
}

/** Only real push services, so the helper can't be used to call anywhere else. */
export function pushHostOk(endpoint: string, dev = false): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (dev && u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return true;
  if (u.protocol !== "https:") return false;
  const h = u.hostname;
  return h === "web.push.apple.com" || h.endsWith(".push.apple.com") || h === "fcm.googleapis.com" ||
    h === "updates.push.services.mozilla.com" || h.endsWith(".notify.windows.com");
}
