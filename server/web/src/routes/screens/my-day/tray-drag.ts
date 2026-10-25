/**
 * The tray item being dragged onto the Timeline (the owner's design,
 * LAI-512): the browser's drag carries only a string, and the drop needs
 * the item's length and words before it lands — so the tray says what it
 * picked up here, and the Timeline reads it while the pointer is over the
 * track. One at a time, as a drag is.
 */

export interface TrayDrag {
  readonly kind: 'draft' | 'entry';
  readonly id: string;
  readonly minutes: number;
  readonly label: string;
}

let current: TrayDrag | null = null;

export function startTrayDrag(item: TrayDrag): void {
  current = item;
}

export function endTrayDrag(): void {
  current = null;
}

export function trayDrag(): TrayDrag | null {
  return current;
}
