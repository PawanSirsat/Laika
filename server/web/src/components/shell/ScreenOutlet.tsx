import { useEffect, type ComponentType } from 'react';
import { useShell } from './shell-context.ts';
import { SpaceLayout } from '../space/SpaceLayout.tsx';
import { BoardScreen } from '../../routes/screens/BoardScreen.tsx';
import { CalendarScreen } from '../../routes/screens/calendar/CalendarScreen.tsx';
import {
  CapacityScreen,
  type CapacityTaskLink,
} from '../../routes/screens/capacity/CapacityScreen.tsx';
import { ActivityScreen } from '../../routes/screens/activity/ActivityScreen.tsx';
import { DashboardScreen } from '../../routes/screens/dashboard/DashboardScreen.tsx';
import { SetupRoute } from '../../routes/screens/SetupRoute.tsx';
import { InviteRoute } from '../../routes/screens/InviteRoute.tsx';
import { LoginRoute } from '../../routes/screens/LoginRoute.tsx';
import { MeetingReviewScreen } from '../../routes/screens/meeting-review/MeetingReviewScreen.tsx';
import { MembersScreen } from '../../routes/screens/MembersScreen.tsx';
import { NotFound } from '../../routes/screens/NotFound.tsx';
import { OrganisationScreen } from '../../routes/screens/organisation/OrganisationScreen.tsx';
import { ProjectsScreen } from '../../routes/screens/ProjectsScreen.tsx';
import { ProfileScreen } from '../../routes/screens/profile/ProfileScreen.tsx';
import { ReviewScreen } from '../../routes/screens/review/ReviewScreen.tsx';
import { SprintsScreen } from '../../routes/screens/sprints/SprintsScreen.tsx';
import { TimelineScreen } from '../../routes/screens/timeline/TimelineScreen.tsx';
import { ConnectScreen } from '../../routes/screens/connect/ConnectScreen.tsx';
import { DeveloperScreen } from '../../routes/screens/developer/DeveloperScreen.tsx';
import { InboxScreen } from '../../routes/screens/inbox/InboxScreen.tsx';
import { InsightsScreen } from '../../routes/screens/insights/InsightsScreen.tsx';
import { UnlistedScreen } from '../../routes/screens/unlisted/UnlistedScreen.tsx';
import { UsageScreen } from '../../routes/screens/usage/UsageScreen.tsx';
import { MyDayScreen } from '../../routes/screens/my-day/MyDayScreen.tsx';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import {
  INBOX_TABS,
  INSIGHTS_TABS,
  ORGANISATION_TABS,
  currentTab,
  visibleTabs,
} from '../../routes/page-tabs.ts';
import { StateGallery } from '../StateGallery.tsx';
import { TokenReference } from '../../theme/TokenReference.tsx';

/**
 * Which frame a screen mounts into.
 *
 * - `space` — a view *of* a project: the top bar and tab strip belong above it
 *   (LAI-251 builds that frame; the value is declared here so the registry and
 *   `SPACE_TAB_PATHS` can be checked against each other today).
 * - `own-chrome` — the screen draws its own brand and theme control, so the
 *   shell adds no header. Must agree with the route's `ownsChrome`.
 * - `plain` — the ordinary case.
 */
export type ScreenLayout = 'space' | 'plain' | 'own-chrome';

export interface ScreenEntry {
  readonly Component: ComponentType;
  readonly layout: ScreenLayout;
}

/*
 * The wrappers below are the whole of what `AppShell`'s ternary chain did: take
 * what the shell knows and hand each screen its props. They are here rather
 * than merged into the screens because the screens are presentational and
 * prop-tested; giving each one a private view of the shell would have rewritten
 * those tests to prove nothing new.
 */

function BoardRoute() {
  const {
    route: { params, setParams, path },
    me,
  } = useShell();
  // `/board` and `/list` are the same screen in two modes — the design makes
  // them sibling tabs, so the route is what chooses (LAI-270).
  return <BoardScreen params={params} onParamsChange={setParams} me={me} path={path} />;
}

function ProjectsRoute() {
  const {
    route: { navigate },
    me,
  } = useShell();
  return (
    <ProjectsScreen
      me={me}
      onOpen={(slug) => {
        navigate(`/board?project=${encodeURIComponent(slug)}`);
      }}
      onOpenMembers={(slug) => {
        navigate(`/members?project=${encodeURIComponent(slug)}`);
      }}
    />
  );
}

/** The board opens a task by id in `?task=` (LAI-424); a key goes through search. */
function openTaskByKey(navigate: (to: string) => void) {
  return (taskKey: string) => {
    navigate(`/board?q=${encodeURIComponent(taskKey)}`);
  };
}

/**
 * Open a task **in its own space**, by id (LAI-755). Without `?project=` the
 * board falls back to the space last opened, which on a page across every
 * space is usually another one. A key search remains the fallback when the
 * space is not known.
 */
