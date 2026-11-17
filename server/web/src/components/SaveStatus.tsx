import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE, failedWith, saveLine, type SaveState } from './save-status-model.ts';
import './save-status.css';

export interface UseSaveStatus {
  readonly state: SaveState;
  /**
   * Run one save: *Saving…* now, *Saved* on the server's answer, *Couldn't
   * save* on a refusal — which is rethrown, so the screen can still put a
   * field's error under the field. A later run wins over an earlier one.
   */
  readonly run: <T>(save: () => Promise<T>) => Promise<T>;
  /** The last save again, as it was sent. */
  readonly retry: () => void;
  /** Back to saying nothing — an edit after *Saved* makes it stale. */
  readonly reset: () => void;
}

/** The state behind a {@link SaveStatus}: one per form, or per auto-saving card. */
export function useSaveStatus(): UseSaveStatus {
  const [state, setState] = useState<SaveState>(IDLE);
  const last = useRef<(() => Promise<unknown>) | undefined>(undefined);
  const seq = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(<T,>(save: () => Promise<T>): Promise<T> => {
    seq.current += 1;
    const mine = seq.current;
    last.current = save;
    setState({ kind: 'saving' });
    const current = (): boolean => alive.current && seq.current === mine;
    return save().then(
      (result) => {
        if (current()) setState({ kind: 'saved' });
        return result;
      },
      (cause: unknown) => {
        if (current()) setState(failedWith(cause));
        throw cause;
      },
    );
  }, []);

  const retry = useCallback((): void => {
    const again = last.current;
    if (again === undefined) return;
    run(again).catch(() => {
      // Said by the status itself; the screen's own handler ran the first time.
    });
  }, [run]);

  const reset = useCallback((): void => {
    seq.current += 1;
    setState(IDLE);
  }, []);

  return { state, run, retry, reset };
}

export interface SaveStatusProps {
  readonly state: SaveState;
  /** Offered beside *Couldn't save* when the failure is worth trying again. */
  readonly onRetry?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * *Saving… / Saved / Couldn't save — Retry* beside a form's Save or an
 * auto-saving control (LAI-1129, B11). The sentence sits in a polite live
 * region that is always mounted, so each change is heard without taking
 * focus; Retry is a real button outside it, so it is not read out as part of
 * the sentence.
 */
export function SaveStatus({ state, onRetry, className }: SaveStatusProps) {
  const line = saveLine(state);
  return (
    <span
      className={className === undefined ? 'save-status' : `save-status ${className}`}
      data-save-status={state.kind}
    >
      <span className="save-status-line" role="status" aria-live="polite" aria-atomic="true">
        {state.kind === 'saved' && (
          <span className="save-status-tick" aria-hidden="true">
            ✓{' '}
          </span>
        )}
        {line}
        {state.kind === 'failed' && onRetry !== undefined && state.retryable && ' —'}
      </span>
      {state.kind === 'failed' && onRetry !== undefined && state.retryable && (
        <button
          type="button"
          className="save-status-retry"
          data-save-retry
          title={state.message}
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </span>
  );
}
