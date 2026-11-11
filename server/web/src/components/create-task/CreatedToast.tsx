import './created-toast.css';

/** The last task made here, and how it went (LAI-1167). */
export interface CreatedToastState {
  /** Changes with every toast, so its timer starts again. */
  readonly id: number;
  /** `status` when all went as asked; `alert` for *created, but…*. */
  readonly tone: 'status' | 'alert';
  /** `LC-7 created`, or `LC-7 created, but could not add it to Sprint 4`. */
  readonly text: string;
  /** The server's own sentence, under the headline. */
  readonly detail?: string | undefined;
  readonly taskId: string;
}

export interface CreatedToastProps {
  readonly toast: CreatedToastState | undefined;
  readonly onOpen: (taskId: string) => void;
  readonly onClose: () => void;
}

/**
 * *LC-7 created · Open* — a dark pill at the bottom centre of the window, in
 * My day's recipe (`my-day/Toast.tsx`, LAI-831) but its own component: that
 * one is sticky inside the My day column and carries Undo; this one is fixed
 * to the window, because the dialog it reports on has closed and the view
 * under it may be any of the space's. A shared Toast is a later unification
 * (D-145).
 *
 * The sentence alone is announced — a status when all went well, an alert
 * when the task exists but a step after it did not (the reader must know a
 * task was made either way, which is why the dialog closes in both cases).
 */
export function CreatedToast({ toast, onOpen, onClose }: CreatedToastProps) {
  if (toast === undefined) return null;
  return (
    <div className="created-toasts" data-created-toast>
      <div key={toast.id} className={`created-toast created-toast-${toast.tone}`}>
        {toast.tone === 'alert' && <span className="created-toast-dot" aria-hidden="true" />}
        <span className="created-toast-text" role={toast.tone}>
          {toast.text}
          {toast.detail !== undefined && (
            <span className="created-toast-detail">{toast.detail}</span>
          )}
        </span>
        <button
          type="button"
          className="created-toast-open"
          onClick={() => {
            onOpen(toast.taskId);
          }}
        >
          Open
        </button>
        <button
          type="button"
          className="created-toast-close"
          aria-label="Dismiss"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
