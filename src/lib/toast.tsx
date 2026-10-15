import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type UndoFn = () => unknown | Promise<unknown>;
interface ToastState { id: number; text: string; undo?: UndoFn; }
type Show = (text: string, undo?: UndoFn) => void;
const Ctx = createContext<Show>(() => {});

/* Non-React code (stores, flows) can toast too. */
let globalShow: Show = () => {};
export const toast: Show = (text, undo) => globalShow(text, undo);

/** One toast at a time, with Undo for 10 seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<ToastState | null>(null);
  const n = useRef(0);
  const show = useCallback<Show>((text, undo) => {
    const id = ++n.current;
    setT({ id, text, undo });
    window.setTimeout(() => setT((cur) => (cur && cur.id === id ? null : cur)), undo ? 10_000 : 2_500);
  }, []);
  globalShow = show;
  return (
    <Ctx.Provider value={show}>
      {children}
      {t && (
        <div className="toast" role="status" key={t.id}>
          {t.text}
          {t.undo && <button onClick={async () => { const u = t.undo!; setT(null); await u(); }}>Undo</button>}
        </div>
      )}
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
