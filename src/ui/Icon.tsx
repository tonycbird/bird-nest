import { Fragment, type CSSProperties, type ReactNode } from "react";
import { ICONS, type IconName } from "./icons";
import { splitGlyphs } from "./glyphs";
export { iconName, EMOJI } from "./glyphs";

/* Nest icons: drawn for this app, one stroke weight, one soft tone fill. They take the text color. */

export type { IconName };

export function Icon(props: { n: IconName | string; size?: number | string; tone?: boolean; className?: string; style?: CSSProperties; label?: string }) {
  const d = (ICONS as Record<string, { t: string; l: string }>)[props.n] ?? ICONS.dot;
  const size = props.size ?? 20;
  return (
    <svg className={"i" + (props.className ? " " + props.className : "")} width={size} height={size} viewBox="0 0 24 24" style={props.style}
      role={props.label ? "img" : undefined} aria-label={props.label} aria-hidden={props.label ? undefined : true} focusable="false">
      {props.tone !== false && d.t && <g fill="currentColor" opacity=".28" stroke="none" dangerouslySetInnerHTML={{ __html: d.t }} />}
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d.l }} />
    </svg>
  );
}

/** An inline icon that sits in a line of text. */
export function I(props: { n: IconName | string; tone?: boolean }) {
  return <Icon n={props.n} size="1.2em" tone={props.tone} className="ii" />;
}

/** Text with emoji in it, drawn with Nest icons instead. */
export function iconText(s: string | null | undefined): ReactNode {
  if (!s) return s;
  const parts = splitGlyphs(s);
  if (!parts) return s;
  return parts.map((p, i) => (i % 2 === 1 ? <I key={i} n={p} /> : p ? <Fragment key={i}>{p}</Fragment> : null));
}
