/**
 * What an action's toast says (LAI-1310), as pure decisions so `node --test`
 * can pin every branch: the success line, the error line and its detail, and
 * when nothing should be said at all. `use-action.ts` is the React half — it
 * awaits the call and hands these to `useToast().show`.
 *
 * The contract (`docs/ux/design-system/interaction-contracts.md`, Toasts, and
 * the LAI-1310 task file):
 *
 * - **Success names what happened**, in the caller's words; Undo only where
 *   the server can really reverse it (LAI-1129 rule 2), which the caller
 *   decides by passing one.
 * - **Errors persist** (the queue's rule, `toast-model.ts`) and carry **the
 *   server's own sentence** as the detail, so the person reads why, not just
 *   that it broke.
 * - **A 422 that names a field stays inline**: the field is where it can be
 *   fixed, so the toast only points there.
 * - **An abort is not a failure.** The screen cancelled its own request — a
 *   newer one replaced it, or the view went away — and nobody needs telling.
 */

import { ApiError, NetworkError } from '../../api/errors.ts';
import type { ToastAction, ToastInput, UndoAction } from './toast-model.ts';

/** The headline when the caller did not say what failed. */
export const DEFAULT_FAILURE = 'That didn’t work';

/** The headline for a refusal that names a field — the field says the rest. */
export const FIELD_FAILURE = 'Couldn’t save — see the highlighted field';

/**
 * The detail for a request that never reached the server. Not the server's
 * sentence — there is none — so this is the one place the client writes it.
 */
export const UNREACHABLE = 'Could not reach the instance.';

/** What a caller says about one action; `use-action.ts` adds the call itself. */
export interface ActionWords<T> {
  /**
   * The success line, or how to make it from the result. `null` says nothing
   * on success — for actions so frequent a toast each time would be noise
   * (marking a notice read); the call site says why in a comment.
   */
  readonly success: string | ((result: T) => string) | null;
  /** Takes the change back on the server; resolves to what to say after. */
  readonly undo?: ((result: T) => Promise<string>) | undefined;
  /** The error headline, e.g. *Couldn't sign out*; defaults to {@link DEFAULT_FAILURE}. */
  readonly failure?: string | undefined;
  /** A way on from the success toast — *Open*. */
  readonly action?: ToastAction | undefined;
  /** A `data-*` mark on the toast, for tests and screens that look for it. */
  readonly mark?: string | undefined;
}

/** The cancelled-request shapes `fetch` and `AbortController` produce. */
export function isAbort(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * A `422` whose details point at a field: zod's `issues` (each with a path,
 * `api/setup.ts`'s `fieldErrors`) or a service refusal's `details.field`
 * (`create-task-form.ts`'s `errorsByField`). Those are the two shapes the
 * server sends; anything else is the form's, not a field's.
 */
export function namesFields(cause: unknown): boolean {
  if (!(cause instanceof ApiError) || cause.code !== 'unprocessable') return false;
  const details = cause.details as { issues?: unknown; field?: unknown } | null;
  if (details === null || typeof details !== 'object') return false;
  if (Array.isArray(details.issues) && details.issues.length > 0) return true;
  return typeof details.field === 'string' && details.field !== '';
}

/**
 * The sentence under the headline: the server's when it answered, ours when
 * it could not be reached. An `Error` from elsewhere keeps its own message;
 * a thrown non-error has nothing worth reading, so it gets no detail.
 */
export function detailOf(cause: unknown): string | undefined {
  if (cause instanceof NetworkError) return UNREACHABLE;
  // `fetch` itself rejects with a TypeError when the network is down and the
  // call did not go through `api/client.ts`'s wrapper.
  if (cause instanceof TypeError && /fetch|network/i.test(cause.message)) return UNREACHABLE;
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return undefined;
}

/** The success toast for a result, or `null` when the caller asked for silence. */
export function successToast<T>(words: ActionWords<T>, result: T): ToastInput | null {
  if (words.success === null) return null;
  const text = typeof words.success === 'function' ? words.success(result) : words.success;
  const undo = words.undo;
  const bound: UndoAction | undefined = undo === undefined ? undefined : () => undo(result);
  return {
    text,
    tone: 'success',
    ...(bound === undefined ? {} : { undo: bound }),
    ...(words.action === undefined ? {} : { action: words.action }),
    ...(words.mark === undefined ? {} : { mark: words.mark }),
  };
}

/**
 * The error toast for a failure, or `null` for an abort. A field-naming 422
 * gets {@link FIELD_FAILURE} whatever the caller's headline, because the
 * remedy is the field, and the field's message is already under it.
 */
export function failureToast(words: ActionWords<never>, cause: unknown): ToastInput | null {
  if (isAbort(cause)) return null;
  if (namesFields(cause)) {
    return {
      text: FIELD_FAILURE,
      tone: 'error',
      ...(words.mark === undefined ? {} : { mark: words.mark }),
    };
  }
  const detail = detailOf(cause);
  return {
    text: words.failure ?? DEFAULT_FAILURE,
    tone: 'error',
    ...(detail === undefined ? {} : { detail }),
    ...(words.mark === undefined ? {} : { mark: words.mark }),
  };
}
