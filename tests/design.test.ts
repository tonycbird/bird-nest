import { describe, expect, test } from "vitest";
import { iconName, splitGlyphs } from "../src/ui/glyphs";
import { ICONS } from "../src/ui/icons";
import { blockLook, shortLabel, taskIcon } from "../src/ui/colors";
import { resolve, sunTimes } from "../src/lib/theme";

describe("Nest icons", () => {
  test("old emoji and icon names both resolve", () => {
    expect(iconName("🏋")).toBe("lift");
    expect(iconName("🧘")).toBe("stretch");
    expect(iconName("⚠️")).toBe("warn");
    expect(iconName("lift")).toBe("lift");
    expect(iconName("🦄", "head")).toBe("head");
    expect(iconName(null, "home")).toBe("home");
  });
  test("every mapped emoji points at a real icon", () => {
    for (const n of ["tick", "close", "river", "nest", "claude", "barcode"]) expect(n in ICONS).toBe(true);
  });
  test("emoji inside text split out; numbers like 3×10 stay text", () => {
    expect(splitGlyphs("🌊 On the River")).toEqual(["", "river", " On the River"]);
    expect(splitGlyphs("3×10 · 70")).toBeNull();
    expect(splitGlyphs("Plain words")).toBeNull();
  });
  test("blocks take their area's color", () => {
    expect(blockLook({ icon: "🏋", kind: "body" })).toEqual({ icon: "lift", color: "var(--c-body)" });
    expect(blockLook({ icon: "stretch", kind: "body" }).color).toBe("var(--c-stretch)");
    expect(blockLook({ icon: null, kind: "money" })).toEqual({ icon: "coin", color: "var(--c-money)" });
  });
  test("task circles: icon from the words, label names the thing", () => {
    expect(taskIcon("Call Dave")).toBe("call");
    expect(taskIcon("Pay Avista")).toBe("bill");
    expect(taskIcon("Winco run")).toBe("groceries");
    expect(shortLabel("Call supplier about tile")).toBe("Supplier");
    expect(shortLabel("Pay Avista")).toBe("Avista");
    expect(shortLabel("Replace porch light")).toBe("Porch");
  });
});

describe("Follow the sun (Coeur d'Alene)", () => {
  test("light by day, dark at night", () => {
    const d = new Date("2026-10-21T12:42:00Z"); // 5:42 AM Pacific
    const { rise, set } = sunTimes(d);
    expect(rise).toBeGreaterThan(d.getTime());
    expect(set - rise).toBeGreaterThan(9 * 3600e3);
    expect(set - rise).toBeLessThan(12 * 3600e3);
    expect(resolve("auto", d)).toBe("dark");
    expect(resolve("auto", new Date("2026-10-21T19:00:00Z"))).toBe("light"); // noon Pacific
    expect(resolve("light", d)).toBe("light");
  });
});
