import { useMemo, useState, type ReactNode } from 'react';
import { describeEvent, pushSummary, type ActivityEvent } from '../../../api/activity.ts';
import { sessionHarnessName, sessionWordsAfter } from '../../../api/agent-session.ts';
import { isAgentComment, mayChangeComment, type Comment } from '../../../api/comments.ts';
import type { Round } from '../../../api/review.ts';
import { agentVia, type AgentNaming } from '../../../api/selected-agent.ts';
import type { Member, TaskSummary } from '../../../api/tasks.ts';
import { dateTime, timeLabel } from '../../../api/time-label.ts';
import type { UseTaskDetail } from '../../../api/use-task-detail.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { avatarColorSolid } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { actorLine, describeActor } from '../board/actor-presentation.ts';
import { threadOrder, type ThreadItem } from '../board/thread-order.ts';
import { CommentComposer } from './CommentComposer.tsx';
import { FeedComment } from './FeedComment.tsx';
import { actorKey, commentKind, runPositions, type RunPosition } from './feed-groups.ts';
import { FEED_GLYPHS, feedLines, feedMeta } from './feed-line.ts';
import type { CardCandidate, MentionCandidate } from './LazyRichEditor.tsx';
import { WhoDidThis } from './WhoDidThis.tsx';
import './feed.css';

export interface ActivityFeedProps {
  /** The thread and the history, read by the panel (`useTaskDetail`). */
  readonly detail: UseTaskDetail;
  /** For *Created this task · via MCP · Polly*. */
  readonly task: Pick<TaskSummary, 'created_via' | 'created_by_client'>;
  /** The `webhook.*` rows: the Changes tab, and the rail's count, from one filter. */
  readonly changes: readonly ActivityEvent[];
  readonly members: ReadonlyMap<string, Member>;
  /** Agents this reader may name, by id (LAI-538). */
  readonly agentNames: ReadonlyMap<string, AgentNaming>;
  readonly people: readonly MentionCandidate[];
  readonly cards: readonly CardCandidate[];
  readonly meId?: string | undefined;
  /** The task's rounds, for telling a finish summary from a comment. */
  readonly rounds: readonly Round[];
  /** The reader leads the space: Edit and Delete on every comment (§3.2). */
  readonly leads: boolean;
}

type Tab = 'all' | 'comments' | 'history' | 'changes';

function personName(id: string | null, members: ReadonlyMap<string, Member>): string {
  if (id === null) return 'someone';
  return members.get(id)?.name ?? id;
}

function commentIdOf(event: ActivityEvent): string | undefined {
  const id = (event.payload as { comment_id?: unknown } | null)?.comment_id;
  return typeof id === 'string' ? id : undefined;
}

/** Who a run is by, as its header draws it. */
interface Actor {
  readonly name: string;
  /** Whose colour the avatar takes: the person's id, or a fixed word for Laika. */
  readonly inkId: string;
  /** The bot mark on the avatar. */
  readonly agent: boolean;
  /** The row whose *Who did this* the chip opens, on an agent's row. */
  readonly row: ActivityEvent | undefined;
  /** The agent's words where there is no row to open: *an agent*. */
  readonly plain: string | undefined;
  /** What the session said ran, kept for a screen reader: *Codex · gpt-5.5*. */
  readonly session: string | undefined;
  /** `.cmt-who` on a comment, `.panel-event-who` on a row. */
  readonly whoClass: 'cmt-who' | 'panel-event-who';
  /** The word beside the name: `AGENT` on a comment, the marker on a row. */
  readonly badge: ReactNode;
}

/**
 * **The task's activity** (§11.4.2.1, D-129, LAI-1122): the four tabs — All,
 * Comments, History, Changes — over rows the panel already read, the feed
 * drawn in runs, and the composer under it.
 *
 * ## Runs
 *
 * Consecutive items by one actor in one session sit under **one header row**
 * (`feed-groups.ts`): the avatar, the person, the agent chip that opens *Who
 * did this*, and the time. The rest hang off a rail under it, each with its
 * own mark. The list stays flat — one `li` per item, so a test or a reader
 * counting items counts items — and each continuing item keeps its actor's
 * name for a screen reader, out of sight.
 *
 * ## What All leaves out
 *
 * A comment's own `comment.added` row: the comment is the item. History keeps
 * every row.
 */
