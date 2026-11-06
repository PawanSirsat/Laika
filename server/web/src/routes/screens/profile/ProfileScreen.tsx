import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { PermissionDenied } from '../../../components/PermissionDenied.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { OverflowMenu, type OverflowMenuItem } from '../../../components/wizard/OverflowMenu.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { AvailabilityPill } from '../../../components/availability/AvailabilityPill.tsx';
import { copyText } from '../../../components/CopyButton.tsx';
import { firstName, updatedAgo } from '../../../components/availability/availability-derive.ts';
import '../../../components/availability/availability.css';
import { agentClientName, type AgentClient } from '../../../api/agent-clients.ts';
import { useSharedAvailability, type AvailabilitySeen } from '../../../api/availability.ts';
import { ApiError } from '../../../api/errors.ts';
import type { OrgRole } from '../../../api/invites.ts';
import type { MeProfile } from '../../../api/me.ts';
import {
  getOwnProfile,
  getProfile,
  profileHref,
  setProfileKind,
  type MemberProfile,
  type ProfileAgents,
  type ProfileCurrentWork,
  type ProfileDelivery,
  type ProfileKind,
  type ProfileProject,
  type ProfileQueue,
  type ProfileReview,
  type ProfileTask,
} from '../../../api/profiles.ts';
import { PEOPLE_ANALYTICS } from '../../../api/people-analytics.ts';
import { useGates } from '../../../api/permissions.ts';
import { readsSharedRow, useSharedRow } from './profile-availability.ts';
import { dateTime, timeLabel } from '../../../api/time-label.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { SCREEN_COPY } from '../screen-copy.ts';
import { ActivityCard } from './ActivityCard.tsx';
import { KINDS } from './ManageSections.tsx';
import { ManageMemberPanel } from './ManageMemberPanel.tsx';
import { adminControls, anyAdminControl } from './manage-controls.ts';
import { AvailabilityPopover } from '../my-day/AvailabilityPopover.tsx';
import { MyDayScreen } from '../my-day/MyDayScreen.tsx';
import { dayIn, isDay } from '../my-day/my-day-derive.ts';
import { readerZone } from '../../../api/usage.ts';
import { TimeReport } from '../../../components/time-report/TimeReport.tsx';
import { PersonLocalActivity } from './PersonLocalActivity.tsx';
import { DeveloperSetupTab, OwnDeveloperSetupTab } from './DeveloperSetupTab.tsx';
import { toFixLabel } from './own-setup-derive.ts';
import { useOwnSetup } from './use-own-setup.ts';
import { ProfileWhoLooked } from './ProfileWhoLooked.tsx';
import {
  profileNotice,
  profileTab,
  profileTabLabel,
  profileTabs,
  type ProfileTab,
} from './profile-shell.ts';
import {
  agentRows,
  barHeights,
  columnCount,
  columnPlan,
  type CardGroup,
  type ColumnCount,
  type ProfileCardId,
  countLabel,
  durationLabel,
  lastActive,
  ROWS_SHOWN,
  workTab,
  type WorkTab,
  monthYear,
  weekLabel,
} from './profile-derive.ts';
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

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly profile: MemberProfile };

/** Categorical slots for the agent-share bar, in rank order (tokens only). */
const SHARE_SLOTS = 6;

/** The server's sentence when there is one; never "something went wrong" over it. */
function said(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'That did not go through. Try again.';
}

