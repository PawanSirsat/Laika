import {
  Fragment,
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
import { agentClientName, type AgentClient } from '../../../api/agent-clients.ts';
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
import { ActivityCard } from './ActivityCard.tsx';
import { InfoTip } from './InfoTip.tsx';
import {
  agentRows,
  barHeights,
  columnCount,
  columnPlan,
  type ColumnCount,
  type ProfileCardId,
  countLabel,
  durationLabel,
  lastActive,
  ROWS_SHOWN,
  workTab,
  type WorkTab,
  monthYear,
  nextAttempt,
  type RatingAttempt,
  scoreLabel,
  weekLabel,
} from './profile-derive.ts';
import { RatingDialog } from './RatingDialog.tsx';
import { UsageCard } from './UsageCard.tsx';
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
  reviewAccepted:
    'Their moves into a Done status of a task that is not theirs — someone else’s, or nobody’s.',
  reviewSentBack:
    'Their moves from Review back to an earlier status of a task that is not theirs — someone else’s, or nobody’s.',
  decided30: 'Their accepts and send-backs on work that is not theirs in the last 30 days.',
  decide:
    'Median time from a task’s latest move into Review — or its creation, if it was created there — to their decision on it. Decisions made from outside Review are counted, not measured.',
  led: 'Projects where their membership role is Lead, not archived.',
  waiting:
    'Tasks in Review in the projects they lead that are not theirs — someone else’s, or nobody’s.',
  oldest: 'How long the longest-waiting of those has been in Review.',
} as const;

/** Categorical slots for the agent-share bar, in rank order (tokens only). */
const SHARE_SLOTS = 6;

/** The server's sentence when there is one; never "something went wrong" over it. */
function said(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'That did not go through. Try again.';
}

/**
 * How many columns the cards flow in, from the viewport's width (LAI-751),
 * kept current as the window resizes.
 */
