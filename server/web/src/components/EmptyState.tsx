import { StateIcon } from './StateIcon.tsx';
import './states.css';

export interface EmptyStateProps {
  /**
   * Required, and deliberately not defaulted. LAI-020 asks for per-instance
   * copy — "No projects yet" beats "No data" — and a default headline is how
   * every screen quietly ends up saying the same useless thing.
   */
  readonly headline: string;
  /** One line. What the reader can do about it, or why it is empty. */
  readonly body?: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

/**
 * Nothing here yet — and that is normal, not a failure.
 *
 * Distinct from ErrorState (something broke) and PermissionDenied (it exists,
 * you may not see it). Rendering "empty" for a `forbidden` response is a lie
 * the reader cannot detect, which is why they are three components.
 */
export function EmptyState({ headline, body, action }: EmptyStateProps) {
  return (
    <div className="state state-empty">
      <div className="state-icon">
        <StateIcon name="empty" />
      </div>
      <p className="state-headline">{headline}</p>
      {body !== undefined && <p className="state-body">{body}</p>}
      {action !== undefined && (
        <div className="state-action">
          <button type="button" className="state-button" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
