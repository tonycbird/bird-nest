import * as R from "react/jsx-dev-runtime";
import { fixProps } from "./glyph-children";

export const Fragment = R.Fragment;
export type { JSX } from "react/jsx-dev-runtime";
type P = Parameters<typeof R.jsxDEV>;
export function jsxDEV(type: P[0], props: P[1], key: P[2], isStatic: P[3], source?: P[4], self?: P[5]) {
  return R.jsxDEV(type, fixProps(type, props as Record<string, unknown>) as P[1], key, isStatic, source, self);
}
