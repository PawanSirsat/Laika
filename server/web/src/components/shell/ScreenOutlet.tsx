import type { ComponentType } from 'react';
import { useShell } from './shell-context.ts';
import { SpaceLayout } from '../space/SpaceLayout.tsx';
import { BoardScreen } from '../../routes/screens/BoardScreen.tsx';
import { CapacityScreen } from '../../routes/screens/capacity/CapacityScreen.tsx';
import { DashboardScreen } from '../../routes/screens/dashboard/DashboardScreen.tsx';
import { SetupRoute } from '../../routes/screens/SetupRoute.tsx';
import { InviteRoute } from '../../routes/screens/InviteRoute.tsx';
import { LoginRoute } from '../../routes/screens/LoginRoute.tsx';
import { MeetingReviewScreen } from '../../routes/screens/meeting-review/MeetingReviewScreen.tsx';
import { MembersScreen } from '../../routes/screens/MembersScreen.tsx';
import { NotFound } from '../../routes/screens/NotFound.tsx';
import { OrganisationScreen } from '../../routes/screens/organisation/OrganisationScreen.tsx';
import { ProjectsScreen } from '../../routes/screens/ProjectsScreen.tsx';
import { SprintsScreen } from '../../routes/screens/sprints/SprintsScreen.tsx';
import { TimelineScreen } from '../../routes/screens/timeline/TimelineScreen.tsx';
import { TokensScreen } from '../../routes/screens/tokens/TokensScreen.tsx';
import { UnlistedScreen } from '../../routes/screens/unlisted/UnlistedScreen.tsx';
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
    route: { params, setParams },
    me,
  } = useShell();
  return <BoardScreen params={params} onParamsChange={setParams} me={me} />;
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

function CapacityRoute() {
  const {
    route: { navigate },
  } = useShell();
  return <CapacityScreen onOpenTask={openTaskByKey(navigate)} />;
}

function UnlistedRoute() {
  const {
    route: { navigate },
  } = useShell();
  return <UnlistedScreen members={new Map()} onOpenTask={openTaskByKey(navigate)} />;
}

function TokensRoute() {
  const { me } = useShell();
  return <TokensScreen me={me} />;
}

function OrganisationRoute() {
  const { me } = useShell();
  // The screen requires a user; the gate has already refused every other
  // session state on this protected route, so this is the frame before a
  // redirect lands rather than a state anyone sits in.
  return me === undefined ? null : <OrganisationScreen me={me} />;
}

function MembersRoute() {
  const {
    route: { params },
    me,
  } = useShell();
  return <MembersScreen slug={params.get('project') ?? undefined} me={me} />;
}

/**
 * Every path in `ROUTES` has exactly one entry here, and every entry names a
 * real path — `screen-registry.test.ts` asserts the bijection. A route that
 * gains no screen is the defect this replaces: the old chain fell through to a
 * generic placeholder, so a missing branch looked like an empty state.
 */
export const SCREENS: Readonly<Record<string, ScreenEntry>> = {
  '/board': { Component: BoardRoute, layout: 'space' },
  '/timeline': { Component: TimelineScreen, layout: 'space' },
  '/sprints': { Component: SprintsScreen, layout: 'space' },
  '/dashboard': { Component: DashboardScreen, layout: 'space' },
  '/meeting-review': { Component: MeetingReviewRoute, layout: 'space' },
  '/projects': { Component: ProjectsRoute, layout: 'plain' },
  '/capacity': { Component: CapacityRoute, layout: 'space' },
  '/unlisted': { Component: UnlistedRoute, layout: 'plain' },
  '/tokens': { Component: TokensRoute, layout: 'plain' },
  '/organisation': { Component: OrganisationRoute, layout: 'plain' },
  '/members': { Component: MembersRoute, layout: 'plain' },
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
