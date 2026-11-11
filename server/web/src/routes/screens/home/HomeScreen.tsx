import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { describeEvent } from '../../../api/activity.ts';
import type { MeProfile } from '../../../api/me.ts';
import { useGates } from '../../../api/permissions.ts';
import type { ReviewQueueItem } from '../../../api/review.ts';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { describeActor } from '../board/actor-presentation.ts';
import { plainClick } from '../my-day/task-link.ts';
import {
  activeGroup,
  activityRows,
  agentRows,
  AGENTS_HREF,
  attentionEmpty,
  blockedGroup,
  comingUpGroup,
  handoffGroup,
  overdueGroup,
  reviewGroup,
  type AgentRow,
  type Attention,
  type HomeGroup,
  type HomeRow,
} from './home-derive.ts';
import {
  HOME_API,
  loadActivity,
  loadAgents,
  loadHandoffs,
  loadMine,
  loadSpaces,
  type ActivityData,
  type AgentsData,
  type HandoffsData,
  type HomeApi,
  type MineData,
  type Spaces,
} from './home-load.ts';
import {
  ageLabel,
  browserPollDeps,
  HOME_POLL_MS,
  isAbort,
  settle,
  startPolling,
  type SectionState,
} from './home-poll.ts';
import './home.css';

export interface HomeScreenProps {
  readonly me: MeProfile;
  /** The review queue the shell already reads for the sidebar's badge — not read twice. */
  readonly reviewQueue: readonly ReviewQueueItem[] | undefined;
  readonly reviewCapped: boolean | undefined;
  /** Ask the shell to read the queue again — the attention section's Retry. */
  readonly refreshReview: () => void;
  readonly onNavigate: (to: string) => void;
  /** The reads, swappable for a test; the real endpoints otherwise. */
  readonly api?: HomeApi;
}

interface Section<T> {
  readonly state: SectionState<T>;
  readonly retry: () => void;
}

/**
 * One section's reads: now, then quietly every minute while the tab is shown
 * and once when it comes back (`startPolling`). A failed re-read keeps the
 * rows (`settle`); a `403` hides the section. Answers to an older read never
 * land over a newer one.
 */
