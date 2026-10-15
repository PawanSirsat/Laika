import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { PermissionDenied } from '../../../components/PermissionDenied.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { agentClientName } from '../../../api/agent-clients.ts';
import { ApiError } from '../../../api/errors.ts';
import type { OrgRole } from '../../../api/invites.ts';
import type { MeProfile } from '../../../api/me.ts';
import {
  attemptKey,
  getProfile,
  mayOpenProfiles,
  mayRate,
  PROFILE_KINDS,
  rateMember,
  setProfileKind,
  type MemberProfile,
  type MemberRating,
  type ProfileAgents,
  type ProfileCurrentWork,
  type ProfileDelivery,
  type ProfileKind,
  type ProfileProject,
  type ProfileQueue,
  type ProfileReview,
  type ProfileTask,
} from '../../../api/profiles.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { SCREEN_COPY } from '../screen-copy.ts';
import { InfoTip } from './InfoTip.tsx';
import {
  agentRows,
  barHeights,
  countLabel,
  durationLabel,
  lastActive,
  monthYear,
  nextAttempt,
  type RatingAttempt,
  scoreLabel,
  weekLabel,
} from './profile-derive.ts';
import { RatingDialog } from './RatingDialog.tsx';
import './profile.css';

export interface ProfileScreenProps {
  /** `?user=` — whose profile. */
  readonly userId: string | undefined;
  readonly me: MeProfile | undefined;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly profile: MemberProfile };

const KINDS: Readonly<Record<ProfileKind, { label: string; hint: string }>> = {
  builder: {
    label: 'Builder',
    hint: 'does the work: delivery, current work and the agents they use.',
  },
  manager: {
    label: 'Manager',
    hint: 'reviews and leads: the review queue, review load and decisions.',
  },
};

/**
 * What each figure counts — said once, in the (i) beside it and in the tile's
 * tooltip, rather than as paragraphs under every card (LAI-750). The words are
 * SPEC §6.4's.
 */
const MEANS = {
  accepted: 'Moved into a Done status by someone other than them.',
  sentBack: 'Moved from Review back to an earlier status by someone other than them.',
  reopened: 'Moved out of Done into work again, by anyone.',
  cycle:
    'From the first start to completion, for their tasks done in the window. Tasks done with no recorded start are counted, not measured.',
  reviewAccepted: 'Their moves of somebody else’s task into a Done status.',
  reviewSentBack: 'Their moves of somebody else’s task from Review back to an earlier status.',
  decided30: 'Their accepts and send-backs on other people’s work in the last 30 days.',
  decide:
    'Median time from a task’s latest move into Review to their decision on it. Decisions made from outside Review are counted, not measured.',
  led: 'Projects where their membership role is Lead, not archived.',
  waiting: 'Tasks in Review in the projects they lead, assigned to anyone but them.',
  oldest: 'How long the longest-waiting of those has been in Review.',
} as const;

/** Categorical slots for the agent-share bar, in rank order (tokens only). */
const SHARE_SLOTS = 6;

/** The server's sentence when there is one; never "something went wrong" over it. */
function said(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'That did not go through. Try again.';
}

/**
 * One member's profile (SPEC §11.4.2, D-078, LAI-743, LAI-750): what the board
 * recorded about their work, a Builder/Manager label, and a private rating —
 * laid out as the strategy page's profile mockup is (LAI-750), on real data.
 *
 * ## Owners and admins only
 *
 * Anyone else is told so and **the profile is never asked for** — the server
 * would refuse it, and a request that can only be refused is a request this
 * screen should not make. The links into it are drawn for the same readers
 * only (`PersonLink`).
 *
 * ## Every figure is the server's
 *
 * Nothing here counts anything: each number is a field of
 * `GET /users/:id/profile`, and an absence reads as a sentence or a dash, never
 * as a zero. A manager's response carries no agent, work or delivery block and
 * a builder's no queue, so those cards are absent — not empty — and that is all
 * the kind changes. What a figure means is in the (i) beside it.
 */
