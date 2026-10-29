import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listTaskCheckpoints,
  listTaskHandoffOffers,
  type Checkpoint,
  type HandoffOffer,
} from './handoffs.ts';

export interface TaskHandoffs {
  /** `ready` once both lists have answered; a failure keeps what was shown. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly checkpoints: readonly Checkpoint[];
  readonly offers: readonly HandoffOffer[];
  /** Re-read both, **quietly**: what is on screen stays until the answer lands. */
  readonly refresh: () => void;
  /** Put the server's answer to a write in place at once, before the re-read. */
  readonly replaceOffer: (offer: HandoffOffer) => void;
}

const EMPTY: Pick<TaskHandoffs, 'checkpoints' | 'offers'> = { checkpoints: [], offers: [] };

/**
 * A task's checkpoints and hand-off offers, for the drawer (LAI-549).
 *
 * Read only while `enabled` — a task that has never been claimed has neither,
 * and asking would cost every drawer two requests for nothing. A re-read never
 * blanks the panel: a live frame changes a line in place, so the reader's
 * place and focus stay where they were.
 */
export function useTaskHandoffs(
  taskId: string,
  enabled: boolean,
  /**
   * Re-read every `pollMs` while set — a save waiting for its push notice, so
   * the server's `pending_notice` and `verified` reach a drawer nobody
   * touches. Skipped while the page is hidden; quiet, so nothing moves.
   */
  pollMs?: number,
): TaskHandoffs {
  const [state, setState] = useState<{
    status: TaskHandoffs['status'];
    checkpoints: readonly Checkpoint[];
    offers: readonly HandoffOffer[];
  }>({ status: 'idle', ...EMPTY });
  const [attempt, setAttempt] = useState(0);
  const shownFor = useRef(taskId);

  useEffect(() => {
    if (!enabled) return;
    if (shownFor.current !== taskId) {
      shownFor.current = taskId;
      setState({ status: 'loading', ...EMPTY });
    } else {
      setState((s) => (s.status === 'idle' ? { ...s, status: 'loading' } : s));
    }
    const controller = new AbortController();
    Promise.all([
      listTaskCheckpoints(taskId, controller.signal),
      listTaskHandoffOffers(taskId, controller.signal),
    ])
      .then(([checkpoints, offers]) => {
        setState({ status: 'ready', checkpoints: checkpoints.data, offers: offers.data });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Keep whatever was drawn: a failed re-read is not news about the task.
        // A first read that failed is `error`, never an empty `ready` — the
        // drawer must not read it as "no saves" (LAI-549 review).
        setState((s) => (s.status === 'ready' ? s : { status: 'error', ...EMPTY }));
      });
    return () => {
      controller.abort();
    };
  }, [taskId, enabled, attempt]);

  const refresh = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || pollMs === undefined) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
    }, pollMs);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, pollMs]);
  const replaceOffer = useCallback((offer: HandoffOffer) => {
    setState((s) => ({
      ...s,
      offers: s.offers.some((o) => o.id === offer.id)
        ? s.offers.map((o) => (o.id === offer.id ? offer : o))
        : [offer, ...s.offers],
    }));
  }, []);

  return { ...state, refresh, replaceOffer };
}
