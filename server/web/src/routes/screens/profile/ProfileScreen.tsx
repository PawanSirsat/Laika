import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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
  type ProfileReview,
  type ProfileTask,
} from '../../../api/profiles.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { SCREEN_COPY } from '../screen-copy.ts';
import {
  barHeights,
  durationLabel,
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
  builder: { label: 'Builder', hint: 'does the work — current work, delivery and agents' },
  manager: { label: 'Manager', hint: 'reviews and leads — review work and decisions' },
};

/** The server's sentence when there is one; never "something went wrong" over it. */
function said(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'That did not go through. Try again.';
}

/**
 * One member's profile (SPEC §11.4.2, D-078, LAI-743): what the board recorded
 * about their work, a Builder/Manager label, and a private rating.
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
 * as a zero. A manager's response carries no agent, work or delivery block, so
 * those cards are absent — not empty — and that is all the kind changes.
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

  return (
    <div className="prof">
      {header}

      <ProfileHead profile={profile} busy={kindBusy} error={kindError} onKind={changeKind} />

      <div className="prof-grid">
        <ProjectsCard projects={profile.projects} weeks={profile.window.weeks} />
        {profile.current_work !== undefined && (
          <CurrentWorkCard work={profile.current_work} now={now} />
        )}
        {profile.delivery !== undefined && (
          <DeliveryCard delivery={profile.delivery} weeks={profile.window.weeks} />
        )}
        <ReviewCard review={profile.review} weeks={profile.window.weeks} />
        {user.profile_kind === 'manager' && (
          <DecisionsCard review={profile.review} weeks={profile.window.weeks} now={now} />
        )}
        {profile.agents !== undefined && <AgentsCard agents={profile.agents} now={now} />}
        <RatingCard
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

// ------------------------------------------------------------------- parts

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

  return (
    <section className="prof-head" aria-labelledby="prof-name">
      <span
        className="prof-avatar"
        style={{ background: ink.background, color: ink.foreground }}
        aria-hidden="true"
      >
        {initials(user.name)}
      </span>
      <div className="prof-who">
        <h2 className="prof-name" id="prof-name">
          {user.name}
          {!user.is_active && <span className="prof-chip prof-chip-off">DEACTIVATED</span>}
        </h2>
        <p className="prof-meta">
          <span>{user.email}</span>
          <span>{orgRoleLabel(user.org_role as OrgRole)}</span>
          <span>Member since {monthYear(user.created_at)}</span>
        </p>
      </div>
      <fieldset className="prof-kind" disabled={busy}>
        <legend className="prof-kind-label">Profile kind {busy && <Spinner size="sm" />}</legend>
        <div className="prof-kind-options">
          {PROFILE_KINDS.map((kind) => (
            <label key={kind} className="prof-kind-option">
              <input
                type="radio"
                name="profile-kind"
                value={kind}
                checked={user.profile_kind === kind}
                onChange={() => {
                  onKind(kind);
                }}
              />
              <span className="prof-kind-face">{KINDS[kind].label}</span>
            </label>
          ))}
        </div>
        <p className="prof-kind-hint">
          {KINDS[user.profile_kind].label}: {KINDS[user.profile_kind].hint}. A label for this page —
          it never changes what they may do.
        </p>
        {error !== undefined && (
          <p className="prof-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
    </section>
  );
}

function Card({
  name,
  title,
  count,
  children,
  actions,
}: {
  readonly name: string;
  readonly title: string;
  readonly count?: number | undefined;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}) {
  const id = `prof-${name}-title`;
  return (
    <section className="prof-card" data-section={name} aria-labelledby={id}>
      <header className="prof-card-head">
        <h3 className="prof-card-title" id={id}>
          {title}
        </h3>
        {count !== undefined && <span className="prof-card-count">{count}</span>}
        {actions !== undefined && <span className="prof-card-actions">{actions}</span>}
      </header>
      {children}
    </section>
  );
}

function Stat({
  name,
  label,
  value,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="prof-stat" data-stat={name}>
      <dt className="prof-stat-label">{label}</dt>
      <dd className="prof-stat-value">{value}</dd>
    </div>
  );
}

function projectRole(project: ProfileProject): string {
  if (project.role === null) return 'no membership';
  return project.role.charAt(0).toUpperCase() + project.role.slice(1);
}

function ProjectsCard({
  projects,
  weeks,
}: {
  readonly projects: readonly ProfileProject[];
  readonly weeks: number;
}) {
  return (
    <Card name="projects" title="Projects" count={projects.length}>
      {projects.length === 0 ? (
        <p className="prof-empty">No projects yet — no membership, no assigned work, no reviews.</p>
      ) : (
        <ul className="prof-list">
          {projects.map((project) => (
            <li key={project.id} className="prof-project">
              <span className="prof-key">{project.key}</span>
              <span className="prof-project-who">
                <span className="prof-project-name">
                  {project.name}
                  {project.archived && <span className="prof-chip">ARCHIVED</span>}
                </span>
                <span className="prof-row-meta">
                  {projectRole(project)} · {project.open_tasks} open · {project.accepted} accepted ·{' '}
                  {project.reviewed} reviewed
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="prof-card-note">Accepted and reviewed count the last {weeks} weeks.</p>
    </Card>
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
  return (
    <Card name="current" title="Current work">
      {empty ? (
        <p className="prof-empty">Nothing in progress or in review.</p>
      ) : (
        <>
          <h4 className="prof-sub">
            In progress <span className="prof-sub-count">{work.in_progress_total}</span>
          </h4>
          {work.in_progress.length > 0 && (
            <ul className="prof-list">
              {work.in_progress.map((task) => (
                <TaskRow key={task.id} task={task} now={now} />
              ))}
            </ul>
          )}
          <More shown={work.in_progress.length} total={work.in_progress_total} />
          <h4 className="prof-sub">
            In review <span className="prof-sub-count">{work.in_review_total}</span>
          </h4>
          {work.in_review.length > 0 && (
            <ul className="prof-list">
              {work.in_review.map((task) => (
                <TaskRow key={task.id} task={task} now={now} />
              ))}
            </ul>
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
  const counts = delivery.accepted_per_week.map((w) => w.accepted);
  const heights = barHeights(counts);
  const first = delivery.accepted_per_week[0];
  const last = delivery.accepted_per_week[delivery.accepted_per_week.length - 1];
  const { cycle_time: cycle } = delivery;

  return (
    <Card name="delivery" title={`Delivered · ${String(weeks)} weeks`}>
      <figure className="prof-chart">
        <ol className="prof-bars" aria-label="Accepted per week">
          {delivery.accepted_per_week.map((week, i) => {
            const label = `Week of ${weekLabel(week.week_start)}: ${String(week.accepted)} accepted`;
            return (
              <li
                key={week.week_start}
                className="prof-bar"
                data-week={week.week_start}
                data-accepted={week.accepted}
                title={label}
              >
                <span
                  className="prof-bar-fill"
                  style={{ height: `${String(Math.round((heights[i] ?? 0) * 100))}%` }}
                  aria-hidden="true"
                />
                <span className="visually-hidden">{label}</span>
              </li>
            );
          })}
        </ol>
        {first !== undefined && last !== undefined && (
          <figcaption className="prof-bars-axis">
            <span>{weekLabel(first.week_start)}</span>
            <span>accepted per week</span>
            <span>{weekLabel(last.week_start)}</span>
          </figcaption>
        )}
      </figure>
      {delivery.accepted === 0 && (
        <p className="prof-empty">Nothing accepted in these {weeks} weeks.</p>
      )}
      <dl className="prof-stats">
        <Stat name="accepted" label="Accepted" value={String(delivery.accepted)} />
        <Stat name="sent_back" label="Sent back" value={String(delivery.sent_back)} />
        <Stat name="reopened" label="Reopened" value={String(delivery.reopened)} />
        <Stat name="p50" label="Cycle p50" value={durationLabel(cycle.p50_ms)} />
        <Stat name="p75" label="Cycle p75" value={durationLabel(cycle.p75_ms)} />
      </dl>
      {cycle.unmeasured > 0 && (
        <p className="prof-unmeasured">
          {cycle.unmeasured} done with no recorded start — counted, not measured.
        </p>
      )}
      <p className="prof-card-note">
        Accepted: moved into a Done status by someone else. Sent back: moved from Review to an
        earlier status by someone else. Reopened: moved out of Done into work again. Cycle time:
        first start to latest completion, for their tasks done in the window.
      </p>
    </Card>
  );
}

function ReviewCard({ review, weeks }: { readonly review: ProfileReview; readonly weeks: number }) {
  return (
    <Card name="review" title="Review work for others">
      <dl className="prof-stats">
        <Stat name="review_accepted" label="Accepted" value={String(review.accepted)} />
        <Stat name="review_sent_back" label="Sent back" value={String(review.sent_back)} />
      </dl>
      <p className="prof-card-note">
        Their decisions on tasks assigned to someone else, in the last {weeks} weeks.
      </p>
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
    <Card name="decisions" title="Recent review decisions">
      {review.recent.length === 0 ? (
        <p className="prof-empty">No review decisions in these {weeks} weeks.</p>
      ) : (
        <ul className="prof-list">
          {review.recent.map((decision) => (
            <li key={`${decision.task_id}-${String(decision.at)}`} className="prof-decision">
              <span className={`prof-verdict prof-verdict-${decision.decision}`}>
                {decision.decision === 'accepted' ? 'Accepted' : 'Sent back'}
              </span>
              <span className="prof-task-who">
                <span className="prof-task-title" title={decision.title}>
                  <span className="prof-key">{decision.key}</span> {decision.title}
                </span>
                <span className="prof-row-meta">
                  {decision.assignee.name}’s · {timeLabel(decision.at, now).text}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AgentsCard({ agents, now }: { readonly agents: ProfileAgents; readonly now: number }) {
  const kinds = new Set(agents.tokens.map((token) => token.client));
  const { online } = agents;

  return (
    <Card name="agents" title="Agents" count={kinds.size}>
      <p className="prof-online">
        {!online.enabled ? (
          'Presence is off for this organisation, so who is online is not recorded.'
        ) : online.clients.length === 0 ? (
          'No agent online now.'
        ) : (
          <>
            <span className="prof-online-dot" aria-hidden="true" />
            Online now:{' '}
            {online.clients.map((client, i) => (
              <span key={client} className="prof-online-client">
                <AgentMark client={client} size="sm" />
                {agentClientName(client)}
                {i < online.clients.length - 1 ? ', ' : ''}
              </span>
            ))}
          </>
        )}
      </p>
      {agents.tokens_total === 0 ? (
        <p className="prof-empty">No agent has connected — no token is in use.</p>
      ) : (
        <ul className="prof-list">
          {agents.tokens.map((token) => {
            const used = Math.max(token.last_used_at ?? 0, token.last_mcp_at ?? 0);
            return (
              <li
                key={token.id}
                className="prof-agent"
                data-online={online.enabled && online.clients.includes(token.client)}
              >
                <AgentMark client={token.client} />
                <span className="prof-task-who">
                  <span className="prof-agent-name">{agentClientName(token.client)}</span>
                  <span className="prof-row-meta">
                    {token.name}
                    {token.client_name !== null && token.client_name !== token.name
                      ? ` · ${token.client_name}`
                      : ''}{' '}
                    · {used === 0 ? 'never used' : `used ${timeLabel(used, now).text}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <More shown={agents.tokens.length} total={agents.tokens_total} />
      <p className="prof-card-note">
        Each token they can still use, with the agent it last connected as. Where they are working
        is not shown here.
      </p>
    </Card>
  );
}

function RatingRow({ rating, now }: { readonly rating: MemberRating; readonly now: number }) {
  return (
    <>
      <span className="prof-score">{scoreLabel(rating.score)}</span>
      <span className="prof-rating-body">
        <span className="prof-rating-note">{rating.note}</span>
        <span className="prof-row-meta">
          {rating.rated_by.name} · {timeLabel(rating.created_at, now).text}
        </span>
      </span>
    </>
  );
}

function RatingCard({
  ratings,
  total,
  self,
  canRate,
  now,
  buttonRef,
  onRate,
}: {
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
      title="Rating"
      actions={
        canRate ? (
          <button ref={buttonRef} type="button" className="prof-rate" onClick={onRate}>
            Rate
          </button>
        ) : undefined
      }
    >
      {latest === undefined ? (
        <p className="prof-empty">Not rated yet.</p>
      ) : (
        <div className="prof-rating-latest">
          <RatingRow rating={latest} now={now} />
        </div>
      )}
      {self && <p className="prof-card-note">You cannot rate yourself.</p>}
      {history.length > 0 && (
        <>
          <h4 className="prof-sub">
            Earlier <span className="prof-sub-count">{total - 1}</span>
          </h4>
          <ul className="prof-list prof-rating-history">
            {history.map((rating) => (
              <li key={rating.id} className="prof-rating">
                <RatingRow rating={rating} now={now} />
              </li>
            ))}
          </ul>
          <More shown={ratings.length} total={total} />
        </>
      )}
      <p className="prof-card-note">
        Seen only here, by owners and admins — in no feed, export or agent tool. A new rating is
        added on top; none is ever edited.
      </p>
    </Card>
  );
}
