import { useCallback, useMemo } from 'react';
import { failureToast, successToast, type ActionWords } from './action-model.ts';
import { useToast } from './ToastProvider.tsx';

/** One explicit action: the call, and what to say about it either way. */
export interface ActionOptions<T> extends ActionWords<T> {
  /** The server call. Its rejection is caught here — see {@link UseAction.run}. */
  readonly do: () => Promise<T>;
  /**
   * The failure, for a caller that has more to do with it than the toast —
   * put a 422's field messages under their fields, roll back an optimistic
   * change. Called after the toast is shown, and never for an abort.
   */
  readonly onError?: ((cause: unknown) => void) | undefined;
}

export interface UseAction {
  /**
   * Run one action and say how it went (LAI-1310).
   *
   * **Never rejects.** It resolves to the call's result on success, and to
   * `undefined` on failure, after the error toast is up — so a call site is
   * `const made = await run({...}); if (made === undefined) return;` with no
   * `try`, and a forgotten `.catch` cannot leave a rejection unhandled. A
   * caller whose `do` itself resolves `undefined` (a `void` call) tells the
   * two apart through `onError`, which is the one place the error is handed
   * over.
   *
   * - Success: a success toast in the caller's words, with Undo or an action
   *   when given; none when `success` is `null`.
   * - Failure: a persistent error toast — `failure` (or *That didn't work*)
   *   with the server's sentence as its detail; a 422 that names a field says
   *   *Couldn't save — see the highlighted field* instead, and the field's
   *   own message is the caller's to place, through `onError`.
   * - An aborted request says nothing and still resolves `undefined`.
   */
  readonly run: <T>(opts: ActionOptions<T>) => Promise<T | undefined>;
}

/**
 * The one way an explicit action reports itself (LAI-1310): every button,
 * menu item, drag or confirm that changes something on the server ends in a
 * toast, through `useToast()` from `ToastProvider.tsx`. The words are decided
 * in `action-model.ts`, which is tested; this only awaits and shows.
 */
export function useAction(): UseAction {
  const toast = useToast();

  const run = useCallback(
    async <T>(opts: ActionOptions<T>): Promise<T | undefined> => {
      let result: T;
      try {
        result = await opts.do();
      } catch (cause: unknown) {
        const said = failureToast(opts, cause);
        if (said === null) return undefined;
        toast.show(said);
        opts.onError?.(cause);
        return undefined;
      }
      const said = successToast(opts, result);
      if (said !== null) toast.show(said);
      return result;
    },
    [toast],
  );

  return useMemo(() => ({ run }), [run]);
}
