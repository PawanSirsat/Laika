/** A box on screen, in viewport pixels — what `getBoundingClientRect` returns. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly side: 'top' | 'bottom';
}

/** Room between the control and its tooltip. */
export const TIP_GAP = 6;
/** The tooltip never comes closer than this to the window's edge. */
export const TIP_MARGIN = 8;

/** Whether two boxes overlap by any area. */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/**
 * Where a tooltip goes (LAI-1193): centred on its control, **below** it unless
 * the window has no room there and has room above, and slid sideways so it
 * never leaves the window — a toolbar's last icon sits against the right edge.
 *
 * `avoid` is the field being typed in, when that is not the control itself
 * (LAI-1209): a tooltip **never covers the words someone is writing**. The
 * side that would cover it is given up for the other, even one that does not
 * quite fit — a tooltip clipped at the window's edge costs less than a hidden
 * caret.
 *
 * Pure: the component measures, this decides, and the answer reaches the page
 * as two CSS custom properties set through the CSSOM — never a `style`
 * attribute, which the CSP's `style-src-attr` governs.
 */
export function placeTooltip(
  anchor: Box,
  tip: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  prefer: 'top' | 'bottom' = 'bottom',
  avoid?: Box,
): Placement {
  const below = anchor.top + anchor.height + TIP_GAP;
  const above = anchor.top - TIP_GAP - tip.height;
  const fitsBelow = below + tip.height <= viewport.height - TIP_MARGIN;
  const fitsAbove = above >= TIP_MARGIN;
  let side: 'top' | 'bottom' =
    prefer === 'bottom'
      ? fitsBelow || !fitsAbove
        ? 'bottom'
        : 'top'
      : fitsAbove || !fitsBelow
        ? 'top'
        : 'bottom';

  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const maxX = viewport.width - TIP_MARGIN - tip.width;
  const x = Math.round(Math.max(TIP_MARGIN, Math.min(centred, maxX)));
  const boxAt = (s: 'top' | 'bottom'): Box => ({
    left: x,
    top: s === 'bottom' ? below : above,
    width: tip.width,
    height: tip.height,
  });
  if (avoid !== undefined && overlaps(boxAt(side), avoid)) {
    const other = side === 'bottom' ? 'top' : 'bottom';
    if (!overlaps(boxAt(other), avoid)) side = other;
  }
  const y = Math.round(side === 'bottom' ? below : above);
  return { x, y, side };
}
