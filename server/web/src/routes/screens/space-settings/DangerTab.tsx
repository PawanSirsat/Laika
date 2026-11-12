import { useRef, useState } from 'react';
import type { Project } from '../../../api/projects.ts';
import { updateSpace } from '../../../api/space-settings.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { InlineConfirm } from '../../../components/InlineConfirm.tsx';
import { SaveStatus, useSaveStatus } from '../../../components/SaveStatus.tsx';

export interface DangerTabProps {
  readonly project: Project;
  /** `project.settings.edit` here and the org's `project.archive`, as the server answers both. */
  readonly mayArchive: boolean;
  readonly onSaved: (project: Project) => void;
}

/**
 * Archive, or restore (D-103 item 10). **No delete** — that is LAI-979, owner
 * only with a typed key, and it is not drawn until it exists. Archiving asks
 * first, in the one `InlineConfirm` (LAI-1129, B12); restoring does not,
 * since it takes nothing away. Each says *Saving… / Saved / Couldn't save —
 * Retry* beside it (`SaveStatus`), and *Saved* only on the server's answer.
 */
export function DangerTab({ project, mayArchive, onSaved }: DangerTabProps) {
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const status = useSaveStatus();
  const busy = status.state.kind === 'saving';
  const archiveButton = useRef<HTMLButtonElement | null>(null);
  const archived = project.archived_at !== null;

  // The whole save — its answer handled too — is what Retry runs again.
  const set = (next: boolean): void => {
    status
      .run(() => {
        setFailure(undefined);
        return updateSpace(project.slug, { archived: next }).then(
          (updated) => {
            setConfirming(false);
            onSaved(updated);
          },
          (cause: unknown) => {
            setFailure(cause instanceof Error ? cause.message : 'Nothing changed');
            throw cause;
          },
        );
      })
      .catch(() => {
        // Said beside the control, by the status and the message above.
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
                Restore
              </Button>
            ) : confirming ? (
              <InlineConfirm
                className="ss-confirm"
                question={`Archive ${project.name}? Its board becomes read-only until it is restored.`}
                confirmLabel="Archive space"
                confirmClassName="button button-danger button-md"
                cancelClassName="button button-secondary button-md"
                confirmAction="confirm-archive"
                busy={busy}
                onConfirm={() => {
                  set(true);
                }}
                onCancel={() => {
                  setConfirming(false);
                }}
                returnFocus={() => archiveButton.current}
              />
            ) : (
              <Button
                ref={archiveButton}
                variant="danger"
                data-action="archive"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Archive
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
    </section>
  );
}
