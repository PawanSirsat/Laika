import { EXECUTION_STATE_WORDS, type ExecutionState } from './agent-states.ts';
import './agent.css';

export interface ExecutionStateLineProps {
  readonly state: ExecutionState;
  /** A short fact after the label: "since 14:02", "to Codex · desktop-2". */
  readonly detail?: string | undefined;
  /** `card` is one quiet line; `panel` adds what the state means underneath. */
  readonly variant?: 'card' | 'panel';
  /**
   * A card line that carries its meaning without drawing it (LAI-1006): the
   * `title` on hover, and the words for a reader the card's open button
   * points at with `aria-describedby` — so focus reaches it too.
   */
  readonly hint?:
    | {
        readonly id: string;
        readonly className?: string;
        /**
         * A pointer on the line does what the card's open control does
         * (LAI-1006 review): lifted for its hover title, the line sits over
         * that control and would otherwise swallow the click. Keyboard users
         * reach the control itself; this is the pointer's path only.
         */
        readonly onActivate?: () => void;
      }
    | undefined;
}

/**
 * One execution state, in words, with a shape beside it (LAI-536).
 *
 * **The words carry it; the icon only helps.** Each state has its own shape —
 * hourglass, person-check, play, broken link, rotate, warning, clock — and no
 * state is told apart by colour, so the line reads the same in either theme,
 * in greyscale, and to a screen reader.
 */
export function ExecutionStateLine({
  state,
  detail,
  variant = 'card',
  hint,
}: ExecutionStateLineProps) {
  const words = EXECUTION_STATE_WORDS[state];
  const extra = hint?.className === undefined ? '' : ` ${hint.className}`;
  return (
    <p
      className={`exec-state exec-state-${variant}${extra}`}
      data-exec-state={state}
      id={hint?.id}
      title={hint === undefined ? undefined : words.meaning}
      onClick={hint?.onActivate}
      // The drawer's line can change while it is open — Working to Connection
      // lost on the reader's clock (LAI-597). A status is read out without
      // taking the focus from whatever the reader is doing.
      role={variant === 'panel' ? 'status' : undefined}
    >
      <StateShape state={state} />
      <span className="exec-state-text">
        <b className="exec-state-label">{words.label}</b>
        {detail !== undefined && <span className="exec-state-detail"> · {detail}</span>}
        {variant === 'panel' && <span className="exec-state-meaning">{words.meaning}</span>}
        {variant === 'card' && hint !== undefined && (
          <span className="visually-hidden">. {words.meaning}</span>
        )}
      </span>
    </p>
  );
}

const PATHS: Readonly<Record<ExecutionState, readonly string[]>> = {
  // Hourglass.
  waiting_for_agent: ['M7 3h10M7 21h10', 'M8 3c0 5 8 5 8 9s-8 4-8 9', 'M16 3c0 5-8 5-8 9s8 4 8 9'],
  // A person with a tick.
  waiting_for_approval: [
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    'M3 21a6 6 0 0 1 12 0',
    'm16 11 2 2 4-4',
  ],
  // Play.
  working: ['M7 4v16l13-8z'],
  // A broken link.
  connection_lost: [
    'M9 15 7.5 16.5a3.5 3.5 0 0 1-5-5L4 10',
    'm15 9 1.5-1.5a3.5 3.5 0 0 1 5 5L20 14',
    'M8 2v3M2 8h3M16 22v-3M22 16h-3',
  ],
  // Rotate back.
  recovery_available: ['M3 12a9 9 0 1 0 3-6.7', 'M3 3v6h6'],
  // Warning triangle.
  save_needs_attention: ['M12 3 2 21h20z', 'M12 10v5', 'M12 18h.01'],
  // Clock.
  verification_pending: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M12 7v5l3 2'],
};

function StateShape({ state }: { readonly state: ExecutionState }) {
  return (
    <svg
      className="exec-state-icon"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-shape={state}
    >
      {PATHS[state].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
