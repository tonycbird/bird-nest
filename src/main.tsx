import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/archivo";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/head.css";
import App from "./App";
import { installRiverBridge } from "./head/river-bridge";

installRiverBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
