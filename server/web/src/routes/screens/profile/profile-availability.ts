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
 *   look**, once, for the header and the Current load card together;
 * - **anyone else** — their row of `GET /people/availability`, narrowed by the
 *   server to what a co-worker or a space admin may see. Asked only of a reader
 *   that list never logs, so opening one profile never records a look at
 *   everybody on it.
 *
 * A person who shares no space with the reader has no row: no pill.
 */

export type ProfileAvailabilityMode = 'self' | 'load' | 'shared';

export type LoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly load: PersonLoad };

export interface ProfileAvailability {
  /** What to draw in the header; `undefined` until asked or when there is nothing. */
  readonly seen: AvailabilitySeen | null | undefined;
  /** The Current load read, for `load` mode only. */
  readonly load: LoadState;
  readonly reload: () => void;
}

export function useProfileAvailability(
  userId: string,
  mode: ProfileAvailabilityMode | undefined,
): ProfileAvailability {
  const [seen, setSeen] = useState<AvailabilitySeen | null | undefined>(undefined);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    setSeen(undefined);
    setLoad({ status: mode === 'load' ? 'loading' : 'idle' });
    if (mode === undefined) return;
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
  }, [userId, mode, asked]);

  return {
    seen,
    load,
    reload: () => {
      setAsked((n) => n + 1);
    },
  };
}
