/**
 * What a save is doing, as one value (LAI-1129): the words `SaveStatus`
 * shows and announces, and whether Retry is worth offering. Pure, so the
 * transitions are tested without a renderer (CONVENTIONS §4).
 *
 * The contract (`docs/ux/design-system/interaction-contracts.md` §1 state 4,
 * *Forms and inline edit*): **"Saved" only on the server's 2xx**, never
 * optimistically; a failure says so beside the control and offers Retry
 * when trying again could go differently — a dropped connection, or what
 * `ApiError.retryable` already says is worth retrying (`internal`,
 * `rate_limited`). A refusal of the values or of the person is said where it
 * applies, and sending the same thing again would only be refused again, so
 * it gets no Retry.
 */

import { ApiError } from '../api/errors.ts';

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly message: string; readonly retryable: boolean };

export const IDLE: SaveState = { kind: 'idle' };

/** The sentence for a state; empty while idle, so the live region says nothing. */
export function saveLine(state: SaveState): string {
  switch (state.kind) {
    case 'idle':
      return '';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'failed':
      return 'Couldn’t save';
  }
}

/** A failure's state, and whether the same request again could succeed. */
export function failedWith(cause: unknown): SaveState {
  const message =
    cause instanceof Error && cause.message !== '' ? cause.message : 'The change was not saved';
  // Anything that is not the server's answer — the network, an abort — may
  // well go through a second time.
  const retryable = cause instanceof ApiError ? cause.retryable : true;
  return { kind: 'failed', message, retryable };
}
