import { useEffect, useMemo, useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { Button } from '../../components/forms/Button.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { listAllUsers, type OrgUser } from '../../api/users.ts';
import { PROJECT_ROLES, ROLE_SUMMARY, type ProjectRole } from '../../api/members.ts';
import { avatarColor } from '../../theme/avatar-color.ts';
import { useTheme } from '../../theme/use-theme.ts';

export interface AddMemberFormProps {
  /** User ids already on the project — never offered. */
  readonly existingIds: readonly string[];
  readonly busy: boolean;
  readonly onAdd: (userId: string, role: ProjectRole) => Promise<boolean>;
  readonly onCancel: () => void;
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Pick a person from the organisation and give them a role (LAI-059, LAI-060).
 *
 * **A picker, not an id field.** `POST /:slug/members` takes a `user_id`, and
 * for most of this task's life nothing in the API could produce one — which is
 * exactly why the add flow was held back rather than shipped as a box you paste
 * a ULID into. `GET /api/v1/users` now exists, so the person is chosen by name
 * and face.
 *
 * Radios rather than a `<select>`: a native option list cannot show an avatar,
 * and the avatar is how you tell two people with the same name apart. Radios
 * are a real form control, so arrow keys, labels and screen readers work
 * without inventing a listbox.
 *
 * **Agent accounts.** LAI-060 established there is nothing non-human to filter:
 * an agent authenticates with a token belonging to a real person, so the
 * directory is people. Builder-A left a test that fails if a service-account
 * concept ever lands, which is the signal to revisit this.
 */
export function AddMemberForm({ existingIds, busy, onAdd, onCancel }: AddMemberFormProps) {
  const { theme } = useTheme();
  const [users, setUsers] = useState<readonly OrgUser[] | undefined>(undefined);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [role, setRole] = useState<ProjectRole>('member');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    listAllUsers(controller.signal)
      .then((all) => {
        setUsers(all.users);
        setTruncated(all.truncated);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError(cause);
      });

    return () => {
      controller.abort();
    };
  }, []);

  const eligible = useMemo(() => {
    if (users === undefined) return [];
    const already = new Set(existingIds);
    const needle = filter.trim().toLowerCase();
    return users
      .filter((u) => !already.has(u.id))
      .filter(
        (u) =>
          needle === '' ||
          u.name.toLowerCase().includes(needle) ||
          u.email.toLowerCase().includes(needle),
      );
  }, [users, existingIds, filter]);

  if (loadError !== null) {
    return (
      <div className="member-add">
        <ApiErrorState error={loadError} resource="the organisation’s people" />
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  if (users === undefined) {
    return (
      <div className="member-add">
        <LoadingState shape="row" count={2} label="Loading people" />
      </div>
    );
  }

  return (
    <form
      className="member-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen === undefined) return;
        void onAdd(chosen, role).then((accepted) => {
          // Only clear on success. A refusal keeps the choice on screen so the
          // error is about something the reader can still see.
          if (accepted) {
            setChosen(undefined);
            setFilter('');
            onCancel();
          }
        });
      }}
    >
      <div className="member-add-head">
        <h3 className="member-add-title">Add someone to this project</h3>
        <input
          type="search"
          className="member-add-filter"
          placeholder="Filter by name or email"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
          aria-label="Filter people"
        />
      </div>

      {truncated && (
        <p className="member-add-note" role="status">
          Showing the first several pages of the directory — refine the filter if the person you
          want is missing.
        </p>
      )}

      {eligible.length === 0 ? (
        <p className="member-add-empty">
          {users.length - existingIds.length <= 0
            ? 'Everyone in the organisation is already on this project.'
            : 'Nobody matches that filter.'}
        </p>
      ) : (
        <ul className="member-add-list" role="radiogroup" aria-label="People to add">
          {eligible.map((user) => {
            const colour = avatarColor(user.id, theme);
            return (
              <li key={user.id}>
                <label className="member-add-option">
                  <input
                    type="radio"
                    name="add-member-user"
                    value={user.id}
                    checked={chosen === user.id}
                    onChange={() => {
                      setChosen(user.id);
                    }}
                  />
                  <span
                    className="member-avatar"
                    style={{
                      background: colour.background,
                      color: colour.foreground,
                      borderColor: colour.border,
                    }}
                    aria-hidden="true"
                  >
                    {initials(user.name)}
                  </span>
                  <span className="member-who">
                    <span className="member-name">{user.name}</span>
                    <span className="member-email">{user.email}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="member-add-actions">
        <label className="member-role">
          <span className="visually-hidden">Role for the person being added</span>
          <select
            value={role}
            disabled={busy}
            onChange={(event) => {
              setRole(event.target.value as ProjectRole);
            }}
          >
            {PROJECT_ROLES.map((r) => (
              <option key={r} value={r} title={ROLE_SUMMARY[r]}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {/* Disabled until someone is chosen — the server would 422 on an empty
            `user_id`, and offering a button that cannot work is noise. */}
        <Button type="submit" disabled={busy || chosen === undefined}>
          Add
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
