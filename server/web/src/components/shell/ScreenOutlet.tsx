import { handoffsWaiting } from '../agent/person-handoffs.ts';
import { useEffect, type ComponentType } from 'react';
import { useShell } from './shell-context.ts';
import { SpaceLayout } from '../space/SpaceLayout.tsx';
import { BoardScreen } from '../../routes/screens/BoardScreen.tsx';
import { CalendarScreen } from '../../routes/screens/calendar/CalendarScreen.tsx';
import { CapacityScreen } from '../../routes/screens/capacity/CapacityScreen.tsx';
import { ActivityScreen } from '../../routes/screens/activity/ActivityScreen.tsx';
import { DashboardScreen } from '../../routes/screens/dashboard/DashboardScreen.tsx';
import { SetupRoute } from '../../routes/screens/SetupRoute.tsx';
import { InviteRoute } from '../../routes/screens/InviteRoute.tsx';
import { ResetPasswordRoute } from '../../routes/screens/ResetPasswordRoute.tsx';
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
import { DeveloperScreen } from '../../routes/screens/developer/DeveloperScreen.tsx';
import { InboxScreen } from '../../routes/screens/inbox/InboxScreen.tsx';
import { InsightsScreen } from '../../routes/screens/insights/InsightsScreen.tsx';
import { TimeTab } from '../../routes/screens/insights/TimeTab.tsx';
import {
  insightsHolder,
  ledProjectIds,
  timeSubview,
  timeView,
} from '../../routes/screens/insights/time-tab.ts';
import { UnlistedScreen } from '../../routes/screens/unlisted/UnlistedScreen.tsx';
import { UsageScreen } from '../../routes/screens/usage/UsageScreen.tsx';
import { MyDayScreen } from '../../routes/screens/my-day/MyDayScreen.tsx';
import type { WorkTaskLink } from '../../routes/screens/organisation/WorkTab.tsx';
import { SpaceSettingsScreen } from '../../routes/screens/space-settings/SpaceSettingsScreen.tsx';
import { WorkroomScreen } from '../../routes/screens/workroom/WorkroomScreen.tsx';
import { routeParams } from '../../routes/route-table.ts';
import { slugOfKey, taskHref, withTaskOpen } from '../../routes/task-href.ts';
import { useSpaces } from '../../routes/use-spaces.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import {
  currentTab,
  developerAlias,
  developerTabs,
  INBOX_TABS,
  inboxAlias,
  inboxCount,
  INSIGHTS_TABS,
  ORGANISATION_TABS,
  refusedTab,
  visibleTabs,
} from '../../routes/page-tabs.ts';
import { StateGallery } from '../StateGallery.tsx';
import { LoadingState } from '../LoadingState.tsx';
import { TokenReference } from '../../theme/TokenReference.tsx';
import { usePermissions } from '../../api/permissions.ts';
import { useDeveloperAccessMode } from '../../api/developer-compat.ts';
import { Button } from '../forms/Button.tsx';
import '../states.css';

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
    route: { params, setParams, path, navigate },
    me,
  } = useShell();
  // `/board` and `/list` are the same screen in two modes — the design makes
  // them sibling tabs, so the route is what chooses (LAI-270).
  return (
    <BoardScreen
      params={params}
      onParamsChange={setParams}
      me={me}
      path={path}
      onNavigate={navigate}
    />
  );
}

function ProjectsRoute() {
  const {
    route: { navigate, params, setParams },
    me,
  } = useShell();
  return (
    <ProjectsScreen
      me={me}
      params={params}
      onParamsChange={setParams}
      onOpenSettings={(slug) => {
        navigate(`/spaces/${encodeURIComponent(slug)}/settings`);
      }}
      onOpen={(slug) => {
        navigate(`/board?project=${encodeURIComponent(slug)}`);
      }}
      onOpenMembers={(slug) => {
        navigate(`/members?project=${encodeURIComponent(slug)}`);
      }}
    />
  );
}

/**
 * Open a task **in its own space's drawer** (LAI-1190, B2 and B18) — by id
 * when the link has one, else by key, which the drawer host resolves. Through
 * `taskHref`, the one place that decides what a task link is: `/board?q=KEY`
 * only when no space can be named. Work's rows use it (LAI-952; the
 * Organisation tab since LAI-1170).
 */
function openTaskInItsSpace(navigate: (to: string) => void) {
  return ({ id, key, projectSlug }: WorkTaskLink) => {
    navigate(taskHref({ id, key }, projectSlug));
  };
}

/**
 * A task link on a page across every space, which knows only the key: the
 * space comes from the key's prefix among the spaces the reader can read.
 */
