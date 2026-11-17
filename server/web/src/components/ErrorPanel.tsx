import { Spinner } from '../components/Spinner.tsx';
import { StateIcon } from './StateIcon.tsx';
import type { EmptyAction } from './EmptyPanel.tsx';
import './forms/forms.css';
import './state-kit.css';

export interface ErrorPanelProps {
  /** What happened, in the reader's terms: "Couldn’t load members". */
  readonly title: string;
  /** Why, and what it means for them. `errorCopy` writes both from an error. */
  readonly why: string;
  /** SPEC §13.2's `request_id`, shown small and selectable for quoting. */
  readonly requestId?: string | undefined;
  /**
   * Ask again. Omit when asking again cannot help — a rejected payload fails
   * the same way twice, and a button that cannot work teaches people to mash.
   */
  readonly onRetry?: (() => void) | undefined;
  /** A retry is in flight: the button stays focusable, says so, and ignores presses. */
  readonly retrying?: boolean | undefined;
  /** A quieter second step: "Go to Spaces", "Check the instance status". */
  readonly help?: EmptyAction | undefined;
  /** The glyph: `offline` when the instance did not answer, `error` otherwise. */
  readonly kind?: 'offline' | 'server' | undefined;
  /** `compact` inside a card or panel; the default fills its region. */
  readonly size?: 'compact' | 'regular' | undefined;
  /** Draw the title as a heading of this level, as `EmptyPanel` can. */
  readonly headingLevel?: 2 | 3 | undefined;
}

/**
 * A read failed and there is nothing to show instead (LAI-1207).
 *
 * **What happened, why, and the way out** — in that order, because that is
 * the order a reader asks them in. Calmer than LAI-020's `ErrorState`: the
 * glyph carries the warning colour and the words stay in the ordinary text
 * colours, because a red headline makes a timeout read like data loss. Retry
 * is the primary action, drawn like every other primary action.
 *
 * `role="alert"` stays: unlike an empty list, a failure is news, and a reader
 * who pressed something deserves to hear that it did not work.
 *
 * When there **is** something to show — a re-read failed over data already on
 * screen — use {@link StaleBanner} instead and keep the data.
 */
export function ErrorPanel({
  title,
  why,
  requestId,
  onRetry,
  retrying = false,
  help,
  kind = 'server',
  size = 'regular',
  headingLevel,
}: ErrorPanelProps) {
  const Title = headingLevel === undefined ? 'p' : headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="error-panel" role="alert" data-size={size} data-kind={kind}>
      <span className="error-panel-icon">
        <StateIcon name={kind === 'offline' ? 'offline' : 'error'} />
      </span>
      <Title className="error-panel-title">{title}</Title>
      <p className="error-panel-why">{why}</p>
      {requestId !== undefined && (
        <p className="error-panel-detail">
          <span className="visually-hidden">Request id, quote this when reporting: </span>
          request_id {requestId}
        </p>
      )}
      {(onRetry !== undefined || help !== undefined) && (
        <div className="empty-panel-actions">
          {onRetry !== undefined && (
            /* `aria-disabled`, not `disabled`: focus stays on the button while it asks. */
            <button
              type="button"
              className="button button-primary kit-btn"
              aria-disabled={retrying || undefined}
              aria-busy={retrying || undefined}
              onClick={() => {
                if (!retrying) onRetry();
              }}
            >
              {retrying && <Spinner size="sm" />}
              Try again
            </button>
          )}
          {help !== undefined &&
            (help.href !== undefined ? (
              <a className="kit-link" href={help.href}>
                {help.label}
              </a>
            ) : (
              <button type="button" className="kit-link" onClick={help.onClick}>
                {help.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
