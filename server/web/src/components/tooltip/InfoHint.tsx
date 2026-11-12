import { Icon } from '../icon/Icon.tsx';
import { Tooltip } from './Tooltip.tsx';
import './info-hint.css';

export interface InfoHintProps {
  /** The button's name: what it explains — *"About Agent"*, not *"Info"*. */
  readonly label: string;
  /**
   * The explanation: a sentence or two of **secondary** help. Never the only
   * copy of something a person must know to use the field safely — that stays
   * on screen; this is the *why*, the difference, the detail.
   */
  readonly children: string;
  /** Above by default, so it does not cover the control under the label it sits in. */
  readonly side?: 'top' | 'bottom';
}

/**
 * An (i) beside a label (LAI-1209): secondary help moved off the screen until
 * it is asked for, so a form shows its fields and not its footnotes.
 *
 * It is the shared {@link Tooltip} in `toggle` mode around a real button:
 *
 * - hover or keyboard focus shows the words, as any tooltip;
 * - **a tap or a click keeps them** until Escape, a press elsewhere, or focus
 *   leaving — the touch screen's way to ask, and the reader's way to keep it
 *   while reading;
 * - the words are the button's `aria-describedby`, so a screen reader hears
 *   *"About Agent, button, A coding agent you ask to …"* on reaching it;
 * - Escape closes the hint and not the dialog around it.
 *
 * Small on screen and at least 44px under a finger (`info-hint.css`).
 */
export function InfoHint({ label, children, side = 'top' }: InfoHintProps) {
  return (
    <Tooltip content={children} tone="hint" toggle side={side}>
      <button type="button" className="info-hint" aria-label={label} data-info-hint="">
        <Icon name="info" size="tiny" />
      </button>
    </Tooltip>
  );
}