function useOpenTaskByKey(): (taskKey: string) => void {
  const {
    route: { navigate },
    me,
  } = useShell();
  const { all } = useSpaces(me !== undefined);
  return (taskKey) => {
    const slug = slugOfKey(
      taskKey,
      all.map((space) => ({ prefix: space.key, slug: space.slug })),
    );
    navigate(taskHref({ key: taskKey }, slug));
  };
}

function MeetingReviewRoute() {
  const {
    route: { params, setParams, navigate },
  } = useShell();
  const slug = params.get('project') ?? undefined;
  return (
    <MeetingReviewScreen
      slug={slug}
      onOpenTask={(taskKey) => {
        // Over the review itself, in this space (B2): the reader came to
        // check a proposal, and closing the task should leave them on it.
        if (slug === undefined) {
          navigate(taskHref({ key: taskKey }, undefined));
          return;
        }
        setParams(withTaskOpen(params, { key: taskKey }, slug), { push: true });
      }}
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
    reviewCapped,
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
      unlistedOpen={unlistedOpen}
      reviewWaiting={reviewWaiting}
      reviewCapped={reviewCapped}
      onNavigate={navigate}
    />
  );
}

function UnlistedRoute() {
  const { refreshUnlisted } = useShell();
  const openTask = useOpenTaskByKey();
  // A promote or a dismiss changes the sidebar's count; it re-reads (LAI-754).
  return <UnlistedScreen onOpenTask={openTask} onChanged={refreshUnlisted} />;
}

/**
 * One page for the organisation (LAI-769), with its own space selector. The
 * space is `?project=` (LAI-814), so a By space row is a link to that space
 * and Back returns from it; the selector replaces, as a filter does.
 */
function UsageRoute() {
  const {
    route: { navigate, params, setParams },
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
      project={params.get('project') ?? undefined}
      onProject={(slug) => {
        const next = new URLSearchParams(params);
        if (slug === '') next.delete('project');
        else next.set('project', slug);
        setParams(next);
      }}
    />
  );
}

/**
 * The reader's own day (LAI-787). `?day=` names which; absent is today. A
 * day picked is a URL, so back and forward walk the days as they were seen.
 * `?user=` is somebody else's day, read only (LAI-959), picked the same way.
 */
function MyDayRoute() {
  const {
    route: { params, setParams, navigate },
    me,
    reviewQueue,
    reviewCapped,
  } = useShell();
  return (
    <MyDayScreen
      me={me}
      queue={reviewQueue}
      queueCapped={reviewCapped}
      onNavigate={navigate}
      day={params.get('day') ?? undefined}
      onDay={(day) => {
        const next = new URLSearchParams(params);
        next.set('day', day);
        setParams(next, { push: true });
      }}
      user={params.get('user') ?? undefined}
      onUser={(userId) => {
        const next = new URLSearchParams(params);
        if (userId === undefined) next.delete('user');
        else next.set('user', userId);
        setParams(next, { push: true });
      }}
    />
  );
}

function ReviewRoute() {
  const {
    route: { navigate, params, setParams },
    me,
    refreshReview,
    handoffCounts,
    refreshHandoffs,
  } = useShell();
  // An accept or a send-back changes the sidebar's count; it re-reads (D-082).
  // The hand-offs waiting on this person sit at the top of the same tab
  // (D-146 item 4): their counts and their re-read are the shell's too.
  return (
    <ReviewScreen
      params={params}
      setParams={setParams}
      onNavigate={navigate}
      onChanged={refreshReview}
      handoffs={{ meId: me?.id, counts: handoffCounts, onChanged: refreshHandoffs }}
    />
  );
}

/**
 * Inbox (LAI-796): Review — with the hand-offs needing approval folded in
 * (D-146, LAI-1169) — and Unlisted work as tabs. The counts are the shell's —
 * the same numbers the sidebar adds up for Inbox's badge. The Hand-offs tab
 * of LAI-550 is an alias now: `?tab=handoffs` is rewritten in place to
 * Review's *All hand-offs* view, so an old link still lands on its rows.
 */
