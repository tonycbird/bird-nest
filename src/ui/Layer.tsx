import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Sheets and full-screen views render at the top of the page, never inside the scrolling area,
    so the tab bar can't sit on top of them (iPhone draws a scrolling area as its own layer). */
export function Layer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
