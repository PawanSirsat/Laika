import type { ActionOptions, UseAction } from '../../../components/toast/use-action.ts';

/**
 * `useAction().run` for a control that **must see the failure itself**
 * (LAI-1310): an inline field or an editor whose own `onSave`/`onSubmit`
 * keeps the draft open and marks the field when the promise rejects.
 *
 * `run` never rejects — that is its point for a button — so this hands the
 * cause back by throwing it after the toast is up: the toast says what failed
 * with the server's sentence, and the field keeps its in-place error and the
 * text somebody typed. An abort throws too (the save did not happen), but
 * `run` showed nothing for it.
 */
export async function runOrThrow<T>(run: UseAction['run'], opts: ActionOptions<T>): Promise<T> {
  let failed = false;
  let cause: unknown;
  let result: T | undefined;
  await run({
    ...opts,
    do: async () => {
      try {
        result = await opts.do();
        return result;
      } catch (thrown: unknown) {
        failed = true;
        cause = thrown;
        throw thrown;
      }
    },
  });
  if (failed) throw cause;
  return result as T;
}
