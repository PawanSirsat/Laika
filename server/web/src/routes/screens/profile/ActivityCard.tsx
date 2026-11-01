import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  getPeopleActivity,
  type ActivityRange,
  type PeopleActivity,
} from '../../../api/people-activity.ts';
import { InfoTip } from './InfoTip.tsx';
import {
  activityStats,
  calendarLayout,
  dayLines,
  dayText,
  designKey,
  emptyDays,
  HEAT_DESIGNS,
  heatDays,
  levelScale,
  moveIndex,
  plural,
  rangeDays,
  shortDate,
  sourceTotals,
  spanLabel,
  storedDesign,
  WEEKDAYS,
  weekdayName,
  type HeatDay,
  type HeatDesign,
  type HeatLevel,
  type HeatSource,
  type Placed,
} from './activity-derive.ts';
import './activity.css';

export interface ActivityCardProps {
  /** Whose activity. */
  readonly userId: string;
  readonly name: string;
  /** Who is looking — the design they chose is remembered per viewer. */
  readonly viewerId: string;
  /** Owners and admins may turn Developer insights on, so they get the link. */
  readonly canManageOrg: boolean;
  /**
   * D-079's two switches for them, from the profile (LAI-751): the card is
   * drawn in its final shape before the activity answers, so nothing below it
   * moves when it does.
   */
  readonly sharing: ActivitySwitches;
}

interface ActivitySwitches {
  readonly org_enabled: boolean;
  readonly enabled: boolean;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly activity: PeopleActivity };

/** Why GitHub and Local are not drawn at all, if they are not. */
type Off = 'org_off' | null;

/** GitHub's and Local's line when Developer insights are on and nothing has come. */
const NOTHING_YET = 'nothing from their machines yet';

const RANGES: readonly { value: ActivityRange; label: string; caption: string }[] = [
  { value: '12w', label: '12 weeks', caption: 'last 12 weeks' },
  { value: '52w', label: '1 year', caption: 'last 12 months' },
];

const DESIGNS: Readonly<Record<HeatDesign, { label: string; hint: string }>> = {
  split: {
    label: 'Split',
    hint: 'One grid: each day is GitHub top-left and Local bottom-right.',
  },
  stacked: {
    label: 'Stacked',
    hint: 'One grid per source on the same weeks: GitHub, Local, then the board.',
  },
};

const SOURCE: Readonly<Record<HeatSource, string>> = {
  github: 'GitHub',
  local: 'Local',
  board: 'Board',
};

/** Phones open on 12 weeks: a year is 53 columns, and scrolls there. */
const PHONE = '(max-width: 40rem)';

function readDesign(viewerId: string): HeatDesign {
  try {
    return storedDesign(window.localStorage.getItem(designKey(viewerId)));
  } catch {
    return 'stacked';
  }
}

function keepDesign(viewerId: string, design: HeatDesign): void {
  try {
    window.localStorage.setItem(designKey(viewerId), design);
  } catch {
    // Private mode or blocked storage: the choice lasts the visit.
  }
}

function defaultRange(): ActivityRange {
  try {
    return window.matchMedia(PHONE).matches ? '12w' : '52w';
  } catch {
    return '52w';
  }
}

/** Today's UTC date: the skeleton's last column, before any answer says. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Only the organisation's switch hides GitHub and Local: since D-102 (amended,
 * LAI-963) collection follows it alone and the server sends `enabled` equal to
 * it, so `enabled` is not read here — a stale personal answer decides nothing.
 */
function offReason(sharing: ActivitySwitches): Off {
  return sharing.org_enabled ? null : 'org_off';
}

