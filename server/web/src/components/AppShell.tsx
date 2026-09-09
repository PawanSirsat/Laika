import { useCallback, useEffect, useState } from 'react';
import { Brand } from './Brand.tsx';
import { EmptyState } from './EmptyState.tsx';
import { Sidebar } from './Sidebar.tsx';
import { showsAppNav } from './shell-chrome.ts';
import { useShellContext } from '../api/use-shell-context.ts';
import { ThemeToggle } from './ThemeToggle.tsx';
import { FirstBootScreen } from '../routes/screens/FirstBootScreen.tsx';
import { InviteScreen } from '../routes/screens/InviteScreen.tsx';
import { acceptInvite } from '../api/invites.ts';
import { useInvite } from '../api/use-invite.ts';
import { LoginScreen } from '../routes/screens/LoginScreen.tsx';
import { BoardScreen } from '../routes/screens/BoardScreen.tsx';
import { SprintsScreen } from '../routes/screens/sprints/SprintsScreen.tsx';
import { TimelineScreen } from '../routes/screens/timeline/TimelineScreen.tsx';
import { DashboardScreen } from '../routes/screens/dashboard/DashboardScreen.tsx';
import { NotFound } from '../routes/screens/NotFound.tsx';
import { MembersScreen } from '../routes/screens/MembersScreen.tsx';
import { OrganisationScreen } from '../routes/screens/organisation/OrganisationScreen.tsx';
import { ProjectsScreen } from '../routes/screens/ProjectsScreen.tsx';
import { TokensScreen } from '../routes/screens/tokens/TokensScreen.tsx';
import { CapacityScreen } from '../routes/screens/capacity/CapacityScreen.tsx';
import { UnlistedScreen } from '../routes/screens/unlisted/UnlistedScreen.tsx';
import { Screen } from '../routes/screens/Screen.tsx';
import { StateGallery } from './StateGallery.tsx';
import { TokenReference } from '../theme/TokenReference.tsx';
import { ApiErrorState } from './ApiErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';
import { UserChrome } from './UserChrome.tsx';
import { isPublic } from '../routes/route-table.ts';
import { useRoute } from '../routes/use-route.ts';
import { useSession } from '../api/use-session.ts';
import { useSetupStatus } from '../api/use-setup-status.ts';
import { completeSetup, fieldErrors } from '../api/setup.ts';
import { ApiError } from '../api/errors.ts';
import { useTheme } from '../theme/use-theme.ts';
import { isCredentialRejection, SignInError } from '../api/auth.ts';
import './app-shell.css';

/**
 * The frame every authenticated screen mounts into (LAI-019).
 *
 * Landmarks are explicit: `<nav aria-label="Primary">` in the sidebar,
 * `<header>` for the top bar, `<main id="main">` for the screen. A skip link
 * jumps straight to `main`, because otherwise a keyboard user tabs through every
 * nav item on every navigation.
 *
 * **No API call anywhere here.** The user chrome renders an unauthenticated
 * slot; wiring it to `GET /api/v1/me` is LAI-007, which depends on the API.
 */
