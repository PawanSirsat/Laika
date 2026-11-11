import type { TaskTime } from '../../../api/task-time.ts';
import type { Timer, TimeMode } from '../../../api/time.ts';

/**
 * What the task panel's *Tracked on this task* block says (owner, 2026-11-10;
 * the intent of LAI-812). Pure, so the wording is tested without a browser.
 *
 * **Hours and minutes, spelled with their units** — `6h 42m`, never a `06:42`
 * clock, which LAI-830 retired because a reader could not tell minutes from
 * hours. **Agent time in minutes only** (D-088 item 8), on its own line and
 * never added to the people's total. **Drafts are the reader's own** (D-088
 * item 3) and are not confirmed time, so they sit beside the total too.
 */

/** One number and its unit, so the number can be drawn large and the unit small. */
export interface DurationPart {
  readonly value: string;
  readonly unit: 'h' | 'm';
}

/** `402` → `6h 42m`, `45` → `45m`, `120` → `2h`, `0` → `0m`. */
export function durationParts(minutes: number): readonly DurationPart[] {
  const whole = Math.max(0, Math.round(minutes));
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return [{ value: String(m), unit: 'm' }];
  if (m === 0) return [{ value: String(h), unit: 'h' }];
  return [
    { value: String(h), unit: 'h' },
    { value: String(m).padStart(2, '0'), unit: 'm' },
  ];
}

/** The same, as one line of text: `6h 42m`. */
export function shortDuration(minutes: number): string {
  return durationParts(minutes)
    .map((p) => `${p.value}${p.unit}`)
    .join(' ');
}

/** `by 3 people · 7 entries`; nothing when nobody has confirmed any time. */
export function contributorsLine(view: TaskTime): string | null {
  if (view.entries <= 0 || view.total_minutes <= 0) return null;
  const people = view.people === 1 ? '1 person' : `${String(view.people)} people`;
  const entries = view.entries === 1 ? '1 entry' : `${String(view.entries)} entries`;
  return `by ${people} · ${entries}`;
}

/** `+1h 12m in your drafts` — not yet confirmed; nothing for none, or to a token. */
export function draftLine(view: TaskTime): string | null {
  const mine = view.my_draft_minutes;
  if (mine === null || mine <= 0) return null;
  return `+${shortDuration(mine)} in your drafts`;
}

/** `125 agent min` — kept apart from people's time; minutes, never hours. */
export function agentLine(view: TaskTime): string | null {
  if (view.agent_minutes <= 0) return null;
  return `${String(Math.round(view.agent_minutes))} agent min`;
}

/** What each short part of the bar means, said in full on hover. */
export const TRACKED_HINTS = {
  total: 'Confirmed time everyone logged on this task',
  drafts: 'Your own drafted time on this task, not yet confirmed — only you see it',
  agents: 'Time agents worked on this task, kept apart from people’s time',
} as const;

/** What the block's timer control offers, from the reader's own My day. */
export type TimerState =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'here'; readonly timer: Timer }
  | { readonly kind: 'elsewhere'; readonly label: string };

/**
 * One timer per person (§4.61): none, running on this task, or running on
 * something else — which the block says rather than letting a start fail
 * `409`. `unavailable` when the organisation's time is off or the reader's
 * day could not be read: no button is better than one that refuses.
 */
export function timerState(
  day: { readonly mode: TimeMode; readonly timer: Timer | null } | undefined,
  taskId: string,
): TimerState {
  if (day === undefined || day.mode === 'off') return { kind: 'unavailable' };
  const timer = day.timer;
  if (timer === null) return { kind: 'idle' };
  if (timer.task?.id === taskId) return { kind: 'here', timer };
  const label = timer.task?.key ?? timer.title ?? 'another task';
  return { kind: 'elsewhere', label };
}
