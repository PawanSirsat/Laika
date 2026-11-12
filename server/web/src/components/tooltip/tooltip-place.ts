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

/**
 * Where a tooltip goes (LAI-1193): centred on its control, **below** it unless
 * the window has no room there and has room above, and slid sideways so it
 * never leaves the window — a toolbar's last icon sits against the right edge.
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
): Placement {
  const below = anchor.top + anchor.height + TIP_GAP;
  const above = anchor.top - TIP_GAP - tip.height;
  const fitsBelow = below + tip.height <= viewport.height - TIP_MARGIN;
  const fitsAbove = above >= TIP_MARGIN;
  const side =
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
  const y = Math.round(side === 'bottom' ? below : above);
  return { x, y, side };
}
