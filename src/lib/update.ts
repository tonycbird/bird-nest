import { registerSW } from "virtual:pwa-register";

/* App updates. A new build downloads quietly, then installs at a calm moment:
   when Nest goes to the background, when Anthony taps Reload / "Check for update",
   or from the rescue screen. It never reloads the page while he's using it. */

let apply: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;
let registration: ServiceWorkerRegistration | undefined;

export function installUpdates() {
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true;
      if (document.visibilityState === "hidden") void apply?.(true);
    },
    onRegisteredSW(_url, reg) { registration = reg; if (reg) window.setInterval(() => void reg.update(), 30 * 60_000); },
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && waiting) void apply?.(true);
  });
  (window as unknown as { __nestReload?: () => void }).__nestReload = reloadFresh;
}

/** Reload, taking a waiting update with it if there is one. */
export function reloadFresh() {
  if (waiting && apply) { void apply(true); window.setTimeout(() => location.reload(), 2500); return; }
  location.reload();
}

export const updateWaiting = () => waiting;

/** Settings › Check for update: look now, install if there's one. Resolves false when already up to date. */
export async function checkForUpdate(): Promise<boolean> {
  try { await registration?.update(); } catch { /* offline */ }
  for (let i = 0; i < 12 && !waiting; i++) await new Promise((r) => setTimeout(r, 250));
  if (waiting) { reloadFresh(); return true; }
  return false;
}
