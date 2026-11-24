import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { glyphHtml, splitGlyphs } from "../src/ui/glyphs";
import { db } from "../src/lib/db";
import * as H from "../src/head/store";
import { moment } from "../src/lib/coach";

beforeEach(async () => { await db.delete(); await db.open(); });

describe("no emoji on screen (Nov 24 polish)", () => {
  it("a known emoji becomes its Nest icon; one with no icon just goes, with its space", () => {
    expect(splitGlyphs("📧 https://mail.google.com/x")).toEqual(["", "mail", " https://mail.google.com/x"]);
    expect(splitGlyphs("💧 Pay AK Sprinklers invoice")).toEqual(["Pay AK Sprinklers invoice"]);
    expect(splitGlyphs("Pay 💳 Chase card")).toEqual(["Pay Chase card"]);
    expect(splitGlyphs("Fix the 👨‍👩‍👧 room")).toEqual(["Fix the room"]);
    expect(splitGlyphs("Smith Co.® quote")).toBeNull(); // ® is a word, not decoration
    expect(splitGlyphs("Plain words")).toBeNull();
  });
  it("notes drawn as HTML get icons in their text, never inside a tag", () => {
    const html = glyphHtml('<p>📧 <a href="https://x.test/💧">link</a> 💧 wet</p>', (n) => `[${n}]`);
    expect(html).toBe('<p>[mail] <a href="https://x.test/💧">link</a> wet</p>');
  });
  it("old tasks that start with an emoji lose it once; clean ones and done ones are left alone", async () => {
    const a = await H.createTask({ title: "⚡ Pay Avista bill" });
    const b = await H.createTask({ title: "💳 Pay Chase card (...9690)" });
    const c = await H.createTask({ title: "Call Dave" });
    const d = await H.createTask({ title: "🔥" }); // nothing left without it: keep
    expect(await H.tidyTitles()).toBe(2);
    expect((await db.tasks.get(a.id))?.title).toBe("Pay Avista bill");
    expect((await db.tasks.get(b.id))?.title).toBe("Pay Chase card (...9690)");
    expect((await db.tasks.get(c.id))?.title).toBe("Call Dave");
    expect((await db.tasks.get(d.id))?.title).toBe("🔥");
    expect(await H.tidyTitles()).toBe(0);
  });
});

describe("Today shows the rest of the day under Next", () => {
  it("ahead is everything still to come, in order, without what's running", () => {
    const B = (id: string, start: string, end: string) => ({ id, day: "2026-11-24", start, end, kind: "head", icon: "x", title: id, status: "open", steps: [], doneCount: 0, created_at: "", updated_at: "", deleted_at: null, done_at: null }) as never;
    const m = moment([B("Jobs", "07:30", "15:30"), B("Chapel", "08:30", "09:30"), B("Lunch", "12:00", "13:00"), B("Home", "16:00", "19:00"), B("Study", "19:30", "20:15")], 10 * 60 + 36);
    expect((m.now as { id: string } | null)?.id).toBe("Jobs");
    expect(m.ahead.map((b) => (b as { id: string }).id)).toEqual(["Lunch", "Home", "Study"]);
    expect([(m.next as { id: string } | null)?.id, (m.later as { id: string } | null)?.id]).toEqual(["Lunch", "Home"]);
  });
});
