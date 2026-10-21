import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

export interface ListScrollerProps {
  /** The card the list sits in: a wheel anywhere over it moves the list. */
  readonly card: RefObject<HTMLElement | null>;
  readonly label: string;
  readonly id?: string;
  /** The page shown. A new one starts at its top. */
  readonly page: number;
  /** The selected row's id, when it may be in this list. */
  readonly selected: string | undefined;
  readonly children: ReactNode;
}

/** A wheel's line, in pixels, for a wheel that counts in lines. */
const LINE = 16;

/** Wheel events closer together than this are one gesture — a fling's are ~16ms apart. */
const LATCH_MS = 150;

/** Where each row starts and ends, from the top of the list's content. */
function rowEdges(box: HTMLElement): { top: number; bottom: number }[] {
  const origin = box.getBoundingClientRect().top + box.clientTop - box.scrollTop;
  return [...box.querySelectorAll(':scope > ol > li')].map((row) => {
    const r = row.getBoundingClientRect();
    return { top: r.top - origin, bottom: r.bottom - origin };
  });
}

/**
 * Size the list to whole rows, and end it on one (LAI-858). Its height is the
 * most rows that fit in what the stylesheet allows; the tail makes its
 * furthest scroll a row's top. So it never rests with a row cut under the
 * header — on the owner's screen ten rows came less than a row over, the list
 * could move only by that sliver, and at its end the first row showed one
 * line. A list that shows every row is no scroller.
 */
function fitRows(box: HTMLElement, tail: HTMLElement): void {
  const at = box.scrollTop;
  box.style.height = '';
  tail.style.height = '';
  // What the stylesheet's max-height leaves, or less when every row fits.
  const room = box.clientHeight;
  const edges = rowEdges(box);
  const total = edges.at(-1)?.bottom ?? 0;
  if (total <= room + 0.5) {
    delete box.dataset.overflows;
    return;
  }
  const shown = edges.filter((e) => e.bottom <= room + 0.5).at(-1)?.bottom ?? room;
  const reach = total - shown;
  const landing = edges.find((e) => e.top >= reach - 0.5)?.top ?? reach;
  box.style.height = `${String(shown)}px`;
  if (landing - reach > 0.5) tail.style.height = `${String(landing - reach)}px`;
  box.dataset.overflows = '';
  box.scrollTop = at;
}

/** Scroll the list, never the page, so all of `row` shows with a row's top at the top. */
function reveal(box: HTMLElement, row: Element): void {
  const origin = box.getBoundingClientRect().top + box.clientTop - box.scrollTop;
  const r = row.getBoundingClientRect();
  const top = r.top - origin;
  const bottom = r.bottom - origin;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) {
    const to = rowEdges(box).find((e) => e.top >= bottom - box.clientHeight - 0.5)?.top;
    box.scrollTop = to ?? top;
  }
}

/** Whether something inside the card, between `from` and it, scrolls that way itself. */
function scrollsItself(from: Element | null, card: Element, dy: number): boolean {
  for (let el = from; el !== null && el !== card; el = el.parentElement) {
    if (!['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) continue;
    if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) {
      return true;
    }
  }
  return false;
}

/**
 * The scroll area of *To settle* and *Confirmed* (LAI-858; the owner,
 * 2026-10-21: "only scroll that component … not the whole page").
 *
 * - **The whole card scrolls the list.** `overscroll-behavior` holds a wheel
 *   only over the scroller itself, so over the header, the selection bar, the
 *   pager or *Add time* it went straight to the page. Over the rest of the
 *   card the wheel is taken here and turned into rows. Neither end carries on
 *   into the page — while the list has more rows than it shows. One that
 *   shows them all lets the page scroll, over the rows too.
 * - **Rows rest whole**: whole-row height, a snap to each row's top, and a
 *   tail so the end is a row's top as well.
 * - **The selected row shows whole**, on its page, by scrolling the list
 *   alone — never `scrollIntoView`, which would move the page too.
 */
export function ListScroller({ card, label, id, page, selected, children }: ListScrollerProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const tail = useRef<HTMLDivElement | null>(null);
  const shown = useRef<
    { readonly page: number; readonly selected: string | undefined } | undefined
  >(undefined);

  // Whole rows whenever the rows, the width or the window change.
  useEffect(() => {
    const box = scroller.current;
    const end = tail.current;
    const rows = box?.firstElementChild;
    if (box === null || end === null || rows === null || rows === undefined) return;
    const fit = (): void => {
      fitRows(box, end);
    };
    const watch = new ResizeObserver(fit);
    watch.observe(rows);
    window.addEventListener('resize', fit);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  // A new page starts at its top; the selected row is brought into view.
  useLayoutEffect(() => {
    const box = scroller.current;
    const end = tail.current;
    if (box === null || end === null) return;
    fitRows(box, end);
    const last = shown.current;
    shown.current = { page, selected };
    if (last?.page === page && last.selected === selected) return;
    const row =
      selected === undefined
        ? null
        : box.querySelector(`[data-select="${CSS.escape(selected)}"]`)?.closest('li');
    if (row !== null && row !== undefined) reveal(box, row);
    else if (last?.page !== page) box.scrollTop = 0;
  }, [page, selected]);

  // The wheel anywhere else over the card, turned into rows of this list.
  useEffect(() => {
    const host = card.current;
    const box = scroller.current;
    if (host === null || box === null) return;
    let owed = 0;
    let elsewhere = -Infinity;
    const onAnyWheel = (event: WheelEvent): void => {
      if (!(event.target instanceof Node) || !host.contains(event.target)) {
        elsewhere = event.timeStamp;
      }
    };
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || !('overflows' in box.dataset)) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const from = event.target instanceof Element ? event.target : null;
      // Over the rows the browser scrolls them, and `overscroll-behavior` keeps it there.
      if (from === null || box.contains(from)) return;
      if (scrollsItself(from, host, event.deltaY)) return;
      // A fling already moving the page as the card passes under the pointer
      // stays the page's, as the browser keeps one that passes over the rows.
      if (event.timeStamp - elsewhere < LATCH_MS) {
        elsewhere = event.timeStamp;
        return;
      }
      event.preventDefault();
      const dy =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * LINE
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * box.clientHeight
            : event.deltaY;
      if (Math.sign(dy) !== Math.sign(owed)) owed = 0;
      owed += dy;
      // The row top nearest where the wheel has got to — a snap position, so
      // the snap keeps it — and the rest owed to the next notch.
      const want = box.scrollTop + owed;
      const furthest = box.scrollHeight - box.clientHeight;
      const to = rowEdges(box)
        .map((e) => Math.min(e.top, furthest))
        .reduce((best, top) => (Math.abs(top - want) < Math.abs(best - want) ? top : best), 0);
      if (Math.abs(to - box.scrollTop) < 0.5) return;
      owed = want - to;
      box.scrollTop = to;
    };
    window.addEventListener('wheel', onAnyWheel, { capture: true, passive: true });
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onAnyWheel, { capture: true });
      host.removeEventListener('wheel', onWheel);
    };
  }, [card]);

  return (
    <div
      ref={scroller}
      id={id}
      className="myday-scroll"
      role="region"
      aria-label={label}
      // A region that scrolls is reachable by keyboard, so it can be scrolled.
      tabIndex={0}
    >
      {children}
      <div ref={tail} className="myday-scroll-tail" aria-hidden="true" />
    </div>
  );
}
