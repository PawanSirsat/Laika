import {
  isoWeek,
  mondayOf,
  monthName,
  SPAN_LABELS,
  SPANS,
  startsAfter,
  stepPeriod,
  yearOf,
  zoomSpan,
  type Span,
} from './span.ts';

export interface ViewSwitchProps {
  readonly span: Span;
  readonly day: string;
  readonly today: string;
  readonly onSpan: (span: Span) => void;
  readonly onStep: (by: 1 | -1) => void;
  readonly onToday: () => void;
  /** The day view keeps its own ‹ › and week strip; the wider views draw these. */
  readonly withNav: boolean;
  readonly disabled?: boolean | undefined;
}

/**
 * My day's **View** (LAI-1174, the owner's design): ‹ Today › for the wider
 * views, the trail back up (*2026 › November › Week 46*), the four views as
 * one radio group whose thumb slides to the one picked, and − / + one step
 * out or in. The keys are D, W, M, Y and − / + (`shortcuts.ts`).
 */
export function ViewSwitch({
  span,
  day,
  today,
  onSpan,
  onStep,
  onToday,
  withNav,
  disabled = false,
}: ViewSwitchProps) {
  const index = SPANS.indexOf(span);
  const finer = zoomSpan(span, 'in');
  const coarser = zoomSpan(span, 'out');
  const crumbs = trail(span, day);
  const atToday = same(span, day, today);

  return (
    <div className="span-switch" data-view-switch data-span={span}>
      {withNav && (
        <div className="span-nav" role="group" aria-label={`${SPAN_LABELS[span]} to show`}>
          <button
            type="button"
            className="span-nav-step"
            aria-label={`Previous ${SPAN_LABELS[span].toLowerCase()}`}
            disabled={disabled}
            onClick={() => {
              onStep(-1);
            }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="span-nav-today"
            disabled={disabled || atToday}
            onClick={onToday}
          >
            Today
          </button>
          <button
            type="button"
            className="span-nav-step"
            aria-label={`Next ${SPAN_LABELS[span].toLowerCase()}`}
            disabled={disabled || startsAfter(span, stepPeriod(span, day, 1), today)}
            onClick={() => {
              onStep(1);
            }}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {withNav && (
        <nav className="span-crumbs" aria-label="Where you are">
          {crumbs.map((c, i) => (
            <span key={c.span} className="span-crumb-wrap">
              {i > 0 && (
                <span className="span-crumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
              {c.span === span ? (
                <span className="span-crumb" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="span-crumb span-crumb-link"
                  disabled={disabled}
                  onClick={() => {
                    onSpan(c.span);
                  }}
                >
                  {c.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="span-switch-tools">
        <div
          className="span-seg"
          role="radiogroup"
          aria-label="View"
          style={{ ['--span-index' as string]: String(index) }}
        >
          <span className="span-seg-thumb" aria-hidden="true" />
          {SPANS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === span}
              className="span-seg-option"
              data-span-option={s}
              title={`${SPAN_LABELS[s]} (${SPAN_LABELS[s].charAt(0)})`}
              disabled={disabled}
              tabIndex={s === span ? 0 : -1}
              onClick={() => {
                if (s !== span) onSpan(s);
              }}
              onKeyDown={(event) => {
                const by =
                  event.key === 'ArrowRight' || event.key === 'ArrowDown'
                    ? 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                      ? -1
                      : 0;
                if (by === 0) return;
                event.preventDefault();
                event.stopPropagation();
                const group = event.currentTarget.parentElement;
                const next = SPANS[(SPANS.indexOf(s) + by + SPANS.length) % SPANS.length];
                if (next !== undefined) {
                  onSpan(next);
                  requestAnimationFrame(() => {
                    group?.querySelector<HTMLElement>(`[data-span-option="${next}"]`)?.focus();
                  });
                }
              }}
            >
              {SPAN_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="span-zoom" role="group" aria-label="Zoom the view">
          <button
            type="button"
            className="span-zoom-step"
            aria-label="Zoom out (−)"
            title="Zoom out (−)"
            disabled={disabled || coarser === undefined}
            onClick={() => {
              if (coarser !== undefined) onSpan(coarser);
            }}
          >
            −
          </button>
          <button
            type="button"
            className="span-zoom-step"
            aria-label="Zoom in (+)"
            title="Zoom in (+)"
            disabled={disabled || finer === undefined}
            onClick={() => {
              if (finer !== undefined) onSpan(finer);
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

/** The trail from the year down to the view shown. */
function trail(span: Span, day: string): { span: Span; label: string }[] {
  const out: { span: Span; label: string }[] = [{ span: 'year', label: String(yearOf(day)) }];
  if (span === 'year') return out;
  out.push({ span: 'month', label: monthName(day) });
  if (span === 'month') return out;
  out.push({ span: 'week', label: `Week ${String(isoWeek(day))}` });
  return out;
}

/** Whether two days fall in the same period of a span. */
function same(span: Span, a: string, b: string): boolean {
  if (span === 'year') return a.slice(0, 4) === b.slice(0, 4);
  if (span === 'month') return a.slice(0, 7) === b.slice(0, 7);
  if (span === 'week') return mondayOf(a) === mondayOf(b);
  return a === b;
}