function openTaskInItsSpace(navigate: (to: string) => void) {
  return ({ id, key, projectSlug }: CapacityTaskLink) => {
    if (projectSlug === undefined) {
      openTaskByKey(navigate)(key);
      return;
    }
    navigate(`/board?project=${encodeURIComponent(projectSlug)}&task=${encodeURIComponent(id)}`);
  };
}

function MeetingReviewRoute() {
  const {
    route: { params, navigate },
  } = useShell();
  return (
    <MeetingReviewScreen
      slug={params.get('project') ?? undefined}
      onOpenTask={openTaskByKey(navigate)}
    />
  );
}

function CalendarRoute() {
  const {
    route: { params, setParams },
  } = useShell();
  return (
    <CalendarScreen
      slug={params.get('project') ?? undefined}
      onOpenTask={(taskId) => {
        const next = new URLSearchParams(params);
        next.set('task', taskId);
        setParams(next, { push: true });
      }}
    />
  );
}

function ActivityRoute() {
  const {
    route: { params },
  } = useShell();
  // Space-scoped: the stream, the sessions and the stale list are all about
  // *this* space, so the screen reads the same `?project=` every tab carries.
  return <ActivityScreen slug={params.get('project') ?? undefined} />;
}

/**
 * One page for the organisation (LAI-754), so `?project=` means nothing here.
 * A link that still carries one — from when Capacity was a space tab — has it
 * rewritten away in place, so the address says what is shown. Since LAI-796
 * it is the Capacity tab of Insights.
 */
function CapacityRoute() {
  const {
    route: { navigate, params, setParams },
    unlistedOpen,
    reviewWaiting,
  } = useShell();
  const project = params.get('project');
  useEffect(() => {
    if (project === null) return;
    const next = new URLSearchParams(params);
    next.delete('project');
    setParams(next);
  }, [project]);
  return (
    <CapacityScreen
      onOpenTask={openTaskInItsSpace(navigate)}
      unlistedOpen={unlistedOpen}
      reviewWaiting={reviewWaiting}
      onNavigate={navigate}
    />
  );
}

function UnlistedRoute() {
  const {
    route: { navigate },
    refreshUnlisted,
  } = useShell();
  // A promote or a dismiss changes the sidebar's count; it re-reads (LAI-754).
  return <UnlistedScreen onOpenTask={openTaskByKey(navigate)} onChanged={refreshUnlisted} />;
}

/** One page for the organisation (LAI-769), with its own space selector. */
function UsageRoute() {
  const {
    route: { navigate },
    me,
    tokenAlerts,
    refreshTokenAlerts,
  } = useShell();
  return (
    <UsageScreen
      me={me}
      onNavigate={navigate}
      alerts={tokenAlerts}
      onAlertsChanged={refreshTokenAlerts}
    />
  );
}

/**
 * The reader's own day (LAI-787). `?day=` names which; absent is today. A
 * day picked is a URL, so back and forward walk the days as they were seen.
 */
function MyDayRoute() {
  const {
    route: { params, setParams, navigate },
    me,
  } = useShell();
  return (
    <MyDayScreen
      me={me}
      onNavigate={navigate}
      day={params.get('day') ?? undefined}
      onDay={(day) => {
        const next = new URLSearchParams(params);
        next.set('day', day);
        setParams(next, { push: true });
      }}
    />
  );
}

function ReviewRoute() {
  const {
    route: { navigate },
    refreshReview,
  } = useShell();
  // An accept or a send-back changes the sidebar's count; it re-reads (D-082).
  return <ReviewScreen onNavigate={navigate} onChanged={refreshReview} />;
}

function ConnectRoute() {
  const {
    me,
    route: { params, setParams },
  } = useShell();
  // `?agent=` carries the chosen coding agent (LAI-737), so a link can open
  // the page already set to the team's agent.
  return (
    <ConnectScreen me={me} origin={window.location.origin} params={params} setParams={setParams} />
  );
}

/**
 * Inbox (LAI-796): Review and Unlisted work as tabs. The counts are the
 * shell's — the same two numbers the sidebar adds up for Inbox's badge.
 */
function InboxRoute() {
  const {
    route: { params, navigate },
    me,
    reviewWaiting,
    unlistedOpen,
  } = useShell();
  const holds = permissionHolder(me?.org_role);
  const tab = currentTab(INBOX_TABS, params, holds);
  return (
    <InboxScreen
      tabs={visibleTabs(INBOX_TABS, holds)}
      current={tab}
      counts={{ review: reviewWaiting, unlisted: unlistedOpen }}
      onNavigate={navigate}
    >
      {tab === 'unlisted' ? <UnlistedRoute /> : <ReviewRoute />}
    </InboxScreen>
  );
}

