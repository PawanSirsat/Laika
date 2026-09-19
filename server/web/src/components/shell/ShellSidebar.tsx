import { useEffect, useState } from 'react';
import { getProject } from '../../api/projects.ts';
import { Sidebar } from '../sidebar/Sidebar.tsx';
import { useShell } from './shell-context.ts';
import { useSpaces } from '../../routes/use-spaces.ts';

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
    route: { path, navigate, params },
    session,
    me,
    signOut,
    signingOut,
    sprintCount,
    orgName,
  } = useShell();

  const projectSlug = params.get('project') ?? undefined;

  /*
   * The open project's real name for the wordmark (LAI-295). By slug, not from
   * the spaces list — see `Sidebar`'s `spaceName` for why the list cannot be
   * trusted for this. Moved here from `SpaceLayout`, which asked for exactly
   * this and no longer needs it; it is the same one request, not a new one.
   */
  const [spaceName, setSpaceName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (projectSlug === undefined) {
      setSpaceName(undefined);
      return;
    }

    const controller = new AbortController();

    getProject(projectSlug, controller.signal)
      .then((project) => {
        if (!controller.signal.aborted) setSpaceName(project.name);
      })
      .catch(() => {
        // The rail falls back to the listed name, then to the product name.
        // A rail that cannot name the space is not worth an error state.
      });

    return () => {
      controller.abort();
    };
  }, [projectSlug]);
  // Gated on the session: `/login` and first boot render this shell too, and an
  // ungated fetch 401s on every sign-in page load.
  const {
    spaces,
    all: allSpaces,
    open: openSpace,
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
      orgRole={me?.org_role}
      orgName={orgName}
      spaceName={spaceName}
      counts={{ '/sprints': sprintCount }}
      user={me}
      onSignOut={signOut}
      signingOut={signingOut}
    />
  );
}
