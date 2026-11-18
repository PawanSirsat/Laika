import { useSyncExternalStore } from 'react';
import { getPresencePeople, type PresencePeopleView, type PresencePerson } from './presence.ts';
import {
  BROWSER_ENVIRONMENT,
  createPoller,
  type PolledState,
  type Poller,
  type PollerEnvironment,
} from './use-polled.ts';

/**
 * Who is online or away now, **read once for the whole page** (LAI-1348,
 * LAI-1349). The header's who's-here, the board's member faces and every
 * person picker that rings a face by its status subscribe here: one poll of
 * `GET /presence/people` every 30 s while the tab is visible, however many
 * of them are on screen, started by the first and stopped with the last.
 */

/** How often it asks, while the tab is visible. */
export const PRESENCE_PEOPLE_POLL_MS = 30_000;

/** Each person online or away, by user id; `undefined` until told, or while presence is off. */
export type PresenceStatuses = ReadonlyMap<string, PresencePerson['status']>;

export interface PresencePeopleStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => PolledState<PresencePeopleView>;
  /** The statuses of the current answer, the same map until the answer changes. */
  readonly statuses: () => PresenceStatuses | undefined;
}

const LOADING: PolledState<PresencePeopleView> = {
  status: 'loading',
  data: undefined,
  error: null,
  stale: false,
  readAt: null,
};

/** The store, with its read and its clock as arguments so a unit test can drive it. */
export function createPresencePeopleStore(
  fetcher: (signal: AbortSignal) => Promise<PresencePeopleView>,
  env: PollerEnvironment,
): PresencePeopleStore {
  let poller: Poller<PresencePeopleView> | undefined;
  // The last answer outlives the poller, so a remount does not flash empty.
  let last: PolledState<PresencePeopleView> = LOADING;
  let mapFor: PresencePeopleView | undefined;
  let map: PresenceStatuses | undefined;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    if (poller !== undefined) last = poller.snapshot();
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (poller === undefined) {
        poller = createPoller(
          fetcher,
          { ms: PRESENCE_PEOPLE_POLL_MS, keepOnError: true, pauseWhenHidden: true },
          env,
        );
        poller.subscribe(emit);
        poller.start();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && poller !== undefined) {
          poller.stop();
          poller = undefined;
        }
      };
    },
    snapshot: () => last,
    statuses() {
      const data = last.data;
      if (data?.enabled !== true) return undefined;
      if (data !== mapFor) {
        mapFor = data;
        map = new Map(data.people.map((p) => [p.user_id, p.status]));
      }
      return map;
    },
  };
}

const STORE = createPresencePeopleStore(getPresencePeople, BROWSER_ENVIRONMENT);

/** The shared answer, as `usePolled` gives one: for the header's stack and list. */
export function usePresencePeople(): PolledState<PresencePeopleView> {
  return useSyncExternalStore(STORE.subscribe, STORE.snapshot);
}

/** Each person's status, for a face's ring; `undefined` until told, or while presence is off. */
export function usePresenceStatuses(): PresenceStatuses | undefined {
  return useSyncExternalStore(STORE.subscribe, STORE.statuses);
}