/** A plain click on an in-app link is the app's to follow; a modified one is the browser's. */
function follow(go: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go();
  };
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
 * One member's profile (SPEC §11.4.2.1, D-078, D-139; the owner's *Laika
 * Profile*, LAI-1152): a breadcrumb and a notice, a head card holding who they
 * are, their availability and the tabs, then the tab.
 *
 * ## Two cases
 *
 * **Someone else's**, for an owner or admin: read-only, the person sees the
 * look, and **⋯** holds *Manage member…*, *Copy link to profile* and *See
 * <first>'s cards in Work*. **Your own**: the availability pill is the button
 * that edits it, *Who looked* lists every look at you, and all four tabs are
 * yours. Anyone else is told so and **the profile is never asked for**.
 *
 * Your own is `GET /me/profile` (LAI-1150), which every role may read, and
 * its heatmap `GET /me/activity`; a look at someone else is
 * `GET /users/:id/profile`, `profile.read` alone.
 *
 * ## Every figure is the server's
 *
 * Nothing here counts anything: each number is a field of
 * `GET /users/:id/profile`, and an absence reads as a sentence or a dash, never
 * as a zero. A builder's response carries no queue; a manager's carries the
 * work, delivery and agents blocks like a builder's since D-139 item 2, and a
 * block a server leaves out is a card left out — never an empty one.
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
  const own = userId !== undefined && userId === me?.id;
  // Your own is every role's (D-139 item 1, LAI-1150); anyone else's is
  // `profile.read`, owners and admins.
  const allowed = gates.org('profile.read') || (own && gates.org('profile.read_own'));
  const readsDays = gates.org(PEOPLE_ANALYTICS);
  // Someone else's pill (D-137, LAI-1152): their row of the list, which logs
  // nothing. Your own is the shared store *My availability* reads and saves.
  const theirs = useSharedRow(userId ?? '', allowed && readsSharedRow(userId, me?.id));
  const [mine] = useSharedAvailability();
  // Your own developer setup (LAI-1156), read beside the profile and not
  // before it: the Developer access tab draws it, and its *N to fix* is the
  // tab's badge — on your own only (D-139 item 5). Someone else's is never
  // read to draw the head.
  const ownSetup = useOwnSetup(own && allowed ? me : undefined);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [kindBusy, setKindBusy] = useState(false);
  const [kindError, setKindError] = useState<string | undefined>(undefined);
  /** The Manage member panel (LAI-1134), and the ⋯ that opened it. */
  const [managing, setManaging] = useState(false);
  const manageButton = useRef<HTMLDivElement>(null);
  /** *Copy link to profile*'s answer: copied, or the link to copy by hand. */
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const columns = useColumnCount();
  /**
   * Whose profile is on the page now (LAI-751). A kind change answers after
   * its request — and Back may have moved the page to someone else by then;
   * an answer about anybody but this person is dropped, never drawn over the
   * person now shown.
   */
  const shown = useRef(userId);

  useEffect(() => {
    shown.current = userId;
    // A panel belongs to the person it was opened on; moving away closes it.
    setKindError(undefined);
    setManaging(false);
    setCopied(undefined);
  }, [userId]);

  useEffect(() => {
    if (!allowed || userId === undefined) return;
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    // Your own from `/me/profile`, which writes no look and needs no grant
    // past being signed in; someone else's from `/users/:id/profile`.
    (own ? getOwnProfile(controller.signal) : getProfile(userId, controller.signal))
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
  }, [allowed, own, userId, attempt]);

  const chrome = (name?: string) => <ProfileChrome own={own} name={name} onNavigate={onNavigate} />;

  if (me === undefined) return null;

  if (!allowed && !settled) {
    return (
      <div className="prof">
        {chrome()}
        <LoadingState shape="card" count={4} label="Loading the profile" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="prof">
        {chrome()}
        <PermissionDenied resource="member profiles" requiredRole="admin" scope="organisation" />
      </div>
    );
  }

  if (userId === undefined || userId === '') {
    return (
      <div className="prof">
        {chrome()}
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
        {chrome()}
        <LoadingState shape="card" count={4} label="Loading the profile" />
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="prof">
        {chrome()}
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
  const first = firstName(user.name);

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
  };

  const offered = profileTabs(own, readsDays, gates.org('developer_setup.read_any'));
  const asked = profileTab(tab);
  const shownTab: ProfileTab = offered.includes(asked) ? asked : 'overview';
  // ⋯'s *Manage member…* is offered only when the panel would hold something (LAI-1134).
  const manages = anyAdminControl(adminControls(gates, me, user));
  const tabHref = (id: ProfileTab): string => {
    const q = new URLSearchParams({ user: user.id });
    if (id !== 'overview') q.set('tab', id);
    return `/people?${q.toString()}`;
  };
  const record = columnPlan(user.profile_kind, columns, 'record');

  const menu: OverflowMenuItem[] = [
    ...(manages
      ? [
          {
            id: 'manage',
            label: 'Manage member…',
            hint: 'Role, spaces, security, deactivate',
            onSelect: () => {
              setManaging(true);
            },
          },
        ]
      : []),
    {
      id: 'copy',
      label: 'Copy link to profile',
      onSelect: () => {
        // Inside the click, before any await: the fallback needs the gesture.
        const link = `${window.location.origin}${profileHref(user.id)}`;
        setCopied(undefined);
        void copyText(link, manageButton.current).then((outcome) => {
          if (shown.current !== user.id) return;
          setCopied(outcome === 'copied' ? 'Link copied' : `Copy this link: ${link}`);
        });
      },
    },
    {
      id: 'work',
      label: `See ${first}’s cards in Work`,
      onSelect: () => {
        onNavigate(`/work?person=${encodeURIComponent(user.id)}`);
      },
    },
  ];

  return (
    <div className="prof" data-kind={user.profile_kind} data-own={own}>
      {chrome(user.name)}

      <ProfileHead
        profile={profile}
        own={own}
        availability={own ? mine : theirs}
        actions={
          own ? (
            <ProfileWhoLooked />
          ) : (
            <>
              <span className="prof-copied" role="status" data-profile-copied>
                {copied ?? ''}
              </span>
              <div className="prof-manage" ref={manageButton} data-profile-manage>
                <OverflowMenu label={`Manage ${user.name}`} items={menu} />
              </div>
            </>
          )
        }
        tabs={
          offered.length > 1 ? (
            <nav className="prof-tabs" aria-label={`${user.name}’s profile`}>
              {offered.map((id) => (
                <a
                  key={id}
                  href={tabHref(id)}
                  className={id === shownTab ? 'prof-tab prof-tab-active' : 'prof-tab'}
                  aria-current={id === shownTab ? 'page' : undefined}
                  data-profile-tab={id}
                  onClick={follow(() => {
                    onTab(id);
                  })}
                >
                  {profileTabLabel(id, own)}
                  {id === 'dev' && own && toFixLabel(ownSetup.toFix) !== undefined && (
                    <span className="prof-tab-badge" data-profile-tab-badge>
                      {toFixLabel(ownSetup.toFix)}
                    </span>
                  )}
                </a>
              ))}
            </nav>
          ) : undefined
        }
      />

      {shownTab === 'day' &&
        (own ? (
          <>
            <p className="prof-tab-lead">
              <a
                href="/my-day"
                data-profile-edit-day
                onClick={follow(() => {
                  onNavigate('/my-day');
                })}
              >
                Edit in My day ›
              </a>
            </p>
            <MyDayScreen
              key={user.id}
              me={me}
              user={user.id}
              embedded={{ name: user.name }}
              day={day}
              onDay={onDay}
              onNavigate={onNavigate}
            />
          </>
        ) : (
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
        ))}

      {shownTab === 'time' &&
        (own ? (
          <TimeReport
            key={user.id}
            scope="me"
            title="Time report"
            today={dayIn(readerZone(), Date.now())}
            anchor={isDay(day) ? day : undefined}
          />
        ) : (
          <TimeReport
            key={user.id}
            scope="person"
            subject={{ id: user.id, name: user.name }}
            today={dayIn(readerZone(), Date.now())}
            anchor={isDay(day) ? day : undefined}
          />
        ))}

      {shownTab === 'overview' && (
        <>
          {/*
           * The design's summary first (frames 1n–1p), in columns (LAI-751,
           * owner, 2026-10-16): each column stacks its cards one gap apart, so
           * a short card is never followed by a hole the height of its
           * neighbour. Which card goes where is `columnPlan`'s — chosen, not
           * computed — and one column is the reading order.
           */}
          {!own && offered.includes('time') && (
            // *Time this week* (frame 1n) is a link, not figures: reading them
            // here would log a look at the person on every Overview open
            // (D-102, D-135). The Time report tab is the look, and says so.
            <Card name="time" title="Time this week">
              <p className="prof-time-link">
                Where {user.name}’s time went, by space, task and kind.{' '}
                <a
                  href={tabHref('time')}
                  data-profile-time-link
                  onClick={follow(() => {
                    onTab('time');
                  })}
                >
                  Open time report
                </a>
                <span className="prof-time-note"> · opening it is a look {user.name} can see</span>
              </p>
            </Card>
          )}
          <Columns plan={columnPlan(user.profile_kind, columns)} cards={cards} group="main" />

          <ActivityCard
            userId={user.id}
            name={user.name}
            viewerId={me.id}
            canManageOrg={gates.org('org.developer_insights.set')}
            sharing={profile.activity_sharing}
            definitions={false}
            own={own}
          />

          {/*
           * The record (LAI-1134): what SPEC §11.4.2.1 requires and the design
           * draws further down — tool usage and delivery — folded in under the
           * summary. The rating and recent decisions are gone (D-139 item 8).
           */}
          <h3 className="prof-group-title" data-group-title="record">
            Record
            <span className="prof-card-caption">
              {record.length === 0 ? 'tool usage' : 'tool usage and delivery'}
            </span>
          </h3>

          {/* Their agents' tokens (D-084, LAI-769): full width, like Activity. */}
          <UsageCard
            key={user.id}
            userId={user.id}
            name={user.name}
            self={own}
            definitions={false}
          />

          {record.length > 0 && <Columns plan={record} cards={cards} group="record" />}
        </>
      )}

      {shownTab === 'dev' &&
        (own ? (
          <OwnDeveloperSetupTab setup={ownSetup} meId={me.id} />
        ) : (
          <DeveloperSetupTab
            key={user.id}
            userId={user.id}
            name={user.name}
            canRevokeTokens={gates.org('token.revoke_any')}
          />
        ))}

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
    </div>
  );
}