function InboxRoute() {
  const {
    route: { params, navigate, setParams },
    me,
    reviewDecidable,
    unlistedOpen,
    handoffCounts,
  } = useShell();
  const { permissions } = usePermissions(me !== undefined);
  const holds = permissionHolder(permissions?.me.actions);
  const alias = inboxAlias(params);
  useEffect(() => {
    if (alias !== undefined) setParams(alias);
  }, [alias?.toString()]);
  const tab = currentTab(INBOX_TABS, params, holds);
  // An aliased address is rewritten before anything is read: mounting the
  // queue for the one render before the effect would fetch it and flash it
  // (review round 1, item 6). The target is always Review.
  if (alias !== undefined) {
    return (
      <InboxScreen
        tabs={visibleTabs(INBOX_TABS, holds)}
        current="review"
        counts={{
          review: inboxCount(reviewDecidable, undefined, handoffsWaiting(handoffCounts)),
          unlisted: unlistedOpen,
        }}
        onNavigate={navigate}
      >
        <LoadingState shape="row" count={3} label="Loading hand-offs" />
      </InboxScreen>
    );
  }
  return (
    <InboxScreen
      tabs={visibleTabs(INBOX_TABS, holds)}
      current={tab}
      counts={{
        review: inboxCount(reviewDecidable, undefined, handoffsWaiting(handoffCounts)),
        unlisted: unlistedOpen,
      }}
      onNavigate={navigate}
    >
      {tab === 'unlisted' ? <UnlistedRoute /> : <ReviewRoute />}
    </InboxScreen>
  );
}

/**
 * Insights (LAI-796): Capacity, Usage & cost and — for owners, analytics
 * readers and space admins — Time (LAI-1138). A link to Time for anybody
 * else is refused once the server has answered, never guessed before.
 */
function InsightsRoute() {
  const {
    route: { params, navigate },
    me,
    orgName,
  } = useShell();
  const { permissions, settled } = usePermissions(me !== undefined);
  const leads = ledProjectIds(permissions);
  const holds = insightsHolder(permissionHolder(permissions?.me.actions), leads);
  const refused = settled ? refusedTab(INSIGHTS_TABS, params, holds) : undefined;
  const tab = refused?.id ?? currentTab(INSIGHTS_TABS, params, holds);
  // Asked for Time before the server has said who may read it: wait, rather
  // than open Capacity (and read it) in its place.
  if (!settled && params.get('tab') === 'time') {
    return (
      <InsightsScreen tabs={visibleTabs(INSIGHTS_TABS, holds)} current="time" onNavigate={navigate}>
        <LoadingState shape="card" count={1} label="Loading the Time report" />
      </InsightsScreen>
    );
  }
  return (
    <InsightsScreen tabs={visibleTabs(INSIGHTS_TABS, holds)} current={tab} onNavigate={navigate}>
      {tab === 'time' ? (
        <TimeTab
          view={
            refused === undefined
              ? timeView(permissionHolder(permissions?.me.actions), leads)
              : 'none'
          }
          leads={leads}
          orgName={orgName}
          subview={timeSubview(params.get('view'))}
          onNavigate={navigate}
        />
      ) : tab === 'usage' ? (
        <UsageRoute />
      ) : (
        <CapacityRoute />
      )}
    </InsightsScreen>
  );
}

/**
 * Developer access (LAI-796; five tabs since LAI-537): Connect, Agents, Projects,
 * Activity, Tokens. `?agent=` and `?step=` still carry the wizard's state,
 * which is why the route hands the whole query down.
 *
 * **Which tabs depends on the deployment** (LAI-1048): the mode comes from
 * `GET /developer/compatibility`, read once, and the page waits for it rather
 * than drawing classic and then swapping. In `v3` an old tab id is moved to its
 * new home first (`developerAlias`), as a `replace`, so Back never lands on an
 * address that only bounces forward.
 */
function DeveloperRoute() {
  const {
    me,
    route: { params, setParams, navigate },
  } = useShell();
  const mode = useDeveloperAccessMode();
  const moved = mode === undefined ? undefined : developerAlias(mode, params)?.toString();
  useEffect(() => {
    if (moved !== undefined) setParams(new URLSearchParams(moved));
  }, [moved, setParams]);
  if (mode === undefined || moved !== undefined) {
    return <LoadingState shape="card" count={1} label="Loading Developer access" />;
  }
  const tabs = developerTabs(mode);
  const tab = currentTab(tabs, params);
  return (
    <DeveloperScreen
      mode={mode}
      me={me}
      origin={window.location.origin}
      tabs={visibleTabs(tabs)}
      current={tab}
      params={params}
      setParams={setParams}
      onNavigate={navigate}
    />
  );
}

