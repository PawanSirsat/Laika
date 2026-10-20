import { request } from './client.ts';

/**
 * A person's own time (D-088, LAI-787, SPEC §6.4): their switch, their day as
 * drafted on their own machine, and the entries they confirmed or typed.
 *
 * **Everything here is the caller's own, on a web session.** No path names
 * anybody else, and the server refuses every one of these to a token — an
 * agent may *propose* a draft (`propose_time_entry`, the MCP tool, and its
 * REST twin `POST /me/time-drafts`), never read one or confirm it. Nothing in
 * the SPA proposes: a person here confirms, edits or types.
 *
 * **Agent time is minutes, never hours** (D-088 item 8): `agent.minutes` is
 * Claude Code's own agent time, shown beside the day and never added to it.
 *
 * Mirrors `services/time-settings.ts`, `services/time-drafts.ts`,
 * `services/time-entries.ts` and `services/my-day.ts`.
 */

export const TIME_MODES = ['off', 'manual', 'drafts'] as const;
/** The organisation's *Time* setting: nothing, typed entries only, or drafts too. */
export type TimeMode = (typeof TIME_MODES)[number];

export const DAY_STATES = ['confirmed', 'drafted', 'no_signal', 'future'] as const;
export type DayState = (typeof DAY_STATES)[number];

/** `GET /me/time-settings`: both switches, and whether drafting is on as a result. */
export interface TimeSettings {
  readonly org_mode: TimeMode;
  readonly draft_my_time: boolean;
  /** `org_mode === 'drafts'` and `draft_my_time` — the collector's question. */
  readonly drafting: boolean;
  readonly min_sync_interval_s: number;
}

export interface TaskRef {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}

export interface ProjectRef {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** What a block was drafted from — counts only, never what was typed. */
export interface TimeSignals {
  readonly prompts: number;
  readonly replies: number;
  readonly sessions: number;
  readonly commits: number;
  readonly marks: number;
}

/** One unconfirmed block of the person's day. */
export interface TimeDraft {
  readonly id: string;
  /** From the person's own collector, or proposed by one of their agents. */
  readonly source: 'collector' | 'agent';
  readonly day: string;
  readonly tz: string;
  readonly started_at: number | null;
  readonly ended_at: number | null;
  readonly minutes: number;
  readonly task: TaskRef | null;
  /** The key the collector sent, when it names no card this person can read. */
  readonly task_key: string | null;
  readonly project: ProjectRef | null;
  /** Assigned to no card and no project, on purpose. */
  readonly general: boolean;
  readonly signals: TimeSignals;
  readonly note: string | null;
}

export type EntrySource = 'draft' | 'manual' | 'import';

/** A confirmed entry: the only time anybody else can ever see. */
export interface TimeEntry {
  readonly id: string;
  readonly day: string;
  readonly tz: string;
  readonly started_at: number | null;
  readonly ended_at: number | null;
  readonly minutes: number;
  readonly source: EntrySource;
  readonly task: TaskRef | null;
  readonly project: ProjectRef | null;
  readonly note: string | null;
  readonly revision: number;
  readonly created_at: number;
  readonly updated_at: number;
}

/** One step of an entry's history, append-only. */
export interface TimeRevision {
  readonly revision: number;
  readonly change: 'created' | 'edited' | 'deleted';
  readonly changed_by: string;
  readonly day: string;
  readonly tz: string;
  readonly minutes: number;
  readonly task_id: string | null;
  readonly project_id: string | null;
  readonly note: string | null;
  readonly started_at: number | null;
  readonly ended_at: number | null;
  readonly created_at: number;
}

export interface MyDayAgentTask {
  readonly task: TaskRef;
  readonly minutes: number;
}

/**
 * Claude Code's own agent time that day — minutes, beside the day, never in
 * it. Mirrors `services/agent-time.ts`' `AgentDayView`.
 */
export interface MyDayAgent {
  /** `type=cli`: the agent working. */
  readonly minutes: number;
  /** `type=user`: keyboard time inside Claude Code. */
  readonly keyboard_minutes: number;
  readonly by_task: readonly MyDayAgentTask[];
  readonly unattributed_minutes: number;
}

/**
 * A gap the person waved away as a break (LAI-831): never time, never counted.
 * Mirrors `services/time-breaks.ts`' `TimeBreakView`.
 */
export interface TimeBreak {
  readonly id: string;
  readonly day: string;
  readonly tz: string;
  readonly started_at: number;
  readonly ended_at: number;
}

/** One day of the week strip. Mirrors `services/my-day.ts`' `WeekDayView`. */
export interface MyDayWeekDay {
  readonly day: string;
  readonly confirmed_minutes: number;
  readonly drafted_minutes: number;
  readonly state: DayState;
}

/** `GET /me/time?day=&tz=` — My day. */
export interface MyDay {
  readonly day: string;
  readonly tz: string;
  readonly today: string;
  readonly settings: TimeSettings;
  readonly drafts: readonly TimeDraft[];
  readonly entries: readonly TimeEntry[];
  /** Gaps waved away (LAI-831), in the order they happened. */
  readonly breaks: readonly TimeBreak[];
  /** Every pending draft held, on every day — what *Draft my time* off deletes. */
  readonly drafts_held: { readonly count: number; readonly minutes: number };
  readonly agent: MyDayAgent;
  readonly state: DayState;
  /** Monday to Sunday of the week holding `day`. */
  readonly week: readonly MyDayWeekDay[];
}

export interface DraftPatch {
  /** A card's key or id; `null` unties it. */
  readonly task?: string | null;
  /** A space's slug; `null` clears it. */
  readonly project?: string | null;
  readonly general?: boolean;
  readonly minutes?: number;
  /** An edge moved on the block's own day (LAI-831), unix ms. */
  readonly started_at?: number;
  readonly ended_at?: number;
}

export interface NewEntry {
  readonly day: string;
  readonly tz: string;
  readonly minutes: number;
  readonly task?: string;
  readonly project?: string;
  readonly note?: string;
  readonly started_at?: number;
  readonly ended_at?: number;
}

export interface EntryPatch {
  readonly minutes?: number;
  readonly task?: string | null;
  readonly project?: string | null;
  readonly note?: string | null;
  readonly day?: string;
  /** An edge moved on the entry's own day (LAI-831): one revision. */
  readonly started_at?: number;
  readonly ended_at?: number;
}

export interface NewBreak {
  readonly day: string;
  readonly tz: string;
  readonly started_at: number;
  readonly ended_at: number;
}

const opts = (signal?: AbortSignal) => (signal === undefined ? {} : { signal });

/**
 * The header a change answers with: the id of **that** change, which
 * {@link undo} takes (LAI-831 review round 1). Mirrors
 * `services/time-undo-log.ts`' `UNDO_HEADER`.
 */
export const UNDO_HEADER = 'X-Undo-Id';

/** Told the undo id of the change just made, when the server recorded one. */
export type OnUndo = (id: string) => void;

const undoable = (onUndo?: OnUndo) =>
  onUndo === undefined
    ? {}
    : {
        onHeaders: (headers: Headers) => {
          const id = headers.get(UNDO_HEADER);
          if (id !== null && id !== '') onUndo(id);
        },
      };

export function getTimeSettings(signal?: AbortSignal): Promise<TimeSettings> {
  return request<TimeSettings>('/me/time-settings', opts(signal));
}

/** *Draft my time* — the person's own switch. Off deletes every draft held. */
export function setDraftMyTime(on: boolean): Promise<TimeSettings> {
  return request<TimeSettings>('/me/time-settings', {
    method: 'PUT',
    body: { draft_my_time: on },
  });
}

/** The organisation's *Time* setting — owners and admins, signed in. */
export function setOrgTimeMode(mode: TimeMode): Promise<{ readonly mode: TimeMode }> {
  return request<{ readonly mode: TimeMode }>('/org/time', { method: 'PUT', body: { mode } });
}

export function getMyDay(day: string, tz: string, signal?: AbortSignal): Promise<MyDay> {
  const query = new URLSearchParams({ day, tz }).toString();
  return request<MyDay>(`/me/time?${query}`, opts(signal));
}

export function updateDraft(id: string, patch: DraftPatch, onUndo?: OnUndo): Promise<TimeDraft> {
  return request<TimeDraft>(`/me/time-drafts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    ...undoable(onUndo),
  });
}

/** Two drafts where there was one, cut at `at` (unix ms). */
export function splitDraft(
  id: string,
  at: number,
  onUndo?: OnUndo,
): Promise<{ readonly drafts: readonly [TimeDraft, TimeDraft] }> {
  return request<{ readonly drafts: readonly [TimeDraft, TimeDraft] }>(
    `/me/time-drafts/${encodeURIComponent(id)}/split`,
    { method: 'POST', body: { at }, ...undoable(onUndo) },
  );
}

/** Not work: it stays dismissed, and a later sync does not bring it back. */
export function dismissDraft(id: string, onUndo?: OnUndo): Promise<void> {
  return request<void>(`/me/time-drafts/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    ...undoable(onUndo),
  });
}