// ------------------------------------------------------------------ chrome

const Eye = () => (
  <svg className="prof-eye" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.75" />
  </svg>
);

/**
 * The line above the head card (SPEC §11.4.2.1): *Members / <name>*, or *My
 * profile* on your own, and the notice at the right in its two wordings. It
 * is the screen's `ScreenHeader`, so the last step is the page's one `<h1>`;
 * the name in the head card under it is a heading of the card. Until the
 * profile answers, someone else's is *Members* alone and has no notice.
 */
function ProfileChrome({
  own,
  name,
  onNavigate,
}: {
  readonly own: boolean;
  readonly name: string | undefined;
  readonly onNavigate: (to: string) => void;
}) {
  const members = '/organisation?tab=people';
  const named = !own && name !== undefined;
  return (
    <ScreenHeader
      variant="crumbs"
      title={own ? 'My profile' : (name ?? 'Members')}
      trail={
        named && (
          <>
            <a
              href={members}
              className="prof-crumb"
              onClick={follow(() => {
                onNavigate(members);
              })}
            >
              Members
            </a>
            <span className="prof-crumb-sep" aria-hidden="true">
              /
            </span>
          </>
        )
      }
      context={
        own || name !== undefined ? (
          <span className="prof-notice" data-profile-notice>
            <Eye />
            <span>{profileNotice(own, name ?? '')}</span>
          </span>
        ) : undefined
      }
    />
  );
}