export function ActivityFeed({
  detail,
  task,
  changes,
  members,
  agentNames,
  people,
  cards,
  meId,
  rounds,
  leads,
}: ActivityFeedProps) {
  const { theme } = useTheme();
  const now = Date.now();
  /**
   * Which tab is showing. Local, not in the URL: a tab is a way of looking at
   * the task already identified by `?task=`, and putting it in the address bar
   * would make Back step through tab switches before it closed the drawer —
   * which is the one thing Back has to do here (LAI-252).
   */
  const [tab, setTab] = useState<Tab>('all');
  /** Deleted here, and not drawn while the thread is read again. */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());

  const comments = useMemo(
    () => detail.comments.filter((comment) => !removed.has(comment.id)),
    [detail.comments, removed],
  );

  /** Each comment's `comment.added` row (LAI-1117): who wrote it, through which agent and session. */
  const addedRows = useMemo(() => {
    const found = new Map<string, ActivityEvent>();
    for (const event of detail.activity) {
      if (event.type !== 'comment.added') continue;
      const id = commentIdOf(event);
      if (id !== undefined) found.set(id, event);
    }
    return found;
  }, [detail.activity]);

  /*
   * **All** is the thread and the history in one timeline, oldest first — a
   * conversation's order, with what happened between the messages. It is by
   * `created_at` with the comment first on a tie and two events by `seq`
   * ({@link threadOrder}, LAI-575).
   */
  const everything: readonly ThreadItem[] = useMemo(() => {
    const shown = new Set(comments.map((comment) => comment.id));
    return [
      ...comments.map((comment) => ({
        kind: 'comment' as const,
        at: comment.created_at,
        comment,
      })),
      ...detail.activity
        .filter((event) => {
          if (event.type !== 'comment.added') return true;
          const id = commentIdOf(event);
          return id === undefined || !shown.has(id);
        })
        .map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
    ].sort(threadOrder);
  }, [comments, detail.activity]);

  const commentKey = (comment: Comment): string => {
    const row = addedRows.get(comment.id);
    if (row !== undefined) return actorKey(row);
    // No row loaded: an agent's comment is still not its person's (D-114).
    return `${comment.author_id ?? 'someone'}|${isAgentComment(comment) ? 'agent' : ''}|`;
  };
  const itemKey = (item: ThreadItem): string =>
    item.kind === 'comment' ? commentKey(item.comment) : actorKey(item.event);

  /** The agent half of an agent's row: the chip's words, and the session's for a screen reader. */
  const agentParts = (row: ActivityEvent) => ({
    row,
    plain: undefined,
    // What the session ran beyond the chip's own words — never *Claude Code*
    // twice (LAI-1123).
    session:
      row.agent_redacted === true
        ? undefined
        : sessionWordsAfter(chipLabel(row), row.agent_session),
  });

  const commentActor = (comment: Comment): Actor => {
    const agent = isAgentComment(comment);
    const row = addedRows.get(comment.id);
    const viaRow = row?.actor_kind === 'agent' ? row : undefined;
    return {
      name: personName(comment.author_id, members),
      inkId: comment.author_id ?? 'someone',
      agent,
      ...(viaRow === undefined
        ? {
            row: undefined,
            // An agent comment whose row is not loaded says only *an agent*:
            // it is never given a name (LAI-538).
            plain: agent ? 'an agent' : undefined,
            session: undefined,
          }
        : agentParts(viaRow)),
      whoClass: 'cmt-who',
      badge: agent ? <span className="cmt-agent">AGENT</span> : null,
    };
  };

  const eventActor = (event: ActivityEvent): Actor => {
    // Not `personName`: on an activity row a null actor is the system by
    // CHECK constraint (LAI-411).
    const actor = describeActor(event, members, agentNames);
    return {
      name: actor.name,
      inkId: event.actor_id ?? 'system',
      agent: event.actor_kind === 'agent',
      ...(event.actor_kind === 'agent'
        ? agentParts(event)
        : { row: undefined, plain: undefined, session: undefined }),
      whoClass: 'panel-event-who',
      // The word itself, not a colour (AC3).
      badge:
        actor.badge === undefined ? null : (
          <span className={`marker marker-${actor.badge}`}>{actor.badge}</span>
        ),
    };
  };

  /** The agent as this reader may name it: `<harness> · <device>`, or *an agent*. */
  const chipLabel = (row: ActivityEvent): string => agentVia(row, agentNames) ?? 'an agent';

  /** *Who did this* for an agent's row, as the chip that names the agent. */
  const chip = (row: ActivityEvent): ReactNode => {
    const redacted =
      row.agent_redacted === true || row.agent_id === null || row.agent_id === undefined;
    const session = row.agent_session ?? null;
    const harness = session?.harness ?? null;
    const version = session?.harness_version ?? null;
    return (
      <WhoDidThis
        label={chipLabel(row)}
        person={personName(row.actor_id, members)}
        agent={chipLabel(row)}
        redacted={redacted}
        device={
          row.agent_id === null || row.agent_id === undefined
            ? undefined
            : (agentNames.get(row.agent_id)?.device_label ?? undefined)
        }
        tool={
          harness === null
            ? undefined
            : `${sessionHarnessName(harness)}${version === null ? '' : ` ${version}`}`
        }
        model={session?.model ?? undefined}
      />
    );
  };

  /** The words a continuing item keeps for a screen reader: *Ada Lovelace via Claude Code · laptop-1*. */
  const whoText = (actor: Actor): string => {
    const agent =
      actor.row === undefined
        ? actor.plain
        : `${chipLabel(actor.row)}${actor.session === undefined ? '' : ` · ${actor.session}`}`;
    return agent === undefined ? actor.name : `${actor.name} via ${agent}`;
  };

  const avatar = (actor: Actor) => {
    const ink = avatarColorSolid(actor.inkId, theme);
    return (
      <span
        className="cmt-avatar"
        aria-hidden="true"
        style={{ background: ink.background, color: ink.foreground }}
      >
        {initials(actor.name)}
        {/* The bot mark rides on the avatar, as on a card and a presence chip. */}
        {actor.agent && (
          <span className="cmt-bot" aria-hidden="true">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
              <rect
                x="4"
                y="8"
                width="16"
                height="12"
                rx="3"
                stroke="var(--on-accent)"
                strokeWidth="3"
              />
              <path d="M12 4v4" stroke="var(--on-accent)" strokeWidth="3" />
            </svg>
          </span>
        )}
      </span>
    );
  };

  /** The run's header row: avatar, person, agent chip, badge, time. */
  const head = (actor: Actor, at: number, comment: boolean) => {
    const when = timeLabel(at, now);
    const agentShown = actor.row !== undefined || actor.plain !== undefined;
    return (
      <div className="feed-head">
        {avatar(actor)}
        <p className="feed-head-line">
          {/*
            **`Ada Lovelace via Claude Code · laptop-1`** (LAI-538), the person
            then the agent they acted through — *via* and the session's words
            are kept for a screen reader, and the chip draws the agent.
          */}
          <span className={actor.whoClass}>
            <span className="feed-name">{actor.name}</span>
            {agentShown && <span className="feed-sr"> via </span>}
            {actor.row !== undefined
              ? chip(actor.row)
              : actor.plain !== undefined && <span className="feed-agent">{actor.plain}</span>}
            {actor.session !== undefined && <span className="feed-sr"> · {actor.session}</span>}
          </span>
          {actor.badge}
          <time
            className={comment ? 'cmt-when feed-when' : 'panel-time feed-when'}
            dateTime={when.iso}
            title={when.full}
          >
            {when.text}
          </time>
        </p>
      </div>
    );
  };

  /**
   * A continuing item's actor and time, for a screen reader: the header above
   * says both once for the run, as the design draws it, and the exact time is
   * the row's `title` too.
   */
  const hiddenWho = (actor: Actor, at: number, comment: boolean) => {
    const when = timeLabel(at, now);
    return (
      <span className="feed-cont-who">
        <span className={actor.whoClass}>{whoText(actor)}</span>
        {actor.badge}
        <time className={comment ? 'cmt-when' : 'panel-time'} dateTime={when.iso}>
          {when.text}
        </time>
      </span>
    );
  };

  const renderComment = (comment: Comment, position: RunPosition) => {
    const actor = commentActor(comment);
    const starts = position === 'solo' || position === 'start';
    return (
      <li
        key={comment.id}
        className={['cmt', starts ? '' : 'cmt-cont', comment.sent_back ? 'cmt-reason' : '']
          .filter((c) => c !== '')
          .join(' ')}
        data-feed-item="comment"
        data-run={position}
      >
        {starts
          ? head(actor, comment.created_at, true)
          : hiddenWho(actor, comment.created_at, true)}
        <div className="feed-row">
          <span className="feed-gutter" aria-hidden="true" />
          <FeedComment
            comment={comment}
            kind={commentKind(comment, rounds)}
            agent={isAgentComment(comment)}
            people={people}
            meId={meId}
            cards={cards}
            mayChange={mayChangeComment(comment, meId, leads)}
            now={now}
            onChanged={detail.refresh}
            onDeleted={(id) => {
              setRemoved((was) => new Set([...was, id]));
            }}
          />
        </div>
      </li>
    );
  };

  const renderEvent = (event: ActivityEvent, position: RunPosition) => {
    const actor = eventActor(event);
    const starts = position === 'solo' || position === 'start';
    const meta = feedMeta(event, task);
    const lines = feedLines(event, agentNames);
    return (
      <li
        key={`${event.id}-${String(event.seq)}`}
        className={starts ? 'panel-event' : 'panel-event panel-event-cont'}
        data-feed-item="event"
        data-run={position}
      >
        {starts ? head(actor, event.created_at, false) : hiddenWho(actor, event.created_at, false)}
        {lines.map((line, i) => (
          <div key={i} className="feed-row" data-event-icon={line.icon}>
            <span className="feed-gutter" aria-hidden="true">
              <span className="feed-icon">{FEED_GLYPHS[line.icon]}</span>
            </span>
            <p className="panel-event-what feed-what" title={timeLabel(event.created_at, now).full}>
              {line.text}
              {line.object !== undefined && (
                <>
                  {' '}
                  <strong className="feed-object">{line.object}</strong>
                </>
              )}
              {line.tail !== undefined && ` ${line.tail}`}
              {line.move !== undefined && (
                <>
                  {' '}
                  <span className="feed-pill">{line.move.from}</span>
                  <span className="feed-arrow"> → </span>
                  <span className="feed-pill">{line.move.to}</span>
                </>
              )}
              {meta !== undefined && i === lines.length - 1 && (
                <>
                  {' '}
                  <span className="feed-meta">· {meta}</span>
                </>
              )}
            </p>
          </div>
        ))}
      </li>
    );
  };

  /** A list of items in runs: one header per run, a rail joining the rest. */
  const feed = (items: readonly ThreadItem[]) => {
    const positions = runPositions(items, itemKey);
    return items.map((item, i) => {
      const position = positions[i] ?? 'solo';
      return item.kind === 'comment'
        ? renderComment(item.comment, position)
        : renderEvent(item.event, position);
    });
  };

  const noComments = (
    <p className="cmt-none feed-empty">
      No comments yet. Ask a question here, or @mention someone to leave them a note.
    </p>
  );

  const composer = (
    <div className="panel-composer feed-composer">
      {meId !== undefined && (
        <span
          className="cmt-avatar cmt-avatar-me"
          aria-hidden="true"
          style={{
            background: avatarColorSolid(meId, theme).background,
            color: avatarColorSolid(meId, theme).foreground,
          }}
        >
          {initials(personName(meId, members))}
        </span>
      )}
      <CommentComposer people={people} meId={meId} cards={cards} onPost={detail.post} />
    </div>
  );

  return (
    <section className="panel-section panel-activity-section" id="activity">
      <h3 className="panel-section-title">Activity</h3>
      {detail.status === 'loading' ? (
        <LoadingState shape="row" count={3} label="Loading comments and activity" />
      ) : detail.status === 'error' ? (
        <ApiErrorState error={detail.error} resource="this task" onRetry={detail.reload} />
      ) : (
        <>
          {/*
            **Four tabs, as Jira has them.** *All* is the thread and the
            history merged in time; *History* is the audit trail; *Changes* is
            the commits — `webhook.commit` rows, which the GitHub webhook
            writes. Every filter is over rows this panel already loaded, so no
            tab can disagree with the one beside it.
          */}
          <div className="panel-tabs" role="tablist" aria-label="Task activity">
            {(
              [
                ['all', 'All', everything.length],
                ['comments', 'Comments', comments.length],
                ['history', 'History', detail.activity.length],
                ['changes', 'Changes', changes.length],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                className={tab === id ? 'panel-tab panel-tab-on' : 'panel-tab'}
                onClick={() => {
                  setTab(id);
                }}
              >
                {label} <span className="panel-tab-count">{count}</span>
              </button>
            ))}
          </div>

          {/*
            **Only the showing tab is in the DOM.** A hidden tabpanel still
            holds its rows, and the thread's comments would then exist twice.
          */}
          {tab === 'all' && (
            <section
              className="panel-section"
              id="panel-all"
              role="tabpanel"
              aria-labelledby="tab-all"
            >
              {everything.length > 0 && (
                <ul className="cmt-list panel-everything feed-list">{feed(everything)}</ul>
              )}
              {comments.length === 0 && noComments}
            </section>
          )}

          {tab === 'comments' && (
            <section
              className="panel-section"
              id="panel-comments"
              role="tabpanel"
              aria-labelledby="tab-comments"
            >
              {comments.length === 0 ? (
                noComments
              ) : (
                <ul className="cmt-list feed-list">
                  {feed(
                    comments.map((comment) => ({
                      kind: 'comment' as const,
                      at: comment.created_at,
                      comment,
                    })),
                  )}
                </ul>
              )}
            </section>
          )}

          {tab === 'history' && (
            <section
              className="panel-section"
              id="panel-history"
              role="tabpanel"
              aria-labelledby="tab-history"
            >
              {detail.activity.length === 0 ? (
                <p className="panel-muted">Nothing recorded yet.</p>
              ) : (
                <ol className="panel-activity feed-list">
                  {feed(
                    detail.activity.map((event) => ({
                      kind: 'event' as const,
                      at: event.created_at,
                      event,
                    })),
                  )}
                </ol>
              )}
            </section>
          )}

          {tab === 'changes' && (
            <section
              className="panel-section"
              id="panel-changes"
              role="tabpanel"
              aria-labelledby="tab-changes"
            >
              {changes.length === 0 ? (
                <p className="panel-muted">
                  No commits recorded against this task. Laika learns about them from the GitHub
                  webhook, so a space with no repo wired has none.
                </p>
              ) : (
                <ol className="panel-changes">
                  {changes.map((event) => (
                    <li key={`${event.id}-${String(event.seq)}`} className="panel-change">
                      <span className="panel-change-who">
                        {actorLine(describeActor(event, members, agentNames))}
                      </span>
                      <span className="panel-change-what">
                        {pushSummary(event) ?? describeEvent(event)}
                      </span>
                      <time
                        className="panel-time"
                        dateTime={new Date(event.created_at).toISOString()}
                      >
                        {dateTime(event.created_at, now)}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {/* The composer under the thread, as the design draws it (LAI-1122). */}
          {(tab === 'all' || tab === 'comments') && composer}
        </>
      )}
    </section>
  );
}
