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
import { OverflowMenu } from '../../../components/wizard/OverflowMenu.tsx';
import { ApiError } from '../../../api/errors.ts';
import type { OrgRole } from '../../../api/invites.ts';
import type { MeProfile } from '../../../api/me.ts';
import {
  attemptKey,
  getProfile,
  rateMember,
  setProfileKind,
  type MemberProfile,
  type MemberRating,
  type ProfileKind,
  type ProfileReview,
} from '../../../api/profiles.ts';
import { PEOPLE_ANALYTICS } from '../../../api/people-analytics.ts';
import { useGates } from '../../../api/permissions.ts';
import { CurrentLoadCard, ProfileAvailabilityLine } from './CurrentLoadCard.tsx';
import { profileAvailabilityMode, useProfileAvailability } from './profile-availability.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { SCREEN_COPY } from '../screen-copy.ts';
import { ActivityCard } from './ActivityCard.tsx';
import { KINDS } from './ManageSections.tsx';
import { InfoTip } from './InfoTip.tsx';
import { ManageMemberPanel } from './ManageMemberPanel.tsx';
import { adminControls, anyAdminControl } from './manage-controls.ts';
import { MyDayScreen } from '../my-day/MyDayScreen.tsx';
import { dayIn, isDay } from '../my-day/my-day-derive.ts';
import { readerZone } from '../../../api/usage.ts';
import { TimeReport } from '../../../components/time-report/TimeReport.tsx';
import { PersonLocalActivity } from './PersonLocalActivity.tsx';
import { DeveloperSetupTab } from './DeveloperSetupTab.tsx';
import {
  countLabel,
  monthYear,
  nextAttempt,
  type RatingAttempt,
  scoreLabel,
} from './profile-derive.ts';
import { firstName } from '../../../components/availability/availability-derive.ts';
import { OverviewRows } from './overview/OverviewRows.tsx';
import { RatingDialog } from './RatingDialog.tsx';
import { UsageCard } from './UsageCard.tsx';
import './profile.css';

export interface ProfileScreenProps {
  /** `?user=` — whose profile. */
  readonly userId: string | undefined;
  readonly me: MeProfile | undefined;
  /**
   * `?tab=` — `day`, `time` or `dev` (LAI-959, LAI-1134, LAI-1140); `hours`,
   * the Time report's name before LAI-1134, still opens it. Anything else is
   * the overview.
   */
  readonly tab?: string | undefined;
  readonly onTab?: (tab: ProfileTab) => void;
  /** `?day=` — the day the Day and Hours tabs read; today when absent. */
  readonly day?: string | undefined;
  readonly onDay?: (day: string) => void;
  readonly onNavigate?: (to: string) => void;
}

/**
 * The profile's sections (LAI-959, LAI-1134, LAI-1140): the record, the
 * person's day, their time, and their developer setup (frame 1n). Day and
 * Time report are *See everyone's analytics*; Developer setup is *See and
 * manage anyone's developer setup* — so a reader may hold either set alone.
 */
export type ProfileTab = 'overview' | 'day' | 'time' | 'dev';

const TABS: readonly (readonly [ProfileTab, string])[] = [
  ['overview', 'Overview'],
  ['day', 'Day'],
  ['time', 'Time report'],
  ['dev', 'Developer setup'],
];

/** `?tab=` as a tab: `hours` is the Time report's old name, kept so its links still land. */
export function profileTab(tab: string | undefined): ProfileTab {
  if (tab === 'day') return 'day';
  if (tab === 'time' || tab === 'hours') return 'time';
  if (tab === 'dev') return 'dev';
  return 'overview';
}

