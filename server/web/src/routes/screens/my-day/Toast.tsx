/** What the page last said, and what Undo would take back (LAI-831). */
export interface ToastState {
  /** Changes with every new toast, so its timer starts again. */
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'warn' | 'error';
  /**
   * Takes the change back — the server puts back exactly what it replaced —
   * and resolves to what to say after; absent when nothing can be undone.
   */
  readonly undo?: () => Promise<string>;
  /** A batch's report (LAI-810), which says how it went in full. */
  readonly batch?: boolean;
}

export interface ToastProps {
  readonly toast: ToastState | undefined;
  readonly busy: boolean;
  readonly onUndo: (undo: () => Promise<string>) => void;
  readonly onClose: () => void;
}

/**
 * The page's last word (LAI-831, the owner's design): one dark line at the
 * foot of the screen for every action, with a close button — and **Undo**
 * for about ten seconds wherever the server can put the change back exactly
 * (CHIEF's addition B). An error stays until it is closed.
 */
export function Toast({ toast, busy, onUndo, onClose }: ToastProps) {
  return (
    <div className="myday-toasts">
      {toast !== undefined && (
        <div key={toast.id} className={`myday-toast myday-toast-${toast.tone}`} data-toast>
          <span className="myday-toast-dot" aria-hidden="true" />
          {/* The sentence alone is announced: an alert when it did not all
              go as asked (LAI-810), never "Undo ×" read out with it. */}
          <span
            className="myday-toast-text"
            role={toast.tone === 'info' ? 'status' : 'alert'}
            {...(toast.batch === true ? { 'data-bulk-said': '' } : {})}
          >
            {toast.text}
          </span>
          {toast.undo !== undefined && (
            <button
              type="button"
              className="myday-toast-undo"
              disabled={busy}
              onClick={() => {
                if (toast.undo !== undefined) onUndo(toast.undo);
              }}
            >
              Undo
            </button>
          )}
          <button
            type="button"
            className="myday-toast-close"
            aria-label="Dismiss"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
