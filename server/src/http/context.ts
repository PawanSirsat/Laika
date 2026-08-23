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
  };
}
