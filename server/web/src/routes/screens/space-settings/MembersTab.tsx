import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { OffboardingDialog } from '../../../components/OffboardingDialog.tsx';
import {
  PROJECT_ROLES,
  ROLE_SUMMARY,
  listMembers,
  projectRoleLabel,
  type Member,
  type ProjectRole,
} from '../../../api/members.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { Project } from '../../../api/projects.ts';
import { leaveSpace, type LeaveSpaceView } from '../../../api/space-settings.ts';
import type { UseMembers } from '../../../api/use-members.ts';
import { listAllUsers, type OrgUser } from '../../../api/users.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';

export interface MembersTabProps {
  readonly project: Project;
  readonly me: MeProfile;
  readonly orgName: string | undefined;
  readonly members: UseMembers;
  /** `project.members.manage` here, as the server answers it. */
  readonly mayManage: boolean;
  /** The other spaces the reader can see, for *Copy members from another space…*. */
  readonly spaces: readonly Project[] | undefined;
  readonly onLeft: (view: LeaveSpaceView) => void;
}

/** The order the design's segmented control reads in. */
const ADD_ROLES: readonly ProjectRole[] = ['member', 'lead', 'viewer'];

interface Toast {
  readonly id: number;
  readonly text: string;
  readonly undo?: () => void;
}

/**
 * Who is in the space and what they may do (D-103; the owner's Members
 * screenshot).
 *
 * **Every list change is the server's list back** (`useMembers`), so a refused
 * change — the last space admin demoted or removed — shows the refusal and
 * the list as it really stands. Removal goes through the **offboarding
 * dialog** (D-104 item 5, LAI-988) — the one deactivation uses — which asks
 * what happens to their open tasks here when they hold any, then offers
 * **Undo**, which adds the person back with the role they had. Undo restores
 * the membership, not the tasks' assignee.
 */