export function confirmDraft(id: string, onUndo?: OnUndo): Promise<TimeEntry> {
  return request<TimeEntry>(`/me/time-drafts/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    ...undoable(onUndo),
  });
}

/** Confirm day: every unconfirmed block of it, in one click. */
export function confirmDay(
  day: string,
  onUndo?: OnUndo,
): Promise<{ readonly entries: readonly TimeEntry[] }> {
  return request<{ readonly entries: readonly TimeEntry[] }>(
    `/me/time/days/${encodeURIComponent(day)}/confirm`,
    { method: 'POST', ...undoable(onUndo) },
  );
}

/** Every unconfirmed draft of mine, gone. Confirmed entries stay. */
export function deleteDrafts(): Promise<void> {
  return request<void>('/me/time-drafts', { method: 'DELETE' });
}

/** Time typed by hand — a meeting, a call. */
export function addEntry(entry: NewEntry, onUndo?: OnUndo): Promise<TimeEntry> {
  return request<TimeEntry>('/me/time-entries', {
    method: 'POST',
    body: entry,
    ...undoable(onUndo),
  });
}

export function updateEntry(id: string, patch: EntryPatch): Promise<TimeEntry> {
  return request<TimeEntry>(`/me/time-entries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });
}

export function deleteEntry(id: string, onUndo?: OnUndo): Promise<void> {
  return request<void>(`/me/time-entries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...undoable(onUndo),
  });
}

/**
 * Undo (LAI-831): the server puts back exactly what change `id` replaced —
 * the id that change answered with ({@link UNDO_HEADER}). `409` once the
 * block changed since or a later change touched it, `404` once too old.
 */
export function undo(id: string): Promise<void> {
  return request<void>('/me/time/undo', { method: 'POST', body: { id } });
}

/** A gap waved away as a break: it stops counting under *Gaps*. Never time. */
export function addBreak(span: NewBreak): Promise<TimeBreak> {
  return request<TimeBreak>('/me/time-breaks', { method: 'POST', body: span });
}

export function removeBreak(id: string): Promise<void> {
  return request<void>(`/me/time-breaks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getRevisions(
  id: string,
  signal?: AbortSignal,
): Promise<{ readonly revisions: readonly TimeRevision[] }> {
  return request<{ readonly revisions: readonly TimeRevision[] }>(
    `/me/time-entries/${encodeURIComponent(id)}/revisions`,
    opts(signal),
  );
}
