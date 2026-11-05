import { useEffect, useState } from 'react';
import {
  getMyAvailability,
  getPersonLoad,
  listPeopleAvailability,
  type AvailabilitySeen,
  type PersonLoad,
} from '../../../api/availability.ts';

/**
 * What a profile shows of someone's availability (D-131, D-137; LAI-1139),
 * read the one way this reader may:
 *
 * - **yourself** — `GET /me/availability`, your whole record;
 * - **an owner, or *See everyone's analytics*** — `GET /people/:id/load`,
 *   which carries the whole record beside the load facts and **logs the
 *   look**. So it is read **only when the reader asks** — *Show current
 *   load* — never on opening the profile or any of its tabs, the way
 *   LAI-1138 kept *Time this week* a link (D-102, D-135). Until then there is
 *   no pill in the header either: the pill comes from the same read;
 * - **anyone else** — their row of `GET /people/availability`, narrowed by the
 *   server to what a co-worker or a space admin may see. Asked only of a reader
 *   that list never logs, so opening one profile never records a look at
 *   everybody on it.
 *
 * A person who shares no space with the reader has no row: no pill.
 */

export type ProfileAvailabilityMode = 'self' | 'load' | 'shared';

export interface ModeInput {
  /** `?user=`; undefined before the address names anyone. */
  readonly userId: string | undefined;
  /** The signed-in person; undefined until `/me` answers. */
  readonly meId: string | undefined;
  /** `profile.read`: without it the page is a permission notice and asks nothing. */
  readonly allowed: boolean;
  /** Whether the server has answered what the reader may do. */
  readonly settled: boolean;
  /** *See everyone's analytics* (`people.analytics.read`). */
  readonly readsAnalytics: boolean;
}

/**
 * Which read this reader makes, or `undefined` for none yet. **Nothing before
 * the server has said what the reader may do**: guessing `load` would log a
 * look the reader may not be entitled to, and guessing `shared` would ask a
 * list an owner's read would log for everyone on it.
 */
export function profileAvailabilityMode(input: ModeInput): ProfileAvailabilityMode | undefined {
  if (input.userId === undefined || input.meId === undefined || !input.allowed) return undefined;
  if (input.meId === input.userId) return 'self';
  if (!input.settled) return undefined;
  return input.readsAnalytics ? 'load' : 'shared';
}

export type LoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly load: PersonLoad };

export interface ProfileAvailability {
  /** What to draw in the header; `undefined` until asked or when there is nothing. */
  readonly seen: AvailabilitySeen | null | undefined;
  /** The Current load read, for `load` mode only; `idle` until {@link reveal}. */
  readonly load: LoadState;
  /** Read the load now — the look the reader chose to make. */
  readonly reveal: () => void;
  readonly reload: () => void;
}

export function useProfileAvailability(
  userId: string,
  mode: ProfileAvailabilityMode | undefined,
): ProfileAvailability {
  const [seen, setSeen] = useState<AvailabilitySeen | null | undefined>(undefined);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [asked, setAsked] = useState(0);
  // Whose load the reader asked to see: moving to another person closes it.
  const [revealedFor, setRevealedFor] = useState<string | undefined>(undefined);
  const revealed = revealedFor === userId;
  // Another person closes it, and coming back finds it closed (review N1):
  // A → Show → B → A is a collapsed card and no second look at A.
  useEffect(() => {
    setRevealedFor((was) => (was === userId ? was : undefined));
  }, [userId]);

  useEffect(() => {
    setSeen(undefined);
    setLoad({ status: mode === 'load' && revealed ? 'loading' : 'idle' });
    if (mode === undefined || (mode === 'load' && !revealed)) return;
    const controller = new AbortController();
    const live = (): boolean => !controller.signal.aborted;
    if (mode === 'self') {
      getMyAvailability(controller.signal)
        .then((a) => {
          if (live()) setSeen(a);
        })
        .catch(() => undefined);
    } else if (mode === 'load') {
      getPersonLoad(userId, controller.signal)
        .then((l) => {
          if (!live()) return;
          setSeen(l.availability);
          setLoad({ status: 'ready', load: l });
        })
        .catch((error: unknown) => {
          if (live()) setLoad({ status: 'error', error });
        });
    } else {
      listPeopleAvailability({}, controller.signal)
        .then((list) => {
          if (live()) setSeen(list.data.find((r) => r.user.id === userId)?.availability ?? null);
        })
        .catch(() => undefined);
    }
    return () => {
      controller.abort();
    };
  }, [userId, mode, asked, revealed]);

  return {
    seen,
    load,
    reveal: () => {
      setRevealedFor(userId);
    },
    reload: () => {
      setAsked((n) => n + 1);
    },
  };
}
