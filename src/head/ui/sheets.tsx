import { useEffect, type ReactNode } from "react";
import { createStore } from "../useHead";

/* Promise-based sheets, like Clearhead's openSheet(): `const r = await openSheet(DatePicker, {...})`.
   undefined = cancelled. Sheets stack, so a picker can open over the task detail. */

type Done = (v: unknown) => void;
export interface SheetProps { done: Done; }
interface Entry { id: number; C: (p: never) => ReactNode; props: Record<string, unknown>; resolve: Done; }

const stack = createStore<Entry[]>([]);
let n = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openSheet<R = unknown>(C: (p: any) => ReactNode, props: object = {}): Promise<R | undefined> {
  return new Promise((resolve) => {
    const id = ++n;
    const finish: Done = (v) => {
      stack.set((s) => s.filter((e) => e.id !== id));
      resolve(v as R | undefined);
    };
    stack.set((s) => [...s, { id, C: C as unknown as Entry["C"], props: props as Record<string, unknown>, resolve: finish }]);
  });
}

export function SheetHost() {
  const items = stack.use();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && items.length) items[items.length - 1].resolve(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items]);
  return (
    <>
      {items.map((e, i) => {
        const C = e.C as (p: Record<string, unknown>) => ReactNode;
        return (
          <div key={e.id} className="scrim" style={{ zIndex: 40 + i * 2 }} onClick={() => e.resolve(undefined)}>
            <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
              <C {...e.props} done={e.resolve} />
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Standard sheet layout: title, body, footer buttons. */
export function SheetFrame(props: { title: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  return (
    <>
      <h2>{props.title}</h2>
      {props.children}
      {props.foot && <div className="sheet-actions">{props.foot}</div>}
    </>
  );
}
