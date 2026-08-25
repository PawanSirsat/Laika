import { useEffect, useState } from 'react';
import { ApiError } from './errors.ts';
import { previewInvite } from './invites.ts';
import type { InvitePreview } from './invites.ts';

export interface UseInvite {
  readonly invite: InvitePreview | undefined;
  readonly loading: boolean;
  /**
   * The token was refused, or there was no token at all.
   *
   * One flag, not a reason. The server answers a single status for unknown,
   * expired and already-spent (`services/invites.ts`), deliberately, so that
   * posting guesses cannot confirm a token exists. There is nothing more
   * specific to report and a screen must not invent it.
   */
  readonly refused: boolean;
  /** A failure that is **not** the token's fault — the instance is unreachable. */
  readonly error: unknown;
}

/**
 * Read the invite named by a token (LAI-077).
 *
 * Pre-auth by nature: the holder has no account, which is what they are here to
 * fix. Nothing about this hook may require a session.
 */
export function useInvite(token: string | undefined): UseInvite {
  const [invite, setInvite] = useState<InvitePreview | undefined>(undefined);
  const [loading, setLoading] = useState(token !== undefined);
  const [refused, setRefused] = useState(token === undefined);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    // No token is not a network failure — it is a link that was truncated or
    // typed by hand, and it lands on the same screen as a bad one.
    if (token === undefined || token === '') {
      setRefused(true);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setRefused(false);
    setError(null);

    previewInvite(token, controller.signal)
      .then((preview) => {
        setInvite(preview);
        setRefused(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;

        // `404` is the refusal. Anything else is the instance being unreachable
        // or broken, which is a different screen and a different remedy: one
        // says "ask for a new invite", the other says "try again later", and
        // showing the first for a 500 sends someone to bother a colleague about
        // a link that is fine.
        if (cause instanceof ApiError && cause.code === 'not_found') {
          setRefused(true);
        } else {
          setError(cause);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [token]);

  return { invite, loading, refused, error };
}