function OrganisationRoute() {
  const {
    me,
    route: { params, setParams, navigate },
  } = useShell();
  const { permissions, settled } = usePermissions(me !== undefined);
  // The screen requires a user; the gate has already refused every other
  // session state on this protected route, so this is the frame before a
  // redirect lands rather than a state anyone sits in.
  if (me === undefined) return null;
  const holds = permissionHolder(permissions?.me.actions);
  // A gated tab is withheld until the server answers, and *refused* only once
  // it has: before then nobody knows, and "you can't" would be a guess.
  const refused = settled ? refusedTab(ORGANISATION_TABS, params, holds) : undefined;
  return (
    <OrganisationScreen
      me={me}
      tabs={visibleTabs(ORGANISATION_TABS, holds)}
      tab={refused?.id ?? currentTab(ORGANISATION_TABS, params, holds)}
      refused={refused !== undefined}
      params={params}
      setParams={setParams}
      onNavigate={navigate}
      // The Work tab (LAI-1170): a row opens its task in its own space's drawer.
      onOpenTask={openTaskInItsSpace(navigate)}
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

/**
 * A space's settings (D-103, LAI-977). The slug is in the path; `?tab=` is
 * the tab, pushed so Back walks the tabs as they were seen.
 */
function SpaceSettingsRoute() {
  const {
    route: { path, route, params, navigate },
    me,
    orgName,
  } = useShell();
  const slug = route === undefined ? undefined : routeParams(route.path, path)?.slug;
  if (slug === undefined || me === undefined) return null;
  return (
    <SpaceSettingsScreen
      slug={slug}
      me={me}
      orgName={orgName}
      tab={params.get('tab') ?? undefined}
      onNavigate={navigate}
    />
  );
}

/** A task's own page, by key (LAI-1199). */
function WorkroomRoute() {
  const {
    route: { path, route, navigate },
    me,
  } = useShell();
  const key = route === undefined ? undefined : routeParams(route.path, path)?.key;
  if (key === undefined || me === undefined) return null;
  return <WorkroomScreen taskKey={key} navigate={navigate} />;
}

function ProfileRoute() {
  const {
    route: { params, setParams, navigate },
    me,
  } = useShell();
  // `?user=` names whose profile (LAI-743); the screen refuses anyone who may
  // not open profiles before it asks the server for one. `?tab=` and `?day=`
  // are its Day and Hours (LAI-959), each a URL, so Back walks them.
  const set = (name: string, value: string | undefined): void => {
    const next = new URLSearchParams(params);
    if (value === undefined) next.delete(name);
    else next.set(name, value);
    setParams(next, { push: true });
  };
  return (
    <ProfileScreen
      userId={params.get('user') ?? undefined}
      me={me}
      tab={params.get('tab') ?? undefined}
      onTab={(tab) => {
        set('tab', tab === 'overview' ? undefined : tab);
      }}
      day={params.get('day') ?? undefined}
      onDay={(day) => {
        set('day', day);
      }}
      onNavigate={navigate}
    />
  );
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
  '/members': { Component: MembersRoute, layout: 'plain' },
  '/spaces/:slug/settings': { Component: SpaceSettingsRoute, layout: 'plain' },
  '/task/:key': { Component: WorkroomRoute, layout: 'plain' },
  '/people': { Component: ProfileRoute, layout: 'plain' },
  '/login': { Component: LoginRoute, layout: 'plain' },
  '/invite': { Component: InviteRoute, layout: 'plain' },
  '/reset-password': { Component: ResetPasswordRoute, layout: 'plain' },
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

  // By the route's own path, so a parameterised one (`/spaces/:slug/settings`)
  // finds its entry; for every other route the two are the same string.
  const entry = SCREENS[route.path] ?? SCREENS[path];
  // A routed path with no registry entry cannot happen — the bijection test
  // fails the build first — but rendering 404 beats rendering nothing if it
  // ever does.
  if (entry === undefined) return <NotFoundRoute />;

  const { Component, layout } = entry;
  // The space frame belongs to the views of a project, and nothing else gets
  // it — `layout` is the registry's answer, checked against `SPACE_TAB_PATHS`
  // in screen-registry.test.ts.
  return (
    <>
      <PermissionsRetry />
      {layout === 'space' ? (
        <SpaceLayout>
          <Component />
        </SpaceLayout>
      ) : (
        <Component />
      )}
    </>
  );
}

/**
 * `GET /permissions` failed, so every gated control is withheld (LAI-970) —
 * say so, once, and offer to ask again, rather than leave somebody wondering
 * where their controls went.
 */
function PermissionsRetry() {
  const { me } = useShell();
  const { failed, refresh } = usePermissions(me !== undefined);
  if (!failed) return null;
  return (
    <div className="banner" role="status" aria-live="polite" data-state="permissions-failed">
      <span className="banner-dot" aria-hidden="true" />
      <div>
        <p className="banner-title">Couldn&rsquo;t load what you may do here</p>
        <p className="banner-body">
          Controls that need a permission stay hidden until it loads.{' '}
          <Button variant="secondary" onClick={refresh}>
            Retry
          </Button>
        </p>
      </div>
    </div>
  );
}

function NotFoundRoute() {
  const {
    route: { path, navigate },
  } = useShell();
  return <NotFound path={path} onNavigate={navigate} />;
}
