import { Fragment, jsx as rjsx } from "react/jsx-runtime";
import { splitGlyphs } from "../ui/glyphs";
import { Icon } from "../ui/Icon";

/* Bird Nest draws its own icons. Any emoji that reaches the screen as text (old saved blocks,
   Claude's plans, toasts, area icons) is swapped for the matching Nest icon right here. */

const SKIP = new Set(["option", "textarea", "title", "style", "script", "text", "tspan"]);

function swap(s: string): unknown {
  const parts = splitGlyphs(s);
  if (!parts) return s;
  return parts.map((p, i) => (i % 2 === 1 ? rjsx(Icon, { n: p, size: "1.2em", className: "ii" }, i) : p)).filter((x) => x !== "");
}

export function fixProps(type: unknown, props: Record<string, unknown> | null): Record<string, unknown> | null {
  if ((typeof type !== "string" && type !== Fragment) || (typeof type === "string" && SKIP.has(type)) || !props || props.children == null) return props;
  const c = props.children;
  if (typeof c === "string") {
    const r = swap(c);
    return r === c ? props : { ...props, children: r };
  }
  if (Array.isArray(c)) {
    let changed = false;
    const fix = (x: unknown): unknown => {
      if (Array.isArray(x)) { const y = x.map(fix); return y.some((v, i) => v !== x[i]) ? y : x; }
      if (typeof x !== "string") return x;
      const r = swap(x);
      if (r !== x) changed = true;
      return r;
    };
    const out = c.map((x) => { const r = fix(x); if (r !== x) changed = true; return r; });
    return changed ? { ...props, children: out } : props;
  }
  return props;
}
