import { useCallback, useEffect, useState } from 'react';
import { getSetupStatus, type SetupSystemStatus } from './setup.ts';

export interface UseSetupStatus {
  /** `undefined` while the first check is in flight. */
  readonly setupRequired: boolean | undefined;
  /**
   * What the instance reports about itself (§6.4, LAI-206) — `undefined` until
   * the response lands, and **after a failed check too**.
   *
   * The same request already carried this and nothing read it. LAI-158 renders
   * it; the panel is absent rather than guessed while this is `undefined`,
   * because a status panel is read precisely when somebody is trying to find out
   * whether something is wrong.
   */
  readonly system: SetupSystemStatus | undefined;
  /**
   * Setup just succeeded — flip the flag **synchronously**.
   *
   * Not `recheck()`: a re-fetch is asynchronous, so for a frame or two the flag
   * is still `true` and the redirect effect bounces the newly-minted Owner
   * straight back to `/setup`. A `201` is definitive; there is nothing to ask.
   */
  readonly markComplete: () => void;
  /** Re-read from the server — for a `409`, where another tab got there first. */
  readonly recheck: () => void;
}

/**
 * Does this instance still need an owner?
 *
 * Read once on boot. The server's `setup-gate` is authoritative — it answers
 * `conflict` to every API call and redirects browsers — so this only decides
 * what the SPA renders while that is true.
 *
 * A failed check resolves to `false` rather than blocking: if the instance is
 * unreachable the session probe will say so in its own error state, and two
 * components reporting the same outage is noise.
 */
export function useSetupStatus(): UseSetupStatus {
  const [setupRequired, setSetupRequired] = useState<boolean | undefined>(undefined);
  const [system, setSystem] = useState<SetupSystemStatus | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    getSetupStatus(controller.signal)
      .then((status) => {
        setSetupRequired(status.setup_required);
        setSystem(status.system);
      })
      .catch(() => {
        setSetupRequired(false);
      });

    return () => {
      controller.abort();
    };
  }, [attempt]);

  const markComplete = useCallback((): void => {
    setSetupRequired(false);
  }, []);

  const recheck = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  return { setupRequired, system, markComplete, recheck };
}
