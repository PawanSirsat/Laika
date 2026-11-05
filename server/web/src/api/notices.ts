import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { request } from './client.ts';

/**
 * A member's notices (SPEC §6.4, D-134; LAI-1136 serves them, LAI-1139 draws
 * them as *For you* on My day): being added to a space — with the adder's
 * message and first card — and, once LAI-1137 lands, a tool, device or token
 * of theirs revoked by somebody else. Mirrors `services/notices.ts`'
 * `NoticeView`.
 *
 * **The message is the adder's own free text**, up to 500 characters. It is
 * drawn as text, never as HTML or Markdown — React's text nodes, nothing that
 * parses it.
 *
 * Session only: every read and mark is `notices.own`, the caller's rows.
 */

export type NoticeKind = 'added_to_space' | 'tool_revoked' | 'device_unpaired' | 'token_revoked';

export interface Notice {
  readonly id: string;
  readonly kind: NoticeKind;
  readonly actor: { readonly id: string; readonly name: string };
  /** The space while it exists and the reader can open it; null otherwise. */
  readonly project: { readonly id: string; readonly slug: string; readonly name: string } | null;
  /** The first card while it exists and the reader can open its space. */
  readonly task: { readonly id: string; readonly key: string; readonly title: string } | null;
  /** The tool, device or token's name as it was. */
  readonly subject: string | null;
  readonly message: string | null;
  readonly created_at: number;
  readonly read_at: number | null;
}

export interface NoticePage {
  readonly data: readonly Notice[];
  readonly next_cursor: string | null;
  readonly unread_count: number;
}

export function getNotices(
  options: { readonly limit?: number; readonly unread?: boolean } = {},
  signal?: AbortSignal,
): Promise<NoticePage> {
  const q = new URLSearchParams();
  if (options.limit !== undefined) q.set('limit', String(options.limit));
  if (options.unread === true) q.set('unread', 'true');
  const s = q.toString();
  return request<NoticePage>(
    `/me/notices${s === '' ? '' : `?${s}`}`,
    signal === undefined ? {} : { signal },
  );
}

export function markNoticeRead(id: string): Promise<void> {
  return request<void>(`/me/notices/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function markAllNoticesRead(): Promise<void> {
  return request<void>('/me/notices/read-all', { method: 'POST' });
}

/** The space's or card's name, or what it was when it is gone or out of reach. */
function spaceName(notice: Notice): string {
  return notice.project?.name ?? 'a space';
}

/**
 * One notice as a sentence, without the message. The message is shown under
 * it as the adder wrote it, quoted, so nothing here interprets it.
 */
export function noticeLine(notice: Notice): string {
  const who = notice.actor.name;
  const what = notice.subject ?? 'one of yours';
  switch (notice.kind) {
    case 'added_to_space':
      return `${who} added you to ${spaceName(notice)}`;
    case 'tool_revoked':
      return `${who} revoked the tool ${what}`;
    case 'device_unpaired':
      return `${who} unpaired the device ${what}`;
    case 'token_revoked':
      return `${who} revoked the token ${what}`;
  }
}

// ------------------------------------------------------------- the count

/**
 * The unread count, shared by My day's rail badge and the For you card, so a
 * notice read on the card takes the badge down at once rather than at the
 * next poll. One small store, not a context: the shell and the screen are far
 * apart and both only need the one number.
 */
let unread: number | undefined;
/** Bumped when the signed-in person changes (review N2), as availability's is. */
let generation = 0;
const listeners = new Set<() => void>();

export function setUnreadNotices(count: number | undefined, at: number = generation): void {
  if (at !== generation || unread === count) return;
  unread = count;
  for (const listener of listeners) listener();
}

/** A different person, or none: forget the last one's count (`setStoreUser`). */
export function resetUnreadNotices(): void {
  generation += 1;
  if (unread === undefined) return;
  unread = undefined;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A minute is fresh enough for a badge; My day re-reads on open. */
const REFRESH_MS = 60_000;

/**
 * The signed-in person's unread count, for the rail. Polled while `enabled`;
 * a failed read keeps the last answer, since zero would claim there is none.
 */
export function useUnreadNotices(enabled: boolean): number | undefined {
  useEffect(() => {
    if (!enabled) {
      setUnreadNotices(undefined);
      return;
    }
    const controller = new AbortController();
    const read = (): void => {
      const at = generation;
      getNotices({ limit: 1, unread: true }, controller.signal)
        .then((page) => {
          if (!controller.signal.aborted) setUnreadNotices(page.unread_count, at);
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled]);
  return useSyncExternalStore(
    subscribe,
    () => unread,
    () => unread,
  );
}

// ------------------------------------------------------------- the card

export type NoticesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly notices: readonly Notice[];
      readonly unread: number;
      readonly more: boolean;
    };

/** How many For you shows. Older ones are kept 90 days and are not lost. */
export const FOR_YOU_LIMIT = 10;

export interface Notices {
  readonly state: NoticesState;
  readonly reload: () => void;
  /** Mark one read; the card and the badge change when the server agrees. */
  readonly read: (id: string) => Promise<void>;
  readonly readAll: () => Promise<void>;
}

export function useNotices(enabled: boolean): Notices {
  const [state, setState] = useState<NoticesState>({ status: 'loading' });
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    const at = generation;
    getNotices({ limit: FOR_YOU_LIMIT }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || at !== generation) return;
        setUnreadNotices(page.unread_count, at);
        setState({
          status: 'ready',
          notices: page.data,
          unread: page.unread_count,
          more: page.next_cursor !== null,
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [enabled, asked]);

  const reload = useCallback(() => {
    setAsked((n) => n + 1);
  }, []);

  const current = useRef(state);
  current.current = state;

  const read = useCallback(async (id: string) => {
    await markNoticeRead(id);
    const s = current.current;
    if (s.status !== 'ready') return;
    const was = s.notices.find((n) => n.id === id);
    if (was?.read_at !== null) return;
    const at = Date.now();
    const next = Math.max(0, s.unread - 1);
    setUnreadNotices(next);
    setState({
      ...s,
      unread: next,
      notices: s.notices.map((n) => (n.id === id ? { ...n, read_at: at } : n)),
    });
  }, []);

  const readAll = useCallback(async () => {
    await markAllNoticesRead();
    const at = Date.now();
    setUnreadNotices(0);
    setState((s) =>
      s.status !== 'ready'
        ? s
        : {
            ...s,
            unread: 0,
            notices: s.notices.map((n) => (n.read_at === null ? { ...n, read_at: at } : n)),
          },
    );
  }, []);

  return { state, reload, read, readAll };
}
