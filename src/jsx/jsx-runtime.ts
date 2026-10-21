import * as R from "react/jsx-runtime";
import { fixProps } from "./glyph-children";

export const Fragment = R.Fragment;
export type { JSX } from "react/jsx-runtime";
type P = Parameters<typeof R.jsx>;
export function jsx(type: P[0], props: P[1], key?: P[2]) { return R.jsx(type, fixProps(type, props as Record<string, unknown>) as P[1], key); }
export function jsxs(type: P[0], props: P[1], key?: P[2]) { return R.jsxs(type, fixProps(type, props as Record<string, unknown>) as P[1], key); }