// -------------------------------------------------------------------- head

/**
 * The head card (frames A and C, LAI-1152): the avatar in its ring, the name,
 * the Builder / Manager chip and the availability pill inline — on your own,
 * the pill is the button that opens *My availability* — then one line of
 * facts, the note and tags with who set them when, the actions at the top
 * right (⋯ on someone else's, *Who looked* on your own) and the tabs along
 * its foot.
 */
function ProfileHead({
  profile,
  own,
  availability,
  actions,
  tabs,
}: {
  readonly profile: MemberProfile;
  readonly own: boolean;
  /** What they said: `undefined` while it is read, `null` when there is no row for them. */
  readonly availability: AvailabilitySeen | null | undefined;
  readonly actions: ReactNode;
  readonly tabs: ReactNode;
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
      <div className="prof-head-main">
        <span className="prof-avatar" style={avatar} aria-hidden="true">
          {initials(user.name)}
        </span>
        <div className="prof-who">
          <div className="prof-name-row">
            <h2 className="prof-name" id="prof-name">
              {user.name}
            </h2>
            <span className="prof-kind-chip" data-kind-chip={user.profile_kind}>
              {KINDS[user.profile_kind].label}
            </span>
            {!user.is_active && <span className="prof-chip prof-chip-off">DEACTIVATED</span>}
            {own ? (
              <AvailabilityPopover variant="head" />
            ) : (
              availability !== undefined &&
              availability !== null && (
                <span data-profile-pill>
                  <AvailabilityPill availability={availability} unset="Availability not set" />
                </span>
              )
            )}
          </div>
          <p className="prof-meta">
            <span>{orgRoleLabel(user.org_role as OrgRole)}</span>
            <span>{countLabel(profile.projects.length, 'project', 'projects')}</span>
            <span className="prof-meta-email">{user.email}</span>
            <span>Member since {monthYear(user.created_at)}</span>
          </p>
          <AvailabilityLine seen={availability} setBy={own ? 'you' : firstName(user.name)} />
        </div>
        <div className="prof-head-actions">{actions}</div>
      </div>
      {tabs}
    </section>
  );
}

