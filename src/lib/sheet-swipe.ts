/* Every bottom sheet closes with a swipe down from its top edge (the grab bar), or a tap on the bar.
   Works for all sheets at once: it closes a sheet by "tapping" the dim area behind it, which every sheet already handles. */

export function installSheetSwipe() {
  let sheet: HTMLElement | null = null;
  let y0 = 0, dy = 0, moved = false, top = 0;
  const reset = (el: HTMLElement) => { el.style.transition = "transform .18s ease"; el.style.transform = ""; window.setTimeout(() => { el.style.transition = ""; }, 200); };
  const close = (el: HTMLElement) => {
    const scrim = el.closest(".scrim") as HTMLElement | null;
    if (!scrim) return reset(el);
    // Save the field being typed in first: a sheet removed while a field has focus never gets its blur on iPhone.
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* fine */ }
    el.style.transition = "transform .16s ease"; el.style.transform = "translateY(100%)";
    window.setTimeout(() => scrim.click(), 140);
  };
  document.addEventListener("touchstart", (e) => {
    sheet = null; // never carry a half-finished swipe into a new touch
    const t = e.target as HTMLElement | null;
    const el = t?.closest?.(".sheet") as HTMLElement | null;
    if (!el || el.classList.contains("qa-sheet") || !el.closest(".scrim")) return;
    if (el.scrollTop > 0) return; // scrolled down: the top strip is content now, not the grab bar
    if (t?.closest?.("button, input, textarea, select, a, [role=button]")) return; // a real control (the ✕) wins
    const r = el.getBoundingClientRect();
    const y = e.touches[0].clientY;
    if (y - r.top > 44) return; // only from the top strip, so lists and fields inside still scroll and type
    sheet = el; y0 = y; dy = 0; moved = false; top = y - r.top;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!sheet) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 6) moved = true;
    if (moved) { sheet.style.transition = "none"; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  document.addEventListener("touchcancel", () => { const el = sheet; sheet = null; if (el && moved) reset(el); });
  document.addEventListener("touchend", () => {
    const el = sheet; sheet = null;
    if (!el) return;
    if (moved ? dy > 80 : top < 22) close(el);
    else if (moved) reset(el);
  });
}
