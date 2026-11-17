import { useRef, useState } from 'react';
import type { Project } from '../../../api/projects.ts';
import { updateSpace } from '../../../api/space-settings.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { TextInput } from '../../../components/forms/TextInput.tsx';
import { SaveStatus, useSaveStatus } from '../../../components/SaveStatus.tsx';
import { useAction } from '../../../components/toast/use-action.ts';

export interface DangerTabProps {
  readonly project: Project;
  /** `project.settings.edit` here and the org's `project.archive`, as the server answers both. */
  readonly mayArchive: boolean;
  readonly onSaved: (project: Project) => void;
  /** In-app navigation for the *Spaces › Archived* link; absent, it is a plain link. */
  readonly onNavigate?: ((to: string) => void) | undefined;
}

/** Where an archived space is listed, and restored from besides here. */
export const ARCHIVED_SPACES_HREF = '/projects?filter=archived';

/**
 * Archive, or restore (D-103 item 10). **No delete** — that is LAI-979, owner
 * only with a typed key, and it is not drawn until it exists. Each says
 * *Saving… / Saved / Couldn't save — Retry* beside it (`SaveStatus`,
 * LAI-1129), and *Saved* only on the server's answer.
 *
 * LAI-1211: archiving **says what it does before it is done** — the list is
 * the Spaces page's own archive wording — and asks for the space's key to be
 * typed, because it stops work for everyone in the space. It is reversible,
 * and says so. Once done, the page says where the space now lives and that it
 * can be restored here or from *Spaces › Archived*. Restoring takes nothing
 * away, so it asks nothing.
 */
export function DangerTab({ project, mayArchive, onSaved, onNavigate }: DangerTabProps) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<string | undefined>(undefined);
  /** An archive just landed: where the space now lives, which a toast cannot link. */
  const [done, setDone] = useState<'archived' | undefined>(undefined);
  const status = useSaveStatus();
  const { run } = useAction();
  const busy = status.state.kind === 'saving';
  const archiveButton = useRef<HTMLButtonElement | null>(null);
  const archived = project.archived_at !== null;
  const matches = typed.trim().toUpperCase() === project.prefix;

  const close = (): void => {
    setConfirming(false);
    setTyped('');
    requestAnimationFrame(() => archiveButton.current?.focus());
  };

  // The whole save — its answer handled too — is what Retry runs again.
  // Archiving and restoring toast too (LAI-1310). Archiving offers Undo —
  // restoring asks nothing, so putting it back is the same click; restoring
  // offers none, because archiving again is behind the typed confirmation.
  const set = (next: boolean): void => {
    void run({
      do: () =>
        status.run(() => {
          setFailure(undefined);
          setDone(undefined);
          return updateSpace(project.slug, { archived: next }).then(
            (updated) => {
              setConfirming(false);
              setTyped('');
              // Only an archive leaves a note: it says where the space now lives.
              setDone(next ? 'archived' : undefined);
              onSaved(updated);
              return updated;
            },
            (cause: unknown) => {
              setFailure(cause instanceof Error ? cause.message : 'Nothing changed');
              throw cause;
            },
          );
        }),
      success: next ? `${project.name} archived` : `${project.name} restored`,
      ...(next
        ? {
            undo: async () => {
              const back = await updateSpace(project.slug, { archived: false });
              setDone(undefined);
              onSaved(back);
              return `${project.name} restored`;
            },
          }
        : {}),
      failure: next ? 'Couldn’t archive the space' : 'Couldn’t restore the space',
      mark: 'space-archive',
    });
  };

  const archivedLink = (
    <a
      href={ARCHIVED_SPACES_HREF}
      onClick={(event) => {
        if (onNavigate === undefined) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(ARCHIVED_SPACES_HREF);
      }}
    >
      Spaces › Archived
    </a>
  );

  return (
    <section className="ss-card ss-danger" aria-labelledby="ss-danger-title">
      <header className="ss-card-head">
        <h2 id="ss-danger-title" className="ss-danger-title">
          Danger zone
        </h2>
        <p>Changes here affect everyone who works in {project.name}.</p>
      </header>

      <div className="ss-rows">
        <div className="ss-row">
          <div className="ss-row-label">
            <span className="ss-label">{archived ? 'Restore space' : 'Archive space'}</span>
            {archived ? (
              <ul className="ss-danger-list" data-consequences="restore">
                <li>Its board opens for work again: tasks can be added and moved.</li>
                <li>Agents can pick up its work again.</li>
                <li>It leaves Spaces › Archived and returns to the Spaces list.</li>
              </ul>
            ) : (
              <ul className="ss-danger-list" data-consequences="archive">
                <li>Its board becomes read-only: nobody can add or move tasks.</li>
                <li>Agents stop picking up its work.</li>
                <li>Nothing is deleted — members keep its history.</li>
                <li>It moves to Spaces › Archived, and can be restored at any time.</li>
              </ul>
            )}
          </div>
          <div className="ss-row-field ss-row-field-end">
            {!mayArchive ? (
              <p className="ss-value ss-muted">
                To {archived ? 'restore' : 'archive'} a space you need to be its Space admin and
                hold “Create and archive spaces” in your organisation role.
              </p>
            ) : archived ? (
              <Button
                variant="secondary"
                data-action="restore"
                busy={busy}
                onClick={() => {
                  set(false);
                }}
              >
                Restore space
              </Button>
            ) : confirming ? (
              <div
                className="ss-typed"
                role="group"
                aria-label={`Archive ${project.name}`}
                data-typed-confirm
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !busy) {
                    event.preventDefault();
                    close();
                  }
                }}
              >
                <p>
                  Archive <strong>{project.name}</strong>? Type its key,{' '}
                  <strong className="ss-mono">{project.prefix}</strong>, to confirm.
                </p>
                <TextInput
                  id="ss-archive-key"
                  label="Space key"
                  appearance="code"
                  width="short"
                  autoFocus
                  autoComplete="off"
                  value={typed}
                  onChange={(value) => {
                    setTyped(value.toUpperCase());
                  }}
                />
                <div className="ss-confirm-actions">
                  <Button variant="secondary" disabled={busy} onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    data-action="confirm-archive"
                    disabled={!matches}
                    disabledReason={matches ? undefined : `Type ${project.prefix} to archive`}
                    busy={busy}
                    onClick={() => {
                      set(true);
                    }}
                  >
                    Archive space
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                ref={archiveButton}
                variant="danger"
                data-action="archive"
                onClick={() => {
                  setConfirming(true);
                  setDone(undefined);
                }}
              >
                Archive space…
              </Button>
            )}
            {mayArchive && <SaveStatus state={status.state} onRetry={status.retry} />}
            {failure !== undefined && (
              <p className="ss-field-error" role="alert">
                {failure}
              </p>
            )}
          </div>
        </div>
      </div>

      {done !== undefined && (
        <footer className="ss-card-foot ss-card-foot-note">
          <p className="ss-notice" role="status" data-danger-result={done}>
            {project.name} is archived and its board is read-only. Restore it here at any time, or
            from {archivedLink}.
          </p>
        </footer>
      )}
    </section>
  );
}