export function MembersTab({
  project,
  me,
  orgName,
  members,
  mayManage,
  spaces,
  onLeft,
}: MembersTabProps) {
  const { theme } = useTheme();
  const [removing, setRemoving] = useState<Member | undefined>(undefined);
  const [toast, setToast] = useState<Toast | undefined>(undefined);
  const toastSeq = useRef(0);
  const [leaving, setLeaving] = useState<'ask' | 'busy' | undefined>(undefined);
  const [leaveError, setLeaveError] = useState<string | undefined>(undefined);
  const [leftNotice, setLeftNotice] = useState<string | undefined>(undefined);

  const say = (text: string, undo?: () => void): void => {
    toastSeq.current += 1;
    setToast(
      undo === undefined ? { id: toastSeq.current, text } : { id: toastSeq.current, text, undo },
    );
  };

  // A toast says its piece and goes; ten seconds is long enough to reach Undo.
  useEffect(() => {
    if (toast === undefined) return;
    const timer = setTimeout(() => {
      setToast(undefined);
    }, 10_000);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const isMember = members.members.some((m) => m.user_id === me.id);

  const leave = (): void => {
    setLeaving('busy');
    setLeaveError(undefined);
    leaveSpace(project.slug)
      .then((view) => {
        setLeaving(undefined);
        if (view.notice !== null) setLeftNotice(view.notice);
        onLeft(view);
      })
      .catch((cause: unknown) => {
        setLeaving('ask');
        setLeaveError(cause instanceof Error ? cause.message : 'You did not leave');
      });
  };

  /** Removed through the offboarding dialog; Undo adds them back with the role they had. */
  const removed = (member: Member): void => {
    setRemoving(undefined);
    const role = member.role as ProjectRole;
    say(`Removed ${member.name} from ${project.name}.`, () => {
      setToast(undefined);
      void members.add(member.user_id, role).then((back) => {
        if (back) say(`${member.name} is back, as ${projectRoleLabel(role)}.`);
      });
    });
  };

  return (
    <section className="ss-card" aria-labelledby="ss-members-title">
      <header className="ss-card-head">
        <h2 id="ss-members-title">Members</h2>
        <p>
          Space admins change settings and members. Members create and move tasks. Viewers can read
          and comment.
        </p>
      </header>

      {mayManage && members.status === 'ready' && (
        <AddPeople
          orgName={orgName}
          existing={members.members}
          busy={members.pendingId !== undefined}
          onAdd={async (people, role) => {
            let added = 0;
            for (const person of people) {
              if (await members.add(person.id, role)) added += 1;
            }
            if (added > 0) {
              say(
                `Added ${added === 1 ? (people[0]?.name ?? '1 person') : `${String(added)} people`} as ${projectRoleLabel(role)}.`,
              );
            }
            return added === people.length;
          }}
        />
      )}

      {mayManage && members.status === 'ready' && (
        <CopyMembers
          project={project}
          spaces={spaces}
          existing={members.members}
          busy={members.pendingId !== undefined}
          onCopy={async (people) => {
            let added = 0;
            for (const person of people) {
              if (await members.add(person.user_id, person.role as ProjectRole)) added += 1;
            }
            if (added > 0)
              say(
                `Copied ${String(added)} ${added === 1 ? 'person' : 'people'} into ${project.name}.`,
              );
          }}
        />
      )}

      {members.actionError !== null && (
        <ApiErrorState
          error={members.actionError}
          resource="this space’s members"
          requiredRole="lead"
          verb="update"
        />
      )}

      {members.status === 'loading' ? (
        <LoadingState shape="row" count={3} label="Loading members" />
      ) : members.status === 'error' ? (
        <ApiErrorState
          error={members.error}
          resource="this space’s members"
          onRetry={members.reload}
        />
      ) : (
        <ul className="ss-members">
          {members.members.map((member) => {
            const colour = avatarColor(member.user_id, theme);
            const busy = members.pendingId === member.user_id;
            const self = member.user_id === me.id;
            return (
              <li key={member.user_id} className="ss-member" data-member={member.user_id}>
                <span
                  className="ss-member-avatar"
                  style={{
                    background: colour.background,
                    color: colour.foreground,
                    borderColor: colour.border,
                  }}
                  aria-hidden="true"
                >
                  {initials(member.name)}
                </span>
                <div className="ss-member-who">
                  <span className="ss-member-name">
                    {member.name}
                    {self && <span className="ss-you">YOU</span>}
                  </span>
                  <span className="ss-member-email">{member.email}</span>
                </div>
                {mayManage ? (
                  <div className="ss-member-actions">
                    <label className="ss-member-role">
                      <span className="visually-hidden">Role for {member.name}</span>
                      <Dropdown
                        variant="bare"
                        noun="roles"
                        value={member.role}
                        disabled={busy}
                        onChange={(value) => {
                          void members.setRole(member.user_id, value as ProjectRole);
                        }}
                        options={PROJECT_ROLES.map((role) => ({
                          value: role,
                          label: projectRoleLabel(role),
                          title: ROLE_SUMMARY[role],
                        }))}
                      />
                    </label>
                    <button
                      type="button"
                      className="ss-btn ss-btn-quiet"
                      data-action="remove"
                      disabled={busy}
                      aria-label={`Remove ${member.name}`}
                      onClick={() => {
                        setRemoving(member);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span
                    className="ss-member-role-static"
                    title={ROLE_SUMMARY[member.role as ProjectRole]}
                  >
                    {projectRoleLabel(member.role)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {removing !== undefined && (
        <OffboardingDialog
          title={`Remove ${removing.name} from ${project.name}?`}
          verb="Remove"
          leavingId={removing.user_id}
          consequences={
            <p>
              They lose access to {project.name} unless their organisation role opens every space.
              Their work here stays.
            </p>
          }
          loadCandidates={() =>
            Promise.resolve(members.members.map((m) => ({ id: m.user_id, name: m.name })))
          }
          run={(openTasks) => members.removeWith(removing.user_id, openTasks)}
          onDone={() => {
            removed(removing);
          }}
          onClose={() => {
            setRemoving(undefined);
          }}
        />
      )}

      <footer className="ss-card-foot ss-card-foot-note">
        <p className="ss-muted">
          Organisation Owners and Admins can manage every space, whether or not they are members.
        </p>
        {isMember &&
          (leaving === undefined ? (
            <button
              type="button"
              className="ss-btn ss-btn-danger"
              data-action="leave"
              onClick={() => {
                setLeaving('ask');
                setLeaveError(undefined);
              }}
            >
              Leave space
            </button>
          ) : (
            <div className="ss-confirm" role="alertdialog" aria-label={`Leave ${project.name}?`}>
              <p>Leave {project.name}? Someone will have to add you back.</p>
              {leaveError !== undefined && (
                <p className="ss-field-error" role="alert" data-error="leave">
                  {leaveError}
                </p>
              )}
              <div className="ss-confirm-actions">
                <button
                  type="button"
                  className="ss-btn ss-btn-danger-solid"
                  data-action="confirm-leave"
                  disabled={leaving === 'busy'}
                  onClick={leave}
                >
                  Leave space
                </button>
                <button
                  type="button"
                  className="ss-btn"
                  onClick={() => {
                    setLeaving(undefined);
                    setLeaveError(undefined);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        {leftNotice !== undefined && (
          <p className="ss-notice" role="status" data-left-notice>
            {leftNotice}
          </p>
        )}
      </footer>

      <div className="ss-toasts">
        {toast !== undefined && (
          <div key={toast.id} className="ss-toast" data-toast>
            <span role="status">{toast.text}</span>
            {toast.undo !== undefined && (
              <button type="button" className="ss-toast-undo" onClick={toast.undo}>
                Undo
              </button>
            )}
            <button
              type="button"
              className="ss-toast-close"
              aria-label="Dismiss"
              onClick={() => {
                setToast(undefined);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * *Add people from <org>*: a search over the organisation's active people, a
 * pick of several, and one role for all of them — Member, Space admin or
 * Viewer, Member first. Each is added through `POST /members` in turn, so a
 * refusal for one is that one's.
 */
function AddPeople({
  orgName,
  existing,
  busy,
  onAdd,
}: {
  readonly orgName: string | undefined;
  readonly existing: readonly Member[];
  readonly busy: boolean;
  readonly onAdd: (people: readonly OrgUser[], role: ProjectRole) => Promise<boolean>;
}) {
  const { theme } = useTheme();
  const [users, setUsers] = useState<readonly OrgUser[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<readonly OrgUser[]>([]);
  const [role, setRole] = useState<ProjectRole>('member');

  useEffect(() => {
    const controller = new AbortController();
    listAllUsers(controller.signal)
      .then((all) => {
        setUsers(all.users);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError(cause);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const matches = useMemo(() => {
    if (users === undefined) return [];
    const here = new Set(existing.map((m) => m.user_id));
    const picked = new Set(chosen.map((u) => u.id));
    const needle = query.trim().toLowerCase();
    return users
      .filter((u) => !here.has(u.id) && !picked.has(u.id))
      .filter(
        (u) =>
          needle === '' ||
          u.name.toLowerCase().includes(needle) ||
          u.email.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [users, existing, chosen, query]);

  if (loadError !== null) {
    return <ApiErrorState error={loadError} resource="the organisation’s people" />;
  }

  return (
    <div className="ss-add">
      <div className="ss-add-bar">
        <div className="ss-add-search">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {chosen.map((person) => (
            <button
              key={person.id}
              type="button"
              className="ss-chip"
              data-chosen={person.id}
              onClick={() => {
                setChosen((current) => current.filter((u) => u.id !== person.id));
              }}
            >
              {person.name} <span aria-hidden="true">×</span>
              <span className="visually-hidden"> — remove from the people to add</span>
            </button>
          ))}
          <input
            type="search"
            className="ss-add-input"
            placeholder={`Add people from ${orgName ?? 'the organisation'}`}
            aria-label={`Add people from ${orgName ?? 'the organisation'}`}
            value={query}
            onFocus={() => {
              setOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          />
        </div>
        <div className="ss-segmented" role="radiogroup" aria-label="Role for the people added">
          {ADD_ROLES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={role === value}
              data-add-role={value}
              title={ROLE_SUMMARY[value]}
              onClick={() => {
                setRole(value);
              }}
            >
              {projectRoleLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {open && users !== undefined && (query.trim() !== '' || chosen.length === 0) && (
        <ul className="ss-add-results" aria-label="People in the organisation">
          {matches.length === 0 ? (
            <li className="ss-muted ss-add-none">
              {query.trim() === ''
                ? 'Everyone in the organisation is already here.'
                : `Nobody matches “${query.trim()}”.`}
            </li>
          ) : (
            matches.map((person) => {
              const colour = avatarColor(person.id, theme);
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    className="ss-add-result"
                    data-person={person.id}
                    onClick={() => {
                      setChosen((current) => [...current, person]);
                      setQuery('');
                    }}
                  >
                    <span
                      className="ss-member-avatar ss-member-avatar-sm"
                      style={{
                        background: colour.background,
                        color: colour.foreground,
                        borderColor: colour.border,
                      }}
                      aria-hidden="true"
                    >
                      {initials(person.name)}
                    </span>
                    <span className="ss-member-name">{person.name}</span>
                    <span className="ss-member-email">{person.email}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}

      {users === undefined && <LoadingState shape="row" count={1} label="Loading people" />}

      {chosen.length > 0 && (
        <div className="ss-add-go">
          <button
            type="button"
            className="ss-btn ss-btn-primary"
            data-action="add-people"
            disabled={busy}
            onClick={() => {
              void onAdd(chosen, role).then((all) => {
                if (all) {
                  setChosen([]);
                  setOpen(false);
                }
              });
            }}
          >
            {`Add ${chosen.length === 1 ? (chosen[0]?.name ?? '1 person') : `${String(chosen.length)} people`} as ${projectRoleLabel(role)}`}
          </button>
          <button
            type="button"
            className="ss-btn"
            onClick={() => {
              setChosen([]);
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * *Copy members from another space…*: pick a space, see who it would bring
 * and as what — the role each holds there — then add them. Nobody already
 * here is touched; their role here stays theirs.
 */
function CopyMembers({
  project,
  spaces,
  existing,
  busy,
  onCopy,
}: {
  readonly project: Project;
  readonly spaces: readonly Project[] | undefined;
  readonly existing: readonly Member[];
  readonly busy: boolean;
  readonly onCopy: (people: readonly Member[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [theirs, setTheirs] = useState<readonly Member[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (source === '') {
      setTheirs(undefined);
      return;
    }
    const controller = new AbortController();
    setTheirs(undefined);
    setError(null);
    listMembers(source, controller.signal)
      .then((list) => {
        setTheirs(list.members);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      });
    return () => {
      controller.abort();
    };
  }, [source]);

  const here = new Set(existing.map((m) => m.user_id));
  const incoming = (theirs ?? []).filter((m) => !here.has(m.user_id));
  const others = (spaces ?? []).filter((s) => s.id !== project.id);

  if (!open) {
    return (
      <button
        type="button"
        className="ss-link-button"
        data-action="copy-members"
        onClick={() => {
          setOpen(true);
        }}
      >
        Copy members from another space…
      </button>
    );
  }

  return (
    <div className="ss-copy" role="group" aria-label="Copy members from another space">
      <label className="ss-copy-pick">
        <span>Copy members from</span>
        <Dropdown
          noun="spaces"
          value={source}
          onChange={setSource}
          options={[
            { value: '', label: 'Choose a space', pinned: true },
            ...others.map((s) => ({ value: s.slug, label: s.name })),
          ]}
        />
      </label>
      {error !== null && <ApiErrorState error={error} resource="that space’s members" />}
      {source !== '' && theirs !== undefined && (
        <p className="ss-muted" data-copy-preview>
          {incoming.length === 0
            ? 'Everyone there is already here.'
            : `Adds ${incoming.map((m) => `${m.name} (${projectRoleLabel(m.role)})`).join(', ')}.`}
        </p>
      )}
      <div className="ss-confirm-actions">
        <button
          type="button"
          className="ss-btn ss-btn-primary"
          data-action="confirm-copy"
          disabled={busy || incoming.length === 0}
          onClick={() => {
            void onCopy(incoming).then(() => {
              setOpen(false);
              setSource('');
            });
          }}
        >
          {incoming.length === 0
            ? 'Copy members'
            : `Copy ${String(incoming.length)} ${incoming.length === 1 ? 'person' : 'people'}`}
        </button>
        <button
          type="button"
          className="ss-btn"
          onClick={() => {
            setOpen(false);
            setSource('');
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
