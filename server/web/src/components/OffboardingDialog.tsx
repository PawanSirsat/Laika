import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown } from './Dropdown.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { useDialogFocus } from './use-dialog-focus.ts';
import {
  heldSummary,
  openTasksHeld,
  reassignRefusal,
  type OpenTasksChoice,
  type OpenTasksHeld,
} from '../api/offboarding.ts';
import './offboarding-dialog.css';

/** Somebody the leaving person's tasks could go to. */
export interface ReassignCandidate {
  readonly id: string;
  readonly name: string;
}

export interface OffboardingDialogProps {
  /** `Deactivate Bea Builder?`, `Remove Bea Builder from Laika Core?` */
  readonly title: string;
  /** What the change does beyond their tasks — tokens, sessions, spaces. */
  readonly consequences: ReactNode;
  /** The confirm button's verb: `Deactivate`, `Remove`. */
  readonly verb: string;
  /** The person leaving, never offered as the one to reassign to. */
  readonly leavingId: string;
  /**
   * Who their tasks may go to, read when the server says there are tasks to
   * place. The server is still the judge (`cannot_hold`); this only keeps the
   * list to plausible names.
   */
  readonly loadCandidates: () => Promise<readonly ReassignCandidate[]>;
  /**
   * The change itself. `undefined` the first time, so a person with no open
   * work is not asked about any; the server's `409 open_tasks` turns the
   * dialog into the question, and the answer is sent the second time.
   * **Rejects** with the server's refusal, which the dialog reads.
   */
  readonly run: (openTasks: OpenTasksChoice | undefined) => Promise<void>;
  readonly onDone: () => void;
  readonly onClose: () => void;
  readonly restoreFocus?: (() => HTMLElement | null | undefined) | undefined;
}

type Candidates =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly people: readonly ReassignCandidate[] }
  | { readonly kind: 'error' };

/**
 * Offboarding asks (D-104 item 5, LAI-986/988): **one dialog** for deactivating
 * a person and for removing them from a space, so the two cannot ask the
 * question differently.
 *
 * It asks only what the server says needs asking. The first confirm sends no
 * choice; somebody holding no open tasks is simply removed. Somebody holding
 * some is refused `409 open_tasks` with the count and the keys the caller may
 * read, and the dialog shows them with **Unassign** pre-selected and
 * **Reassign to** a named person beside it. A refused reassignment (`422`:
 * the leaving person, an inactive one, one who cannot hold a task) is said in
 * the dialog, which stays open with the choice still in it.
 */
export function OffboardingDialog({
  title,
  consequences,
  verb,
  leavingId,
  loadCandidates,
  run,
  onDone,
  onClose,
  restoreFocus,
}: OffboardingDialogProps) {
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<OpenTasksHeld | undefined>(undefined);
  const [mode, setMode] = useState<'unassign' | 'reassign'>('unassign');
  const [reassignTo, setReassignTo] = useState('');
  const [candidates, setCandidates] = useState<Candidates>({ kind: 'idle' });
  const [error, setError] = useState<string | undefined>(undefined);
  const box = useRef<HTMLFormElement>(null);
  const latestLoad = useRef(loadCandidates);
  latestLoad.current = loadCandidates;

  useDialogFocus(box, { restore: restoreFocus });

  const close = (): void => {
    // A change in flight is not abandoned by closing: its answer decides.
    if (!busy) onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, busy]);

  // The people to reassign to are read once there is something to reassign.
  useEffect(() => {
    if (held === undefined || candidates.kind !== 'idle') return;
    setCandidates({ kind: 'loading' });
    latestLoad.current().then(
      (people) => {
        setCandidates({ kind: 'ready', people: people.filter((p) => p.id !== leavingId) });
      },
      () => {
        setCandidates({ kind: 'error' });
      },
    );
  }, [held, candidates.kind, leavingId]);

  const choice: OpenTasksChoice | undefined =
    held === undefined
      ? undefined
      : mode === 'unassign'
        ? 'unassign'
        : reassignTo === ''
          ? undefined
          : { reassign_to: reassignTo };
  const ready = held === undefined || choice !== undefined;

  const submit = (): void => {
    if (busy || !ready) return;
    setBusy(true);
    setError(undefined);
    run(choice).then(
      () => {
        setBusy(false);
        onDone();
      },
      (cause: unknown) => {
        setBusy(false);
        const asked = openTasksHeld(cause);
        if (asked !== undefined) {
          setHeld(asked);
          return;
        }
        setError(
          reassignRefusal(cause) ?? (cause instanceof Error ? cause.message : 'Nothing changed.'),
        );
      },
    );
  };

  const confirmLabel =
    held === undefined
      ? verb
      : mode === 'unassign'
        ? `${verb} and unassign`
        : `${verb} and reassign`;

  return createPortal(
    <>
      <div className="offb-scrim" aria-hidden="true" onClick={close} />
      <form
        ref={box}
        className="offb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offb-title"
        aria-describedby="offb-about"
        data-offboarding={held === undefined ? 'confirm' : 'open-tasks'}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header className="offb-head">
          <h2 className="offb-title" id="offb-title">
            {title}
          </h2>
          <button
            type="button"
            className="offb-close"
            onClick={close}
            disabled={busy}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="offb-about" id="offb-about">
          {consequences}
        </div>

        {held !== undefined && (
          <fieldset className="offb-tasks" data-open-tasks={held.count}>
            <legend className="offb-label">Their open tasks</legend>
            <p className="offb-held" data-held>
              They hold {heldSummary(held)}.
            </p>
            <label className="offb-option">
              <input
                type="radio"
                name="offb-mode"
                value="unassign"
                checked={mode === 'unassign'}
                onChange={() => {
                  setMode('unassign');
                }}
              />
              <span>
                <b>Unassign them</b>
                <span className="offb-hint">They stay where they are, with nobody on them.</span>
              </span>
            </label>
            <label className="offb-option">
              <input
                type="radio"
                name="offb-mode"
                value="reassign"
                checked={mode === 'reassign'}
                onChange={() => {
                  setMode('reassign');
                }}
              />
              <span>
                <b>Reassign them to</b>
                <span className="offb-hint">One person takes every one of them.</span>
              </span>
            </label>
            {mode === 'reassign' && (
              <div className="offb-picker">
                {candidates.kind === 'ready' ? (
                  candidates.people.length === 0 ? (
                    <p className="offb-hint">Nobody else could take them. Unassign instead.</p>
                  ) : (
                    <Dropdown
                      aria-label="Reassign to"
                      noun="people"
                      searchable
                      placeholder="Choose a person"
                      value={reassignTo}
                      disabled={busy}
                      onChange={(value) => {
                        setReassignTo(value);
                        setError(undefined);
                      }}
                      options={candidates.people.map((p) => ({ value: p.id, label: p.name }))}
                    />
                  )
                ) : candidates.kind === 'error' ? (
                  <p className="offb-hint">Could not read who could take them. Unassign instead.</p>
                ) : (
                  <p className="offb-hint" role="status">
                    <Spinner size="sm" /> Reading who could take them…
                  </p>
                )}
              </div>
            )}
          </fieldset>
        )}

        {error !== undefined && (
          <p className="offb-error" role="alert">
            {error}
          </p>
        )}

        <footer className="offb-actions">
          <button type="button" className="offb-cancel" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="offb-confirm"
            data-action="offboard-confirm"
            disabled={busy || !ready}
          >
            {busy && <Spinner size="sm" />}
            {confirmLabel}
          </button>
        </footer>
      </form>
    </>,
    document.body,
  );
}
