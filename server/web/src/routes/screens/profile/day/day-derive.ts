import type { EntryKind, MyDay, TimeDraft, TimeEntry } from '../../../../api/time.ts';
import { kindLabel } from '../../my-day/entry-kinds.ts';
import { compact } from '../../my-day/format.ts';
import { dayLabel } from '../../my-day/my-day-derive.ts';
import { along, dayLine } from '../../my-day/timeline-derive.ts';

/**
 * The profile's **Day** tab (SPEC §11.4.2.1, D-139 items 6–7, LAI-1155): one
 * day of a person's time as the design's compact panel draws it — four tiles,
 * a timeline from 08:00 to 18:00 stretched to fit, and the same entries as a
 * list. Pure: the clock is passed in.
 *
 * **Every figure is hours** (D-139 item 7, LAI-1147): `5h 37m`, never `5:37`.
 * **Drafts carry no kind** in the API, so a draft's kind is a dash and its
 * block is drawn without a kind's colour — never one guessed for it.
 */

/** The axis the design opens on, in hours of the day; an entry outside stretches it. */
export const DAY_FROM = 8;
export const DAY_TO = 18;

/** On a phone the axis is labelled every this many hours. */
export const PHONE_TICK_HOURS = 3;

export type RowStatus = 'confirmed' | 'draft';

export interface DayTile {
  readonly id: 'tracked' | 'confirmed' | 'drafts' | 'meetings';
  readonly label: string;
  readonly value: string;
}

export interface DayRow {
  readonly id: string;
  readonly status: RowStatus;
  /** `09:00–10:45` in the entry's own zone, or `—` for one with no times. */
  readonly when: string;
  readonly key: string | null;
  readonly title: string;
  /** `null` for a draft: the API gives a draft no kind. */
  readonly kind: EntryKind | null;
  readonly minutes: number;
  /** `1h 45m`. */
  readonly duration: string;
}

export interface DayBlock {
  readonly id: string;
  readonly status: RowStatus;
  readonly kind: EntryKind | null;
  /** Percentages of the axis. */
  readonly left: number;
  readonly width: number;
  /** The card's key, else the kind's word, else *Draft*. */
  readonly label: string;
  /** The title under a key, else the duration. */
  readonly sub: string;
  readonly name: string;
}

export interface AgentBar {
  readonly left: number;
  readonly width: number;
  readonly onCard: boolean;
  readonly name: string;
}

export interface DayTick {
  readonly left: number;
  readonly label: string;
  readonly edge: 'start' | 'mid' | 'end';
  /** Hidden on a phone, which labels every {@link PHONE_TICK_HOURS} hours. */
  readonly minor: boolean;
}

