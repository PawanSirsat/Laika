import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Logger } from '../log.ts';

/**
 * The typed Hono environment every handler and middleware shares.
 *
 * `actor` is `null` for anonymous requests rather than absent — a handler that
 * forgets to check gets a value it cannot accidentally treat as authorised
 * (SPEC §6.1).
 */
export interface AppEnv {
  Variables: {
    requestId: string;
    log: Logger;
    actor: ResolvedActor | null;
    /**
     * Set by a route whose answer reveals a secret once — a token, an invite
     * or reset link, a webhook secret (LAI-534). The idempotency store never
     * keeps such an answer, so the secret is not persisted and cannot be
     * replayed (`markOneTimeSecret`).
     */
    oneTimeSecret: boolean;
  };
}