/**
 * The head card's own line (frame A): the note, the tags and *set by <first>
 * · updated N ago* — *set by you* on your own. Nothing when there is no note
 * and no tag, as the design draws it.
 */
function AvailabilityLine({
  seen,
  setBy,
  now = Date.now(),
}: {
  readonly seen: AvailabilitySeen | null | undefined;
  readonly setBy: string;
  readonly now?: number;
}) {
  if (seen === null || seen === undefined) return null;
  if (seen.note === null && seen.tags.length === 0) return null;
  const updated = updatedAgo(seen.updated_at, now);
  return (
    <p className="prof-avail" data-profile-availability>
      {seen.note !== null && <span className="avail-note">“{seen.note}”</span>}
      {seen.tags.map((t) => (
        <span key={t} className="avail-chip">
          {t}
        </span>
      ))}
      <span data-stale={updated?.stale === true}>
        set by {setBy}
        {updated !== null && ` · ${updated.text}`}
        {updated?.stale === true && ' · may be out of date'}
      </span>
    </p>
  );
}

/** One group of the Overview's columns (LAI-751, LAI-1134). */
function Columns({
  plan,
  cards,
  group,
}: {
  readonly plan: readonly (readonly ProfileCardId[])[];
  readonly cards: Readonly<Record<ProfileCardId, ReactNode>>;
  readonly group: CardGroup;
}) {
  return (
    <div className="prof-columns" data-columns={plan.length} data-group={group}>
      {plan.map((ids) => (
        <div key={ids.join('-')} className="prof-column">
          {ids.map((id) => (
            <Fragment key={id}>{cards[id]}</Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- parts

function Card({
  name,
  title,
  count,
  caption,
  children,
  actions,
}: {
  readonly name: string;
  readonly title: string;
  readonly count?: number | undefined;
  /** A few muted words after the title — what it counts, over when. */
  readonly caption?: string | undefined;
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
        {actions !== undefined && <span className="prof-card-actions">{actions}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * A metric tile: a small label, a big number, and an optional second value
 * beside it (`3 d / 4.5 d`), and an optional tooltip.
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
              ? `In Review since ${dateTime(since, Date.now())}`
              : `First started ${dateTime(since, Date.now())}`
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
    <Card name="delivery" title="Delivered" caption={`${String(weeks)} weeks`}>
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
            <Stat name="accepted" label="Accepted" value={String(delivery.accepted)} />
            <Stat name="sent_back" label="Sent back" value={String(delivery.sent_back)} />
            <Stat name="reopened" label="Reopened" value={String(delivery.reopened)} />
            <Stat
              name="cycle"
              label="Cycle p50 / p75"
              value={durationLabel(cycle.p50_ms)}
              sub={cycle.p75_ms === null ? undefined : `/ ${durationLabel(cycle.p75_ms)}`}
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
    <Card name="review" title={title} caption={`${String(weeks)} weeks`}>
      {/* A manager's queue, when there is one to show (LAI-751: no row of zeros). */}
      {queue !== undefined && (queue.projects_led > 0 || queue.waiting > 0) && (
        <dl className="prof-stats prof-stats-compact" data-group="queue">
          <Stat name="projects_led" label="Projects led" value={String(queue.projects_led)} />
          <Stat name="waiting" label="Waiting now" value={String(queue.waiting)} />
          <Stat
            name="oldest_waiting"
            label="Oldest waiting"
            value={
              queue.oldest_waiting_since === null
                ? '—'
                : durationLabel(Math.max(0, now - queue.oldest_waiting_since))
            }
          />
        </dl>
      )}
      {decided > 0 && (
        <dl className="prof-stats" data-group="decisions">
          <Stat name="review_30d" label="Decided · 30 days" value={String(review.last_30_days)} />
          <Stat name="review_accepted" label="Accepted" value={String(review.accepted)} />
          <Stat name="review_sent_back" label="Sent back" value={String(review.sent_back)} />
          <Stat
            name="decide_p50"
            label="Median to decide"
            value={durationLabel(decide.p50_ms)}
            sub={decide.unmeasured > 0 ? `${String(decide.measured)} timed` : undefined}
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
          ? 'Tools used'
          : `Tools used · ${countLabel(rows.length, 'type', 'types')}`
      }
      caption={
        !online.enabled
          ? 'presence off'
          : live.length === 0
            ? 'none online'
            : `${String(live.length)} online`
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
