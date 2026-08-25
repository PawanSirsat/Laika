import { useCallback, useEffect, useState } from 'react';
import { listAllUsers } from '../../../api/users.ts';
import { listInvites } from '../../../api/invites.ts';
import type { OrgUser } from '../../../api/users.ts';
import type { PendingInvite } from '../../../api/invites.ts';

export type OrganisationState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly people: readonly OrgUser[];
      /** Empty for anyone below `admin` — the endpoint refuses, and that is fine. */
      readonly invites: readonly PendingInvite[];
      /** True when the user walk hit its page cap, so the count is a floor. */
      readonly truncated: boolean;
      /** Set when invites could not be read for a reason other than permission. */
      readonly invitesError: unknown;
    };

export interface UseOrganisation {
  readonly state: OrganisationState;
  readonly reload: () => void;
}

/**
 * The org's people and its pending invites (LAI-086).
 *
 * **Two requests, and only one of them may fail the screen.** Everyone signed
 * in may read the member list (§3.1, *"View member list"* is all four roles);
 * only `admin+` may list invites. A Member opening this screen gets the
 * directory and no invites section, which is the correct screen for them — not
 * an error, and not an empty box implying there are none.
 */
export function useOrganisation(canManage: boolean): UseOrganisation {
  const [state, setState] = useState<OrganisationState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    // Not `Promise.all`: the invites half is allowed to fail without taking the
    // people list down with it.
    const people = listAllUsers(controller.signal);
    const invites = canManage
      ? listInvites(controller.signal).then(
          (page) => ({ rows: page.data, error: null as unknown }),
          (error: unknown) => ({ rows: [] as readonly PendingInvite[], error }),
        )
      : Promise.resolve({ rows: [] as readonly PendingInvite[], error: null });

    Promise.all([people, invites])
      .then(([directory, invited]) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'ready',
          people: directory.users,
          invites: invited.rows,
          truncated: directory.truncated,
          invitesError: invited.error,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error });
      });

    return () => {
      controller.abort();
    };
  }, [canManage, attempt]);

  return { state, reload };
}
