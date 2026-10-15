/* Body page (loaded in a frame inside Nest). Runs the old Bird Fitness script as-is, as a classic
   script, so its behavior matches the old app exactly. Storage and file saving come from Nest. */
import "@fontsource-variable/archivo";
import "@fontsource-variable/fraunces";
import "./fitness.legacy.css";
import "./skin.css";
import FITNESS from "./fitness.legacy.js?raw";
import ADAPTER from "./adapter.legacy.js?raw";

type Host = { db: unknown; downloads: unknown } | null;
let host: Host = null;
try { host = window.parent !== window ? ((window.parent as unknown as { __nestFit?: Host }).__nestFit ?? null) : null; } catch { host = null; }

// The old app asked its host for "db" and "downloads" (window.nest.use, renamed from the artifact API
// in fitness.legacy.js — the only edit to that file). Nest answers instead.
(window as unknown as { nest: unknown }).nest = {
  use: async (name: string) => (host ? (name === "db" ? host.db : name === "downloads" ? host.downloads : null) : null),
};

const s = document.createElement("script");
s.textContent = FITNESS + "\n;\n" + ADAPTER + "\n//# sourceURL=bird-fitness.js";
document.body.appendChild(s);
