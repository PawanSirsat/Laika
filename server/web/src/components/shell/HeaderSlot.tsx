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
type SlotName = 'title' | 'actions';

const slots: Record<SlotName, HTMLElement | null> = { title: null, actions: null };
/** How many mounted screens have put a title up; the header's own crumbs give way to any. */
let titleClaims = 0;
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

export interface HeaderSlotProps {
  readonly children: ReactNode;
  /**
   * What to draw where the header is not mounted — a component rendered on
   * its own, in a test or a frame without the shell — so nothing it carries
   * is lost. Defaults to the children themselves, in place.
   */
  readonly fallback?: ReactNode;
}

/** The screen's title, drawn in the header in place of the route's breadcrumb. */
export function HeaderTitle({ children, fallback = children }: HeaderSlotProps) {
  const slot = useSlot('title');
  useEffect(() => {
    titleClaims += 1;
    emit();
    return () => {
      titleClaims -= 1;
      emit();
    };
  }, []);
  return slot === null ? <>{fallback}</> : createPortal(children, slot);
}

/** Page-wide controls, drawn in the header's actions slot. */
export function HeaderActions({ children, fallback = children }: HeaderSlotProps) {
  const slot = useSlot('actions');
  return slot === null ? <>{fallback}</> : createPortal(children, slot);
}

/** Its children only where the header is not mounted — the in-place half of a `fallback={null}` slot. */
export function HeaderSlotFallback({ children }: { readonly children: ReactNode }) {
  return useSlot('title') === null ? <>{children}</> : null;
}