export function ProfileScreen({ userId, me }: ProfileScreenProps) {
  const allowed = mayOpenProfiles(me?.org_role);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [kindBusy, setKindBusy] = useState(false);
  const [kindError, setKindError] = useState<string | undefined>(undefined);
  const [rating, setRating] = useState<{ open: boolean; busy: boolean; error?: string }>({
    open: false,
    busy: false,
  });
  const rateButton = useRef<HTMLButtonElement>(null);
  /**
   * The rating being tried for each member, and its `Idempotency-Key`
   * (LAI-746). Kept across a failed try and a closed dialog — a response lost
   * on the way back may still have been written — and dropped once a save is
   * answered. **One per member** (LAI-749): this screen stays mounted when
   * `?user=` changes, and a key from one member's attempt must never be sent
   * for another's.
   */
  const ratingAttempts = useRef(new Map<string, RatingAttempt>());

  useEffect(() => {
    if (!allowed || userId === undefined) return;
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    getProfile(userId, controller.signal)
      .then((profile) => {
        setLoad({ kind: 'ready', profile });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoad({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [allowed, userId, attempt]);

  const header = (
    <ScreenHeader title="Member profile" context="Visible to owners and admins only" />
  );

  if (me === undefined) return null;

  if (!allowed) {
    return (
      <div className="prof">
        {header}
        <PermissionDenied resource="member profiles" requiredRole="admin" scope="organisation" />
      </div>
    );
  }

  if (userId === undefined || userId === '') {
    return (
      <div className="prof">
        {header}
        <EmptyState
          headline={SCREEN_COPY['/people']?.headline ?? ''}
          body={SCREEN_COPY['/people']?.body ?? ''}
        />
      </div>
    );
  }

  if (load.kind === 'loading') {
    return (
      <div className="prof">
        {header}
        <LoadingState shape="card" count={4} label="Loading the profile" />
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="prof">
        {header}
        {load.error instanceof ApiError && load.error.code === 'not_found' ? (
          <EmptyState
            headline="No such person"
            body="Nobody in this organisation has that id. The link may be from before they were removed, or mistyped."
          />
        ) : (
          <ApiErrorState
            error={load.error}
            resource="this profile"
            requiredRole="admin"
            scope="organisation"
            onRetry={() => {
              setAttempt((n) => n + 1);
            }}
          />
        )}
      </div>
    );
  }

  const { profile } = load;
  const { user } = profile;
  const now = Date.now();
  const weeks = profile.window.weeks;

  const changeKind = (kind: ProfileKind): void => {
    if (kind === user.profile_kind || kindBusy) return;
    setKindBusy(true);
    setKindError(undefined);
    setProfileKind(user.id, kind)
      .then((next) => {
        setLoad({ kind: 'ready', profile: next });
      })
      .catch((cause: unknown) => {
        setKindError(said(cause));
      })
      .finally(() => {
        setKindBusy(false);
      });
  };

  const save = (score: number, note: string): void => {
    const trying = nextAttempt(
      ratingAttempts.current.get(user.id),
      user.id,
      score,
      note,
      attemptKey,
    );
    ratingAttempts.current.set(user.id, trying);
    setRating({ open: true, busy: true });
    rateMember(user.id, { score, note }, trying.key).then(
      () => {
        ratingAttempts.current.delete(user.id);
        setRating({ open: false, busy: false });
        // The whole profile again rather than splicing the answer in: the
        // order of the history is the server's, and so is every figure. A
        // failure here is a failed *read* — the rating was saved — so it is
        // the screen's error state, never the dialog's.
        getProfile(user.id)
          .then((next) => {
            setLoad({ kind: 'ready', profile: next });
          })
          .catch((cause: unknown) => {
            setLoad({ kind: 'error', error: cause });
          });
      },
      (cause: unknown) => {
        setRating({ open: true, busy: false, error: said(cause) });
      },
    );
  };

  const ratingCard = (span: 2 | 6) => (
    <RatingCard
      span={span}
      ratings={profile.ratings}
      total={profile.ratings_total}
      self={me.id === user.id}
      canRate={mayRate(me, user.id)}
      now={now}
      buttonRef={rateButton}
      onRate={() => {
        setRating({ open: true, busy: false });
      }}
    />
  );

  return (
    <div className="prof" data-kind={user.profile_kind}>
      {header}

      <ProfileHead profile={profile} busy={kindBusy} error={kindError} onKind={changeKind} />

      {/*
       * A wide card beside a stack of short ones, so no card stretches to a
       * neighbour's height around empty space; the grid folds to two columns
       * and then one (profile.css).
       */}
      <div className="prof-grid">
        {user.profile_kind === 'manager' ? (
          <>
            <ReviewCard
              review={profile.review}
              queue={profile.queue}
              weeks={weeks}
              now={now}
              span={4}
              title="Review work"
            />
            <div className="prof-stack">
              <ProjectsCard
                projects={profile.projects}
                queue={profile.queue}
                kind="manager"
                weeks={weeks}
              />
              {ratingCard(2)}
            </div>
            <DecisionsCard review={profile.review} weeks={weeks} now={now} />
          </>
        ) : (
          <>
            {profile.delivery !== undefined && (
              <DeliveryCard delivery={profile.delivery} weeks={weeks} />
            )}
            <div className="prof-stack">
              <ProjectsCard projects={profile.projects} kind="builder" weeks={weeks} />
              {profile.agents !== undefined && <OnlineCard agents={profile.agents} now={now} />}
            </div>
            {profile.current_work !== undefined && (
              <CurrentWorkCard work={profile.current_work} now={now} />
            )}
            {profile.agents !== undefined && (
              <AgentsCard agents={profile.agents} weeks={weeks} now={now} />
            )}
            <ReviewCard
              review={profile.review}
              weeks={weeks}
              now={now}
              span={2}
              title="Review work for others"
            />
            {ratingCard(6)}
          </>
        )}
      </div>

      {rating.open && (
        <RatingDialog
          name={user.name}
          busy={rating.busy}
          error={rating.error}
          onSave={save}
          onClose={() => {
            // A save in flight is not abandoned by closing (LAI-746): the
            // dialog waits for its answer, here as well as in the dialog.
            if (rating.busy) return;
            setRating({ open: false, busy: false });
          }}
          restoreFocus={() => rateButton.current}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------- head

/** A padlock in the ordinary sense — *only some people can see this*. */
function Padlock() {
  return (
    <svg className="prof-pill-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}

function ProfileHead({
  profile,
  busy,
  error,
  onKind,
}: {
  readonly profile: MemberProfile;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onKind: (kind: ProfileKind) => void;
}) {
  const { theme } = useTheme();
  const { user } = profile;
  const ink = avatarColor(user.id, theme);
  const avatar: CSSProperties & Record<'--ring', string> = {
    background: ink.background,
    color: ink.foreground,
    '--ring': ink.background,
  };

  return (
    <section className="prof-head" aria-labelledby="prof-name">
      <div className="prof-id">
        <span className="prof-avatar" style={avatar} aria-hidden="true">
          {initials(user.name)}
        </span>
        <div className="prof-who">
          <h2 className="prof-name" id="prof-name">
            {user.name}
            {!user.is_active && <span className="prof-chip prof-chip-off">DEACTIVATED</span>}
          </h2>
          <p className="prof-meta">
            <span>{orgRoleLabel(user.org_role as OrgRole)}</span>
            <span>{countLabel(profile.projects.length, 'project', 'projects')}</span>
            <span className="prof-meta-email">{user.email}</span>
            <span>Member since {monthYear(user.created_at)}</span>
          </p>
          <p className="prof-tags">
            <span className="prof-pill">
              <Padlock />
              Owners and admins only
            </span>
          </p>
        </div>
      </div>

      <div className="prof-kind">
        <span className="prof-kind-text">
          <span className="prof-kind-label" id="prof-kind-label">
            Profile kind
          </span>
          <span className="prof-kind-note" id="prof-kind-note">
            admin only · a label, never a permission
          </span>
          <InfoTip label="What the profile kinds mean">
            <dl className="prof-defs">
              {PROFILE_KINDS.map((kind) => (
                <div key={kind}>
                  <dt>{KINDS[kind].label}</dt>
                  <dd>{KINDS[kind].hint}</dd>
                </div>
              ))}
            </dl>
            <p className="prof-defs-foot">
              It decides what this page shows — never what they may do. Only owners and admins see
              or set it.
            </p>
          </InfoTip>
          {busy && <Spinner size="sm" />}
        </span>
        <div
          className="prof-seg"
          role="radiogroup"
          aria-labelledby="prof-kind-label"
          aria-describedby="prof-kind-note"
          aria-busy={busy}
        >
          {PROFILE_KINDS.map((kind) => (
            <label key={kind} className="prof-seg-option">
              <input
                type="radio"
                name="profile-kind"
                value={kind}
                checked={user.profile_kind === kind}
                disabled={busy}
                onChange={() => {
                  onKind(kind);
                }}
              />
              <span className="prof-seg-face">{KINDS[kind].label}</span>
            </label>
          ))}
        </div>
        {error !== undefined && (
          <p className="prof-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- parts

function Card({
  name,
  title,
  count,
  caption,
  info,
  span = 2,
  children,
  actions,
}: {
  readonly name: string;
  readonly title: string;
  readonly count?: number | undefined;
  /** A few muted words after the title — what it counts, over when. */
  readonly caption?: string | undefined;
  /** The (i): what this card's figures mean. */
  readonly info?: ReactNode;
  /** Of six columns on a laptop; the grid folds to two, then one. */
  readonly span?: 2 | 3 | 4 | 6;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}) {
  const id = `prof-${name}-title`;
  return (
    <section className="prof-card" data-section={name} data-span={span} aria-labelledby={id}>
      <header className="prof-card-head">
        <h3 className="prof-card-title" id={id}>
          {title}
        </h3>
        {count !== undefined && <span className="prof-card-count">{count}</span>}
        {caption !== undefined && <span className="prof-card-caption">{caption}</span>}
        {info !== undefined && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}
        {actions !== undefined && <span className="prof-card-actions">{actions}</span>}
      </header>
      {children}
    </section>
  );
}

type Def = readonly [term: string, meaning: string];

/** Definitions for an (i): term, then what it counts. */
function Defs({ items }: { readonly items: readonly Def[] }) {
  return (
    <dl className="prof-defs">
      {items.map(([term, meaning]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A metric tile: a small label, a big number, and an optional second value
 * beside it (`3 d / 4.5 d`). Its meaning is the tile's tooltip as well as the
 * card's (i).
 */
function Stat({
  name,
  label,
  value,
  sub,
  hint,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly sub?: string | undefined;
  readonly hint?: string | undefined;
}) {
  return (
    <div className="prof-stat" data-stat={name} title={hint}>
      <dt className="prof-stat-label">{label}</dt>
      <dd className="prof-stat-value">{value}</dd>
      {sub !== undefined && <dd className="prof-stat-sub">{sub}</dd>}
    </div>
  );
}

/**
 * How many a capped list is not showing (LAI-746). The server sends at most 50
 * of each and the total beside it; nothing is drawn when nothing was cut.
 */
function More({ shown, total }: { readonly shown: number; readonly total: number }) {
  const more = total - shown;
  return more > 0 ? <p className="prof-more">and {more} more</p> : null;
}

/** An empty card's one sentence, where its chart or list would be. */
function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="prof-empty">{children}</p>;
}

/**
 * Bars per week of the window, oldest first, from a shared baseline. One
 * series or two stacked; each bar carries its own words for a screen reader
 * and a tooltip, and the list is labelled, so the chart has a text form.
 */
function WeekBars({
  label,
  weeks,
}: {
  readonly label: string;
  readonly weeks: readonly {
    readonly week_start: number;
    readonly values: readonly number[];
    readonly text: string;
  }[];
}) {
  const heights = barHeights(weeks.map((w) => w.values.reduce((sum, n) => sum + n, 0)));
  const totals = weeks.map((w) => w.values.reduce((sum, n) => sum + n, 0));
  const most = Math.max(0, ...totals);
  const first = weeks[0];
  return (
    <figure className="prof-chart">
      <ol className="prof-bars" aria-label={label}>
        {weeks.map((week, i) => {
          const total = totals[i] ?? 0;
          return (
            <li
              key={week.week_start}
              className="prof-bar"
              data-week={week.week_start}
              data-values={week.values.join(',')}
              data-zero={total === 0}
              title={week.text}
            >
              <span
                className="prof-bar-col"
                style={
                  total === 0
                    ? undefined
                    : { height: `${String(Math.round((heights[i] ?? 0) * 100))}%` }
                }
                aria-hidden="true"
              >
                {total > 0 && <span className="prof-bar-n">{total}</span>}
                <span className="prof-bar-stack">
                  {week.values.map((value, part) => (
                    <span
                      key={part}
                      className="prof-bar-fill"
                      data-part={part}
                      style={{ flexGrow: value }}
                    />
                  ))}
                </span>
              </span>
              <span className="visually-hidden">{week.text}</span>
            </li>
          );
        })}
      </ol>
      {first !== undefined && (
        <figcaption className="prof-bars-axis">
          <span>{weekLabel(first.week_start)}</span>
          <span>{most === 0 ? '' : `peak ${String(most)}`}</span>
          <span>this week</span>
        </figcaption>
      )}
    </figure>
  );
}

function projectRole(project: ProfileProject): string {
  if (project.role === null) return 'No membership';
  return project.role.charAt(0).toUpperCase() + project.role.slice(1);
}

/**
 * Projects as horizontal bars. A builder's bar is their open work there now;
 * a manager's is the review decisions they made there in the window — one
 * measure per bar, named in the caption, and the rest of the row's figures as
 * words under the name.
 */
function ProjectsCard({
  projects,
  queue,
  kind,
  weeks,
}: {
  readonly projects: readonly ProfileProject[];
  readonly queue?: ProfileQueue | undefined;
  readonly kind: ProfileKind;
  readonly weeks: number;
}) {
  const value = (p: ProfileProject) => (kind === 'manager' ? p.reviewed : p.open_tasks);
  const widths = barHeights(projects.map(value));
  const waiting = new Map(queue?.projects.map((p) => [p.project_id, p.waiting]) ?? []);

  return (
    <Card
      name="projects"
      title="Projects"
      count={projects.length}
      caption={kind === 'manager' ? `decisions · ${String(weeks)} wk` : 'open tasks now'}
      info={
        <Defs
          items={[
            [
              'The bar',
              kind === 'manager'
                ? `Review decisions they made there in the last ${String(weeks)} weeks.`
                : 'Their tasks there that are neither done nor cancelled.',
            ],
            ['Accepted', `${MEANS.accepted} Last ${String(weeks)} weeks.`],
            [
              'Reviewed',
              `Their decisions there on other people’s work, last ${String(weeks)} weeks.`,
            ],
            ...(kind === 'manager' ? ([['Waiting', MEANS.waiting]] satisfies Def[]) : []),
          ]}
        />
      }
    >
      {projects.length === 0 ? (
        <Empty>No projects yet — no membership, no assigned work, no reviews.</Empty>
      ) : (
        <ul className="prof-pbars">
          {projects.map((project, i) => {
            const wait = waiting.get(project.id);
            return (
              <li key={project.id} className="prof-project" data-project={project.slug}>
                <span className="prof-project-name">
                  <span className="prof-key">{project.key}</span>
                  <span className="prof-project-title">{project.name}</span>
                  {project.archived && <span className="prof-chip">ARCHIVED</span>}
                </span>
                <span className="prof-pbar" aria-hidden="true">
                  <span
                    className="prof-pbar-fill"
                    style={{ width: `${String(Math.round((widths[i] ?? 0) * 100))}%` }}
                  />
                </span>
                <b className="prof-pbar-n">{value(project)}</b>
                <span className="prof-row-meta">
                  {projectRole(project)}
                  {wait !== undefined && ` · ${String(wait)} waiting`}
                  {kind === 'manager'
                    ? project.open_tasks > 0
                      ? ` · ${String(project.open_tasks)} of their own open`
                      : ''
                    : ` · ${String(project.accepted)} accepted · ${String(project.reviewed)} reviewed`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function TaskRow({ task, now }: { readonly task: ProfileTask; readonly now: number }) {
  return (
    <li className="prof-task">
      <span className="prof-key">{task.key}</span>
      <span className="prof-task-who">
        <span className="prof-task-title" title={task.title}>
          {task.title}
        </span>
        <span className="prof-row-meta">
          {task.status_name}
          {task.started_at !== null && ` · started ${durationLabel(now - task.started_at)} ago`}
        </span>
      </span>
    </li>
  );
}

function CurrentWorkCard({
  work,
  now,
}: {
  readonly work: ProfileCurrentWork;
  readonly now: number;
}) {
  const empty = work.in_progress_total === 0 && work.in_review_total === 0;
  // The server sends in-progress work oldest start first.
  const oldest = work.in_progress.find((task) => task.started_at !== null)?.started_at ?? null;
  return (
    <Card name="current" title="Current work">
      <dl className="prof-stats prof-stats-compact">
        <Stat name="in_progress" label="In progress" value={String(work.in_progress_total)} />
        <Stat name="in_review" label="In review" value={String(work.in_review_total)} />
        <Stat
          name="oldest_in_progress"
          label="Oldest started"
          value={oldest === null ? '—' : durationLabel(now - oldest)}
          hint="How long ago their longest-running task in progress was first started."
        />
      </dl>
      {empty ? (
        <Empty>Nothing in progress or in review.</Empty>
      ) : (
        <>
          {work.in_progress.length > 0 && (
            <>
              <h4 className="prof-sub">In progress</h4>
              <ul className="prof-list">
                {work.in_progress.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} />
                ))}
              </ul>
            </>
          )}
          <More shown={work.in_progress.length} total={work.in_progress_total} />
          {work.in_review.length > 0 && (
            <>
              <h4 className="prof-sub">In review</h4>
              <ul className="prof-list">
                {work.in_review.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} />
                ))}
              </ul>
            </>
          )}
          <More shown={work.in_review.length} total={work.in_review_total} />
        </>
      )}
    </Card>
  );
}

function DeliveryCard({
  delivery,
  weeks,
}: {
  readonly delivery: ProfileDelivery;
  readonly weeks: number;
}) {
  const { cycle_time: cycle } = delivery;

  return (
    <Card
      name="delivery"
      title="Delivered"
      caption={`${String(weeks)} weeks`}
      span={4}
      info={
        <Defs
          items={[
            ['Accepted', MEANS.accepted],
            ['Sent back', MEANS.sentBack],
            ['Reopened', MEANS.reopened],
            ['Cycle time', MEANS.cycle],
          ]}
        />
      }
    >
      {delivery.accepted === 0 ? (
        <Empty>Nothing accepted in these {weeks} weeks.</Empty>
      ) : (
        <WeekBars
          label={`Accepted per week, the last ${String(weeks)} weeks`}
          weeks={delivery.accepted_per_week.map((week) => ({
            week_start: week.week_start,
            values: [week.accepted],
            text: `Week of ${weekLabel(week.week_start)}: ${String(week.accepted)} accepted`,
          }))}
        />
      )}
      <dl className="prof-stats">
        <Stat
          name="accepted"
          label="Accepted"
          value={String(delivery.accepted)}
          hint={MEANS.accepted}
        />
        <Stat
          name="sent_back"
          label="Sent back"
          value={String(delivery.sent_back)}
          hint={MEANS.sentBack}
        />
        <Stat
          name="reopened"
          label="Reopened"
          value={String(delivery.reopened)}
          hint={MEANS.reopened}
        />
        <Stat
          name="cycle"
          label="Cycle p50 / p75"
          value={durationLabel(cycle.p50_ms)}
          sub={cycle.p75_ms === null ? undefined : `/ ${durationLabel(cycle.p75_ms)}`}
          hint={MEANS.cycle}
        />
      </dl>
      {cycle.unmeasured > 0 && (
        <p className="prof-unmeasured">
          {cycle.unmeasured} done with no recorded start — counted, not measured.
        </p>
      )}
    </Card>
  );
}

/**
 * Review work on other people's tasks — for a builder, a side card; for a
 * manager, the main one, with their queue's tiles in front of it.
 */
function ReviewCard({
  review,
  queue,
  weeks,
  now,
  span,
  title,
}: {
  readonly review: ProfileReview;
  readonly queue?: ProfileQueue | undefined;
  readonly weeks: number;
  readonly now: number;
  readonly span: 2 | 4;
  readonly title: string;
}) {
  const decided = review.accepted + review.sent_back;
  const decide = review.time_to_decide;
  return (
    <Card
      name="review"
      title={title}
      caption={`${String(weeks)} weeks`}
      span={span}
      info={
        <Defs
          items={[
            ...(queue === undefined
              ? []
              : ([
                  ['Projects led', MEANS.led],
                  ['Waiting now', MEANS.waiting],
                  ['Oldest waiting', MEANS.oldest],
                ] satisfies Def[])),
            ['Decided · 30 days', MEANS.decided30],
            ['Accepted', MEANS.reviewAccepted],
            ['Sent back', MEANS.reviewSentBack],
            ['Time to decide', MEANS.decide],
          ]}
        />
      }
    >
      <dl className="prof-stats">
        {queue !== undefined && (
          <Stat
            name="projects_led"
            label="Projects led"
            value={String(queue.projects_led)}
            hint={MEANS.led}
          />
        )}
        <Stat
          name="review_30d"
          label="Decided · 30 days"
          value={String(review.last_30_days)}
          hint={MEANS.decided30}
        />
        <Stat
          name="review_accepted"
          label="Accepted"
          value={String(review.accepted)}
          hint={MEANS.reviewAccepted}
        />
        <Stat
          name="review_sent_back"
          label="Sent back"
          value={String(review.sent_back)}
          hint={MEANS.reviewSentBack}
        />
        <Stat
          name="decide_p50"
          label="Median to decide"
          value={durationLabel(decide.p50_ms)}
          sub={decide.unmeasured > 0 ? `${String(decide.measured)} timed` : undefined}
          hint={MEANS.decide}
        />
        {queue !== undefined && (
          <>
            <Stat
              name="waiting"
              label="Waiting now"
              value={String(queue.waiting)}
              hint={MEANS.waiting}
            />
            <Stat
              name="oldest_waiting"
              label="Oldest waiting"
              value={
                queue.oldest_waiting_since === null
                  ? '—'
                  : durationLabel(Math.max(0, now - queue.oldest_waiting_since))
              }
              hint={MEANS.oldest}
            />
          </>
        )}
      </dl>
      {decided === 0 ? (
        <Empty>No review decisions on other people’s work in these {weeks} weeks.</Empty>
      ) : (
        <div className="prof-load">
          <h4 className="prof-sub">Review load per week</h4>
          <WeekBars
            label={`Review decisions per week, the last ${String(weeks)} weeks`}
            weeks={review.per_week.map((week) => ({
              week_start: week.week_start,
              values: [week.accepted, week.sent_back],
              text: `Week of ${weekLabel(week.week_start)}: ${String(week.accepted)} accepted, ${String(week.sent_back)} sent back`,
            }))}
          />
          <p className="prof-legend" aria-hidden="true">
            <span className="prof-swatch" data-part="0" /> Accepted
            <span className="prof-swatch" data-part="1" /> Sent back
          </p>
        </div>
      )}
    </Card>
  );
}

function DecisionsCard({
  review,
  weeks,
  now,
}: {
  readonly review: ProfileReview;
  readonly weeks: number;
  readonly now: number;
}) {
  return (
    <Card name="decisions" title="Recent decisions" span={6}>
      {review.recent.length === 0 ? (
        <Empty>No review decisions in these {weeks} weeks.</Empty>
      ) : (
        <ul className="prof-list">
          {review.recent.map((decision) => (
            <li key={`${decision.task_id}-${String(decision.at)}`} className="prof-decision">
              <span className={`prof-verdict prof-verdict-${decision.decision}`}>
                <span aria-hidden="true">{decision.decision === 'accepted' ? '✓' : '↩'}</span>
                {decision.decision === 'accepted' ? 'Accepted' : 'Sent back'}
              </span>
              <span className="prof-task-who">
                <span className="prof-task-title" title={decision.title}>
                  <span className="prof-key">{decision.key}</span> {decision.title}
                </span>
                <span className="prof-row-meta">{decision.assignee.name}’s</span>
              </span>
              <span className="prof-when">{timeLabel(decision.at, now).text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The agents they use (LAI-750): one bar split by their share of writes
 * through each agent in the window, then one row per agent — its real mark,
 * its share, the tokens it is on and when it was last used. An agent appears
 * once, however many tokens it is on.
 */
function AgentsCard({
  agents,
  weeks,
  now,
}: {
  readonly agents: ProfileAgents;
  readonly weeks: number;
  readonly now: number;
}) {
  const rows = agentRows(agents.writes, agents.tokens);
  const slot = (i: number) => Math.min(i, SHARE_SLOTS - 1);
  const shared = rows.filter((row) => row.writes > 0);
  const spoken = shared
    .map((row) => `${agentClientName(row.client)} ${String(row.percent)}%`)
    .join(', ');

  return (
    <Card
      name="agents"
      title={
        rows.length === 0
          ? 'Agents used'
          : `Agents used · ${countLabel(rows.length, 'type', 'types')}`
      }
      info={
        <Defs
          items={[
            [
              'Share',
              `Their board writes made through each agent in the last ${String(weeks)} weeks, by the agent each token last connected as. Writes on the web are not in it.`,
            ],
            ['Tokens', 'The tokens they can still use — not revoked, not expired.'],
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <Empty>No agent has connected with this person’s tokens yet.</Empty>
      ) : (
        <>
          {agents.writes_total === 0 ? (
            <Empty>No writes through an agent in these {weeks} weeks.</Empty>
          ) : (
            <div
              className="prof-share"
              role="img"
              aria-label={`Share of their writes through agents, the last ${String(weeks)} weeks: ${spoken}`}
            >
              {shared.map((row, i) => (
                <span
                  key={row.client}
                  className="prof-share-part"
                  data-slot={slot(i)}
                  data-client={row.client}
                  style={{ flexGrow: row.writes }}
                />
              ))}
            </div>
          )}
          <ul className="prof-list prof-agents">
            {rows.map((row, i) => {
              const used = lastActive(row.tokens, row.client);
              return (
                <li
                  key={row.client}
                  className="prof-agent"
                  data-client={row.client}
                  data-online={agents.online.enabled && agents.online.clients.includes(row.client)}
                  title={
                    row.writes > 0
                      ? `${String(row.writes)} of ${String(agents.writes_total)} writes through agents`
                      : undefined
                  }
                >
                  <span
                    className="prof-swatch"
                    data-slot={row.writes > 0 ? slot(i) : undefined}
                    data-none={row.writes === 0}
                    aria-hidden="true"
                  />
                  <AgentMark client={row.client} />
                  <span className="prof-task-who">
                    <span className="prof-agent-name">{agentClientName(row.client)}</span>
                    <span className="prof-row-meta">
                      {row.tokens.length === 0
                        ? 'no usable token now'
                        : row.tokens
                            .map((token) =>
                              token.client_name !== null && token.client_name !== token.name
                                ? `${token.name} (${token.client_name})`
                                : token.name,
                            )
                            .join(', ')}
                    </span>
                  </span>
                  <span className="prof-agent-figures">
                    <b className="prof-share-pct">
                      {row.writes > 0 ? `${String(row.percent)}%` : '—'}
                    </b>
                    <span className="prof-when">
                      {used === null ? 'never used' : `used ${timeLabel(used, now).text}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <More shown={agents.tokens.length} total={agents.tokens_total} />
        </>
      )}
    </Card>
  );
}

/** Which of their agents are live now (§9.3) — never where they are working. */
function OnlineCard({ agents, now }: { readonly agents: ProfileAgents; readonly now: number }) {
  const { online } = agents;
  return (
    <Card
      name="online"
      title="Online now"
      count={online.enabled && online.clients.length > 0 ? online.clients.length : undefined}
      info={
        <p className="prof-defs-foot">
          An agent is online when it sent a heartbeat or an MCP call in the last five minutes. A
          profile says which agents — never where they are working.
        </p>
      }
    >
      {!online.enabled ? (
        <Empty>Presence is off for this organisation, so who is online is not recorded.</Empty>
      ) : online.clients.length === 0 ? (
        <Empty>No agent online now.</Empty>
      ) : (
        <ul className="prof-list prof-online">
          {online.clients.map((client) => {
            const at = lastActive(agents.tokens, client);
            return (
              <li key={client} className="prof-live" data-client={client}>
                <span className="prof-live-dot" aria-hidden="true" />
                <AgentMark client={client} size="sm" />
                <span className="prof-agent-name">{agentClientName(client)}</span>
                <span className="prof-when">
                  {at === null ? 'live' : `active ${timeLabel(at, now).text}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Five pips, the score's filled — decoration beside the number that says it. */
function Pips({ score }: { readonly score: number }) {
  return (
    <span className="prof-pips" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="prof-pip" data-on={n <= score} />
      ))}
    </span>
  );
}

function RatingCard({
  span,
  ratings,
  total,
  self,
  canRate,
  now,
  buttonRef,
  onRate,
}: {
  /** Across the page (latest and history side by side), or in a side stack. */
  readonly span: 2 | 6;
  readonly ratings: readonly MemberRating[];
  /** Every rating they have; `ratings` is at most the server's cap. */
  readonly total: number;
  readonly self: boolean;
  readonly canRate: boolean;
  readonly now: number;
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
  readonly onRate: () => void;
}) {
  const [latest, ...history] = ratings;
  return (
    <Card
      name="rating"
      title="Admin’s rating"
      span={span}
      info={
        <p className="prof-defs-foot">
          Seen only here, by owners and admins — in no feed, export or agent tool. A new rating is
          added on top; none is ever edited. 1 is well below what you expect, 5 well above it.
        </p>
      }
      actions={
        canRate ? (
          <button ref={buttonRef} type="button" className="prof-rate" onClick={onRate}>
            Rate
          </button>
        ) : undefined
      }
    >
      <div className="prof-rating-cols">
        <div className="prof-rating-now">
          {latest === undefined ? (
            <Empty>Not rated yet.</Empty>
          ) : (
            <div className="prof-rating-latest">
              <span className="prof-score-block">
                <span className="prof-score">{scoreLabel(latest.score)}</span>
                <Pips score={latest.score} />
              </span>
              <span className="prof-rating-body">
                <q className="prof-rating-note">{latest.note}</q>
                <span className="prof-row-meta">
                  {latest.rated_by.name} · {timeLabel(latest.created_at, now).text}
                </span>
              </span>
            </div>
          )}
          {self && <p className="prof-self">You cannot rate yourself.</p>}
        </div>
        {history.length > 0 && (
          <div className="prof-rating-earlier">
            <h4 className="prof-sub">
              Earlier <span className="prof-sub-count">{total - 1}</span>
            </h4>
            <ul className="prof-list prof-rating-history">
              {history.map((rating) => (
                <li key={rating.id} className="prof-rating">
                  <span className="prof-score">{scoreLabel(rating.score)}</span>
                  <span className="prof-rating-body">
                    <span className="prof-rating-note">{rating.note}</span>
                    <span className="prof-row-meta">
                      {rating.rated_by.name} · {timeLabel(rating.created_at, now).text}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <More shown={ratings.length} total={total} />
          </div>
        )}
      </div>
    </Card>
  );
}