function useColumnCount(): ColumnCount {
  const [columns, setColumns] = useState<ColumnCount>(() => columnCount(window.innerWidth));
  useEffect(() => {
    const update = (): void => {
      setColumns(columnCount(window.innerWidth));
    };
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
    };
  }, []);
  return columns;
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
  const columns = useColumnCount();
  /**
   * Whose profile is on the page now (LAI-751). A save or a kind change
   * answers after its request — and Back may have moved the page to someone
   * else by then; an answer about anybody but this person is dropped, never
   * drawn over the person now shown.
   */
  const shown = useRef(userId);

  useEffect(() => {
    shown.current = userId;
    // A dialog belongs to the person it was opened on; moving away closes it.
    setRating({ open: false, busy: false });
    setKindError(undefined);
  }, [userId]);

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
        if (shown.current === user.id) setLoad({ kind: 'ready', profile: next });
      })
      .catch((cause: unknown) => {
        if (shown.current === user.id) setKindError(said(cause));
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
        // Saved — but the page may have moved on (Back, a link) while it was
        // in flight; then this person's profile is not the one to draw.
        if (shown.current !== user.id) return;
        setRating({ open: false, busy: false });
        // The whole profile again rather than splicing the answer in: the
        // order of the history is the server's, and so is every figure. A
        // failure here is a failed *read* — the rating was saved — so it is
        // the screen's error state, never the dialog's.
        getProfile(user.id)
          .then((next) => {
            if (shown.current === user.id) setLoad({ kind: 'ready', profile: next });
          })
          .catch((cause: unknown) => {
            if (shown.current === user.id) setLoad({ kind: 'error', error: cause });
          });
      },
      (cause: unknown) => {
        if (shown.current === user.id) setRating({ open: true, busy: false, error: said(cause) });
      },
    );
  };

  const ratingCard = (
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
  );

  const manager = user.profile_kind === 'manager';
  const cards: Readonly<Record<ProfileCardId, ReactNode>> = {
    delivery: profile.delivery !== undefined && (
      <DeliveryCard delivery={profile.delivery} weeks={weeks} />
    ),
    current: profile.current_work !== undefined && (
      <CurrentWorkCard key={user.id} work={profile.current_work} now={now} />
    ),
    agents: profile.agents !== undefined && (
      <AgentsCard key={user.id} agents={profile.agents} weeks={weeks} now={now} />
    ),
    review: (
      <ReviewCard
        review={profile.review}
        queue={profile.queue}
        weeks={weeks}
        now={now}
        title={manager ? 'Review work' : 'Review work for others'}
      />
    ),
    projects: (
      <ProjectsCard
        projects={profile.projects}
        queue={profile.queue}
        kind={user.profile_kind}
        weeks={weeks}
      />
    ),
    rating: ratingCard,
    decisions: <DecisionsCard review={profile.review} weeks={weeks} now={now} />,
  };

  return (
    <div className="prof" data-kind={user.profile_kind}>
      {header}

      <ProfileHead profile={profile} busy={kindBusy} error={kindError} onKind={changeKind} />

      <ActivityCard
        userId={user.id}
        name={user.name}
        viewerId={me.id}
        canManageOrg={mayOpenProfiles(me.org_role)}
        sharing={profile.activity_sharing}
      />

      {/* Their agents' tokens (D-084, LAI-769): full width, like Activity. */}
      <UsageCard key={user.id} userId={user.id} name={user.name} self={me.id === user.id} />

      {/*
       * The rest flows in columns (LAI-751, owner, 2026-10-16): each column
       * stacks its cards one gap apart, so a short card is never followed by a
       * hole the height of its neighbour. Which card goes where is
       * `columnPlan`'s — chosen, not computed — and one column is the reading
       * order.
       */}
      <div className="prof-columns" data-columns={columns}>
        {columnPlan(user.profile_kind, columns).map((ids) => (
          <div key={ids.join('-')} className="prof-column">
            {ids.map((id) => (
              <Fragment key={id}>{cards[id]}</Fragment>
            ))}
          </div>
        ))}
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
  // The ring is the avatar's own colour, set off by a band of the card's.
  const avatar: CSSProperties = {
    background: ink.background,
    color: ink.foreground,
    boxShadow: `0 0 0 3px var(--bg-card), 0 0 0 5px ${ink.background}`,
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
        <Empty>No projects yet.</Empty>
      ) : (
        <ul className="prof-pbars">
          {projects.map((project, i) => {
            const wait = waiting.get(project.id);
            return (
              <li key={project.id} className="prof-project" data-project={project.slug}>
                <span className="prof-project-name" title={project.name}>
                  <span className="prof-key">{project.key}</span>
                  <span className="prof-project-title">{project.name}</span>
                </span>
                <span className="prof-pbar" aria-hidden="true">
                  <span
                    className="prof-pbar-fill"
                    style={{ width: `${String(Math.round((widths[i] ?? 0) * 100))}%` }}
                  />
                </span>
                <b className="prof-pbar-n">{value(project)}</b>
                <span className="prof-row-meta">
                  {project.archived && <span className="prof-chip">ARCHIVED</span>}
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

/** One line: key, the title cut to fit (whole on hover), and its age. */
function TaskRow({
  task,
  now,
  tab,
}: {
  readonly task: ProfileTask;
  readonly now: number;
  readonly tab: WorkTab;
}) {
  const since = tab === 'in_review' ? task.review_since : task.started_at;
  return (
    <li className="prof-task prof-work-row" data-task={task.key}>
      <span className="prof-key">{task.key}</span>
      <span className="prof-task-title" title={task.title}>
        {task.title}
      </span>
      <span
        className="prof-when"
        title={
          since === null
            ? undefined
            : tab === 'in_review'
              ? `In Review since ${new Date(since).toLocaleString()}`
              : `First started ${new Date(since).toLocaleString()}`
        }
      >
        {since === null
          ? '—'
          : tab === 'in_review'
            ? `waiting ${durationLabel(Math.max(0, now - since))}`
            : durationLabel(Math.max(0, now - since))}
      </span>
    </li>
  );
}

/**
 * Their open work (LAI-750), kept to a card's height (LAI-751): the tiles,
 * then one list at a time — *In progress* or *In review* — at most five rows,
 * the longest running or longest waiting first (the server's order). *Show
 * all* opens the rest inside the card, in a scroll of its own; nothing here
 * makes the card, or the row it sits in, as tall as the list.
 */
function CurrentWorkCard({
  work,
  now,
}: {
  readonly work: ProfileCurrentWork;
  readonly now: number;
}) {
  const [tab, setTab] = useState<WorkTab>(() => workTab(work));
  const [all, setAll] = useState(false);
  const empty = work.in_progress_total === 0 && work.in_review_total === 0;
  // The server sends in-progress work oldest start first.
  const oldest = work.in_progress.find((task) => task.started_at !== null)?.started_at ?? null;
  const list = tab === 'in_progress' ? work.in_progress : work.in_review;
  const total = tab === 'in_progress' ? work.in_progress_total : work.in_review_total;
  const rows = all ? list : list.slice(0, ROWS_SHOWN);

  const choose = (next: WorkTab): void => {
    setTab(next);
    setAll(false);
  };

  return (
    <Card name="current" title="Current work">
      {empty ? (
        <Empty>Nothing in progress or in review.</Empty>
      ) : (
        <>
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
          <span className="prof-seg prof-work-switch" role="radiogroup" aria-label="Which work">
            {(
              [
                ['in_progress', 'In progress', work.in_progress_total],
                ['in_review', 'In review', work.in_review_total],
              ] as const
            ).map(([value, label, n]) => (
              <label key={value} className="prof-seg-option">
                <input
                  type="radio"
                  name="prof-work"
                  value={value}
                  checked={tab === value}
                  onChange={() => {
                    choose(value);
                  }}
                />
                <span className="prof-seg-face">
                  {label} <span className="prof-work-n">{n}</span>
                </span>
              </label>
            ))}
          </span>
          {total === 0 ? (
            <Empty>{tab === 'in_progress' ? 'Nothing in progress.' : 'Nothing in review.'}</Empty>
          ) : (
            <div className="prof-work-panel" data-expanded={all}>
              <ul
                className="prof-list prof-work-list"
                aria-label={tab === 'in_progress' ? 'In progress' : 'In review'}
              >
                {rows.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} tab={tab} />
                ))}
              </ul>
              {/* What the server cut (LAI-746), once everything it sent is on show. */}
              {(all || list.length <= ROWS_SHOWN) && <More shown={list.length} total={total} />}
            </div>
          )}
          {list.length > ROWS_SHOWN && (
            <button
              type="button"
              className="prof-show-all"
              aria-expanded={all}
              onClick={() => {
                setAll((open) => !open);
              }}
            >
              {all ? 'Show less' : `Show all ${String(total)}`}
            </button>
          )}
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
        <>
          {/* Compact (LAI-751): one line, not a chart of nothing above a
              row of zeros — and what there is besides, said in it. */}
          <Empty>
            Nothing accepted in these {weeks} weeks
            {delivery.sent_back > 0 && ` · ${String(delivery.sent_back)} sent back`}
            {delivery.reopened > 0 && ` · ${String(delivery.reopened)} reopened`}.
          </Empty>
          {cycle.p50_ms !== null && (
            <dl className="prof-stats prof-stats-compact">
              <Stat
                name="cycle"
                label="Cycle p50 / p75"
                value={durationLabel(cycle.p50_ms)}
                sub={cycle.p75_ms === null ? undefined : `/ ${durationLabel(cycle.p75_ms)}`}
                hint={MEANS.cycle}
              />
            </dl>
          )}
        </>
      ) : (
        <>
          <WeekBars
            label={`Accepted per week, the last ${String(weeks)} weeks`}
            weeks={delivery.accepted_per_week.map((week) => ({
              week_start: week.week_start,
              values: [week.accepted],
              text: `Week of ${weekLabel(week.week_start)}: ${String(week.accepted)} accepted`,
            }))}
          />
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
        </>
      )}
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
  title,
}: {
  readonly review: ProfileReview;
  readonly queue?: ProfileQueue | undefined;
  readonly weeks: number;
  readonly now: number;
  readonly title: string;
}) {
  const decided = review.accepted + review.sent_back;
  const decide = review.time_to_decide;
  return (
    <Card
      name="review"
      title={title}
      caption={`${String(weeks)} weeks`}
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
      {/* A manager's queue, when there is one to show (LAI-751: no row of zeros). */}
      {queue !== undefined && (queue.projects_led > 0 || queue.waiting > 0) && (
        <dl className="prof-stats prof-stats-compact" data-group="queue">
          <Stat
            name="projects_led"
            label="Projects led"
            value={String(queue.projects_led)}
            hint={MEANS.led}
          />
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
        </dl>
      )}
      {decided > 0 && (
        <dl className="prof-stats" data-group="decisions">
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
        </dl>
      )}
      {decided === 0 ? (
        <Empty>
          No review decisions in these {weeks} weeks
          {queue?.projects_led === 0 ? ', and no project led' : ''}.
        </Empty>
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
    <Card name="decisions" title="Recent decisions">
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
                <span className="prof-row-meta">
                  {decision.assignee === null ? 'Unassigned' : `${decision.assignee.name}’s`}
                </span>
              </span>
              <span className="prof-when">{timeLabel(decision.at, now).text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** An agent's name on the profile: `other` is *Other agent* (LAI-751). */
function agentName(client: AgentClient): string {
  return client === 'other' ? 'Other agent' : agentClientName(client);
}

/**
 * The agents they use (LAI-750): one bar split by their share of writes
 * through each agent in the window, then **one row per agent** (LAI-751) — its
 * real mark, its share, how many tokens it is on and when it was last active.
 * The token names wait behind each row's expand, so many tokens never become
 * one long line.
 *
 * Who is online is here too (LAI-751, owner, 2026-10-16): *Online now* was a
 * card of its own and named the same agents twice. Now it is this card's
 * header and a dot on each row — which agents, never where (D-078 item 4).
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
  const { online } = agents;
  const live = online.enabled ? online.clients : [];
  const rows = agentRows(agents.writes, agents.tokens, live);
  const slot = (i: number) => Math.min(i, SHARE_SLOTS - 1);
  const shared = rows.filter((row) => row.writes > 0);
  const spoken = shared.map((row) => `${agentName(row.client)} ${String(row.percent)}%`).join(', ');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (client: string): void => {
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(client)) next.delete(client);
      else next.add(client);
      return next;
    });
  };

  return (
    <Card
      name="agents"
      title={
        rows.length === 0
          ? 'Agents used'
          : `Agents used · ${countLabel(rows.length, 'type', 'types')}`
      }
      caption={
        !online.enabled
          ? 'presence off'
          : live.length === 0
            ? 'none online'
            : `${String(live.length)} online`
      }
      info={
        <Defs
          items={[
            [
              'Share',
              `Their board writes made through each agent in the last ${String(weeks)} weeks, by the agent each token last connected as. A token used with two agents credits all its writes to the last one it connected as. Writes on the web are not in it.`,
            ],
            [
              'Online',
              online.enabled
                ? 'An agent is online when it sent a heartbeat, an MCP call or a change through the API or the CLI in the last five minutes. Which agents — never where they are working.'
                : 'Presence is off for this organisation, so who is online is not recorded.',
            ],
            [
              'Tokens',
              'The tokens they can still use — not revoked, not expired — that have connected at least once. Open a row to see their names.',
            ],
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <Empty>No agent has used their tokens yet.</Empty>
      ) : (
        <>
          {agents.writes_total > 0 && (
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
          <ul className="prof-list prof-agents prof-scroll">
            {rows.map((row, i) => {
              const used = lastActive(row.tokens, row.client);
              const expanded = open.has(row.client);
              const listId = `prof-agent-tokens-${row.client}`;
              const isOnline = live.includes(row.client);
              return (
                <li
                  key={row.client}
                  className="prof-agent"
                  data-client={row.client}
                  data-online={isOnline}
                  title={
                    row.writes > 0
                      ? `${String(row.writes)} of ${String(agents.writes_total)} writes through agents`
                      : undefined
                  }
                >
                  <span className="prof-agent-line">
                    <span
                      className="prof-swatch"
                      data-slot={row.writes > 0 ? slot(i) : undefined}
                      data-none={row.writes === 0}
                      aria-hidden="true"
                    />
                    <AgentMark client={row.client} />
                    <span className="prof-task-who">
                      <span className="prof-agent-name">
                        {agentName(row.client)}
                        {isOnline && (
                          <span className="prof-online">
                            <span className="prof-live-dot" aria-hidden="true" />
                            online
                          </span>
                        )}
                      </span>
                      <span className="prof-row-meta">
                        {row.tokens.length === 0 ? (
                          'no usable token now'
                        ) : (
                          <button
                            type="button"
                            className="prof-tokens-toggle"
                            aria-expanded={expanded}
                            aria-controls={listId}
                            onClick={() => {
                              toggle(row.client);
                            }}
                          >
                            {countLabel(row.tokens.length, 'token', 'tokens')}
                          </button>
                        )}
                        {used !== null && ` · active ${timeLabel(used, now).text}`}
                      </span>
                    </span>
                    {/* No writes, no share — nothing, rather than a dash (LAI-751). */}
                    {row.writes > 0 && (
                      <b className="prof-share-pct">{`${String(row.percent)}%`}</b>
                    )}
                  </span>
                  {expanded && (
                    <ul className="prof-token-names" id={listId}>
                      {/* The row already names the agent; what the client called
                          itself is on hover, not repeated on every line. */}
                      {row.tokens.map((token) => (
                        <li
                          key={token.id}
                          title={
                            token.client_name === null
                              ? undefined
                              : `Connected as “${token.client_name}”`
                          }
                        >
                          {token.name}
                        </li>
                      ))}
                    </ul>
                  )}
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
  ratings,
  total,
  self,
  canRate,
  now,
  buttonRef,
  onRate,
}: {
  /** Across the page (latest and history side by side), or in a side stack. */
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
            <ul className="prof-list prof-rating-history prof-scroll">
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
