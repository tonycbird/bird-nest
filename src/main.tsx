import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/head.css";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { installRiverBridge } from "./head/river-bridge";
import { installBody } from "./body/install";
import { installSync } from "./lib/sync";
import { installTheme } from "./lib/theme";

/** If a screen throws, show the error and the way out instead of an empty page. */
class Rescue extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? `${e.message}\n${(e.stack || "").split("\n").slice(0, 4).join("\n")}` : String(e) }; }
  componentDidCatch(e: unknown) {
    const w = window as unknown as { __nestErrors?: string[]; __nestRescue?: (why: string) => void };
    w.__nestErrors?.push(this.state.err || String(e));
    w.__nestRescue?.("A screen crashed.");
  }
  render() { return this.state.err ? <div className="app" /> : this.props.children; }
}

// Register updates before anything else, so even a screen that crashes still gets the next fix.
try {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) { if (reg) window.setInterval(() => void reg.update(), 30 * 60_000); },
  });
} catch (e) { console.error(e); }

try { installTheme(); } catch (e) { console.error(e); }
try { installRiverBridge(); } catch (e) { console.error(e); }
try { installBody(); } catch (e) { console.error(e); }
try { installSync(); } catch (e) { console.error(e); }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Rescue><App /></Rescue>
  </StrictMode>,
);