function useSection<T>(load: (signal: AbortSignal) => Promise<T>, enabled: boolean): Section<T> {
  const [state, setState] = useState<SectionState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let latest = 0;
    const read = (): void => {
      latest += 1;
      const mine = latest;
      void loadRef
        .current(controller.signal)
        .then(
          (data) => ({ ok: true as const, data, at: Date.now() }),
          (cause: unknown) => ({ ok: false as const, cause }),
        )
        .then((outcome) => {
          if (controller.signal.aborted || mine !== latest) return;
          if (!outcome.ok && isAbort(outcome.cause)) return;
          setState((was) => settle(was, outcome));
        });
    };
    const stop = startPolling(read, HOME_POLL_MS, browserPollDeps());
    return () => {
      controller.abort();
      stop();
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setState((was) => (was.status === 'error' ? { status: 'loading' } : was));
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

/** A link the app follows itself; a modified click stays the browser's. */
function useFollow(onNavigate: (to: string) => void) {
  return (to: string) => (event: MouseEvent) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    onNavigate(to);
  };
}

/**
 * The Command Center (LAI-1202, proposal `ia-command-center-proactive.md`
 * §2): one page that answers *what needs me, and what do I do next*, from
 * endpoints that exist today. Six sections, each read on its own, each row
 * opening the thing it names, each count opening the list it counts. No
 * metric cards: a number here is always a way into the work.
 *
 * **What the reader sees is what the server lets them read.** A section
 * whose endpoint answers `403` is absent; the agent and activity sections
 * appear only when `GET /permissions` grants their action. No role name is
 * read anywhere.
 */
export function HomeScreen({
  me,
  reviewQueue,
  reviewCapped,
  refreshReview,
  onNavigate,
  api = HOME_API,
}: HomeScreenProps) {
  const gates = useGates(true);
  const follow = useFollow(onNavigate);
  const [now, setNow] = useState(() => Date.now());

  // One read of the reader's spaces, shared by the sections that need it.
  // `/projects` is in the GET cache (`client.ts`), so two sections asking in
  // the same minute is one request.
  const spaces = useCallback((signal: AbortSignal) => loadSpaces(api, signal), [api]);

  const mine = useSection<{ data: MineData; spaces: Spaces }>(async (signal) => {
    const s = await spaces(signal);
    const data = await loadMine(me.id, s, api, signal);
    setNow(Date.now());
    return { data, spaces: s };
  }, true);
  const handoffs = useSection<HandoffsData>((signal) => loadHandoffs(api, signal), true);
  const showAgents = gates.org('agent.read_own');
  const agents = useSection<AgentsData>((signal) => loadAgents(api, signal), showAgents);
  const showActivity = gates.org('member_list.read');
  const activity = useSection<{ data: ActivityData; spaces: Spaces }>(async (signal) => {
    const s = await spaces(signal);
    return { data: await loadActivity(s, api, signal), spaces: s };
  }, showActivity);

  const mineData = mine.state.status === 'ready' ? mine.state.data : undefined;
  const bySlug = mineData?.spaces.bySlug ?? new Map();

  return (
    <div className="page home">
      <ScreenHeader
        variant="page"
        title="Home"
        description="What needs you, what you are on, and what is coming — each a way into the work."
      />
      <div className="home-grid">
        <div className="home-col">
          <AttentionSection
            mine={mine}
            handoffs={handoffs}
            reviewQueue={reviewQueue}
            reviewCapped={reviewCapped === true}
            refreshReview={refreshReview}
            build={(m, h) => ({
              review:
                reviewQueue === undefined
                  ? undefined
                  : reviewGroup(reviewQueue, reviewCapped === true),
              handoffs: h === undefined ? undefined : handoffGroup(h.rows, h.waiting),
              overdue:
                m === undefined
                  ? undefined
                  : overdueGroup(m.data.mine, me.id, now, m.spaces.bySlug),
            })}
            follow={follow}
            now={now}
          />
          <GroupSection
            id="active"
            title="Your active work"
            section={mine}
            group={(m) => activeGroup(m.data.mine, m.data.blockers, me.id, m.spaces.bySlug)}
            empty="Nothing in progress or up next for you."
            countLabel="tasks of yours in progress or up next"
            follow={follow}
            now={now}
          />
          <GroupSection
            id="blocked"
            title="Blocked"
            section={mine}
            group={(m) => blockedGroup(m.data.mine, m.data.blockers, me.id, m.spaces.bySlug)}
            empty="None of your tasks is waiting on another."
            countLabel="of your tasks blocked"
            follow={follow}
            now={now}
          />
        </div>
        <div className="home-col">
          {showAgents && (
            <AgentsSection
              section={agents}
              mine={mineData}
              bySlug={bySlug}
              follow={follow}
              now={now}
            />
          )}
          <GroupSection
            id="coming-up"
            title="Coming up"
            section={mine}
            group={(m) => comingUpGroup(m.data.mine, me.id, now, m.spaces.bySlug)}
            empty="Nothing of yours is due in the next 7 days."
            countLabel="of your tasks due in the next 7 days"
            follow={follow}
            now={now}
          />
          {showActivity && (
            <ActivitySection
              section={activity}
              follow={follow}
              now={now}
              historyHref={gates.org('audit_log.export') ? '/organisation?tab=activity' : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- frame */

interface FrameProps {
  readonly id: string;
  readonly title: string;
  /** The header's count and where it leads, once there is one. */
  readonly count?:
    | {
        readonly n: number;
        readonly floor?: boolean | undefined;
        readonly href: string;
        readonly label: string;
      }
    | undefined;
  /** A link at the header's end — *All activity*. */
  readonly more?: { readonly href: string; readonly label: string } | undefined;
  readonly quiet?: boolean;
  readonly follow: (to: string) => (event: MouseEvent) => void;
  readonly children: ReactNode;
}

function Frame({ id, title, count, more, quiet = false, follow, children }: FrameProps) {
  const heading = `home-${id}-title`;
  return (
    <section
      className={quiet ? 'home-section home-section-quiet' : 'home-section'}
      aria-labelledby={heading}
      data-home-section={id}
    >
      <header className="home-section-head">
        <h2 className="home-section-title" id={heading}>
          {title}
        </h2>
        {count !== undefined && count.n > 0 && (
          <a
            className="home-count"
            href={count.href}
            onClick={follow(count.href)}
            data-home-count={id}
            aria-label={`${String(count.n)}${count.floor === true ? '+' : ''} ${count.label} — open the list`}
          >
            {count.n}
            {count.floor === true ? '+' : ''}
          </a>
        )}
        <span className="home-section-gap" />
        {more !== undefined && (
          <a className="home-more" href={more.href} onClick={follow(more.href)}>
            {more.label} →
          </a>
        )}
      </header>
      {children}
    </section>
  );
}

function SectionError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="home-error" role="alert" data-home-error>
      <p className="home-error-text">Couldn’t load this section. {message}</p>
      <button type="button" className="home-retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function Stale({
  failed,
  at,
  now,
  onRetry,
}: {
  readonly failed: string | undefined;
  readonly at: number;
  readonly now: number;
  readonly onRetry: () => void;
}) {
  if (failed === undefined) return null;
  return (
    <p className="home-stale" role="status" data-home-stale>
      Couldn’t refresh — showing what was read {ageLabel(at, Math.max(now, Date.now()))}.{' '}
      <button type="button" className="home-retry-inline" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

function Rows({
  rows,
  follow,
}: {
  readonly rows: readonly HomeRow[];
  readonly follow: (to: string) => (event: MouseEvent) => void;
}) {
  return (
    <ul className="home-rows">
      {rows.map((row) => (
        <li key={row.id} className="home-row" data-home-row={row.key}>
          <a className="home-row-link" href={row.href} onClick={follow(row.href)}>
            <span className="home-row-key">{row.key}</span>
            <span className="home-row-title">{row.title}</span>
          </a>
          <span className="home-row-meta">
            {row.note !== undefined && (
              <span className={`home-note home-note-${row.tone ?? 'plain'}`}>{row.note}</span>
            )}
            {row.space !== undefined && <span className="home-row-space">{row.space}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a section draws before it has rows of its own: a skeleton, its error,
 * or nothing. A refused section (`forbidden`) is the caller's to drop.
 */
function pending<T>(section: Section<T>): ReactNode {
  const { state, retry } = section;
  if (state.status === 'loading') {
    return <LoadingState shape="row" count={3} label="Loading this section" />;
  }
  if (state.status === 'error') return <SectionError message={state.message} onRetry={retry} />;
  return undefined;
}

/* ---------------------------------------------------- needs attention */

function AttentionSection({
  mine,
  handoffs,
  reviewQueue,
  reviewCapped,
  refreshReview,
  build,
  follow,
  now,
}: {
  readonly mine: Section<{ data: MineData; spaces: Spaces }>;
  readonly handoffs: Section<HandoffsData>;
  readonly reviewQueue: readonly ReviewQueueItem[] | undefined;
  readonly reviewCapped: boolean;
  readonly refreshReview: () => void;
  readonly build: (
    m: { data: MineData; spaces: Spaces } | undefined,
    h: HandoffsData | undefined,
  ) => Attention;
  readonly follow: (to: string) => (event: MouseEvent) => void;
  readonly now: number;
}) {
  const title = 'Needs your attention';
  // Three sources, each failing alone: a refused or broken one drops its own
  // group and says so, and the others still draw.
  if (mine.state.status === 'loading' && handoffs.state.status === 'loading') {
    return (
      <Frame id="attention" title={title} follow={follow}>
        <LoadingState shape="row" count={3} label="Loading what needs your attention" />
      </Frame>
    );
  }
  const mineData = mine.state.status === 'ready' ? mine.state.data : undefined;
  const handoffData = handoffs.state.status === 'ready' ? handoffs.state.data : undefined;
  const attention = build(mineData, handoffData);

  const group = (
    id: string,
    heading: string,
    g: HomeGroup | undefined,
    label: string,
  ): ReactNode => {
    if (g === undefined || g.count === 0) return null;
    return (
      <div className="home-group" data-home-group={id}>
        <h3 className="home-group-title">
          {heading}{' '}
          <a
            className="home-count"
            href={g.href}
            onClick={follow(g.href)}
            data-home-count={id}
            aria-label={`${String(g.count)}${g.floor === true ? '+' : ''} ${label} — open the list`}
          >
            {g.count}
            {g.floor === true ? '+' : ''}
          </a>
        </h3>
        <Rows rows={g.rows} follow={follow} />
      </div>
    );
  };

  const mineFailed = mine.state.status === 'error' ? mine.state.message : undefined;
  const handoffFailed = handoffs.state.status === 'error' ? handoffs.state.message : undefined;
  const settled =
    mine.state.status !== 'loading' &&
    handoffs.state.status !== 'loading' &&
    reviewQueue !== undefined;
  const empty = attentionEmpty(attention);
  const quiet = empty && settled && mineFailed === undefined && handoffFailed === undefined;
  return (
    <Frame id="attention" title={title} quiet={quiet} follow={follow}>
      {mine.state.status === 'ready' && (
        <Stale failed={mine.state.failed} at={mine.state.at} now={now} onRetry={mine.retry} />
      )}
      {handoffs.state.status === 'ready' && (
        <Stale
          failed={handoffs.state.failed}
          at={handoffs.state.at}
          now={now}
          onRetry={handoffs.retry}
        />
      )}
      {mineFailed !== undefined && (
        <SectionError message={`Your tasks: ${mineFailed}`} onRetry={mine.retry} />
      )}
      {handoffFailed !== undefined && (
        <SectionError message={`Hand-offs: ${handoffFailed}`} onRetry={handoffs.retry} />
      )}
      {empty ? (
        <p className="home-quiet" data-home-empty>
          {settled
            ? 'Nothing needs you right now — no reviews, hand-offs or overdue work.'
            : 'Nothing yet — still reading the rest.'}
        </p>
      ) : (
        <>
          {group('review', 'Waiting on your review', attention.review, 'waiting on your review')}
          {group('handoffs', 'Hand-offs to approve', attention.handoffs, 'hand-offs to approve')}
          {group('overdue', 'Overdue', attention.overdue, 'of your tasks overdue')}
        </>
      )}
      {reviewCapped && attention.review !== undefined && attention.review.count > 0 && (
        <p className="home-footnote">
          The review queue is longer than the server sends at once.{' '}
          <button type="button" className="home-retry-inline" onClick={refreshReview}>
            Refresh
          </button>
        </p>
      )}
    </Frame>
  );
}

/* ------------------------------------------------------- task groups */

function GroupSection<T>({
  id,
  title,
  section,
  group,
  empty,
  countLabel,
  follow,
  now,
}: {
  readonly id: string;
  readonly title: string;
  readonly section: Section<T>;
  readonly group: (data: T) => HomeGroup;
  readonly empty: string;
  readonly countLabel: string;
  readonly follow: (to: string) => (event: MouseEvent) => void;
  readonly now: number;
}) {
  if (section.state.status === 'forbidden') return null;
  const before = pending(section);
  if (before !== undefined || section.state.status !== 'ready') {
    return (
      <Frame id={id} title={title} follow={follow}>
        {before}
      </Frame>
    );
  }
  const g = group(section.state.data);
  return (
    <Frame
      id={id}
      title={title}
      quiet={g.count === 0}
      count={{ n: g.count, floor: g.floor, href: g.href, label: countLabel }}
      follow={follow}
    >
      <Stale
        failed={section.state.failed}
        at={section.state.at}
        now={now}
        onRetry={section.retry}
      />
      {g.count === 0 ? (
        <p className="home-quiet" data-home-empty>
          {empty}
        </p>
      ) : (
        <>
          <Rows rows={g.rows} follow={follow} />
          {g.count > g.rows.length && (
            <a className="home-more home-more-foot" href={g.href} onClick={follow(g.href)}>
              {g.count - g.rows.length} more →
            </a>
          )}
        </>
      )}
    </Frame>
  );
}

/* ------------------------------------------------------------- agents */

function AgentsSection({
  section,
  mine,
  bySlug,
  follow,
  now,
}: {
  readonly section: Section<AgentsData>;
  readonly mine: { data: MineData; spaces: Spaces } | undefined;
  readonly bySlug: ReadonlyMap<string, { slug: string; name: string }>;
  readonly follow: (to: string) => (event: MouseEvent) => void;
  readonly now: number;
}) {
  if (section.state.status === 'forbidden') return null;
  const before = pending(section);
  const title = 'Your agents';
  if (before !== undefined || section.state.status !== 'ready') {
    return (
      <Frame id="agents" title={title} follow={follow}>
        {before}
      </Frame>
    );
  }
  const rows = agentRows(
    section.state.data.agents,
    section.state.data.sessions,
    mine?.data.mine ?? [],
    bySlug,
  );
  return (
    <Frame
      id="agents"
      title={title}
      quiet={rows.length === 0}
      count={{ n: rows.length, href: AGENTS_HREF, label: 'active agents of yours' }}
      follow={follow}
    >
      <Stale
        failed={section.state.failed}
        at={section.state.at}
        now={now}
        onRetry={section.retry}
      />
      {rows.length === 0 ? (
        <p className="home-quiet" data-home-empty>
          You have no agents yet.{' '}
          <a href={AGENTS_HREF} onClick={follow(AGENTS_HREF)}>
            Connect one →
          </a>
        </p>
      ) : (
        <ul className="home-rows">
          {rows.map((agent) => (
            <AgentItem key={agent.id} agent={agent} follow={follow} />
          ))}
        </ul>
      )}
    </Frame>
  );
}

function AgentItem({
  agent,
  follow,
}: {
  readonly agent: AgentRow;
  readonly follow: (to: string) => (event: MouseEvent) => void;
}) {
  return (
    <li className="home-row home-agent" data-home-agent={agent.id}>
      <span className="home-agent-who">
        <span className="home-agent-name">{agent.name}</span>
        <span className="home-row-space">{agent.harness}</span>
      </span>
      <span
        className={`home-conn home-conn-${agent.connection}`}
        data-connection={agent.connection}
      >
        <span className="home-conn-mark" aria-hidden="true" />
        {agent.label}
      </span>
      {agent.claims.length > 0 && (
        <ul className="home-claims" aria-label={`What ${agent.name} holds`}>
          {agent.claims.map((claim) => (
            <li key={claim.id}>
              <a className="home-row-link" href={claim.href} onClick={follow(claim.href)}>
                <span className="home-row-key">{claim.key}</span>
                <span className="home-row-title">{claim.title}</span>
              </a>
              {claim.note !== undefined && (
                <span className={`home-note home-note-${claim.tone ?? 'plain'}`}>{claim.note}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* ----------------------------------------------------------- activity */

function ActivitySection({
  section,
  follow,
  now,
  historyHref,
}: {
  readonly section: Section<{ data: ActivityData; spaces: Spaces }>;
  readonly follow: (to: string) => (event: MouseEvent) => void;
  readonly now: number;
  readonly historyHref: string | undefined;
}) {
  if (section.state.status === 'forbidden') return null;
  const before = pending(section);
  const title = 'Recent activity';
  const more = historyHref === undefined ? undefined : { href: historyHref, label: 'All activity' };
  if (before !== undefined || section.state.status !== 'ready') {
    return (
      <Frame id="activity" title={title} more={more} follow={follow}>
        {before}
      </Frame>
    );
  }
  const { data, spaces } = section.state.data;
  const rows = activityRows(data.events, spaces.byId);
  return (
    <Frame id="activity" title={title} quiet={rows.length === 0} more={more} follow={follow}>
      <Stale
        failed={section.state.failed}
        at={section.state.at}
        now={now}
        onRetry={section.retry}
      />
      {rows.length === 0 ? (
        <p className="home-quiet" data-home-empty>
          Nothing has happened in your spaces yet.
        </p>
      ) : (
        <ol className="home-rows home-feed">
          {rows.map(({ event, space, href }) => {
            const actor = describeActor(event, data.members);
            const what = (
              <>
                <b>{actor.name}</b>
                {actor.badge !== undefined && (
                  <span className="visually-hidden"> ({actor.badge})</span>
                )}{' '}
                {describeEvent(event)}
              </>
            );
            return (
              <li key={event.id} className="home-row home-feed-row" data-home-event={event.id}>
                {href === undefined ? (
                  <span className="home-feed-what">{what}</span>
                ) : (
                  <a className="home-feed-what home-row-link" href={href} onClick={follow(href)}>
                    {what}
                  </a>
                )}
                <span className="home-row-meta">
                  {space !== undefined && <span className="home-row-space">{space}</span>}
                  <time dateTime={new Date(event.created_at).toISOString()}>
                    {ageLabel(event.created_at, now)}
                  </time>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Frame>
  );
}
