import { useState } from 'react';
import type { Project } from '../../../api/projects.ts';
import { updateSpace } from '../../../api/space-settings.ts';

export interface DangerTabProps {
  readonly project: Project;
  /** `project.settings.edit` here and the org's `project.archive`, as the server answers both. */
  readonly mayArchive: boolean;
  readonly onSaved: (project: Project) => void;
}

/**
 * Archive, or restore (D-103 item 10). **No delete** — that is LAI-979, owner
 * only with a typed key, and it is not drawn until it exists. Archiving asks
 * first; restoring does not, since it takes nothing away.
 */
export function DangerTab({ project, mayArchive, onSaved }: DangerTabProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const archived = project.archived_at !== null;

  const set = (next: boolean): void => {
    setBusy(true);
    setFailure(undefined);
    updateSpace(project.slug, { archived: next })
      .then((updated) => {
        setConfirming(false);
        onSaved(updated);
      })
      .catch((cause: unknown) => {
        setFailure(cause instanceof Error ? cause.message : 'Nothing changed');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="ss-card ss-danger" aria-labelledby="ss-danger-title">
      <header className="ss-card-head">
        <h2 id="ss-danger-title" className="ss-danger-title">
          Danger zone
        </h2>
      </header>

      <div className="ss-rows">
        <div className="ss-row">
          <div className="ss-row-label">
            <span className="ss-label">{archived ? 'Restore space' : 'Archive space'}</span>
            <p className="ss-help">
              {archived
                ? 'This space is archived: its board is read-only. Restoring opens it for work again.'
                : 'The board becomes read-only. Members keep access to its history.'}
            </p>
          </div>
          <div className="ss-row-field ss-row-field-end">
            {!mayArchive ? (
              <p className="ss-value ss-muted">
                Only an organisation owner or admin can {archived ? 'restore' : 'archive'} a space.
              </p>
            ) : archived ? (
              <button
                type="button"
                className="ss-btn"
                data-action="restore"
                disabled={busy}
                onClick={() => {
                  set(false);
                }}
              >
                Restore
              </button>
            ) : confirming ? (
              <div
                className="ss-confirm"
                role="alertdialog"
                aria-label={`Archive ${project.name}?`}
              >
                <p>Archive {project.name}? Its board becomes read-only until it is restored.</p>
                <div className="ss-confirm-actions">
                  <button
                    type="button"
                    className="ss-btn ss-btn-danger-solid"
                    data-action="confirm-archive"
                    disabled={busy}
                    onClick={() => {
                      set(true);
                    }}
                  >
                    Archive space
                  </button>
                  <button
                    type="button"
                    className="ss-btn"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="ss-btn ss-btn-danger"
                data-action="archive"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Archive
              </button>
            )}
            {failure !== undefined && (
              <p className="ss-field-error" role="alert">
                {failure}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
