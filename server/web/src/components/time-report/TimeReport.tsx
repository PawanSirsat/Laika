import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ApiError } from '../../api/errors.ts';
import {
  downloadTimeReportCsv,
  ENTRY_KINDS,
  getTimeReport,
  type EntryKind,
  type SpaceWeeksReport,
  type TimeReport as TimeReportData,
  type TimeReportAnswer,
  type TimeReportQuery,
} from '../../api/time.ts';
import { avatarColorSolid } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { SpaceBadge } from '../SpaceBadge.tsx';
import { Spinner } from '../Spinner.tsx';
import {
  agentTail,
  barKey,
  canSwap,
  childCount,
  counted,
  dayBars,
  dayLong,
  defaultGrouping,
  DIMENSION_LABELS,
  donutBackground,
  firstFocus,
  firstGroupings,
  groupRows,
  hoursClock,
  hoursWords,
  presetRange,
  RANGE_LABELS,
  RANGE_PRESETS,
  rangeProblem,
  refusalReason,
  REPORT_RANGES,
  secondGroupings,
  shownFor,
  slicesOf,
  statsOf,
  stepped,
  stepUnit,
  stretchLabel,
  stretchOf,
  weekLines,
  wholeWeeks,
  WITHHELD,
  type DayRange,
  type Dimension,
  type Face,
  type Grouping,
  type ReportRange,
  type ReportScope,
} from './time-report-derive.ts';
import './time-report.css';

/** A space as the Space filter offers it. */
export interface ReportSpace {
  readonly slug: string;
  readonly name: string;
}

export interface TimeReportProps {
  /** Where it is drawn: the reader's own, one person's, or everyone's. */
  readonly scope: ReportScope;
  /** Whose time: the reader for `me`, the person for `person`; absent for `org`. */
  readonly subject?: { readonly id: string; readonly name: string } | undefined;
  /** The reader's today, in their own zone. */
  readonly today: string;
  /** The day the stepper opens on; today when absent. */
  readonly anchor?: string | undefined;
  readonly initialRange?: ReportRange | undefined;
  /**
   * My day's Overview keeps Day as its own view (LAI-526), so picking Day
   * here hands back to it rather than drawing a one-day report.
   */
  readonly onDay?: (() => void) | undefined;
  /**
   * A space admin's view (D-136, D-138): the spaces they lead. The report is
   * then one of them at a time, whole weeks, one figure a week.
   */
  readonly ledSpaces?: readonly ReportSpace[] | undefined;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly key: string; readonly answer: TimeReportAnswer }
  | { readonly kind: 'error'; readonly key: string; readonly error: unknown };

interface Filters {
  readonly spaces: readonly string[];
  readonly members: readonly string[];
  readonly kinds: readonly EntryKind[];
}

const NO_FILTERS: Filters = { spaces: [], members: [], kinds: [] };

/** Kind words as the design's chips say them. */
const KIND_WORDS: Readonly<Record<EntryKind, string>> = {
  work: 'Work',
  meeting: 'Meeting',
  thinking: 'Thinking',
  research: 'Research',
  pairing: 'Pairing',
  review: 'Review',
  support: 'Support',
  admin: 'Admin',
};
const kindName = (kind: EntryKind): string => KIND_WORDS[kind];

