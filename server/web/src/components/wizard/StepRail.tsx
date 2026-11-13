import { Icon } from '../icon/Icon.tsx';
import { DisabledReason } from '../tooltip/DisabledReason.tsx';

/*
 * Styled by `routes/screens/connect/connect.css` — see the note at the top of
 * `CodeBlock.tsx` (LAI-1044).
 */

export interface RailStep {
  /** The step's number, from 1. */
  readonly n: number;
  readonly name: string;
  /** The line under the name: what has been chosen or done so far. */
  readonly sub: string;
  readonly done: boolean;
  /** A locked step cannot be opened yet; `lockedReason` says why. */
  readonly open: boolean;
  readonly lockedReason?: string | undefined;
}

export interface StepRailProps {
  /** The rail's landmark name, such as *Setup steps*. */
  readonly label: string;
  readonly intro: string;
  readonly steps: readonly RailStep[];
  /** The step on show. */
  readonly current: number;
  readonly onSelect: (n: number) => void;
}

/**
 * A wizard's rail: every step, its state and its summary, each a button that
 * opens it once it is open (LAI-740). The current step is `aria-current`, a
 * finished one shows a tick in place of its number, and the state is also in
 * the words of `sub` — the tick is decoration.
 */
export function StepRail({ label, intro, steps, current, onSelect }: StepRailProps) {
  return (
    <nav className="conn-rail" aria-label={label}>
      <p className="conn-rail-intro">{intro}</p>
      <ol className="conn-steps">
        {steps.map((s) => {
          const here = s.n === current;
          const state = here ? 'current' : s.done ? 'done' : 'todo';
          return (
            <li key={s.n} className="conn-step" data-state={state} data-locked={!s.open}>
              {/* A locked step with a reason stays focusable and says why in
                  the shared Tooltip (LAI-1214) — a title= on a disabled button
                  reached neither a keyboard nor a touch screen. */}
              <DisabledReason reason={s.open ? undefined : s.lockedReason}>
                <button
                  type="button"
                  className="conn-rail-step"
                  disabled={!s.open && s.lockedReason === undefined}
                  aria-disabled={(!s.open && s.lockedReason !== undefined) || undefined}
                  {...(here ? { 'aria-current': 'step' as const } : {})}
                  onClick={() => {
                    if (s.open) onSelect(s.n);
                  }}
                >
                  <span className="conn-step-n" aria-hidden="true">
                    {s.done ? <Icon name="check" size="small" /> : s.n}
                  </span>
                  <span className="conn-rail-text">
                    <span className="conn-rail-name">
                      <span className="visually-hidden">Step {s.n}: </span>
                      {s.name}
                    </span>
                    <span className="conn-rail-sub">{s.sub}</span>
                  </span>
                </button>
              </DisabledReason>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
