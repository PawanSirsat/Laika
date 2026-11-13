import type { ReactElement } from 'react';
import { Tooltip, type TooltipProps } from './Tooltip.tsx';

/**
 * Why a raw button is held back, in the shared {@link Tooltip} (LAI-1213) —
 * the `Button disabledReason` rule for the small inline buttons that are not
 * `Button`s (a tag's *Add*, a dependency's *Link*, a date's *Save*).
 *
 * With a `reason`, the button it wraps must be `aria-disabled` — not
 * `disabled` — and ignore its click: a natively disabled button takes no
 * focus and no hover, so its reason could never be shown to a keyboard or a
 * pointer. Without one the tooltip has no words and never shows: a button
 * that is only busy says so with its spinner, and waiting resolves it. The
 * Tooltip is always there, so the button is not remounted — and does not lose
 * focus — when its reason comes or goes.
 */
export function DisabledReason({
  reason,
  children,
}: {
  readonly reason: string | undefined;
  readonly children: TooltipProps['children'];
}): ReactElement {
  return (
    <Tooltip content={reason ?? ''} lazy>
      {children}
    </Tooltip>
  );
}