const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** The server's sentence, as the profile convention has it, or a plain one. */
function errorSentence(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = refusalReason(error.details);
    if (reason === 'report_too_large') {
      return 'This range has more rows than the screen shows at once. Narrow the range or filter by space — Export CSV still has every row.';
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'The server did not answer.';
}

/**
 * The Time report (D-130, LAI-1138; the owner's design, frames 1a–1m): one
 * component in three places — My day → Overview (`me`), a person's *Time
 * report* tab (`person`) and Insights → Time (`org`, or a space admin's
 * weeks) — all from `GET /time/report`.
 *
 * The server decides what the reader may see; this groups and draws it.
 * Drafts are always read and the *Confirmed only / Include drafts* switch
 * counts them in or out here, so switching costs no request and *Nothing
 * confirmed — Include drafts* can be offered. Space, Member and Kind narrow
 * the read on the server, so the bars and the agent line follow them.
 */
export function TimeReport({
  scope,
  subject,
  today,
  anchor: openOn,
  initialRange,
  onDay,
  ledSpaces,
}: TimeReportProps) {
  const ids = useId();
  const weekly = ledSpaces !== undefined;
  const [range, setRange] = useState<ReportRange>(
    initialRange ?? (weekly ? 'month' : scope === 'org' ? 'range' : 'week'),
  );
  const [anchor, setAnchor] = useState(openOn ?? today);
  const [picked, setPicked] = useState<DayRange>(() => presetRange('last30', today));
  const [drafts, setDrafts] = useState(!weekly);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [space, setSpace] = useState<string | undefined>(ledSpaces?.[0]?.slug);
  const [pop, setPop] = useState<string | undefined>();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [csv, setCsv] = useState<{ busy: boolean; error?: string }>({ busy: false });
  // Names seen for this reader, so a filter keeps offering what it narrowed away.
  const [seenSpaces, setSeenSpaces] = useState<ReadonlyMap<string, string>>(new Map());
  const [seenPeople, setSeenPeople] = useState<ReadonlyMap<string, string>>(new Map());

  const shownRange: DayRange = stretchOf(range, anchor, picked);
  const stretch = weekly ? wholeWeeks(shownRange) : shownRange;
  const problem = range === 'range' ? rangeProblem(shownRange) : undefined;

  // A personal report with nobody named would be everyone's: never sent.
  const unnamed = scope !== 'org' && subject === undefined;
  const query: TimeReportQuery | undefined =
    problem !== undefined || unnamed || (weekly && space === undefined)
      ? undefined
      : weekly
        ? { from: stretch.from, to: stretch.to, spaces: space === undefined ? [] : [space] }
        : {
            from: stretch.from,
            to: stretch.to,
            spaces: filters.spaces,
            members: scope === 'org' || subject === undefined ? filters.members : [subject.id],
            kinds: filters.kinds,
            drafts: true,
          };
  const key = query === undefined ? '' : JSON.stringify(query);

  useEffect(() => {
    if (query === undefined) return;
    const controller = new AbortController();
    setLoad((was) => (was.kind === 'ready' && was.key === key ? was : { kind: 'loading' }));
    getTimeReport(query, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setLoad({ kind: 'ready', key, answer });
        if (answer.scope !== 'space_totals') {
          setSeenSpaces((was) => {
            const next = new Map(was);
            for (const r of answer.rows)
              if (r.project !== null) next.set(r.project.slug, r.project.name);
            return next.size === was.size ? was : next;
          });
          setSeenPeople((was) => {
            const next = new Map(was);
            for (const r of answer.rows) next.set(r.user.id, r.user.name);
            return next.size === was.size ? was : next;
          });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ kind: 'error', key, error });
      },
    );
    return () => {
      controller.abort();
    };
    // `key` is the query, whole.
  }, [key, attempt]);

  const label = stretchLabel(range, weekly ? stretch : shownRange);
  const spaceName = ledSpaces?.find((s) => s.slug === space)?.name;
  const title = scope === 'me' ? 'Overview' : scope === 'person' ? 'Time report' : 'Time';
  const caption =
    weekly && spaceName !== undefined
      ? `${spaceName} · ${label}`
      : scope === 'org'
        ? `Everyone · ${label}`
        : scope === 'person' && subject !== undefined
          ? `${subject.name} · ${label}`
          : label;

  const unit = stepUnit(range, shownRange);
  const nextDisabled = (weekly ? stretch : shownRange).to >= today;
  const ranges = weekly ? REPORT_RANGES.filter((r) => r !== 'day') : REPORT_RANGES;
  const filtersOn = filters.spaces.length + filters.members.length + filters.kinds.length > 0;
  const answer = load.kind === 'ready' && load.key === key ? load.answer : undefined;
  const ready = answer !== undefined;
  const nothing =
    answer === undefined
      ? true
      : answer.scope === 'space_totals'
        ? answer.weeks.every((w) => (w.confirmed_minutes ?? 0) === 0)
        : counted(answer.totals, drafts) === 0;

  const exportCsv = (): void => {
    if (query === undefined) return;
    setCsv({ busy: true });
    downloadTimeReportCsv(weekly ? query : { ...query, drafts }).then(
      () => {
        setCsv({ busy: false });
      },
      (error: unknown) => {
        setCsv({ busy: false, error: errorSentence(error) });
      },
    );
  };

  const chipOptions = {
    space: weekly
      ? (ledSpaces ?? []).map((s) => ({ value: s.slug, label: s.name, space: s }))
      : [...seenSpaces]
          .sort((a, b) => a[1].localeCompare(b[1]))
          .map(([slug, name]) => ({ value: slug, label: name, space: { slug, name } })),
    member: [...seenPeople]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ value: id, label: name, person: { id, name } })),
    kind: ENTRY_KINDS.map((k) => ({ value: k, label: kindName(k), kind: k })),
  };

  return (
    <section
      className="tr"
      aria-labelledby={`${ids}-title`}
      aria-busy={load.kind === 'loading'}
      data-time-report={weekly ? 'space' : scope}
    >
      <header className="tr-head">
        <div className="tr-titles">
          <h2 className="tr-title" id={`${ids}-title`}>
            {title}
          </h2>
          <span className="tr-caption" data-tr-caption>
            {caption}
          </span>
          {scope === 'person' && (
            <span className="tr-lock" data-tr-lock>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
              </svg>
              Visible to owners and admins · they can see you looked
            </span>
          )}
        </div>
        <div className="tr-segments" role="radiogroup" aria-label="Range">
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              className={range === r ? 'tr-segment tr-segment-on' : 'tr-segment'}
              data-tr-range={r}
              onClick={() => {
                if (r === 'day' && onDay !== undefined) {
                  onDay();
                  return;
                }
                setRange(r);
                setAnchor(openOn ?? today);
              }}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </header>

      <div className="tr-bar" role="toolbar" aria-label="Report controls">
        <div className="tr-stepper">
          <button
            type="button"
            className="tr-step"
            aria-label={`Previous ${unit}`}
            data-tr-prev
            onClick={() => {
              const s = stepped(range, anchor, picked, -1);
              setAnchor(s.anchor);
              setPicked(s.picked);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <span className="tr-range-label" aria-live="polite" data-tr-label>
            {label}
          </span>
          <button
            type="button"
            className="tr-step"
            aria-label={`Next ${unit}`}
            disabled={nextDisabled}
            data-tr-next
            onClick={() => {
              const s = stepped(range, anchor, picked, 1);
              setAnchor(s.anchor);
              setPicked(s.picked);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>
        <span className="tr-divider" aria-hidden="true" />
        {weekly ? (
          <Chip
            id="space"
            name="Space"
            value={spaceName ?? 'None'}
            on
            open={pop === 'space'}
            onToggle={setPop}
          >
            <div role="radiogroup" aria-label="Space">
              {chipOptions.space.map((o) => (
                <label key={o.value} className="tr-option">
                  <input
                    type="radio"
                    name={`${ids}-space`}
                    checked={space === o.value}
                    onChange={() => {
                      setSpace(o.value);
                      setPop(undefined);
                    }}
                  />
                  <SpaceBadge slug={o.space.slug} name={o.space.name} />
                  <span className="tr-option-label">{o.label}</span>
                </label>
              ))}
            </div>
          </Chip>
        ) : (
          <>
            <FilterChip
              id="space"
              name="Space"
              options={chipOptions.space.map((o) => ({
                value: o.value,
                label: o.label,
                mark: <SpaceBadge slug={o.space.slug} name={o.space.name} />,
              }))}
              selected={filters.spaces}
              open={pop === 'space'}
              onToggle={setPop}
              onChange={(spaces) => {
                setFilters((f) => ({ ...f, spaces }));
              }}
            />
            {scope === 'org' && (
              <FilterChip
                id="member"
                name="Member"
                options={chipOptions.member.map((o) => ({
                  value: o.value,
                  label: o.label,
                  mark: <Avatar id={o.person.id} name={o.person.name} />,
                }))}
                selected={filters.members}
                open={pop === 'member'}
                onToggle={setPop}
                onChange={(members) => {
                  setFilters((f) => ({ ...f, members }));
                }}
              />
            )}
            <FilterChip
              id="kind"
              name="Kind"
              options={chipOptions.kind.map((o) => ({
                value: o.value,
                label: o.label,
                mark: <span className={`tr-dot tr-kind-${o.kind}`} aria-hidden="true" />,
              }))}
              selected={filters.kinds}
              open={pop === 'kind'}
              onToggle={setPop}
              onChange={(kinds) => {
                setFilters((f) => ({ ...f, kinds: kinds as EntryKind[] }));
              }}
            />
          </>
        )}
        <div className="tr-bar-end">
          {!weekly && (
            <div className="tr-segments" role="radiogroup" aria-label="Which time to count">
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={drafts === v}
                  className={drafts === v ? 'tr-segment tr-segment-on' : 'tr-segment'}
                  data-tr-drafts={v ? 'include' : 'exclude'}
                  onClick={() => {
                    setDrafts(v);
                  }}
                >
                  {v ? 'Include drafts' : 'Confirmed only'}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="tr-export"
            disabled={!ready || nothing || csv.busy}
            aria-busy={csv.busy}
            data-tr-export
            onClick={exportCsv}
          >
            {csv.busy ? (
              <Spinner size="sm" />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            )}
            Export CSV
          </button>
        </div>
      </div>
      {csv.error !== undefined && (
        <p className="tr-note tr-note-error" role="alert" data-tr-csv-error>
          <b>The file could not be made.</b> {csv.error}
        </p>
      )}

      {range === 'range' && (
        <div className="tr-picker" data-tr-picker>
          <div className="tr-presets" role="group" aria-label="Quick picks">
            {RANGE_PRESETS.map(([preset, words]) => {
              const days = presetRange(preset, today);
              const on = days.from === picked.from && days.to === picked.to;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'tr-preset tr-preset-on' : 'tr-preset'}
                  data-tr-preset={preset}
                  onClick={() => {
                    setPicked(days);
                  }}
                >
                  {words}
                </button>
              );
            })}
          </div>
          <div className="tr-dates">
            <label className="tr-date">
              <span className="tr-date-label">From</span>
              <input
                type="date"
                className="input tr-date-input"
                value={picked.from}
                max={today}
                data-tr-from
                onChange={(event) => {
                  setPicked({ from: event.target.value, to: picked.to });
                }}
              />
            </label>
            <span className="tr-quiet" aria-hidden="true">
              –
            </span>
            <label className="tr-date">
              <span className="tr-date-label">To</span>
              <input
                type="date"
                className="input tr-date-input"
                value={picked.to}
                min={picked.from}
                max={today}
                data-tr-to
                onChange={(event) => {
                  setPicked({ from: picked.from, to: event.target.value });
                }}
              />
            </label>
          </div>
        </div>
      )}

      {problem !== undefined ? (
        <p className="tr-note tr-note-error" role="alert" data-tr-problem>
          {problem}
        </p>
      ) : weekly && space === undefined ? (
        <p className="tr-note" data-tr-no-space>
          You lead no space, so there is no week to show.
        </p>
      ) : load.kind === 'error' && load.key === key ? (
        <div className="tr-error" role="alert" data-tr-error>
          <span>
            <b>This range could not be read.</b> {errorSentence(load.error)} Nothing on the board
            changed.
          </span>
          <button
            type="button"
            className="tr-pill-button"
            data-tr-retry
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : answer === undefined ? (
        <Reading />
      ) : answer.scope === 'space_totals' ? (
        <Weeks report={answer} />
      ) : (
        <Figures
          report={answer}
          scope={scope}
          drafts={drafts}
          filtered={filtersOn}
          today={today}
          label={label}
          firstName={subject === undefined ? '' : firstNameOf(subject.name)}
          ids={ids}
          onLast30={() => {
            setRange('range');
            setPicked(presetRange('last30', today));
          }}
          onClear={() => {
            setFilters(NO_FILTERS);
          }}
          onDrafts={() => {
            setDrafts(true);
          }}
        />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ chips

interface ChipProps {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly on: boolean;
  readonly open: boolean;
  readonly onToggle: (id: string | undefined) => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

/**
 * A filter chip and its panel: Escape closes it and gives focus back to the
 * chip; a click anywhere else closes it too.
 */
function Chip({ id, name, value, on, open, onToggle, children, footer }: ChipProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || wrap.current?.contains(event.target) !== true) {
        onToggle(undefined);
      }
    };
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('pointerdown', away);
    };
  }, [open, onToggle]);
  return (
    <div
      ref={wrap}
      className="tr-chip-wrap"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          onToggle(undefined);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={on ? 'tr-chip tr-chip-on' : 'tr-chip'}
        aria-haspopup="true"
        aria-expanded={open}
        data-tr-chip={id}
        onClick={() => {
          onToggle(open ? undefined : id);
        }}
      >
        <span>{name}</span>
        <span className="tr-chip-value">{value}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="tr-pop" role="group" aria-label={`Filter by ${name.toLowerCase()}`}>
          {children}
          {footer}
        </div>
      )}
    </div>
  );
}

interface FilterChipProps {
  readonly id: string;
  readonly name: string;
  readonly options: readonly { value: string; label: string; mark: ReactNode }[];
  readonly selected: readonly string[];
  readonly open: boolean;
  readonly onToggle: (id: string | undefined) => void;
  readonly onChange: (selected: readonly string[]) => void;
}

function FilterChip({ id, name, options, selected, open, onToggle, onChange }: FilterChipProps) {
  const on = selected.length > 0;
  const value = !on
    ? 'All'
    : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? '1 selected')
      : `${String(selected.length)} selected`;
  return (
    <Chip
      id={id}
      name={name}
      value={value}
      on={on}
      open={open}
      onToggle={onToggle}
      footer={
        <div className="tr-pop-foot">
          <button
            type="button"
            className="tr-link-button"
            onClick={() => {
              onChange([]);
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="tr-link-button tr-link-accent"
            onClick={() => {
              onToggle(undefined);
            }}
          >
            Done
          </button>
        </div>
      }
    >
      {options.length === 0 ? (
        <p className="tr-quiet tr-pop-empty">Nothing in this range yet.</p>
      ) : (
        options.map((o) => (
          <label key={o.value} className="tr-option" data-tr-option={o.value}>
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={() => {
                onChange(
                  selected.includes(o.value)
                    ? selected.filter((v) => v !== o.value)
                    : [...selected, o.value],
                );
              }}
            />
            {o.mark}
            <span className="tr-option-label">{o.label}</span>
          </label>
        ))
      )}
    </Chip>
  );
}

function Avatar({ id, name }: { readonly id: string; readonly name: string }) {
  const { theme } = useTheme();
  const colour = avatarColorSolid(id, theme);
  return (
    <span
      className="tr-avatar"
      style={{ background: colour.background, color: colour.foreground }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

function Mark({ face }: { readonly face: Face }) {
  if (face.space !== undefined) return <SpaceBadge slug={face.space.slug} name={face.space.name} />;
  if (face.person !== undefined) return <Avatar id={face.person.id} name={face.person.name} />;
  if (face.kind !== undefined) {
    return <span className={`tr-dot tr-kind-${face.kind}`} aria-hidden="true" />;
  }
  if (face.none === true) return <span className="tr-dashed" aria-hidden="true" />;
  return null;
}

// ----------------------------------------------------------------- states

/** The figures being read, in bones (frame 1j), and said once to a screen reader. */
function Reading() {
  return (
    <div className="tr-reading" data-tr-loading>
      <div className="tr-stats" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="tr-stat">
            <span className="tr-bone tr-bone-a" />
            <span className="tr-bone tr-bone-b" />
            <span className="tr-bone tr-bone-c" />
          </span>
        ))}
      </div>
      <div className="tr-bone-bars" aria-hidden="true">
        {[62, 40, 74, 55, 30, 8, 8].map((h, i) => (
          <span key={i} className="tr-bone tr-bone-bar" style={{ height: `${String(h)}%` }} />
        ))}
      </div>
      <p className="visually-hidden" role="status">
        Reading the time for this range…
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- figures

interface FiguresProps {
  readonly report: TimeReportData;
  readonly scope: ReportScope;
  readonly drafts: boolean;
  readonly filtered: boolean;
  readonly today: string;
  readonly label: string;
  readonly firstName: string;
  readonly ids: string;
  readonly onLast30: () => void;
  readonly onClear: () => void;
  readonly onDrafts: () => void;
}

function Figures({
  report,
  scope,
  drafts,
  filtered,
  today,
  label,
  firstName,
  ids,
  onLast30,
  onClear,
  onDrafts,
}: FiguresProps) {
  const shown = shownFor(report, drafts, filtered);
  const showFigures = shown.kind === 'figures';
  const empty =
    shown.kind === 'empty'
      ? {
          title: 'No time in this range',
          sub: `Nothing was tracked or drafted, ${label}.`,
          action: 'Show the last 30 days',
          act: onLast30,
          state: 'empty',
        }
      : shown.kind === 'filtered-empty'
        ? {
            title: 'No time matches these filters',
            sub: 'Every day is still shown, so the gaps read as gaps.',
            action: 'Clear filters',
            act: onClear,
            state: 'filtered',
          }
        : shown.kind === 'unconfirmed'
          ? {
              title: 'Nothing confirmed in this range',
              sub: `${hoursWords(shown.drafted)} of drafts are waiting.`,
              action: 'Include drafts',
              act: onDrafts,
              state: 'unconfirmed',
            }
          : undefined;
  const partialTail =
    scope === 'me'
      ? 'Confirm a day from the Timeline to settle it.'
      : scope === 'person'
        ? `${firstName} has not confirmed these yet.`
        : 'People have not confirmed these yet.';

  return (
    <>
      {shown.kind === 'figures' && shown.draftsOnly && (
        <p className="tr-note tr-note-info" role="note" data-tr-partial>
          <b>Drafts only.</b> Nothing in this range is confirmed yet, so every figure below is
          drafted time, drawn hatched. {partialTail}
        </p>
      )}
      {showFigures && (
        <Strip report={report} scope={scope} drafts={drafts} today={today} firstName={firstName} />
      )}
      <Chart
        report={report}
        drafts={drafts}
        today={today}
        label={label}
        id={`${ids}-chart`}
        empty={
          empty === undefined ? undefined : (
            <div className="tr-empty" data-tr-empty={empty.state}>
              <p className="tr-empty-title">{empty.title}</p>
              <p className="tr-empty-sub">{empty.sub}</p>
              <button type="button" className="tr-pill-button" onClick={empty.act}>
                {empty.action}
              </button>
            </div>
          )
        }
      />
      {showFigures && (
        <Breakdown report={report} scope={scope} drafts={drafts} label={label} ids={ids} />
      )}
    </>
  );
}

function Strip({
  report,
  scope,
  drafts,
  today,
  firstName,
}: {
  readonly report: TimeReportData;
  readonly scope: ReportScope;
  readonly drafts: boolean;
  readonly today: string;
  readonly firstName: string;
}) {
  const stats = statsOf(report, drafts, scope, today, firstName);
  const agent = report.agent_minutes;
  return (
    <>
      <ul className="tr-stats" aria-label="Figures">
        {stats.map((s) => (
          <li key={s.key} className="tr-stat" data-tr-stat={s.key}>
            <span className="tr-stat-label">{s.label}</span>
            <span className="tr-stat-value">{s.value}</span>
            <span className="tr-stat-sub">{s.sub}</span>
          </li>
        ))}
      </ul>
      {agent !== null && agent > 0 && (
        <p className="tr-agent" data-tr-agent>
          <span className="tr-agent-mark" aria-hidden="true">
            ›_
          </span>
          <span>
            <b>Agents · {String(agent)} min on cards</b> — {agentTail(scope, firstName)}
          </span>
        </p>
      )}
    </>
  );
}

function Chart({
  report,
  drafts,
  today,
  label,
  id,
  empty,
}: {
  readonly report: TimeReportData;
  readonly drafts: boolean;
  readonly today: string;
  readonly label: string;
  readonly id: string;
  readonly empty: ReactNode;
}) {
  const { bars, axis } = useMemo(
    () => dayBars(report.by_day, drafts, today),
    [report.by_day, drafts, today],
  );
  const [focusAt, setFocusAt] = useState<number | undefined>();
  const [hover, setHover] = useState<number | undefined>();
  const group = useRef<HTMLDivElement>(null);
  const at = focusAt !== undefined && focusAt < bars.length ? focusAt : firstFocus(bars);
  const n = bars.length;
  const tip = hover === undefined ? undefined : bars[hover];
  const gap = n <= 7 ? 'tr-bars-wide' : n <= 31 ? 'tr-bars-mid' : 'tr-bars-dense';

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const to = barKey(event.key, at, n);
    if (to === undefined) return;
    event.preventDefault();
    setFocusAt(to);
    group.current?.querySelectorAll('button')[to]?.focus();
  };

  return (
    <section className="tr-chart" aria-labelledby={id} data-tr-chart>
      <div className="tr-chart-head">
        <h3 className="tr-h3" id={id}>
          Hours per day
        </h3>
        <div className="tr-legend" aria-hidden="true">
          <span className="tr-legend-item">
            <span className="tr-swatch tr-swatch-confirmed" />
            Confirmed
          </span>
          {drafts && (
            <span className="tr-legend-item">
              <span className="tr-swatch tr-swatch-drafted" />
              Drafted
            </span>
          )}
        </div>
      </div>
      <div className="tr-plot">
        <div className="tr-axis" aria-hidden="true">
          {axis.lines.map((g) => (
            <span key={g.label} className="tr-axis-label" style={{ bottom: `${String(g.pct)}%` }}>
              {g.label}
            </span>
          ))}
        </div>
        <div className="tr-area">
          {axis.lines.map((g) => (
            <span
              key={g.label}
              className="tr-gridline"
              aria-hidden="true"
              style={{ bottom: `${String(g.pct)}%` }}
            />
          ))}
          <div
            ref={group}
            className={`tr-bars ${gap}`}
            role="group"
            aria-label={`Hours per day, ${label}. Use the arrow keys to move between days.`}
            onKeyDown={onKey}
          >
            {bars.map((b, i) => (
              <button
                key={b.day}
                type="button"
                className={
                  hover === i || (focusAt === i && hover === undefined)
                    ? 'tr-col tr-col-on'
                    : 'tr-col'
                }
                tabIndex={i === at ? 0 : -1}
                aria-label={b.aria}
                title={b.aria}
                data-tr-day={b.day}
                onMouseEnter={() => {
                  setHover(i);
                }}
                onMouseLeave={() => {
                  setHover(undefined);
                }}
                onFocus={() => {
                  setFocusAt(i);
                }}
              >
                <span
                  className={b.future ? 'tr-stack tr-stack-future' : 'tr-stack'}
                  style={{ height: `${String(b.height)}%` }}
                >
                  <span
                    className="tr-fill-confirmed"
                    style={{ flexBasis: `${String(b.confirmedPct)}%` }}
                  />
                  <span
                    className="tr-fill-drafted"
                    style={{ flexBasis: `${String(b.draftedPct)}%` }}
                  />
                </span>
              </button>
            ))}
          </div>
          {tip !== undefined && hover !== undefined && (
            <div
              className="tr-tip"
              aria-hidden="true"
              style={{
                left: `${String(Math.min(90, Math.max(10, ((hover + 0.5) / n) * 100)))}%`,
                bottom: `calc(${String(Math.min(80, tip.height))}% + 0.5rem)`,
              }}
            >
              <span className="tr-tip-date">{dayLong(tip.day)}</span>
              <span className="tr-tip-total">{tip.future ? '—' : hoursWords(tip.total)}</span>
              <span className="tr-tip-sub">
                {tip.future
                  ? 'Not yet'
                  : tip.total === 0
                    ? 'No time'
                    : drafts && tip.drafted > 0
                      ? `${hoursWords(tip.confirmed)} confirmed · ${hoursWords(tip.drafted)} drafted`
                      : `${hoursWords(tip.confirmed)} confirmed`}
              </span>
            </div>
          )}
          {empty}
        </div>
        <span />
        <div className={`tr-day-names ${gap}`} aria-hidden="true">
          {bars.map((b) => (
            <span
              key={b.day}
              className={
                b.today
                  ? 'tr-day-name tr-day-today'
                  : b.future || b.weekend
                    ? 'tr-day-name tr-day-quiet'
                    : 'tr-day-name'
              }
            >
              <span>{b.top}</span>
              <span className="tr-mono">{b.bottom}</span>
            </span>
          ))}
        </div>
      </div>
      <table className="visually-hidden" data-tr-day-table>
        <caption>Hours per day, {label}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Confirmed</th>
            {drafts && <th scope="col">Drafted</th>}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.day}>
              <th scope="row">{dayLong(b.day)}</th>
              <td>{b.future ? 'not yet' : hoursWords(b.confirmed)}</td>
              {drafts && <td>{b.future ? 'not yet' : hoursWords(b.drafted)}</td>}
              <td>{b.future ? 'not yet' : hoursWords(b.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// --------------------------------------------------------- the breakdown

function GroupMenu({
  id,
  aria,
  current,
  options,
  open,
  onToggle,
  onPick,
}: {
  readonly id: string;
  readonly aria: string;
  readonly current: Grouping;
  readonly options: readonly Grouping[];
  readonly open: boolean;
  readonly onToggle: (id: string | undefined) => void;
  readonly onPick: (g: Grouping) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const away = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || wrap.current?.contains(event.target) !== true) {
        onToggle(undefined);
      }
    };
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('pointerdown', away);
    };
  }, [open, onToggle]);
  return (
    <div
      ref={wrap}
      className="tr-chip-wrap"
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          onToggle(undefined);
          button.current?.focus();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
          const now = items.findIndex((b) => b === document.activeElement);
          const next = event.key === 'ArrowDown' ? now + 1 : now - 1;
          items[(next + items.length) % items.length]?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="tr-chip tr-chip-strong"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${aria}: ${DIMENSION_LABELS[current]}`}
        data-tr-group={id}
        onClick={() => {
          onToggle(open ? undefined : id);
        }}
      >
        {DIMENSION_LABELS[current]}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div ref={menu} className="tr-pop tr-menu" role="menu" aria-label={aria}>
          {options.map((g) => (
            <button
              key={g}
              type="button"
              role="menuitemradio"
              aria-checked={g === current}
              className={g === current ? 'tr-menu-item tr-menu-item-on' : 'tr-menu-item'}
              data-tr-group-option={g}
              onClick={() => {
                onPick(g);
                onToggle(undefined);
                button.current?.focus();
              }}
            >
              {DIMENSION_LABELS[g]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Breakdown({
  report,
  scope,
  drafts,
  label,
  ids,
}: {
  readonly report: TimeReportData;
  readonly scope: ReportScope;
  readonly drafts: boolean;
  readonly label: string;
  readonly ids: string;
}) {
  const [[first, second], setGrouping] = useState<readonly [Dimension, Grouping]>(() =>
    defaultGrouping(scope),
  );
  const [open, setOpen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [menu, setMenu] = useState<string | undefined>();
  const [active, setActive] = useState<string | undefined>();
  const groups = useMemo(
    () => groupRows(report.rows, first, second, drafts, kindName),
    [report.rows, first, second, drafts],
  );
  const slices = slicesOf(groups);
  const split = drafts;
  const sum = groups.reduce(
    (t, g) => ({ c: t.c + g.confirmed, d: t.d + g.drafted, t: t.t + g.total }),
    { c: 0, d: 0, t: 0 },
  );
  const donutTitle = `By ${DIMENSION_LABELS[first].toLowerCase()}`;
  const spoken = `${donutTitle}: ${slices.map((s) => `${s.label} ${hoursWords(s.minutes)} (${s.pct})`).join(', ')}`;
  const tableLabel = `Time by ${DIMENSION_LABELS[first].toLowerCase()}${
    second === 'none' ? '' : ` then ${DIMENSION_LABELS[second].toLowerCase()}`
  }, ${label}`;

  return (
    <div className="tr-breakdown">
      <section className="tr-table-wrap" aria-labelledby={`${ids}-group`} data-tr-table>
        <div className="tr-group-bar">
          <h3 className="tr-group-title" id={`${ids}-group`}>
            Group by
          </h3>
          <GroupMenu
            id="first"
            aria="First grouping"
            current={first}
            options={firstGroupings(scope)}
            open={menu === 'first'}
            onToggle={setMenu}
            onPick={(g) => {
              if (g === 'none') return;
              setGrouping(([was, then]) => [g, then === g ? was : then]);
              setOpen(new Map());
            }}
          />
          <span>then</span>
          <GroupMenu
            id="second"
            aria="Second grouping"
            current={second}
            options={secondGroupings(scope, first)}
            open={menu === 'second'}
            onToggle={setMenu}
            onPick={(g) => {
              setGrouping(([f]) => [f, g]);
              setOpen(new Map());
            }}
          />
          <button
            type="button"
            className="tr-swap"
            aria-label="Swap the two groupings"
            disabled={!canSwap(scope, second)}
            data-tr-swap
            onClick={() => {
              if (second === 'none') return;
              setGrouping([second, first]);
              setOpen(new Map());
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7h12l-3-3M17 17H5l3 3" />
            </svg>
            Swap
          </button>
          {(first === 'member' || second === 'member') && (
            <span className="tr-quiet tr-small">People are listed A–Z</span>
          )}
        </div>

        <div
          className={split ? 'tr-table tr-table-split' : 'tr-table'}
          role="table"
          aria-label={tableLabel}
        >
          <div role="rowgroup">
            <div role="row" className="tr-row tr-row-head">
              <span role="columnheader">{DIMENSION_LABELS[first]}</span>
              {split && (
                <>
                  <span role="columnheader" className="tr-num">
                    Confirmed
                  </span>
                  <span role="columnheader" className="tr-num">
                    Drafted
                  </span>
                </>
              )}
              <span role="columnheader" className="tr-num">
                Total
              </span>
            </div>
          </div>
          <div role="rowgroup">
            {groups.map((g, i) => {
              const leaf = g.children.length === 0;
              const isOpen = !leaf && (open.get(g.face.key) ?? i === 0);
              const meta = childCount(second, g.children.length);
              return (
                <div key={g.face.key} className="tr-group" data-tr-row={g.face.key}>
                  <div role="row" className="tr-row">
                    <span role="rowheader" className="tr-cell-name">
                      <button
                        type="button"
                        className="tr-row-toggle"
                        aria-expanded={leaf ? undefined : isOpen}
                        disabled={leaf}
                        onClick={() => {
                          setOpen((m) => new Map(m).set(g.face.key, !isOpen));
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className={
                            isOpen
                              ? 'tr-chev tr-chev-open'
                              : leaf
                                ? 'tr-chev tr-chev-none'
                                : 'tr-chev'
                          }
                        >
                          <path d="m9 6 6 6-6 6" />
                        </svg>
                        <span
                          className="tr-swatch"
                          style={{ background: g.color }}
                          aria-hidden="true"
                        />
                        <Mark face={g.face} />
                        {g.face.code !== undefined && (
                          <span className="tr-code">{g.face.code}</span>
                        )}
                        <span className="tr-row-label">{g.face.label}</span>
                        {meta !== '' && <span className="tr-row-meta">{meta}</span>}
                      </button>
                    </span>
                    {split && (
                      <>
                        <span role="cell" className="tr-num tr-num-quiet">
                          {hoursClock(g.confirmed)}
                        </span>
                        <span role="cell" className="tr-num tr-num-quiet">
                          {hoursClock(g.drafted)}
                        </span>
                      </>
                    )}
                    <span role="cell" className="tr-num tr-num-strong">
                      {hoursClock(g.total)}
                    </span>
                  </div>
                  {isOpen &&
                    g.children.map((k) => (
                      <div
                        role="row"
                        key={k.face.key}
                        className="tr-row tr-row-child"
                        data-tr-child={k.face.key}
                      >
                        <span role="rowheader" className="tr-cell-name tr-cell-child">
                          <Mark face={k.face} />
                          {k.face.code !== undefined && (
                            <span className="tr-code">{k.face.code}</span>
                          )}
                          <span className="tr-row-label tr-quiet-text">{k.face.label}</span>
                        </span>
                        {split && (
                          <>
                            <span role="cell" className="tr-num tr-num-muted">
                              {hoursClock(k.confirmed)}
                            </span>
                            <span role="cell" className="tr-num tr-num-muted">
                              {hoursClock(k.drafted)}
                            </span>
                          </>
                        )}
                        <span role="cell" className="tr-num tr-num-quiet">
                          {hoursClock(k.total)}
                        </span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
          <div role="rowgroup">
            <div role="row" className="tr-row tr-row-total" data-tr-total>
              <span role="rowheader">Total</span>
              {split && (
                <>
                  <span role="cell" className="tr-num">
                    {hoursClock(sum.c)}
                  </span>
                  <span role="cell" className="tr-num">
                    {hoursClock(sum.d)}
                  </span>
                </>
              )}
              <span role="cell" className="tr-num tr-num-strong">
                {hoursClock(sum.t)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="tr-donut-wrap" aria-labelledby={`${ids}-donut`} data-tr-donut>
        <h3 className="tr-h3" id={`${ids}-donut`}>
          {donutTitle}
        </h3>
        <div className="tr-donut-row">
          <div
            className="tr-donut"
            role="img"
            aria-label={spoken}
            style={{ background: donutBackground(slices, active) }}
          >
            <div className="tr-donut-hole" aria-hidden="true">
              <span className="tr-donut-value">{hoursClock(sum.t)}</span>
              <span className="tr-donut-caption">{drafts ? 'tracked' : 'confirmed'}</span>
            </div>
          </div>
          <ul className="tr-slices" aria-label={donutTitle}>
            {slices.map((s) => (
              <li
                key={s.key}
                className={
                  active === undefined
                    ? 'tr-slice'
                    : active === s.key
                      ? 'tr-slice tr-slice-on'
                      : 'tr-slice tr-slice-dim'
                }
                tabIndex={0}
                data-tr-slice={s.key}
                onMouseEnter={() => {
                  setActive(s.key);
                }}
                onMouseLeave={() => {
                  setActive(undefined);
                }}
                onFocus={() => {
                  setActive(s.key);
                }}
                onBlur={() => {
                  setActive(undefined);
                }}
              >
                <span className="tr-swatch" style={{ background: s.color }} aria-hidden="true" />
                <span className="tr-slice-label">{s.label}</span>
                <span className="tr-mono tr-strong">{hoursClock(s.minutes)}</span>
                <span className="tr-mono tr-slice-pct">{s.pct}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------- a space's weeks

/**
 * A space admin's report (D-136, D-138): one figure a week for one space. A
 * week fewer than three people besides the reader made up is **withheld** —
 * said in words, never drawn as zero. No table, no donut, no breakdown:
 * the server sends none.
 */
function Weeks({ report }: { readonly report: SpaceWeeksReport }) {
  const lines = weekLines(report.weeks);
  return (
    <section
      className="tr-weeks"
      aria-label={`Confirmed time a week in ${report.project.name}`}
      data-tr-weeks
    >
      <p className="tr-note tr-note-info" role="note" data-tr-space-banner>
        <b>Totals for {report.project.name}.</b> One figure a week, confirmed time only, with no
        per-person split. A week fewer than three people besides you worked in is withheld.
      </p>
      <ol className="tr-week-list">
        {lines.map((w) => (
          <li key={w.from} className="tr-week" data-tr-week={w.from}>
            <span className="tr-week-label">{w.label}</span>
            <span className="tr-week-track" aria-hidden="true">
              {w.minutes !== null && (
                <span className="tr-week-fill" style={{ width: `${String(w.width)}%` }} />
              )}
            </span>
            {w.minutes === null ? (
              <span className="tr-week-withheld" data-tr-withheld>
                {WITHHELD}
              </span>
            ) : (
              <span className="tr-week-figure">
                <span className="tr-mono tr-strong">{hoursWords(w.minutes)}</span>
                <span className="tr-quiet">
                  {String(w.people)} {w.people === 1 ? 'person' : 'people'}
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