/** The tabs this reader may open on this profile: never Day, Time or Developer setup on your own. */
export function profileTabs(
  other: boolean,
  readsDays: boolean,
  readsSetup: boolean,
): readonly ProfileTab[] {
  return TABS.map(([id]) => id).filter(
    (id) =>
      id === 'overview' ||
      (other && readsDays && (id === 'day' || id === 'time')) ||
      (other && readsSetup && id === 'dev'),
  );
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly profile: MemberProfile };

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
export function ProfileScreen({
  userId,
  me,
  tab,
  onTab = () => undefined,
  day,
  onDay = () => undefined,
  onNavigate = () => undefined,
}: ProfileScreenProps) {
  // *See everyone's analytics* carries the profile and the day alike (§3's
  // grants, D-102 rule 6): the server's answer, and nothing until it has one
  // (LAI-970) — a role would show a withdrawn admin what they may not open.
  const gates = useGates(me !== undefined);
  const { settled } = gates;
  const allowed = gates.org('profile.read');
  const readsDays = gates.org(PEOPLE_ANALYTICS);
  // Availability (D-137, LAI-1139): your own record, a co-worker's narrowed
  // row, or — for an analytics reader — nothing until *Show current load* is
  // pressed, because that read is a logged look. Nothing before the gates say which.
  const availability = useProfileAvailability(
    userId ?? '',
    profileAvailabilityMode({
      userId,
      meId: me?.id,
      allowed,
      settled,
      readsAnalytics: readsDays,
    }),
  );
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [kindBusy, setKindBusy] = useState(false);
  const [kindError, setKindError] = useState<string | undefined>(undefined);
  const [rating, setRating] = useState<{ open: boolean; busy: boolean; error?: string }>({
    open: false,
    busy: false,
  });
  const rateButton = useRef<HTMLButtonElement>(null);
  /** The Manage member panel (LAI-1134), and the ⋯ that opened it. */
  const [managing, setManaging] = useState(false);
  const manageButton = useRef<HTMLDivElement>(null);
  /**
   * The rating being tried for each member, and its `Idempotency-Key`
   * (LAI-746). Kept across a failed try and a closed dialog — a response lost
   * on the way back may still have been written — and dropped once a save is
   * answered. **One per member** (LAI-749): this screen stays mounted when
   * `?user=` changes, and a key from one member's attempt must never be sent
   * for another's.
   */
  const ratingAttempts = useRef(new Map<string, RatingAttempt>());
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
    setManaging(false);
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

  if (!allowed && !settled) {
    return (
      <div className="prof">
        {header}
        <LoadingState shape="card" count={4} label="Loading the profile" />
      </div>
    );
  }

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
      canRate={gates.org('profile.rate') && me.id !== user.id}
      now={now}
      buttonRef={rateButton}
      onRate={() => {
        setRating({ open: true, busy: false });
      }}
    />
  );

  /**
   * After the Admin panel changed their role or active state: the profile
   * again, quietly — the panel stays on screen, so a notice it just showed is
   * not wiped by a loading state. A failed read is the screen's error.
   */
  const refreshProfile = (): void => {
    getProfile(user.id)
      .then((next) => {
        if (shown.current === user.id) setLoad({ kind: 'ready', profile: next });
      })
      .catch((cause: unknown) => {
        if (shown.current === user.id) setLoad({ kind: 'error', error: cause });
      });
  };

  // A person's own day is My day's, and their own setup Developer access's;
  // these tabs are for somebody else.
  const offered = profileTabs(me.id !== user.id, readsDays, gates.org('developer_setup.read_any'));
  // **`tabbed` is not "reads analytics"**: the row can be Overview · Developer
  // setup alone. A card that reads (or links to) the person's time gates on
  // `offered.includes('time')` or the analytics grant, never `tabbed`.
  const tabbed = offered.length > 1;
  const asked = profileTab(tab);
  const shownTab: ProfileTab = offered.includes(asked) ? asked : 'overview';
  // ⋯ is offered only when the panel would hold something (LAI-1134).
  const manages = anyAdminControl(adminControls(gates, me, user));
  const tabHref = (id: ProfileTab): string => {
    const q = new URLSearchParams({ user: user.id });
    if (id !== 'overview') q.set('tab', id);
    return `/people?${q.toString()}`;
  };

  return (
    <div className="prof" data-kind={user.profile_kind}>
      {header}

      <ProfileHead
        profile={profile}
        availability={<ProfileAvailabilityLine name={user.name} seen={availability.seen} />}
        manageRef={manageButton}
        onManage={
          manages
            ? () => {
                setManaging(true);
              }
            : undefined
        }
      />

      {tabbed && (
        <nav className="prof-tabs" aria-label={`${user.name}’s profile`}>
          {TABS.filter(([id]) => offered.includes(id)).map(([id, label]) => (
            <a
              key={id}
              href={tabHref(id)}
              className={id === shownTab ? 'prof-tab prof-tab-active' : 'prof-tab'}
              aria-current={id === shownTab ? 'page' : undefined}
              data-profile-tab={id}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onTab(id);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      )}

      {shownTab === 'day' && (
        <>
          <MyDayScreen
            key={user.id}
            me={me}
            user={user.id}
            embedded={{ name: user.name }}
            day={day}
            onDay={onDay}
            onNavigate={onNavigate}
          />
          <PersonLocalActivity key={`held-${user.id}`} userId={user.id} name={user.name} />
        </>
      )}

      {shownTab === 'time' && (
        <TimeReport
          key={user.id}
          scope="person"
          subject={{ id: user.id, name: user.name }}
          today={dayIn(readerZone(), Date.now())}
          anchor={isDay(day) ? day : undefined}
        />
      )}

      {shownTab === 'overview' && (
        <>
          {/*
           * The Overview as rows that share a height (SPEC §11.4.2.1, D-139,
           * LAI-1153), the same for both kinds. Activity and LLM tokens are
           * built here, with their own props, and laid into their rows.
           */}
          {/* Until LAI-1152 takes Current load off the profile (D-139 item 8). */}
          {offered.includes('time') && (
            <CurrentLoadCard
              name={user.name}
              state={availability.load}
              onShow={availability.reveal}
              onRetry={availability.reload}
            />
          )}
          <OverviewRows
            profile={profile}
            own={me.id === user.id}
            first={firstName(user.name)}
            readsTime={me.id === user.id || readsDays}
            availability={availability.seen}
            today={dayIn(readerZone(), now)}
            now={now}
            workHref={`/work?person=${encodeURIComponent(user.id)}`}
            onWork={() => {
              onNavigate(`/work?person=${encodeURIComponent(user.id)}`);
            }}
            timeReport={
              offered.includes('time')
                ? {
                    href: tabHref('time'),
                    go: () => {
                      onTab('time');
                    },
                  }
                : undefined
            }
            setup={
              offered.includes('dev')
                ? {
                    href: tabHref('dev'),
                    go: () => {
                      onTab('dev');
                    },
                  }
                : undefined
            }
            activity={
              <ActivityCard
                userId={user.id}
                name={user.name}
                viewerId={me.id}
                canManageOrg={gates.org('org.developer_insights.set')}
                sharing={profile.activity_sharing}
              />
            }
            usage={
              <UsageCard
                key={user.id}
                userId={user.id}
                name={user.name}
                self={me.id === user.id}
                className="prof-card ov-card"
              />
            }
          />

          {/* Until LAI-1152 takes them off the profile (D-139 item 8). */}
          <div className="prof-record" data-group="record">
            {ratingCard}
            <DecisionsCard review={profile.review} weeks={weeks} now={now} />
          </div>
        </>
      )}

      {shownTab === 'dev' && (
        <DeveloperSetupTab
          key={user.id}
          userId={user.id}
          name={user.name}
          canRevokeTokens={gates.org('token.revoke_any')}
        />
      )}

      {managing && (
        <ManageMemberPanel
          key={user.id}
          user={user}
          me={me}
          gates={gates}
          kind={{
            value: user.profile_kind,
            busy: kindBusy,
            error: kindError,
            onKind: changeKind,
          }}
          onChanged={refreshProfile}
          onClose={() => {
            setManaging(false);
          }}
          restore={() => manageButton.current?.querySelector('button')}
        />
      )}

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

/**
 * The profile's header (LAI-1134, frames 1n–1p): who they are, their kind as a
 * chip, one line of facts — and **⋯**, a menu whose *Manage member…* opens the
 * panel that holds every admin control. The Builder/Manager control itself
 * moved into that panel; the header only says which it is.
 */
function ProfileHead({
  profile,
  availability,
  manageRef,
  onManage,
}: {
  readonly profile: MemberProfile;
  /** Their availability pill, note and tags (LAI-1139), or nothing. */
  readonly availability: ReactNode;
  readonly manageRef: RefObject<HTMLDivElement | null>;
  /** Absent when the reader has nothing to manage here: then there is no ⋯. */
  readonly onManage: (() => void) | undefined;
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
      <span className="prof-avatar" style={avatar} aria-hidden="true">
        {initials(user.name)}
      </span>
      <div className="prof-who">
        <h2 className="prof-name" id="prof-name">
          <span>{user.name}</span>
          <span className="prof-kind-chip" data-kind-chip={user.profile_kind}>
            {KINDS[user.profile_kind].label}
          </span>
          {!user.is_active && <span className="prof-chip prof-chip-off">DEACTIVATED</span>}
        </h2>
        <p className="prof-meta">
          <span>{orgRoleLabel(user.org_role as OrgRole)}</span>
          <span>{countLabel(profile.projects.length, 'project', 'projects')}</span>
          <span className="prof-meta-email">{user.email}</span>
          <span>Member since {monthYear(user.created_at)}</span>
        </p>
        {availability}
      </div>
      {onManage !== undefined && (
        <div className="prof-manage" ref={manageRef} data-profile-manage>
          <OverflowMenu
            label={`Manage ${user.name}`}
            items={[{ id: 'manage', label: 'Manage member…', onSelect: onManage }]}
          />
        </div>
      )}
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
