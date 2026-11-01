import { useCallback, useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { PageTabs } from '../../../components/PageTabs.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { everyPage } from '../../../api/every-page.ts';
import { getProject, isProject, listProjects, type Project } from '../../../api/projects.ts';
import type { MeProfile } from '../../../api/me.ts';
import { useGates } from '../../../api/permissions.ts';
import { useMembers } from '../../../api/use-members.ts';
import { SPACE_SETTINGS_TABS, currentTab } from '../../page-tabs.ts';
import { spaceSettingsHref } from '../../space-settings-url.ts';
import { spaceColor, spaceColorVar } from '../../../theme/space-color.ts';
import { readerLine } from './space-settings-model.ts';
import { GeneralTab } from './GeneralTab.tsx';
import { MembersTab } from './MembersTab.tsx';
import { AccessTab } from './AccessTab.tsx';
import { HandoffPolicySection } from './HandoffPolicySection.tsx';
import { DangerTab } from './DangerTab.tsx';
import './space-settings.css';

export interface SpaceSettingsScreenProps {
  readonly slug: string;
  readonly me: MeProfile;
  /** The organisation's name, for *Add people from …*; `undefined` until read. */
  readonly orgName: string | undefined;
  /** `?tab=`; anything unknown opens General. */
  readonly tab: string | undefined;
  readonly onNavigate: (to: string) => void;
}

/**
 * A space's settings (D-103, LAI-977; the owner's four screenshots).
 *
 * **Every control is gated on the server's answer** (LAI-970): General,
 * Access and the member list's controls on `project.settings.edit` and
 * `project.members.manage` for *this* space, archiving on the org's
 * `project.archive` as well. Never the role: an admin whose *Open every
 * project* the owner withdrew is a reader here, and while `/permissions` is
 * in flight everyone is — a control that appears and then goes is the bug.
 * A reader sees every value, as text.
 */
export function SpaceSettingsScreen({
  slug,
  me,
  orgName,
  tab,
  onNavigate,
}: SpaceSettingsScreenProps) {
  const gates = useGates(true);
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  /** Every space the reader can see, archived too — counts for *Next task*, and Copy members' list. */
  const [spaces, setSpaces] = useState<readonly Project[] | undefined>(undefined);
  const members = useMembers(slug);

  useEffect(() => {
    const controller = new AbortController();
    setProject(undefined);
    setError(null);
    getProject(slug, controller.signal)
      .then(setProject)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      });
    return () => {
      controller.abort();
    };
  }, [slug]);

  const reloadSpaces = useCallback((signal?: AbortSignal) => {
    everyPage((cursor) => listProjects({ cursor, limit: 200, archived: 'include' }, signal))
      .then((all) => {
        setSpaces(all.items.filter(isProject));
      })
      .catch(() => {
        // Only the next-key preview and Copy members read this; both say
        // nothing rather than something wrong when it fails.
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    reloadSpaces(controller.signal);
    return () => {
      controller.abort();
    };
  }, [reloadSpaces]);

  if (error !== null || project === undefined) {
    return (
      <div className="ss-page">
        <div className="ss-backbar">
          <BackLink onNavigate={onNavigate} />
        </div>
        <ScreenHeader variant="page" title="Space settings" context={slug} />
        <div className="ss">
          {error !== null ? (
            <ApiErrorState error={error} resource={`the space “${slug}”`} />
          ) : (
            <LoadingState shape="row" count={4} label="Loading space settings" />
          )}
        </div>
      </div>
    );
  }

  const mayEdit = gates.project(project.id, 'project.settings.edit');
  const mayManageMembers = gates.project(project.id, 'project.members.manage');
  const mayArchive = mayEdit && gates.org('project.archive');
  const summary = spaces?.find((space) => space.id === project.id);
  const current = currentTab(SPACE_SETTINGS_TABS, new URLSearchParams({ tab: tab ?? '' }));
  const path = spaceSettingsHref(project.slug);
  const colour = spaceColor(project);
  const archived = project.archived_at !== null;

  const saved = (next: Project): void => {
    setProject(next);
    // A new name, key or colour is the Spaces list's too.
    reloadSpaces();
  };

  const openBoard = `/board?project=${encodeURIComponent(project.slug)}`;

  return (
    <div className="ss-page" data-space={project.slug}>
      <div className="ss-backbar">
        <BackLink onNavigate={onNavigate} />
      </div>
      <ScreenHeader
        variant="page"
        title={project.name}
        lead={
          <span
            className="ss-avatar"
            style={{ background: spaceColorVar(colour) }}
            data-color={colour}
            aria-hidden="true"
          >
            {(project.name.trim()[0] ?? '?').toUpperCase()}
          </span>
        }
        context={
          <>
            <span className={`ss-badge ss-badge-${project.visibility}`}>
              {project.visibility === 'public' ? 'PUBLIC' : 'PRIVATE'}
            </span>
            {archived && <span className="ss-badge ss-badge-archived">ARCHIVED</span>}
          </>
        }
        description={
          <>
            <span className="ss-key">
              {project.prefix}
              {project.repo !== null && <> · {project.repo}</>}
            </span>
            <span className="ss-reader" data-reader={mayEdit ? 'manager' : 'reader'}>
              {gates.settled
                ? readerLine({
                    mayEdit,
                    orgRole: me.org_role,
                    implicitLead: gates.leads(project.id),
                  })
                : 'Space settings'}
            </span>
          </>
        }
        below={
          <PageTabs
            label="Space settings sections"
            path={path}
            tabs={SPACE_SETTINGS_TABS}
            current={current}
            counts={{
              members: members.status === 'ready' ? members.members.length : undefined,
            }}
            countNoun="people"
            onNavigate={onNavigate}
          />
        }
      >
        <a
          className="ss-open-board"
          href={openBoard}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate(openBoard);
          }}
        >
          Open board
        </a>
      </ScreenHeader>

      <div className="ss">
        {current === 'members' ? (
          <MembersTab
            project={project}
            me={me}
            orgName={orgName}
            members={members}
            mayManage={mayManageMembers}
            spaces={spaces}
            onLeft={(view) => {
              if (view.implicit_access) members.reload();
              else onNavigate('/projects');
            }}
          />
        ) : current === 'access' ? (
          <>
            <AccessTab project={project} orgName={orgName} mayEdit={mayEdit} onSaved={saved} />
            <HandoffPolicySection
              slug={project.slug}
              mayEdit={gates.project(project.id, 'project.handoff_policy.edit')}
            />
          </>
        ) : current === 'danger' ? (
          <DangerTab project={project} mayArchive={mayArchive} onSaved={saved} />
        ) : (
          <GeneralTab
            project={project}
            counts={summary?.task_counts}
            mayEdit={mayEdit}
            onSaved={saved}
          />
        )}
      </div>
    </div>
  );
}

function BackLink({ onNavigate }: { readonly onNavigate: (to: string) => void }) {
  return (
    <a
      className="ss-back"
      href="/projects"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate('/projects');
      }}
    >
      <span aria-hidden="true">←</span> Spaces
    </a>
  );
}
