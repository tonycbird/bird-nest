// @ts-nocheck -- uses node:crypto on purpose (an independent check); the app tsconfig has no Node types.
import { describe, expect, test } from "vitest";
import crypto from "node:crypto";
import { b64uDecode, b64uEncode, encrypt, pushHostOk, vapidAuth } from "../worker/webpush";

/* The helper's push lock and sign-in, checked against node:crypto (a separate implementation).
   The full helper is also run under `wrangler dev` with a fake push service and http_ece. */

function receiverDecrypt(body: Buffer, ua: crypto.ECDH, auth: Buffer): string {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  expect(rs).toBe(4096);
  const shared = ua.computeSecret(asPublic);
  const hk = (salt: Buffer, ikm: Buffer, info: Buffer, n: number) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, n));
  const ikm = hk(auth, shared, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]), 32);
  const cek = hk(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hk(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

describe("web push", () => {
  test("base64url round trip", () => {
    const b = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(b64uEncode(b)).not.toMatch(/[+/=]/);
    expect([...b64uDecode(b64uEncode(b))]).toEqual([...b]);
  });

  test("a message only the phone can read", async () => {
    const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const sub = { endpoint: "https://web.push.apple.com/x", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
    const msg = JSON.stringify({ title: "Rest done — go", body: "Next set." });
    const body = await encrypt(sub, new Uint8Array(new TextEncoder().encode(msg)));
    expect(receiverDecrypt(Buffer.from(body), ua, auth)).toBe(msg);
    // a fresh lock every time
    const again = await encrypt(sub, new Uint8Array(new TextEncoder().encode(msg)));
    expect(Buffer.from(again).equals(Buffer.from(body))).toBe(false);
  });

  test("VAPID sign-in verifies with the public key", async () => {
    const kp = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = kp.privateKey.export({ format: "jwk" });
    const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
    const now = Date.UTC(2026, 9, 28, 17, 0);
    const h = await vapidAuth("https://web.push.apple.com/QXp3", { publicKey: pub, privateKey: jwk.d!, subject: "https://bird-nest.tonyc-bird.workers.dev" }, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(pub);
    const good = crypto.verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: kp.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url"));
    expect(good).toBe(true);
    const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
    expect(claims.aud).toBe("https://web.push.apple.com");
    expect(claims.exp * 1000 - now).toBeLessThanOrEqual(3600e3);
    expect(claims.sub).toMatch(/^https:/);
  });

  test("only real push services", () => {
    expect(pushHostOk("https://web.push.apple.com/abc")).toBe(true);
    expect(pushHostOk("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(pushHostOk("https://evil.example.com/x")).toBe(false);
    expect(pushHostOk("http://web.push.apple.com/x")).toBe(false);
    expect(pushHostOk("http://127.0.0.1:9911/x")).toBe(false);
    expect(pushHostOk("http://127.0.0.1:9911/x", true)).toBe(true);
    expect(pushHostOk("not a url")).toBe(false);
  });
});