export interface DayPanel {
  readonly empty: boolean;
  readonly tiles: readonly DayTile[];
  readonly rows: readonly DayRow[];
  readonly blocks: readonly DayBlock[];
  readonly agents: readonly AgentBar[];
  readonly ticks: readonly DayTick[];
  /** Hour lines along the lane, as percentages. */
  readonly hourLines: readonly number[];
  /** The now line's place, on today and inside the axis only. */
  readonly now: number | undefined;
  readonly from: number;
  readonly to: number;
  /** The agents' minutes on cards (D-088 item 8): beside the person's, never added. */
  readonly agentOnCards: number;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `14:20` in `tz`, on the 24-hour clock the design's list and axis use. */
export function clock24(at: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

function whenOf(item: Pick<TimeEntry, 'started_at' | 'ended_at' | 'tz'>): string {
  if (item.started_at === null || item.ended_at === null) return '—';
  return `${clock24(item.started_at, item.tz)}–${clock24(item.ended_at, item.tz)}`;
}

/** What an entry was: its card's key and title, else what the person called it. */
function entryWhat(entry: TimeEntry): { key: string | null; title: string } {
  if (entry.task !== null) return { key: entry.task.key, title: entry.task.title };
  const said = entry.title ?? entry.note;
  if (said !== null && said !== undefined && said.trim() !== '') return { key: null, title: said };
  if (entry.project !== null) return { key: null, title: entry.project.name };
  return { key: null, title: 'General' };
}

/** What a draft is on: its card, the key the collector sent, its note, its space. */
function draftWhat(draft: TimeDraft): { key: string | null; title: string } {
  if (draft.task !== null) return { key: draft.task.key, title: draft.task.title };
  if (draft.note !== null && draft.note.trim() !== '') {
    return { key: draft.task_key, title: draft.note };
  }
  if (draft.task_key !== null) return { key: draft.task_key, title: '' };
  if (draft.project !== null) return { key: null, title: draft.project.name };
  return { key: null, title: draft.general ? 'General' : 'No card yet' };
}

/** `1h 45m` — the figure every tile, row and the agents line prints. */
export const hours = (minutes: number): string => compact(Math.max(0, Math.round(minutes)));

/** `Friday 6 November`, or `Friday 6 November · today`. */
export function dayTitle(day: string, today: string): string {
  const long = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return day === today ? `${long} · today` : long;
}

/** `Fri 6 Nov`, as the empty state names the day. */
export const dayShort = (day: string): string => dayLabel(day);

export function dayPanel(
  view: Pick<
    MyDay,
    'day' | 'tz' | 'today' | 'drafts' | 'entries' | 'breaks' | 'signal_times' | 'agent'
  >,
  nowMs: number,
): DayPanel {
  const confirmed = view.entries.reduce((sum, e) => sum + e.minutes, 0);
  const drafted = view.drafts.reduce((sum, d) => sum + d.minutes, 0);
  const meetings = view.entries
    .filter((e) => e.kind === 'meeting')
    .reduce((sum, e) => sum + e.minutes, 0);
  const tiles: DayTile[] = [
    { id: 'tracked', label: 'Tracked', value: hours(confirmed + drafted) },
    { id: 'confirmed', label: 'Confirmed', value: hours(confirmed) },
    { id: 'drafts', label: 'Drafts', value: hours(drafted) },
    { id: 'meetings', label: 'Meetings', value: hours(meetings) },
  ];

  const timed = (row: DayRow, at: number | null) => ({ row, at: at ?? Number.MAX_SAFE_INTEGER });
  const items = [
    ...view.entries.map((e) =>
      timed(
        {
          id: e.id,
          status: 'confirmed',
          when: whenOf(e),
          ...entryWhat(e),
          kind: e.kind ?? null,
          minutes: e.minutes,
          duration: hours(e.minutes),
        },
        e.started_at,
      ),
    ),
    ...view.drafts.map((d) =>
      timed(
        {
          id: d.id,
          status: 'draft',
          when: whenOf(d),
          ...draftWhat(d),
          kind: null,
          minutes: d.minutes,
          duration: hours(d.minutes),
        },
        d.started_at,
      ),
    ),
  ];
  // In the order they happened; one with no times after every one that has.
  const rows: DayRow[] = items.sort((x, y) => x.at - y.at).map((item) => item.row);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const line = dayLine(view, nowMs);
  const runs = line.agents;
  const placed = [...line.blocks, ...runs];
  const from = Math.max(0, Math.min(DAY_FROM, ...placed.map((s) => Math.floor(s.start / 60))));
  const to = Math.min(
    Math.ceil(line.length / 60),
    Math.max(DAY_TO, ...placed.map((s) => Math.ceil(s.end / 60))),
  );
  const pos = (minute: number): number => along(minute, from, to);

  const blocks: DayBlock[] = line.blocks.flatMap((b) => {
    const row = byId.get(b.id);
    if (row === undefined) return [];
    const word = row.kind === null ? 'Draft' : kindLabel(row.kind);
    const what = [row.key, row.title].filter((part) => part !== null && part !== '').join(' ');
    return [
      {
        id: b.id,
        status: row.status,
        kind: row.kind,
        left: pos(b.start),
        width: pos(b.end) - pos(b.start),
        label: row.key ?? word,
        sub: row.key !== null && row.title !== '' ? row.title : row.duration,
        name: [row.when, row.kind === null ? '' : word, what, row.duration, row.status]
          .filter((part) => part !== '')
          .join(', '),
      },
    ];
  });

  const agents: AgentBar[] = runs.map((r) => ({
    left: pos(r.start),
    width: pos(r.end) - pos(r.start),
    onCard: r.onCard,
    name: `Agents ${r.onCard ? 'on a card' : 'off any card'}, ${hours(r.end - r.start)}`,
  }));

  const ticks: DayTick[] = [];
  const hourLines: number[] = [];
  for (let hour = from; hour <= to; hour += 1) {
    const mark = line.hours.find((h) => h.hour === hour);
    const left = pos(mark?.minute ?? hour * 60);
    ticks.push({
      left,
      label: `${pad(hour)}:00`,
      edge: hour === from ? 'start' : hour === to ? 'end' : 'mid',
      minor: (hour - from) % PHONE_TICK_HOURS !== 0,
    });
    if (hour !== from && hour !== to) hourLines.push(left);
  }

  const nowAt = line.now === undefined ? undefined : pos(line.now);
  const agentOnCards = view.agent.by_task.reduce((sum, t) => sum + t.minutes, 0);

  return {
    empty: view.entries.length === 0 && view.drafts.length === 0,
    tiles,
    rows,
    blocks,
    agents,
    ticks,
    hourLines,
    now: nowAt !== undefined && nowAt > 0 && nowAt < 100 ? nowAt : undefined,
    from,
    to,
    agentOnCards,
  };
}