/**
 * The profile's *Activity* card (D-079, LAI-751): a daily heatmap of three
 * sources — pushed commits (GitHub, violet), local work (prompts, agent
 * sessions, commits not pushed; amber) and board actions (slate) — in two
 * designs a viewer chooses between, over 12 weeks or a year.
 *
 * ## Every number is the server's, every rule is `activity-derive.ts`'s
 *
 * One request per person and range (`GET /people/:id/activity`), kept by the
 * shared GET cache. This file lays the days out and handles the pointer and
 * the keyboard; which day goes where, how dark it is, the streaks and the
 * share pushed are pure functions with their own tests.
 *
 * ## Context only
 *
 * Nothing here is a score and nothing feeds the rating (D-079 item 6); the (i)
 * says so, and says what is never collected.
 */
export function ActivityCard({ userId, name, viewerId, canManageOrg, sharing }: ActivityCardProps) {
  const [range, setRange] = useState<ActivityRange>(defaultRange);
  const [design, setDesign] = useState<HeatDesign>(() => readDesign(viewerId));
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setDesign(readDesign(viewerId));
  }, [viewerId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    getPeopleActivity(userId, range, controller.signal)
      .then((activity) => {
        setLoad({ kind: 'ready', activity });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoad({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [userId, range, attempt]);

  const choose = (next: HeatDesign): void => {
    setDesign(next);
    keepDesign(viewerId, next);
  };

  const activity = load.kind === 'ready' ? load.activity : undefined;
  const days = useMemo(
    () => (activity === undefined ? emptyDays(todayUtc(), rangeDays(range)) : heatDays(activity)),
    [activity, range],
  );
  // The answer's switches once it has come, the profile's until then — the
  // same two, read a moment apart — so the skeleton is already this shape.
  const off = offReason(activity?.sharing ?? sharing);
  const noData =
    activity !== undefined &&
    off === null &&
    !days.some((d) => (d.github ?? 0) + (d.local ?? 0) > 0);
  const caption = RANGES.find((r) => r.value === range)?.caption ?? '';

  return (
    <section
      className="prof-card hm"
      data-section="activity"
      data-range={range}
      data-design={design}
      aria-labelledby="prof-activity-title"
      aria-busy={load.kind === 'loading'}
    >
      <header className="prof-card-head hm-head">
        <h3 className="prof-card-title" id="prof-activity-title">
          Activity
        </h3>
        <span className="prof-card-caption">{caption}</span>
        <InfoTip label="About activity">
          <ActivityDefinitions />
        </InfoTip>
        <span className="prof-card-actions hm-controls">
          <Segmented
            label="Design"
            name={`hm-design-${userId}`}
            value={design}
            options={HEAT_DESIGNS.map((d) => ({
              value: d,
              label: DESIGNS[d].label,
              hint: DESIGNS[d].hint,
            }))}
            onChange={choose}
          />
          <Segmented
            label="Range"
            name={`hm-range-${userId}`}
            value={range}
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            onChange={setRange}
          />
        </span>
      </header>

      {load.kind === 'error' ? (
        <div className="hm-error" role="alert">
          <p className="prof-empty">
            {load.error instanceof ApiError
              ? load.error.message
              : 'The activity could not be loaded.'}
          </p>
          <button
            type="button"
            className="prof-rate"
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <Heatmap
          key={`${userId}-${range}`}
          days={days}
          loading={load.kind === 'loading'}
          design={design}
          off={off}
          noData={noData}
          name={name}
          canManageOrg={canManageOrg}
        />
      )}
    </section>
  );
}

// -------------------------------------------------------------- the figure

interface HeatmapProps {
  readonly days: readonly HeatDay[];
  readonly loading: boolean;
  readonly design: HeatDesign;
  readonly off: Off;
  /** Developer insights on, and nothing from their machines in the range. */
  readonly noData: boolean;
  readonly name: string;
  readonly canManageOrg: boolean;
}

interface Hot {
  readonly index: number;
  readonly source: HeatSource;
  readonly cell: HTMLElement;
}

function Heatmap({ days, loading, design, off, noData, name, canManageOrg }: HeatmapProps) {
  const layout = useMemo(() => calendarLayout(days), [days]);
  const stats = useMemo(() => activityStats(days), [days]);
  const totals = useMemo(() => sourceTotals(days), [days]);
  const scales = useMemo(
    () => ({
      github: levelScale(days.map((d) => d.github)),
      local: levelScale(days.map((d) => d.local)),
      board: levelScale(days.map((d) => d.board)),
    }),
    [days],
  );

  const shown = off === null;
  // A: board actions live in the tooltip, unless they are all there is.
  const boardOnly = !shown;

  const [hot, setHot] = useState<Hot | null>(null);
  const [active, setActive] = useState(() => Math.max(0, days.length - 1));
  const focusNext = useRef<{ source: HeatSource; index: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);

  // The newest week in view: a year on a phone scrolls, and today is at its end.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [days.length, design]);

  // A month's label sticks beside the weekday column; while the next month
  // pushes it out it would slide under that column, so it is hidden for that
  // moment instead — a label is whole or not drawn, never half covered.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el === null) return;
    let frame = 0;
    const settle = (): void => {
      frame = 0;
      const corner = el.querySelector('.hm-corner')?.getBoundingClientRect().right ?? 0;
      for (const label of el.querySelectorAll<HTMLElement>('.hm-month-label')) {
        label.toggleAttribute('data-under', label.getBoundingClientRect().left < corner - 0.5);
      }
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(settle);
    };
    settle();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [days.length, design]);

  useEffect(() => {
    const want = focusNext.current;
    if (want === null) return;
    focusNext.current = null;
    document.getElementById(cellId(want.source, want.index))?.focus();
  });

  /*
   * The tooltip follows the mouse for the mouse and the focus for the
   * keyboard (LAI-761). A click focuses the cell too, and when focus also
   * showed the tooltip, the clicked day stayed open and outlined while the
   * mouse went elsewhere. So focus shows it only when the focus is visible —
   * the keyboard's — and leaving a grid hides it, not leaving the whole card.
   */
  const onPoint = useCallback((source: HeatSource, index: number, cell: HTMLElement | null) => {
    setHot((now) =>
      cell !== null
        ? { index, source, cell }
        : // A blur closes only its own day: the mouse may be on another.
          now !== null && now.index === index && now.source === source
          ? null
          : now,
    );
  }, []);

  const onLeave = useCallback(() => {
    setHot(null);
  }, []);

  const onKey = useCallback(
    (source: HeatSource, index: number, event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        setHot(null);
        return;
      }
      const next = moveIndex(index, event.key, days.length);
      if (next === null) return;
      event.preventDefault();
      focusNext.current = { source, index: next };
      setActive(next);
    },
    [days.length],
  );

  // B with GitHub and Local off is the board alone, under one panel saying
  // why — not two empty grids saying it twice (LAI-751).
  const sources: HeatSource[] =
    design === 'split' ? ['github'] : shown ? ['github', 'local', 'board'] : ['board'];
  // Every line that waits on the answer is already there, one line high.
  const total = (source: HeatSource): string =>
    loading ? '\u00a0' : noData && source !== 'board' ? NOTHING_YET : totalText(source, totals);
  const waiting = noData
    ? `Developer insights are on, and nothing has arrived from ${name}’s machines yet — they connect it with laika activity on.`
    : undefined;

  const style = { '--hm-cols': String(layout.columns) } as CSSProperties;
  const hotDay = hot === null ? undefined : days[hot.index];

  return (
    <div className="hm-body">
      <Stats stats={stats} loading={loading} shown={shown} />

      {off !== null && <OffPanel off={off} canManageOrg={canManageOrg} />}

      <div className="hm-figure">
        <div className="hm-scroll" ref={scroll}>
          <div className="hm-canvas" style={style}>
            <Months layout={layout} />
            {sources.map((source) => {
              const kind: GridKind = design === 'split' ? (boardOnly ? 'board' : 'split') : source;
              return (
                <div key={source} className="hm-block" data-source={kind}>
                  {design === 'stacked' && (
                    <BlockHead
                      source={source}
                      total={total(source)}
                      hint={source === 'board' ? undefined : waiting}
                    />
                  )}
                  <div className="hm-row">
                    <Weekdays />
                    {loading ? (
                      <Ghost columns={layout.columns} />
                    ) : (
                      <div className="hm-grid" data-kind={kind} onMouseLeave={onLeave}>
                        <Cells
                          placed={layout.placed}
                          kind={kind}
                          source={design === 'split' ? (boardOnly ? 'board' : 'github') : source}
                          scales={scales}
                          active={active}
                          onPoint={onPoint}
                          onKey={onKey}
                        />
                        {hot !== null && (
                          <Ring
                            placed={layout.placed[hot.index]}
                            twin={hot.source !== source && design === 'stacked'}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {design === 'split' && <SplitLegend boardOnly={boardOnly} total={total} hint={waiting} />}

      {hot !== null && hotDay !== undefined && <Tip day={hotDay} cell={hot.cell} />}
    </div>
  );
}

// ------------------------------------------------------------------ cells

type GridKind = 'split' | HeatSource;

function cellId(source: HeatSource, index: number): string {
  return `hm-${source}-${String(index)}`;
}

interface CellsProps {
  readonly placed: readonly Placed[];
  readonly kind: GridKind;
  /** The source this grid answers for, for focus and the cross-highlight. */
  readonly source: HeatSource;
  readonly scales: Readonly<Record<HeatSource, (value: number | null) => HeatLevel>>;
  readonly active: number;
  readonly onPoint: (source: HeatSource, index: number, cell: HTMLElement | null) => void;
  readonly onKey: (source: HeatSource, index: number, event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Every day of one grid. Memoised on its data and the focused day, so moving
 * the pointer — which only moves the ring and the tooltip — draws nothing here.
 */
const Cells = memo(function Cells({
  placed,
  kind,
  source,
  scales,
  active,
  onPoint,
  onKey,
}: CellsProps) {
  return (
    <>
      {placed.map(({ day, column, row }) => {
        const levels =
          kind === 'split'
            ? {
                'data-g':
                  day.github === null || day.github === 0 ? undefined : scales.github(day.github),
                'data-l':
                  day.local === null || day.local === 0 ? undefined : scales.local(day.local),
              }
            : {
                'data-v': scales[kind](
                  kind === 'github' ? day.github : kind === 'local' ? day.local : day.board,
                ),
              };
        return (
          <span
            key={day.day}
            id={cellId(source, day.index)}
            className="hm-cell"
            data-i={day.index}
            data-day={day.day}
            {...levels}
            role="img"
            aria-label={dayText(day)}
            tabIndex={day.index === active ? 0 : -1}
            style={{ gridColumn: column + 1, gridRow: row + 1 }}
            onMouseEnter={(event) => {
              onPoint(source, day.index, event.currentTarget);
            }}
            onFocus={(event) => {
              // The keyboard's focus, not a click's (LAI-761).
              if (event.currentTarget.matches(':focus-visible')) {
                onPoint(source, day.index, event.currentTarget);
              }
            }}
            onBlur={() => {
              onPoint(source, day.index, null);
            }}
            onKeyDown={(event) => {
              onKey(source, day.index, event);
            }}
          />
        );
      })}
    </>
  );
});

/** The pointed day, outlined in its own grid and in each of the others (B). */
function Ring({ placed, twin }: { readonly placed: Placed | undefined; readonly twin: boolean }) {
  if (placed === undefined) return null;
  return (
    <span
      className="hm-ring"
      data-twin={twin}
      aria-hidden="true"
      style={{ gridColumn: placed.column + 1, gridRow: placed.row + 1 }}
    />
  );
}

function Months({ layout }: { readonly layout: ReturnType<typeof calendarLayout> }) {
  return (
    <div className="hm-row hm-months-row" aria-hidden="true">
      <span className="hm-corner" />
      <div className="hm-months">
        {layout.months.map((month) => (
          <span
            key={`${month.label}-${String(month.column)}`}
            className="hm-month"
            style={{
              gridColumn: `${String(month.column + 1)} / span ${String(Math.max(1, month.span))}`,
            }}
          >
            <span className="hm-month-label">{month.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Weekdays() {
  return (
    <span className="hm-days" aria-hidden="true">
      {WEEKDAYS.map((day, i) => (
        <span key={day}>{i % 2 === 0 && i < 6 ? day : ''}</span>
      ))}
    </span>
  );
}

function Ramp({ source }: { readonly source: GridKind }) {
  return (
    <span className="hm-ramp" data-source={source} aria-hidden="true">
      Less
      {[0, 1, 2, 3, 4].map((level) => (
        <i key={level} data-v={level} />
      ))}
      More
    </span>
  );
}

type Totals = ReturnType<typeof sourceTotals>;

function totalText(source: HeatSource, totals: Totals): string {
  if (source === 'github') return plural(totals.pushed, 'commit pushed', 'commits pushed');
  if (source === 'local') {
    return [
      plural(totals.prompts, 'prompt', 'prompts'),
      plural(totals.sessions, 'session', 'sessions'),
      `${totals.unpushed.toLocaleString('en-GB')} not pushed`,
    ].join(' · ');
  }
  return [
    plural(totals.boardSelf, 'action by them', 'actions by them'),
    `${totals.boardAgent.toLocaleString('en-GB')} by their agents`,
  ].join(' · ');
}

function BlockHead({
  source,
  total,
  hint,
}: {
  readonly source: HeatSource;
  readonly total: string;
  readonly hint?: string | undefined;
}) {
  return (
    <div className="hm-block-head">
      <span className="hm-block-name">
        <i className="hm-key" data-source={source} aria-hidden="true" />
        {SOURCE[source]}
      </span>
      <span className="hm-total" title={hint ?? total}>
        {total}
      </span>
      <Ramp source={source} />
    </div>
  );
}

/** A source's name with its scale — never wrapped apart (LAI-751) — and its total. */
function LegendItem({
  source,
  total,
  hint,
}: {
  readonly source: HeatSource;
  readonly total: string;
  readonly hint?: string | undefined;
}) {
  return (
    <span className="hm-legend-item" data-source={source}>
      <span className="hm-key-group">
        <span className="hm-key-name">
          <i className="hm-key" data-source={source} aria-hidden="true" />
          {SOURCE[source]}
        </span>
        <Ramp source={source} />
      </span>
      <span className="hm-total" title={hint ?? total}>
        {total}
      </span>
    </span>
  );
}

function SplitLegend({
  boardOnly,
  total,
  hint,
}: {
  readonly boardOnly: boolean;
  readonly total: (source: HeatSource) => string;
  readonly hint?: string | undefined;
}) {
  if (boardOnly) {
    return (
      <p className="hm-legend">
        <LegendItem source="board" total={total('board')} />
      </p>
    );
  }
  return (
    <p className="hm-legend">
      <span className="hm-split-key">
        <i className="hm-sample" aria-hidden="true" />
        <span>
          Each day: <b>GitHub</b> top-left, <b>Local</b> bottom-right
        </span>
      </span>
      <LegendItem source="github" total={total('github')} hint={hint} />
      <LegendItem source="local" total={total('local')} hint={hint} />
    </p>
  );
}

// ---------------------------------------------------------------- states

function OrgLink({ canManageOrg }: { readonly canManageOrg: boolean }) {
  return canManageOrg ? (
    <a className="hm-link" href="/organisation">
      Turn on Developer insights in Organisation
    </a>
  ) : null;
}

/**
 * Why GitHub and Local are not drawn — one sentence for both, and the one way
 * to change it when the viewer has it (LAI-751). The Board grid follows.
 */
function OffPanel({
  off,
  canManageOrg,
}: {
  readonly off: Exclude<Off, null>;
  readonly canManageOrg: boolean;
}) {
  return (
    <p className="hm-off" data-off={off}>
      <span className="hm-off-keys" aria-hidden="true">
        <i className="hm-key" data-source="github" data-off="true" />
        <i className="hm-key" data-source="local" data-off="true" />
      </span>
      <span>
        <b>GitHub and Local are not shown:</b> Developer insights are off for this organisation.{' '}
        <OrgLink canManageOrg={canManageOrg} />
      </span>
    </p>
  );
}

/** A grid's footprint while its days are on their way. */
function Ghost({ columns }: { readonly columns: number }) {
  return (
    <div
      className="hm-ghost"
      aria-hidden="true"
      style={{ '--hm-cols': String(columns) } as CSSProperties}
    />
  );
}

// ------------------------------------------------------------------ stats

function Tile({
  name,
  label,
  value,
  sub,
  hint,
  children,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly sub?: string | undefined;
  readonly hint: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="prof-stat" data-stat={name} title={hint}>
      <dt className="prof-stat-label">{label}</dt>
      <dd className="prof-stat-value">{value}</dd>
      {/* Always there, a space while loading, so a tile is one height. */}
      <dd className="prof-stat-sub">{sub ?? '\u00a0'}</dd>
      {children}
    </div>
  );
}

function Stats({
  stats,
  loading,
  shown,
}: {
  readonly stats: ReturnType<typeof activityStats>;
  readonly loading: boolean;
  readonly shown: boolean;
}) {
  const dash = (value: string) => (loading ? '—' : value);
  const busiest = stats.busiestWeekday;
  const tied = busiest?.weekdays ?? [];
  const longest = stats.longestStreak;
  const pushed = stats.pushedPercent;
  return (
    <dl className="prof-stats hm-stats">
      <Tile
        name="active_days"
        label="Active days"
        value={dash(stats.activeDays.toLocaleString('en-GB'))}
        sub={loading ? undefined : `of ${String(stats.totalDays)}`}
        hint="Days with anything recorded in a source on show: a commit, a prompt, a session or a board action."
      />
      <Tile
        name="current_streak"
        label="Current streak"
        value={dash(String(stats.currentStreak))}
        sub={loading ? undefined : stats.currentStreak === 1 ? 'day' : 'days'}
        hint="Active days in a row up to today — or yesterday, when today has nothing yet."
      />
      <Tile
        name="longest_streak"
        label="Longest streak"
        value={dash(String(longest.days))}
        sub={
          loading
            ? undefined
            : `${longest.days === 1 ? 'day' : 'days'}${
                longest.from !== null && longest.to !== null
                  ? ` · ${spanLabel(longest.from, longest.to)}`
                  : ''
              }`
        }
        hint="The most active days in a row in this range."
      />
      <Tile
        name="busiest_weekday"
        label="Busiest weekday"
        // A tie is said, never settled quietly on the first (LAI-751): two
        // days by name, more as no single busiest day.
        value={
          loading || busiest === null || tied.length > 2
            ? '—'
            : tied.map((d) => WEEKDAYS[d] ?? '').join(', ')
        }
        sub={
          loading || busiest === null
            ? undefined
            : tied.length > 2
              ? 'no single busiest day'
              : `${String(busiest.active)} of ${String(busiest.of)}${tied.length > 1 ? ' each' : ''}`
        }
        hint={
          busiest === null
            ? 'The weekday with the most active days.'
            : `${tied.map((d) => weekdayName(d)).join(', ')}: ${tied.length > 1 ? 'each ' : ''}active on ${String(busiest.active)} of the ${String(busiest.of)} in this range.`
        }
      />
      <Tile
        name="pushed_share"
        label="Pushed vs local"
        value={loading || pushed === null ? '—' : `${String(pushed)}%`}
        sub={
          loading
            ? undefined
            : pushed === null
              ? shown
                ? 'no commits'
                : 'not collected'
              : `${String(100 - pushed)}% local only`
        }
        hint="Of their commits counted in this range, the share already on a remote; the rest exist only on their machine."
      >
        {/* Drawn empty while there is no share to show: the same height. */}
        <dd className="hm-split" data-empty={loading || pushed === null} aria-hidden="true">
          <i style={{ flexGrow: loading || pushed === null ? 0 : pushed }} />
          <i style={{ flexGrow: loading || pushed === null ? 0 : 100 - pushed }} />
        </dd>
      </Tile>
    </dl>
  );
}

// --------------------------------------------------------------- the tip

/** The pointed day's whole breakdown, beside its square, inside the viewport. */
function Tip({ day, cell }: { readonly day: HeatDay; readonly cell: HTMLElement }) {
  const tip = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const box = cell.getBoundingClientRect();
    const own = tip.current?.getBoundingClientRect();
    const width = own?.width ?? 260;
    const height = own?.height ?? 160;
    const left = Math.min(
      Math.max(8, box.left + box.width / 2 - width / 2),
      window.innerWidth - width - 8,
    );
    const below = box.bottom + 8;
    const top = below + height > window.innerHeight - 8 ? box.top - height - 8 : below;
    setPlace({ left, top: Math.max(8, top) });
  }, [cell, day]);

  const groups: { source: HeatSource; lines: ReturnType<typeof dayLines> }[] = (
    ['github', 'local', 'board'] as const
  ).map((source) => ({ source, lines: dayLines(day).filter((l) => l.source === source) }));

  return (
    <div
      ref={tip}
      className="hm-tip"
      role="tooltip"
      style={place === null ? { visibility: 'hidden' } : { left: place.left, top: place.top }}
    >
      <p className="hm-tip-date">{shortDate(day.day)}</p>
      {groups.map(({ source, lines }) => (
        <div key={source} className="hm-tip-group" data-source={source}>
          {lines.map((line) => (
            <p key={line.text} className="hm-tip-row" data-none={line.n === null || line.n === 0}>
              {line.n !== null && <b>{line.n.toLocaleString('en-GB')}</b>}
              <span>{line.text}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- bits

function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly name: string;
  readonly value: T;
  readonly options: readonly { value: T; label: string; hint?: string }[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <span className="prof-seg hm-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className="prof-seg-option" title={option.hint}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              onChange(option.value);
            }}
          />
          <span className="prof-seg-face">{option.label}</span>
        </label>
      ))}
    </span>
  );
}

function ActivityDefinitions() {
  return (
    <>
      <dl className="prof-defs">
        <div>
          <dt>GitHub</dt>
          <dd>
            Their commits already on a remote, counted on their own machine — Laika never calls
            GitHub. A commit seen from two machines counts once, on the day first reported.
          </dd>
        </div>
        <div>
          <dt>Local</dt>
          <dd>
            Prompts sent to agents, agent sessions started and commits not pushed yet, by the
            machine’s own date. Only while the organisation’s Developer insights are on, and only
            from a machine where <code>laika activity on</code> was run.
          </dd>
        </div>
        <div>
          <dt>Board</dt>
          <dd>
            Their actions on this board — by them on the web, and by their agents with their tokens
            — by UTC day. Always shown.
          </dd>
        </div>
        <div>
          <dt>Active day, streak</dt>
          <dd>
            A day with anything recorded in a source on show. The current streak runs to today, or
            to yesterday when today has nothing yet.
          </dd>
        </div>
      </dl>
      <p className="prof-defs-foot">
        Context only: none of this feeds a rating or a score. Never collected: prompt text, file or
        repository names, paths, branches, commit messages, emails or commit ids.
      </p>
    </>
  );
}
