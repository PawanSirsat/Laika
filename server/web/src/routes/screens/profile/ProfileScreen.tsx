import {
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
import { AvailabilityPill } from '../../../components/availability/AvailabilityPill.tsx';
import { copyText } from '../../../components/CopyButton.tsx';
import { firstName, updatedAgo } from '../../../components/availability/availability-derive.ts';
import '../../../components/availability/availability.css';
import { useSharedAvailability, type AvailabilitySeen } from '../../../api/availability.ts';
import { ApiError } from '../../../api/errors.ts';
import type { OrgRole } from '../../../api/invites.ts';
import type { MeProfile } from '../../../api/me.ts';
import { workHref } from '../organisation/work-derive.ts';
import {
  getOwnProfile,
  getProfile,
  profileHref,
  setProfileKind,
  type MemberProfile,
  type ProfileKind,
} from '../../../api/profiles.ts';
import { PEOPLE_ANALYTICS } from '../../../api/people-analytics.ts';
import { useGates } from '../../../api/permissions.ts';
import { readsSharedRow, useSharedRow } from './profile-availability.ts';
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
import { countLabel, monthYear } from './profile-derive.ts';
import { OverviewRows } from './overview/OverviewRows.tsx';
import { UsageCard } from './UsageCard.tsx';
import {
  TAB_ACTIVE,
  TAB_ITEM,
  TabStrip,
  rovingTabIndex,
} from '../../../components/tabs/TabStrip.tsx';
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
  // Someone else's pill (D-137, LAI-1152, LAI-1159): this one person's load for
  // an analytics reader — the list would log a look at everyone it lists — and
  // their row of the narrowed, unlogged list otherwise. Your own is the shared
  // store *My availability* reads and saves.
  const theirs = useSharedRow(userId ?? '', allowed && readsSharedRow(userId, me?.id), readsDays);
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
        {/* The grant, not a role (LAI-1191): an owner may give it to any role. */}
        <PermissionDenied
          resource="member profiles"
          requiredRole="admin"
          grant="See everyone’s analytics"
          scope="organisation"
        />
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
        onNavigate(workHref(user.id));
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
              <TabStrip activeKey={shownTab} className="prof-tabs-strip">
                {offered.map((id, index) => (
                  <a
                    key={id}
                    href={tabHref(id)}
                    className={id === shownTab ? 'prof-tab prof-tab-active' : 'prof-tab'}
                    aria-current={id === shownTab ? 'page' : undefined}
                    tabIndex={rovingTabIndex(id === shownTab, index, offered.includes(shownTab))}
                    data-profile-tab={id}
                    {...{ [TAB_ITEM]: '' }}
                    {...(id === shownTab ? { [TAB_ACTIVE]: '' } : {})}
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
              </TabStrip>
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
              embedded={{ name: user.name, orgRole: user.org_role }}
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
              embedded={{ name: user.name, orgRole: user.org_role }}
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
            // Your own report names you, as My day's does: with nobody named
            // the report would be everyone's, so TimeReport never asks for it
            // and the tab sat on its skeleton (LAI-1161).
            subject={{ id: user.id, name: user.name }}
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
        // The Overview as rows that share a height (SPEC §11.4.2.1, D-139,
        // LAI-1153), the same for both kinds. Activity and LLM tokens are
        // built here, with their own props, and laid into their rows.
        <OverviewRows
          profile={profile}
          own={own}
          first={first}
          readsTime={own || readsDays}
          availability={own ? mine : theirs}
          today={dayIn(readerZone(), now)}
          now={now}
          workHref={workHref(user.id)}
          onWork={() => {
            onNavigate(workHref(user.id));
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
              joinedAt={user.created_at}
              viewerId={me.id}
              canManageOrg={gates.org('org.developer_insights.set')}
              sharing={profile.activity_sharing}
              definitions={false}
              own={own}
            />
          }
          usage={
            <UsageCard
              key={user.id}
              userId={user.id}
              name={user.name}
              self={own}
              definitions={false}
              className="prof-card ov-card"
            />
          }
        />
      )}

      {shownTab === 'dev' &&
        (own ? (
          <OwnDeveloperSetupTab setup={ownSetup} meId={me.id} onNavigate={onNavigate} />
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