/** Insights (LAI-796): Capacity and Usage & cost as tabs. */
function InsightsRoute() {
  const {
    route: { params, navigate },
    me,
  } = useShell();
  const holds = permissionHolder(me?.org_role);
  const tab = currentTab(INSIGHTS_TABS, params, holds);
  return (
    <InsightsScreen
      tabs={visibleTabs(INSIGHTS_TABS, holds)}
      current={tab}
      onNavigate={navigate}
    >
      {tab === 'usage' ? <UsageRoute /> : <CapacityRoute />}
    </InsightsScreen>
  );
}

/** Developer access (LAI-796): Connect's card and the reader's tokens. */
function DeveloperRoute() {
  const {
    me,
    route: { navigate },
  } = useShell();
  return <DeveloperScreen me={me} origin={window.location.origin} onNavigate={navigate} />;
}

function OrganisationRoute() {
  const {
    me,
    route: { params, navigate },
  } = useShell();
  // The screen requires a user; the gate has already refused every other
  // session state on this protected route, so this is the frame before a
  // redirect lands rather than a state anyone sits in.
  if (me === undefined) return null;
  const holds = permissionHolder(me.org_role);
  return (
    <OrganisationScreen
      me={me}
      tabs={visibleTabs(ORGANISATION_TABS, holds)}
      tab={currentTab(ORGANISATION_TABS, params, holds)}
      onNavigate={navigate}
    />
  );
}

function MembersRoute() {
  const {
    route: { params },
    me,
  } = useShell();
  return <MembersScreen slug={params.get('project') ?? undefined} me={me} />;
}

function ProfileRoute() {
  const {
    route: { params },
    me,
  } = useShell();
  // `?user=` names whose profile (LAI-743); the screen refuses anyone who may
  // not open profiles before it asks the server for one.
  return <ProfileScreen userId={params.get('user') ?? undefined} me={me} />;
}

/**
 * Every path in `ROUTES` has exactly one entry here, and every entry names a
 * real path — `screen-registry.test.ts` asserts the bijection. A route that
 * gains no screen is the defect this replaces: the old chain fell through to a
 * generic placeholder, so a missing branch looked like an empty state.
 */
export const SCREENS: Readonly<Record<string, ScreenEntry>> = {
  '/board': { Component: BoardRoute, layout: 'space' },
  '/list': { Component: BoardRoute, layout: 'space' },
  '/timeline': { Component: TimelineScreen, layout: 'space' },
  '/calendar': { Component: CalendarRoute, layout: 'space' },
  '/sprints': { Component: SprintsScreen, layout: 'space' },
  '/dashboard': { Component: DashboardScreen, layout: 'space' },
  '/activity': { Component: ActivityRoute, layout: 'space' },
  '/meeting-review': { Component: MeetingReviewRoute, layout: 'space' },
  '/projects': { Component: ProjectsRoute, layout: 'plain' },
  '/my-day': { Component: MyDayRoute, layout: 'plain' },
  '/inbox': { Component: InboxRoute, layout: 'plain' },
  '/insights': { Component: InsightsRoute, layout: 'plain' },
  '/organisation': { Component: OrganisationRoute, layout: 'plain' },
  '/developer': { Component: DeveloperRoute, layout: 'plain' },
  '/developer/connect': { Component: ConnectRoute, layout: 'plain' },
  '/members': { Component: MembersRoute, layout: 'plain' },
  '/people': { Component: ProfileRoute, layout: 'plain' },
  '/login': { Component: LoginRoute, layout: 'plain' },
  '/invite': { Component: InviteRoute, layout: 'plain' },
  '/setup': { Component: SetupRoute, layout: 'own-chrome' },
  '/design/tokens': { Component: TokenReference, layout: 'plain' },
  '/design/states': { Component: StateGallery, layout: 'plain' },
};

/**
 * The screen for the current path.
 *
 * One lookup. The chain this replaces was ~110 lines of nested ternaries whose
 * order mattered — `route === undefined ? <NotFound/>` sat in the middle of it,
 * so the branches below it were reachable only because 404 had been handled
 * earlier by luck of ordering.
 */
export function ScreenOutlet() {
  const {
    route: { path, route },
  } = useShell();

  if (route === undefined) return <NotFoundRoute />;

  const entry = SCREENS[path];
  // A routed path with no registry entry cannot happen — the bijection test
  // fails the build first — but rendering 404 beats rendering nothing if it
  // ever does.
  if (entry === undefined) return <NotFoundRoute />;

  const { Component, layout } = entry;
  // The space frame belongs to the views of a project, and nothing else gets
  // it — `layout` is the registry's answer, checked against `SPACE_TAB_PATHS`
  // in screen-registry.test.ts.
  return layout === 'space' ? (
    <SpaceLayout>
      <Component />
    </SpaceLayout>
  ) : (
    <Component />
  );
}

function NotFoundRoute() {
  const {
    route: { path, navigate },
  } = useShell();
  return <NotFound path={path} onNavigate={navigate} />;
}
