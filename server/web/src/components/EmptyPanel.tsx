import { StateIcon, type StateIconName } from './StateIcon.tsx';
import './forms/forms.css';
import './state-kit.css';

/**
 * Why a place is empty, which decides what the reader can do about it
 * (LAI-1207). Four reasons, four different next steps:
 *
 * | Variant | Means | The next step |
 * | --- | --- | --- |
 * | `first-use` | nothing has been made here yet | make the first one |
 * | `filtered` | there is work, the filter hides it | clear the filter |
 * | `no-permission` | there may be work; this reader cannot add or see it here | who to ask |
 * | `caught-up` | everything here is dealt with | nothing — and that is good |
 *
 * `no-permission` is the **quiet** case: a list the reader may not add to, or
 * a section their role does not include. A request the server **refused**
 * (`403`) is not empty at all and still renders `PermissionDenied`, through
 * `ApiErrorPanel` — telling a reader "nothing here" when the truth is "not for
 * you" is the lie LAI-020 AC4 exists to prevent.
 */
export type EmptyVariant = 'first-use' | 'filtered' | 'no-permission' | 'caught-up';

/** A button, or a link when the next step is somewhere else. */
export type EmptyAction =
  | { readonly label: string; readonly onClick: () => void; readonly href?: undefined }
  | { readonly label: string; readonly href: string; readonly onClick?: undefined };

export interface EmptyPanelProps {
  readonly variant: EmptyVariant;
  /**
   * Required and never defaulted, for the reason `EmptyState` gives (LAI-020):
   * "No tokens yet" says something; "No data" says nothing.
   */
  readonly title: string;
  /** One line: why it is empty, or what will appear here. */
  readonly why?: string | undefined;
  /**
   * The one next step. For `filtered`, leave it out and pass
   * {@link EmptyPanelProps.onClearFilters}: the action is then always *Clear
   * filters*, worded the same on every screen.
   */
  readonly action?: EmptyAction | undefined;
  /** A quieter second step, drawn as a text button beside the first. */
  readonly secondary?: EmptyAction | undefined;
  /** `filtered` only: clears every filter. Becomes the primary action. */
  readonly onClearFilters?: (() => void) | undefined;
  /**
   * The glyph. Each variant has its own by default; pass a name to change it,
   * or `false` for none (a small inline empty, such as one board lane).
   */
  readonly icon?: StateIconName | false | undefined;
  /**
   * `compact` sits inside a card or lane: less padding, a smaller title. The
   * default fills the region it is given and centres itself in it.
   */
  readonly size?: 'compact' | 'regular' | undefined;
  /**
   * Draw the title as a heading of this level, for an empty state that stands
   * in for a section's content. A paragraph by default. Same name and meaning
   * as LAI-1128's `EmptyState` prop, so the two converge.
   */
  readonly headingLevel?: 2 | 3 | undefined;
  /** The title's id, so a section can be labelled by it and focus can return to it. */
  readonly headingId?: string | undefined;
}

const DEFAULT_ICON: Record<EmptyVariant, StateIconName> = {
  'first-use': 'start',
  filtered: 'filter',
  'no-permission': 'forbidden',
  'caught-up': 'done',
};

function ActionControl({
  action,
  kind,
}: {
  readonly action: EmptyAction;
  readonly kind: 'primary' | 'secondary';
}) {
  const className = kind === 'primary' ? 'button button-primary kit-btn' : 'kit-link';
  if (action.href !== undefined) {
    return (
      <a className={className} href={action.href}>
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={action.onClick}>
      {action.label}
    </button>
  );
}

/**
 * Nothing here — said calmly, with the reason and the way forward (LAI-1207).
 *
 * **Never error-styled and never an alert.** The visual audit found an empty
 * panel tinted red the full height of Activity: the reader is told something
 * is wrong when nothing is. Every colour here is neutral — the canvas, the
 * column surface, primary and secondary text, the accent only on the one
 * action — and nothing announces itself: an empty list is not news. The
 * Playwright suite measures the computed colours against the error palette.
 *
 * Distinct from `ErrorPanel` (a read failed) and `PermissionDenied` (the
 * server refused); see {@link EmptyVariant}.
 */
export function EmptyPanel({
  variant,
  title,
  why,
  action,
  secondary,
  onClearFilters,
  icon,
  size = 'regular',
  headingLevel,
  headingId,
}: EmptyPanelProps) {
  const Title = headingLevel === undefined ? 'p' : headingLevel === 2 ? 'h2' : 'h3';
  const glyph = icon === false ? undefined : (icon ?? DEFAULT_ICON[variant]);
  const primary: EmptyAction | undefined =
    variant === 'filtered' && onClearFilters !== undefined && action === undefined
      ? { label: 'Clear filters', onClick: onClearFilters }
      : action;

  return (
    <div className="empty-panel" data-variant={variant} data-size={size}>
      {glyph !== undefined && (
        <span className="empty-panel-icon">
          <StateIcon name={glyph} />
        </span>
      )}
      <Title
        className="empty-panel-title"
        {...(headingId === undefined ? {} : { id: headingId, tabIndex: -1 })}
      >
        {title}
      </Title>
      {why !== undefined && <p className="empty-panel-why">{why}</p>}
      {(primary !== undefined || secondary !== undefined) && (
        <div className="empty-panel-actions">
          {primary !== undefined && <ActionControl action={primary} kind="primary" />}
          {secondary !== undefined && <ActionControl action={secondary} kind="secondary" />}
        </div>
      )}
    </div>
  );
}
