// @ts-nocheck -- runs the Node builder; the app tsconfig has no Node types.
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";

/* The money sync prompt carries money.mjs inside it. If the script changes, the prompt must be rebuilt. */
test("claude/tasks/money.md carries the current money.mjs", () => {
  const r = spawnSync(process.execPath, ["claude/tools/build-money-task.mjs", "--check"], { encoding: "utf8" });
  expect(r.stdout.trim()).toBe("money.md is up to date");
  expect(r.status).toBe(0);
});
