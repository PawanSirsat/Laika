import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { scrollToReveal, stripOverflow, tabKeyTarget } from './tab-keys.ts';
import './tabs.css';

/** Marks an element as one of a strip's tabs, for the keys and the scroll. */
export const TAB_ITEM = 'data-tab-item';
/** Marks the strip's current tab — the one revealed when the strip scrolls. */
export const TAB_ACTIVE = 'data-tab-active';

/** Space left past a revealed tab, so the edge fade never sits on it. Matches `tabs.css`. */
const FADE_PX = 24;

/**
 * The roving tabindex: the current tab is the strip's one stop in the Tab
 * order, the others are reached with the arrow keys. With no current tab the
 * first one takes the stop, so a strip is never unreachable from the keyboard.
 */
export function rovingTabIndex(active: boolean, index: number, anyActive: boolean): 0 | -1 {
  return active || (!anyActive && index === 0) ? 0 : -1;
}

export interface TabStripProps {
  /**
   * The current tab's id. When it changes the strip scrolls that tab into
   * view — on a phone the tab you are on is never the one cut off.
   */
  readonly activeKey: string;
  /** The scrolling list's element: `ul` for links in a `nav`, `div` for a tablist. */
  readonly element?: 'ul' | 'div' | 'span' | undefined;
  /** `tablist` for tabs that switch a panel; absent for a `nav` of links. */
  readonly role?: 'tablist' | undefined;
  /** The list's accessible name, when it is the tablist itself. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/**
 * The one tab strip (LAI-1193). Every row of tabs in the app is drawn inside
 * it, whatever its look, so they all behave one way:
 *
 * - **Keys** (WAI-ARIA APG *Tabs*): Left/Right move and wrap, Home/End jump,
 *   and moving activates — a tab here is cheap to show, so there is no
 *   separate *select* step. Activation is the tab's own `click()`, so a link
 *   tab navigates through its `onClick` exactly as a pointer would.
 * - **Overflow**: the list scrolls sideways rather than wrapping, and the edge
 *   that hides a tab fades (`tab-strip-fade-start` / `-end`) — the 390px
 *   strip cut at *"Sprin"* with nothing to say it scrolls (visual audit #4).
 * - **Reveal**: the current tab, and a tab the keys move to, are scrolled
 *   fully into view.
 *
 * Classes only, never a style attribute: the fade is a CSS mask chosen by
 * class, so the strip needs nothing the CSP's `style-src-attr` would see.
 */
export function TabStrip({
  activeKey,
  element = 'div',
  role,
  label,
  className,
  children,
}: TabStripProps) {
  const list = useRef<HTMLElement | null>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = list.current;
    if (el === null) return;
    const next = stripOverflow(el);
    setFade((was) => (was.start === next.start && was.end === next.end ? was : next));
  }, []);

  const reveal = useCallback(
    (tab: HTMLElement | null | undefined, smooth: boolean) => {
      const el = list.current;
      if (el === null || tab === null || tab === undefined) return;
      const box = tab.getBoundingClientRect();
      const frame = el.getBoundingClientRect();
      const left = box.left - frame.left + el.scrollLeft;
      const to = scrollToReveal({ left, width: box.width }, el, FADE_PX);
      if (to === undefined) return;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: to, behavior: smooth && !still ? 'smooth' : 'auto' });
      measure();
    },
    [measure],
  );

  const first = useRef(true);
  useLayoutEffect(() => {
    const el = list.current;
    if (el === null) return;
    reveal(el.querySelector<HTMLElement>(`[${TAB_ACTIVE}]`), !first.current);
    first.current = false;
    measure();
  }, [activeKey, reveal, measure]);

  useEffect(() => {
    const el = list.current;
    if (el === null) return;
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>(`[${TAB_ITEM}]`)];
    const here =
      event.target instanceof Element ? event.target.closest<HTMLElement>(`[${TAB_ITEM}]`) : null;
    if (here === null) return;
    const to = tabKeyTarget(event.key, tabs.indexOf(here), tabs.length);
    const next = to === undefined ? undefined : tabs[to];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
    if (next !== here) next.click();
  };

  const onFocus = (event: FocusEvent<HTMLElement>): void => {
    if (event.target instanceof HTMLElement && event.target.hasAttribute(TAB_ITEM)) {
      reveal(event.target, true);
    }
  };

  const classes = [
    'tab-strip',
    fade.start ? 'tab-strip-fade-start' : '',
    fade.end ? 'tab-strip-fade-end' : '',
    className ?? '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  const props = {
    ref: (el: HTMLElement | null) => {
      list.current = el;
    },
    className: classes,
    role,
    'aria-label': label,
    'aria-orientation': role === 'tablist' ? ('horizontal' as const) : undefined,
    'data-tab-strip': '',
    onKeyDown,
    onFocus,
    children,
  };
  if (element === 'ul') return <ul {...props} />;
  if (element === 'span') return <span {...props} />;
  return <div {...props} />;
}
