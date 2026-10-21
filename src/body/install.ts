/* Body wiring at app start: the frame's host object, River sync after every Fitness save,
   and the week of Body plans Claude reads (Phase 4). */
import { addDays, today } from "../lib/time";
import { onAnyBlockDone } from "../lib/river";
import { schedule, setBodyPlanProvider } from "../lib/sync";
import { fitApi, installFitHost, onFitChange } from "./host";
import { syncPlanToRiver } from "./river-body";

export function installBody() {
  installFitHost();
  onFitChange(() => {
    const api = fitApi();
    if (!api) return;
    try { void syncPlanToRiver(api.plan(today())).catch(() => {}); } catch { /* plan not ready */ }
    schedule(5000);
  });
  // Warm-up finished on the River → checked off in Body too.
  onAnyBlockDone(async (b) => {
    if (b.source_type !== "workout" || !b.source_id) return;
    const [date, key] = b.source_id.split("|");
    if (key === "warm") fitApi()?.markWarm(date);
  });
  // Claude can't run the Fitness logic, so the phone sends the next week of plans with each sync.
  setBodyPlanProvider(() => {
    const api = fitApi();
    if (!api) return null;
    const t = today();
    return { days: Array.from({ length: 7 }, (_, i) => api.plan(addDays(t, i))), missed: api.missed() };
  });
}
