import type { OrgOverview } from '../../../api/org.ts';

/**
 * Organisation → Overview's pulse (LAI-989), from `GET /org/overview` alone.
 *
 * **Every number is the server's.** This module names the five figures and
 * writes the line under each; it counts nothing. A zero is drawn as `0` — an
 * absent tile would read as a figure nobody computed.
 */

export interface PulseTile {
  readonly id: 'people' | 'open' | 'review' | 'blocked' | 'overdue';
  readonly label: string;
  readonly value: string;
  readonly sub: string;
}

export function pulseTiles(overview: OrgOverview): readonly PulseTile[] {
  const { people, tasks } = overview;
  return [
    {
      id: 'people',
      label: 'Active people',
      value: String(people.active),
      sub:
        people.seen_this_week === 0
          ? 'none seen this week'
          : `${String(people.seen_this_week)} seen this week`,
    },
    {
      id: 'open',
      label: 'Open tasks',
      value: String(tasks.open),
      sub: 'not done or cancelled',
    },
    {
      id: 'review',
      label: 'In review',
      value: String(tasks.in_review),
      sub: 'waiting on a person',
    },
    { id: 'blocked', label: 'Blocked', value: String(tasks.blocked), sub: 'waiting on other work' },
    { id: 'overdue', label: 'Overdue', value: String(tasks.overdue), sub: 'past their due date' },
  ];
}