export function AppShell() {
  const { path, route, navigate, params, setParams } = useRoute();
  const { session, signIn, signOut, retry } = useSession();
  const { theme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signInError, setSignInError] = useState<string | undefined>(undefined);
  const [signInRejected, setSignInRejected] = useState(false);
  const [setupSubmitting, setSetupSubmitting] = useState(false);
  const [setupError, setSetupError] = useState<string | undefined>(undefined);
  const [setupFieldErrors, setSetupFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | undefined>(undefined);

  /**
   * The invite token, from the link the invitee was sent.
   *
   * Read unconditionally rather than inside the `/invite` branch: hooks cannot
   * be called conditionally, and `useInvite` does nothing when the token is
   * absent, which is every other route.
   */
  const inviteToken = path === '/invite' ? (params.get('token') ?? undefined) : undefined;
  const inviteState = useInvite(inviteToken);

  // Whether this instance has an owner yet. Read once on boot; the server's own
  // gate is authoritative, this only decides what to render.
  const { setupRequired, system, markComplete, recheck } = useSetupStatus();

  /**
   * Where to return after signing in (LAI-007 AC4). Captured when the guard
   * redirects, so a deep link survives the detour instead of dumping the user
   * on the board.
   */
  const [returnTo, setReturnTo] = useState<string | undefined>(undefined);

  const routeIsPublic = isPublic(route) || route === undefined;

  // Before anything else: an instance with no owner has exactly one useful
  // screen. The server redirects browsers here too (setup-gate.ts SETUP_PATH),
  // so this only covers in-app navigation.
  useEffect(() => {
    // `setupRequired` comes from `/setup/status` at mount. `session` carries the
    // same news from a **live** call, which is the case that was broken: a tab
    // open since before the instance was reset has a stale `false` here, and
    // only the 409 on `/me` knows better (LAI-087).
    const needsSetup = setupRequired === true || session.status === 'setup-required';
    if (!needsSetup || path === '/setup') return;
    navigate('/setup');
  }, [setupRequired, session.status, path, navigate]);

  // The guard. One effect, one condition: an unauthenticated user on a
  // protected route goes to sign-in exactly once — `path !== '/login'` is what
  // stops it competing with itself on the way there.
  useEffect(() => {
    if (session.status !== 'anonymous') return;
    if (setupRequired === true) return; // setup comes first
    if (routeIsPublic || path === '/login') return;
    // Pathname **and** query. Capturing only the path drops the parameter that
    // says which project — `/members?project=laika-core` came back as
    // `/members`, which renders "no project chosen" after a correct sign-in.
    setReturnTo(path + window.location.search);
    navigate('/login');
  }, [session.status, setupRequired, routeIsPublic, path, navigate]);

  // Signed in and sitting on the sign-in screen: go where they were headed.
  useEffect(() => {
    if (session.status !== 'authenticated' || path !== '/login') return;
    const destination = returnTo ?? '/board';
    setReturnTo(undefined);
    navigate(destination);
  }, [session.status, path, returnTo, navigate]);

  const handleSignIn = useCallback(
    async (values: { email: string; password: string; keepSignedIn: boolean }) => {
      setSignInError(undefined);
      setSignInRejected(false);
      try {
        await signIn({
          email: values.email,
          password: values.password,
          rememberMe: values.keepSignedIn,
        });
      } catch (cause) {
        // Two different situations with two different remedies. Rejected
        // credentials are the reader's to fix and get the design's field-level
        // treatment; an unreachable instance is not theirs to fix at all, and
        // showing "email or password is wrong" for it sends someone to reset a
        // password that was never the problem.
        if (isCredentialRejection(cause)) {
          setSignInRejected(true);
        } else if (cause instanceof SignInError) {
          // The server refused for a reason of its own — rate limiting is the
          // one that actually happens. Its message is the only accurate thing
          // available, and it must not be replaced with a guess about the
          // password, which may well be correct (LAI-220).
          setSignInError(cause.message);
        } else {
          setSignInError('Could not reach the instance.');
        }
      }
    },
    [signIn],
  );

  /**
   * Complete first-run setup.
   *
   * `POST /setup` **already sets the session cookie**, so there is no sign-in
   * step: on 201 the instance is configured and this browser is the Owner.
   * Re-checking the status flips the gate and the session probe picks the user
   * up, which lands them in the authenticated shell.
   */
  /**
   * Accept the invite: create the account, spend the token, become signed in.
   *
   * Mirrors `handleSetup` because it is the same shape of thing — the response
   * carries the session cookie, so `retry()` is what turns this tab from
   * anonymous into authenticated rather than a second sign-in round trip.
   */
  const handleAcceptInvite = useCallback(
    async (values: { name: string; password: string; email?: string }) => {
      if (inviteToken === undefined) return;

      setInviteSubmitting(true);
      setInviteError(undefined);

      try {
        await acceptInvite({
          token: inviteToken,
          name: values.name,
          password: values.password,
          ...(values.email === undefined ? {} : { email: values.email }),
        });
        retry();
        navigate('/board');
      } catch (cause) {
        // `403` is the token being refused between the preview and the submit —
        // it expired while the form was open, or someone else spent a link
        // invite first. The server's own wording is used rather than a reworded
        // one, because it is the only party that knows which.
        setInviteError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not create your account. The instance may be unreachable.',
        );
      } finally {
        setInviteSubmitting(false);
      }
    },
    [inviteToken, retry, navigate],
  );

  const handleSetup = useCallback(
    async (values: {
      ownerName: string;
      ownerEmail: string;
      password: string;
      orgName: string;
      projectName: string;
    }) => {
      setSetupSubmitting(true);
      setSetupError(undefined);
      setSetupFieldErrors({});

      try {
        await completeSetup({
          orgName: values.orgName,
          ownerName: values.ownerName,
          ownerEmail: values.ownerEmail,
          ownerPassword: values.password,
          projectName: values.projectName,
        });
        // Synchronous, so the redirect effect below does not bounce the new
        // Owner back to /setup on the next render.
        markComplete();
        retry();
        navigate('/board');
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'conflict') {
          // Someone finished setup in another tab or another browser. That is
          // not a failure of this form — the instance is ready, so say so and
          // send them to sign in rather than showing a generic error.
          setSetupError('This Laika has already been set up. Sign in instead.');
          recheck();
          return;
        }
        if (cause instanceof ApiError && cause.code === 'unprocessable') {
          setSetupFieldErrors(fieldErrors(cause));
          setSetupError('Some details need fixing before this instance can be created.');
          return;
        }
        setSetupError(cause instanceof Error ? cause.message : 'Could not create this instance.');
      } finally {
        setSetupSubmitting(false);
      }
    },
    [markComplete, recheck, retry, navigate],
  );

  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut().finally(() => {
      setSigningOut(false);
      navigate('/login');
    });
  }, [signOut, navigate]);

  // The instance the browser is actually pointed at. Read from the location
  // rather than hardcoded: the prototype's `laika.kvelld.internal` is a fixture,
  // and this is correct for every deployment without configuration.
  const instanceHost = window.location.host;

  // Escape closes the off-canvas nav. Anything that traps focus on a narrow
  // screen needs a way out that is not a mouse.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  /**
   * The app chrome belongs to a signed-in session, not to a list of routes
   * (LAI-062).
   *
   * Keying it on the route would mean every route added later inherits whatever
   * default it happened to get — which is exactly how `/login`, `/setup` and
   * `/invite` came to render eight protected destinations beside the words "Not
   * signed in", each one bouncing straight back to `/login`. Keying it on the
   * session fails safe in both directions: a new pre-auth screen has no nav
   * without anyone remembering to exclude it, and a protected screen shows no
   * nav until there is genuinely someone to navigate as.
   */
  const signedIn = showsAppNav(session);
  // A full-page screen that draws its own brand and theme control gets no
  // header on top of it (LAI-075).
  const ownsChrome = route?.ownsChrome === true;

  // Real numbers only. `undefined` renders nothing — see `useShellContext`.
  const projectSlug = params.get('project') ?? undefined;
  const { version, sprintCount } = useShellContext(projectSlug, signedIn);

  return (
    <div className={signedIn ? 'shell' : 'shell shell-preauth'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {signedIn && (
        <Sidebar
          currentPath={path}
          onNavigate={navigate}
          open={navOpen}
          onClose={() => {
            setNavOpen(false);
          }}
          projectSlug={projectSlug}
          orgRole={session.status === 'authenticated' ? session.user.org_role : undefined}
          version={version}
          counts={{ '/sprints': sprintCount }}
          footer={
            /* Theme control above the user chip — the order the prototype uses
               (LAI-088). The task text has these the other way round; the
               design file is the authority and it puts the theme control first. */
            <>
              <ThemeToggle />
              <UserChrome
                user={session.user}
                theme={theme}
                onSignOut={handleSignOut}
                signingOut={signingOut}
              />
            </>
          }
        />
      )}

      {/* Click-catcher behind the off-canvas nav. `aria-hidden` and not
          focusable: Escape and the toggle are the accessible ways out. */}
      {signedIn && navOpen && (
        <div
          className="shell-scrim"
          aria-hidden="true"
          onClick={() => {
            setNavOpen(false);
          }}
        />
      )}

      <div className="shell-body">
        {/*
          Signed in, this bar holds only the narrow-viewport nav toggle, which
          CSS hides above 900px — so on a desktop it would be an empty strip
          with a border. `shell-head-quiet` collapses it there and the media
          query brings it back where the toggle is needed.
        */}
        {ownsChrome ? null : (
          <header className={signedIn ? 'shell-head shell-head-quiet' : 'shell-head'}>
            {signedIn ? (
              <button
                type="button"
                className="shell-navtoggle"
                aria-expanded={navOpen}
                aria-controls="sidebar"
                onClick={() => {
                  setNavOpen((v) => !v);
                }}
              >
                <span className="visually-hidden">
                  {navOpen ? 'Close navigation' : 'Open navigation'}
                </span>
                <span className="shell-navtoggle-bars" aria-hidden="true" />
              </button>
            ) : null}

            {/*
            The user chip and theme control live in the sidebar footer once
            there is a sidebar (LAI-064). Pre-auth there is none, and the theme
            control must stay reachable — someone setting up an instance at
            night should not have to sign in to stop being dazzled (LAI-062
            AC3). So the header carries it exactly when the sidebar cannot.

            No "Not signed in" chip: it is authenticated chrome, and beside a
            sign-in form it states the obvious.
          */}
            {!signedIn && <Brand />}
            {!signedIn && (
              <div className="shell-head-right">
                <ThemeToggle />
              </div>
            )}
          </header>
        )}

        <main id="main" className="shell-main" tabIndex={-1}>
          {/*
            Protected routes wait for the session rather than rendering and
            hoping. AC7: a failed /me shows LAI-020's error state with its
            request_id and a retry, never a blank page.
          */}
          {!routeIsPublic && session.status === 'loading' ? (
            <div className="shell-gate">
              <LoadingState shape="card" count={2} label="Loading your account" />
            </div>
          ) : !routeIsPublic && session.status === 'error' ? (
            <div className="shell-gate">
              {/* Mapped rather than hardcoded, so a 403 here renders
                  permission-denied and not a generic failure (AC6). */}
              <ApiErrorState error={session.error} resource="your account" onRetry={retry} />
            </div>
          ) : !routeIsPublic && session.status === 'setup-required' ? (
            // The redirect above is already running; this is the frame before
            // it lands, and it must not be a skeleton.
            <div className="shell-gate">
              <EmptyState
                headline="This instance has not been set up yet"
                body="Taking you to first boot."
              />
            </div>
          ) : !routeIsPublic && session.status === 'anonymous' ? (
            // The guard above is already navigating to /login; rendering the
            // screen's skeleton for that frame avoids a flash of the board.
            <div className="shell-gate">
              <LoadingState shape="card" count={1} label="Redirecting to sign in" />
            </div>
          ) : path === '/projects' ? (
            <>
              <ProjectsScreen
                me={session.status === 'authenticated' ? session.user : undefined}
                onOpen={(slug) => {
                  navigate(`/board?project=${encodeURIComponent(slug)}`);
                }}
                onOpenMembers={(slug) => {
                  navigate(`/members?project=${encodeURIComponent(slug)}`);
                }}
              />
            </>
          ) : path === '/capacity' ? (
            <CapacityScreen
              onOpenTask={(taskKey) => {
                navigate(`/board?q=${encodeURIComponent(taskKey)}`);
              }}
            />
          ) : path === '/unlisted' ? (
            <UnlistedScreen
              members={new Map()}
              onOpenTask={(taskKey) => {
                // The board opens a task by id in `?task=` (LAI-424); a promoted
                // note gives us the key, so the board's search finds it.
                navigate(`/board?q=${encodeURIComponent(taskKey)}`);
              }}
            />
          ) : path === '/tokens' ? (
            <TokensScreen me={session.status === 'authenticated' ? session.user : undefined} />
          ) : path === '/organisation' && session.status === 'authenticated' ? (
            <OrganisationScreen me={session.user} />
          ) : path === '/members' ? (
            <>
              <MembersScreen
                slug={params.get('project') ?? undefined}
                me={session.status === 'authenticated' ? session.user : undefined}
              />
            </>
          ) : path === '/board' ? (
            <>
              <BoardScreen
                params={params}
                onParamsChange={setParams}
                me={session.status === 'authenticated' ? session.user : undefined}
              />
            </>
          ) : route === undefined ? (
            <NotFound path={path} onNavigate={navigate} />
          ) : path === '/sprints' ? (
            <SprintsScreen />
          ) : path === '/timeline' ? (
            <TimelineScreen />
          ) : path === '/dashboard' ? (
            <DashboardScreen />
          ) : path === '/design/tokens' ? (
            <TokenReference />
          ) : path === '/design/states' ? (
            <StateGallery />
          ) : path === '/login' ? (
            <LoginScreen
              host={instanceHost}
              onSubmit={(values) => {
                void handleSignIn(values);
              }}
              submitting={session.status === 'loading'}
              rejected={signInRejected}
              serverError={signInError}
            />
          ) : path === '/invite' ? (
            <InviteScreen
              host={instanceHost}
              invite={inviteState.invite}
              loading={inviteState.loading}
              refused={inviteState.refused}
              onSubmit={(values) => {
                void handleAcceptInvite(values);
              }}
              onRequestNew={() => {
                navigate('/login');
              }}
              submitting={inviteSubmitting}
              serverError={inviteError}
            />
          ) : path === '/setup' ? (
            <FirstBootScreen
              system={system}
              host={instanceHost}
              version={version}
              onSubmit={(values) => {
                void handleSetup(values);
              }}
              submitting={setupSubmitting}
              serverError={setupError}
              fieldErrors={setupFieldErrors}
            />
          ) : (
            <Screen route={route} />
          )}
        </main>
      </div>
    </div>
  );
}
