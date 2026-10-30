import { Sidebar } from '../sidebar/Sidebar.tsx';
import { useShell } from './shell-context.ts';
import { useSpaces } from '../../routes/use-spaces.ts';
import { inboxCount } from '../../routes/page-tabs.ts';
import { handoffsWaiting } from '../agent/person-handoffs.ts';

export interface ShellSidebarProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly collapsed: boolean;
  readonly onToggleCollapse: () => void;
}

/**
 * Everything the rail needs to know (LAI-250).
 *
 * `Sidebar` is presentational and takes fifteen props; this is where they come
 * from. Keeping the two apart means the rail can be reasoned about — and its
 * geometry asserted — without a session, which is how LAI-249's tests read it.
 *
 * The open/collapsed pair stays with the frame: they are chrome state, and the
 * nav toggle and the scrim need them too.
 */
export function ShellSidebar({ open, onClose, collapsed, onToggleCollapse }: ShellSidebarProps) {
  const {
    spaceName,
    route: { path, navigate, params },
    session,
    me,
    signOut,
    signingOut,
    orgName,
    unlistedOpen,
    reviewWaiting,
    tokenAlerts,
    handoffCounts,
  } = useShell();

  const projectSlug = params.get('project') ?? undefined;

  /*
   * The name comes from the shell now (LAI-299), not a fetch of its own: the
   * space bar needs the same string when this rail is collapsed or off-canvas,
   * and two components fetching one project is one too many.
   */
  // Gated on the session: `/login` and first boot render this shell too, and an
  // ungated fetch 401s on every sign-in page load.
  const {
    spaces,
    all: allSpaces,
    open: openSpace,
    togglePin: togglePinnedSpace,
  } = useSpaces(session.status === 'authenticated', projectSlug);
  return (
    <Sidebar
      currentPath={path}
      onNavigate={navigate}
      open={open}
      onClose={onClose}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      projectSlug={projectSlug}
      spaces={spaces}
      allSpaces={allSpaces}
      onOpenSpace={openSpace}
      onTogglePin={togglePinnedSpace}
      orgName={orgName}
      spaceName={spaceName}
      // Inbox is what waits on its tabs (LAI-796): the review queue (D-082),
      // the hand-offs waiting on this person (LAI-550, the server's live
      // counts) and the open unlisted count (LAI-754), which is `undefined`
      // for a reader it is not for. A person's
      // open token alerts (LAI-773) are on Insights, where Usage now is.
      counts={{
        '/inbox': inboxCount(reviewWaiting, unlistedOpen, handoffsWaiting(handoffCounts)),
        '/insights': tokenAlerts?.length,
      }}
      user={me}
      onSignOut={signOut}
      signingOut={signingOut}
    />
  );
}
