import { useState } from 'react';
import type { ActivityEvent } from '../../../api/activity.ts';
import type { Task } from '../../../api/tasks.ts';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import { describeProjectEvent, relativeTime, shownInFeed, statusChange } from './dashboard-derive.ts';
import { DashLink, boardHref } from './DashLink.tsx';
import { dayHeading } from './summary-derive.ts';

/**
 * The avatar's colours for an actor.
 *
 * A `null` actor is Laika itself (the CHECK constraint makes that the only
 * meaning), and it gets the neutral chip rather than a colour drawn from the
 * string `"null"` — which is what colouring by a fallback id would do.
 */
function avatarStyle(actorId: string | null, theme: Theme) {
  if (actorId === null) return undefined;
  const ink = avatarColor(actorId, theme);
  return { background: ink.background, color: ink.foreground, borderColor: ink.border };
}

/**
 * **Recent activity** (LAI-085, LAI-280, LAI-711): what happened in the range,
 * newest first, grouped under the day it happened — Jira's feed.
 *
 * The All · People · Agents filter is a reading of the list already loaded
 * (`actor_kind` is on every row, D-022); the counts beside each name are the
 * real split of what the list shows. The list scrolls inside its card — the
 * page does not grow with the feed.
 */
export function ActivityFeed({
  events,
  tasksById,
  nameOf,
  slug,
  now,
  rangeLabel,
  theme,
}: {
  readonly events: readonly ActivityEvent[];
  readonly tasksById: ReadonlyMap<string, Task>;
  readonly nameOf: (id: string | null) => string;
  readonly slug: string;
  readonly now: number;
  readonly rangeLabel: string;
  readonly theme: Theme;
}) {
  /**
   * Which actors the feed shows. Local, not a URL parameter: it is a way of
   * reading the list already on screen, and the range — which changes what is
   * *fetched* — is the thing that earns a place in the address bar.
   */
  const [actor, setActor] = useState<'all' | 'user' | 'agent'>('all');

  // Counted from what the feed lists, not from every event: a button's count
  // must describe the list that button produces (`FEED_SILENT` explains which
  // verbs are left out and why).
  const shown = events.filter((event) => shownInFeed(event.type));
  const feed = actor === 'all' ? shown : shown.filter((event) => event.actor_kind === actor);

  let lastDay: string | undefined;

  return (
    <section className="dash-card dash-feed-panel" aria-labelledby="dash-feed-title">
      <header className="dash-card-head">
        <h2 id="dash-feed-title" className="dash-card-title">
          Recent activity
        </h2>
        <span className="dash-feed-filters" role="group" aria-label="Filter activity">
          {(
            [
              ['all', 'All', shown.length],
              ['user', 'People', shown.filter((e) => e.actor_kind === 'user').length],
              ['agent', 'Agents', shown.filter((e) => e.actor_kind === 'agent').length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className={actor === id ? 'dash-filter dash-filter-on' : 'dash-filter'}
              aria-pressed={actor === id}
              onClick={() => {
                setActor(id);
              }}
            >
              {label} <span className="dash-filter-count">{count}</span>
            </button>
          ))}
        </span>
      </header>

      <div className="dash-feed-scroll">
        {feed.length === 0 ? (
          <EmptyState
            headline={
              actor !== 'all' && shown.length > 0
                ? `No ${actor === 'agent' ? 'agent' : 'person'} activity in this range`
                : events.length === 0
                  ? `Nothing in the ${rangeLabel.toLowerCase()}`
                  : 'Nothing worth showing in this range'
            }
            body={
              actor !== 'all' && shown.length > 0
                ? 'Switch back to All to see everything in this range.'
                : events.length === 0
                  ? 'Widen the range to see older activity.'
                  : 'Everything in this range is the kind of event this feed leaves out — tasks moved between sprints.'
            }
          />
        ) : (
          <ul className="dash-feed">
            {feed.flatMap((event) => {
              const moved = statusChange(event);
              const day = dayHeading(event.created_at, now);
              const heading =
                day === lastDay ? [] : [
                  <li key={`day-${day}`} className="dash-day" aria-hidden="true">
                    {day}
                  </li>,
                ];
              lastDay = day;
              const task = event.task_id === null ? undefined : tasksById.get(event.task_id);

              return [
                ...heading,
                <li key={`${event.id}-${String(event.seq)}`} className="dash-event">
                  <time className="dash-when" dateTime={new Date(event.created_at).toISOString()}>
                    {relativeTime(event.created_at, now)}
                  </time>

                  <span
                    className="dash-avatar"
                    style={avatarStyle(event.actor_id, theme)}
                    aria-hidden="true"
                  >
                    {initials(nameOf(event.actor_id))}
                    {event.actor_kind === 'agent' && (
                      <span className="dash-avatar-bot" aria-hidden="true" />
                    )}
                  </span>

                  <span className="dash-what">
                    <span className="dash-actor">{nameOf(event.actor_id)}</span>{' '}
                    {describeProjectEvent(event)}
                    {moved !== undefined && (
                      <span className="dash-move">
                        {' '}
                        {moved.from.replace('_', ' ')} → {moved.to.replace('_', ' ')}
                      </span>
                    )}
                    {event.actor_kind === 'agent' && (
                      <span className="visually-hidden"> (by an agent)</span>
                    )}
                  </span>

                  {task !== undefined && (
                    <DashLink
                      href={boardHref(slug, { task: task.id })}
                      className="dash-event-key"
                      title={task.title}
                    >
                      {task.key}
                    </DashLink>
                  )}
                </li>,
              ];
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
