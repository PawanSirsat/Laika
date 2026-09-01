/**
 * What went wrong, and what to do about it (LAI-422 AC6).
 *
 * **Four distinct failures, four distinct messages.** Collapsing them is a
 * defect this codebase has shipped twice already: LAI-224 rendered a `403` on
 * the event stream as "can't reach the instance", and LAI-090 answered a
 * rate-limited sign-in with "email or password is wrong". Both told the reader
 * to do something that could not have helped.
 *
 * Every message here names **a next action**, not a diagnosis. "Board
 * unreachable" is a diagnosis; "check the URL, or that the instance is running"
 * is a next action.
 */

export type FailureKind =
  /** The URL is not a URL, or names nothing that answers. */
  | 'unreachable'
  /** Something answered, but it is not a Laika instance. */
  | 'not_laika'
  /** The instance is there and said no to these credentials. */
  | 'refused'
  /** Signed in, but this account may not mint a token. */
  | 'forbidden'
  /** Signed in, minted nothing, because the instance refused for another reason. */
  | 'mint_failed';

export interface Failure {
  readonly kind: FailureKind;
  /** What to print. Ends without a full stop only when it ends in a command. */
  readonly message: string;
}

export function failure(kind: FailureKind, detail?: string): Failure {
  return { kind, message: describe(kind, detail) };
}

function describe(kind: FailureKind, detail?: string): string {
  switch (kind) {
    case 'unreachable':
      return [
        `Could not reach that board${detail === undefined ? '' : ` (${detail})`}.`,
        '',
        'Check the URL, and that the instance is running. If it is on your own',
        'machine it usually looks like http://localhost:3000 — include the scheme.',
      ].join('\n');

    case 'not_laika':
      return [
        'Something answered at that address, but it is not a Laika board.',
        '',
        'A proxy or a different app on the same port will do this. Open the URL',
        'in a browser: a Laika instance answers /api/v1/health with JSON.',
      ].join('\n');

    case 'refused':
      return [
        'That email and password were refused.',
        '',
        'Check them, and note that Laika is invite-only — if you have never',
        'signed in on the web, ask an owner or admin for an invite first.',
      ].join('\n');

    case 'forbidden':
      return [
        'You are signed in, but this account may not create a token.',
        '',
        'Ask an owner or admin. Tokens carry your own permissions, so an',
        'account that cannot act on the board cannot mint one either.',
      ].join('\n');

    case 'mint_failed':
      return [
        `The board refused to create the token${detail === undefined ? '' : `: ${detail}`}.`,
        '',
        'Nothing was written and nothing was changed. Running init again is safe.',
      ].join('\n');
  }
}

/**
 * Turn an HTTP status from the sign-in or mint call into a failure.
 *
 * **`401` and `403` are deliberately different.** One is "these credentials are
 * wrong", the other is "these credentials are fine and this account may not do
 * that" — and telling someone to check their password when their role is the
 * problem sends them somewhere that cannot help. That is exactly LAI-090.
 */
export function failureForStatus(status: number, detail?: string): Failure {
  if (status === 401) return failure('refused', detail);
  if (status === 403) return failure('forbidden', detail);
  return failure('mint_failed', detail ?? `HTTP ${String(status)}`);
}
