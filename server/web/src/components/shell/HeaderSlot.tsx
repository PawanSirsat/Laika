import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The app header's two slots (LAI-1188): **title**, where a screen that
 * knows more than the route table names itself (a space's name and key, a
 * member's breadcrumb), and **actions**, where it puts controls that belong
 * to the whole page rather than to one part of it (a space's Agents chip and
 * menu).
 *
 * **A module store, not a context**, for the palette store's reason: the
 * header is the shell's and the screens render below it, and a portal keeps
 * each screen's own React context (the space's live stream, its permissions)
 * while drawing its markup in the header.
 */
export type SlotName = 'title' | 'actions';

const slots: Record<SlotName, HTMLElement | null> = { title: null, actions: null };
/** How many mounted screens have put a title up; the header's own crumbs give way to any. */
let titleClaims = 0;
/**
 * How many mounted screens draw their own page title — an `h1` in their page
 * header (LAI-1221). While any does, the header's breadcrumb stops before the
 * page itself, so the page's name is said once, in its own heading.
 */
const pageTitles: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The header registers each slot's element (a ref callback); `null` when it unmounts. */
export function setHeaderSlot(name: SlotName, element: HTMLElement | null): void {
  if (slots[name] === element) return;
  slots[name] = element;
  emit();
}

function useSlot(name: SlotName): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => slots[name],
    () => null,
  );
}

/** Whether a screen has put its own title in the header. */
export function useHeaderTitleClaimed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => titleClaims > 0,
    () => false,
  );
}

/**
 * **The title rule** (LAI-1221): every screen names itself exactly once, in
 * one `h1`. A screen whose own header draws that `h1` (`ScreenHeader`'s page
 * and band) says so here, and the app header then shows only the way *to* the
 * page — the organisation, then the section — never the page's name a second
 * time. A screen whose chrome *is* the header (a space, a profile) hands its
 * title up instead (`HeaderTitle`), and the header carries the `h1`.
 */
export function usePageTitleClaim(active: boolean, title: string): void {
  useEffect(() => {
    if (!active) return;
    pageTitles.push(title);
    emit();
    return () => {
      const at = pageTitles.lastIndexOf(title);
      if (at !== -1) pageTitles.splice(at, 1);
      emit();
    };
  }, [active, title]);
}

/**
 * The title the page's own `h1` says, while a screen below draws one — the
 * newest, when one screen sits inside another — or `undefined`.
 */
export function usePageTitle(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => pageTitles.at(-1),
    () => undefined,
  );
}

export interface HeaderSlotProps {
  readonly children: ReactNode;
  /**
   * What to draw where the header is not mounted — a component rendered on
   * its own, in a test or a frame without the shell — so nothing it carries
   * is lost. Defaults to the children themselves, in place.
   */
  readonly fallback?: ReactNode;
}

/**
 * **One of the header's slots**, filled from wherever a screen renders it: the
 * children are portalled into the header's `slot` element, keeping the
 * screen's own React context, or drawn as `fallback` in place where the
 * header is not mounted. `HeaderTitle` and `HeaderActions` are this, named.
 */
export function HeaderSlot({
  slot: name,
  children,
  fallback = children,
}: HeaderSlotProps & { readonly slot: SlotName }) {
  const slot = useSlot(name);
  return slot === null ? <>{fallback}</> : createPortal(children, slot);
}

/** The screen's title, drawn in the header in place of the route's breadcrumb. */
export function HeaderTitle({ children, fallback = children }: HeaderSlotProps) {
  useEffect(() => {
    titleClaims += 1;
    emit();
    return () => {
      titleClaims -= 1;
      emit();
    };
  }, []);
  return (
    <HeaderSlot slot="title" fallback={fallback}>
      {children}
    </HeaderSlot>
  );
}

/** Page-wide controls, drawn in the header's actions slot. */
export function HeaderActions({ children, fallback = children }: HeaderSlotProps) {
  return (
    <HeaderSlot slot="actions" fallback={fallback}>
      {children}
    </HeaderSlot>
  );
}

/** Its children only where the header is not mounted — the in-place half of a `fallback={null}` slot. */
export function HeaderSlotFallback({ children }: { readonly children: ReactNode }) {
  return useSlot('title') === null ? <>{children}</> : null;
}
