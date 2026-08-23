import { type Logger } from '../log.ts';

/**
 * The typed Hono environment every handler and middleware shares.
 *
 * `actor` is deliberately absent: LAI-005 introduces it along with the `Actor`
 * type itself. Declaring a placeholder shape here would mean LAI-004 and LAI-005
 * inherit a guess instead of designing it.
 */
export interface AppEnv {
  Variables: {
    requestId: string;
    log: Logger;
  };
}
