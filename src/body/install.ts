/* Body wiring at app start: the frame's host object, and River sync after every Fitness save. */
import { today } from "../lib/time";
import { fitApi, installFitHost, onFitChange } from "./host";
import { syncPlanToRiver } from "./river-body";
import { onAnyBlockDone } from "../lib/river";

export function installBody() {
  installFitHost();
  onFitChange(() => {
    const api = fitApi();
    if (!api) return;
    try { void syncPlanToRiver(api.plan(today())).catch(() => {}); } catch { /* plan not ready */ }
  });
  // Warm-up finished on the River → checked off in Body too.
  onAnyBlockDone(async (b) => {
    if (b.source_type !== "workout" || !b.source_id) return;
    const [date, key] = b.source_id.split("|");
    if (key === "warm") fitApi()?.markWarm(date);
  });
}
