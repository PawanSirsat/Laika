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
  type ReportLink,
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
  childWindow,
  spreadOf,
  spreadWords,
  CHILD_STEP,
  type PeopleOrder,
  hoursCompact,
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
  /** The organisation's name, for *Everyone in …* (frame 1g). */
  readonly orgName?: string | undefined;
  /**
   * Changes when what the report covers may have changed elsewhere on the
   * page — My day's open day being edited — so the same stretch is read again.
   */
  readonly version?: string | undefined;
  /** The heading, when the place it is drawn names it otherwise — the profile's *Time report* tab on your own (LAI-1152). */
  readonly title?: string | undefined;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly key: string; readonly answer: TimeReportAnswer }
  | { readonly kind: 'error'; readonly key: string; readonly error: unknown };

interface Filters {
  readonly spaces: readonly string[];
  readonly members: readonly string[];
  readonly kinds: readonly EntryKind[];
  /** By what the time is on (D-142, LAI-1163); absent is all of it. */
  readonly link?: ReportLink | undefined;
}

const NO_FILTERS: Filters = { spaces: [], members: [], kinds: [] };

/** The Task link chip's words. */
const LINK_WORDS: readonly (readonly [ReportLink | undefined, string])[] = [
  [undefined, 'All'],
  ['task', 'On a task'],
  ['general', 'General'],
  ['untied', 'Not on a task yet'],
];

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
 * **Drafts are the person's own until asked for** (D-088 items 2–3, SPEC
 * §6.4: `drafts=exclude` by default). The reader's own report (`me`) always
 * reads them and the *Confirmed only / Include drafts* switch counts them in
 * or out here. Anybody else's opens on *Confirmed only* and asks for drafts
 * only when the reader turns *Include drafts* on; until then nothing drafted
 * is named. Space, Member and Kind narrow the read on the server, so the
 * bars and the agent line follow them.
 */
export function TimeReport({
  scope,
  subject,
  today,
  anchor: openOn,
  initialRange,
  onDay,
  ledSpaces,
  orgName,
  version,
  title: named,
}: TimeReportProps) {
  const ids = useId();
  const weekly = ledSpaces !== undefined;
  const [range, setRange] = useState<ReportRange>(
    initialRange ?? (weekly ? 'month' : scope === 'org' ? 'range' : 'week'),
  );
  const [anchor, setAnchor] = useState(openOn ?? today);
  const [picked, setPicked] = useState<DayRange>(() => presetRange('last30', today));
  // Only the reader's own drafts are read unasked (D-088 items 2–3).
  const own = scope === 'me';
  const [drafts, setDrafts] = useState(own && !weekly);
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
  // A space admin's weeks stop at this one: a week still to come has no figure to show.
  const stretch = weekly
    ? wholeWeeks({ from: shownRange.from, to: shownRange.to > today ? today : shownRange.to })
    : shownRange;
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
            link: filters.link,
            drafts: own || drafts,
          };
  const key = query === undefined ? '' : `${JSON.stringify(query)}|${version ?? ''}`;

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
  const title =
    named ?? (scope === 'me' ? 'Overview' : scope === 'person' ? 'Time report' : 'Time');
  const caption =
    weekly && spaceName !== undefined
      ? `${spaceName} · ${label}`
      : scope === 'org'
        ? `${orgName === undefined || orgName === '' ? 'Everyone' : `Everyone in ${orgName}`} · ${label}`
        : scope === 'person' && subject !== undefined
          ? `${subject.name} · ${label}`
          : label;

  const unit = stepUnit(range, shownRange);
  const nextDisabled = (weekly ? stretch : shownRange).to >= today;
  const ranges = weekly ? REPORT_RANGES.filter((r) => r !== 'day') : REPORT_RANGES;
  const filtersOn =
    filters.spaces.length + filters.members.length + filters.kinds.length > 0 ||
    filters.link !== undefined;
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
    // The file says what the screen counts: drafts only when they are counted.
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
      className="trep"
      aria-labelledby={`${ids}-title`}
      aria-busy={load.kind === 'loading'}
      data-time-report={weekly ? 'space' : scope}
    >
      <header className="trep-head">
        <div className="trep-titles">
          <h2 className="trep-title" id={`${ids}-title`}>
            {title}
          </h2>
          <span className="trep-caption" data-tr-caption>
            {caption}
          </span>
          {scope === 'person' && (
            <span className="trep-lock" data-tr-lock>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
              </svg>
              Visible to owners and admins · they can see you looked
            </span>
          )}
        </div>
        <div className="trep-segments" role="radiogroup" aria-label="Range">
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              className={range === r ? 'trep-segment trep-segment-on' : 'trep-segment'}
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

      <div className="trep-bar" role="toolbar" aria-label="Report controls">
        <div className="trep-stepper">
          <button
            type="button"
            className="trep-step"
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
          <span className="trep-range-label" aria-live="polite" data-tr-label>
            {label}
          </span>
          <button
            type="button"
            className="trep-step"
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
        <span className="trep-divider" aria-hidden="true" />
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
                <label key={o.value} className="trep-option">
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
                  <span className="trep-option-label">{o.label}</span>
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
                mark: <span className={`trep-dot trep-kind-${o.kind}`} aria-hidden="true" />,
              }))}
              selected={filters.kinds}
              open={pop === 'kind'}
              onToggle={setPop}
              onChange={(kinds) => {
                setFilters((f) => ({ ...f, kinds: kinds as EntryKind[] }));
              }}
            />
            <Chip
              id="link"
              name="Task link"
              value={LINK_WORDS.find(([v]) => v === filters.link)?.[1] ?? 'All'}
              on={filters.link !== undefined}
              open={pop === 'link'}
              onToggle={setPop}
            >
              <div role="radiogroup" aria-label="Task link">
                {LINK_WORDS.map(([v, words]) => (
                  <label key={v ?? 'all'} className="trep-option" data-tr-link={v ?? 'all'}>
                    <input
                      type="radio"
                      name={`${ids}-link`}
                      checked={filters.link === v}
                      onChange={() => {
                        setFilters((f) => ({ ...f, link: v }));
                        // Time not on a task yet is only ever a draft.
                        if (v === 'untied') setDrafts(true);
                        setPop(undefined);
                      }}
                    />
                    <span className="trep-option-label">{words}</span>
                  </label>
                ))}
              </div>
            </Chip>
          </>
        )}
        <div className="trep-bar-end">
          {!weekly && (
            <div className="trep-segments" role="radiogroup" aria-label="Which time to count">
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={drafts === v}
                  className={drafts === v ? 'trep-segment trep-segment-on' : 'trep-segment'}
                  data-tr-drafts={v ? 'include' : 'exclude'}
                  onClick={() => {
                    setDrafts(v);
                    // Not on a task yet is drafts only: confirmed only takes the link off.
                    if (!v && filters.link === 'untied') {
                      setFilters((f) => ({ ...f, link: undefined }));
                    }
                  }}
                >
                  {v ? 'Include drafts' : 'Confirmed only'}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="trep-export"
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
        <p className="trep-note trep-note-error" role="alert" data-tr-csv-error>
          <b>The file could not be made.</b> {csv.error}
        </p>
      )}

      {range === 'range' && (
        <div className="trep-picker" data-tr-picker>
          <div className="trep-presets" role="group" aria-label="Quick picks">
            {RANGE_PRESETS.map(([preset, words]) => {
              const days = presetRange(preset, today);
              const on = days.from === picked.from && days.to === picked.to;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'trep-preset trep-preset-on' : 'trep-preset'}
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
          <div className="trep-dates">
            <label className="trep-date">
              <span className="trep-date-label">From</span>
              <input
                type="date"
                className="input trep-date-input"
                value={picked.from}
                max={today}
                data-tr-from
                onChange={(event) => {
                  setPicked({ from: event.target.value, to: picked.to });
                }}
              />
            </label>
            <span className="trep-quiet" aria-hidden="true">
              –
            </span>
            <label className="trep-date">
              <span className="trep-date-label">To</span>
              <input
                type="date"
                className="input trep-date-input"
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
        <p className="trep-note trep-note-error" role="alert" data-tr-problem>
          {problem}
        </p>
      ) : weekly && space === undefined ? (
        <p className="trep-note" data-tr-no-space>
          You lead no space, so there is no week to show.
        </p>
      ) : load.kind === 'error' && load.key === key ? (
        <div className="trep-error" role="alert" data-tr-error>
          <span>
            <b>This range could not be read.</b> {errorSentence(load.error)} Nothing on the board
            changed.
          </span>
          <button
            type="button"
            className="trep-pill-button"
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
      className="trep-chip-wrap"
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
        className={on ? 'trep-chip trep-chip-on' : 'trep-chip'}
        aria-haspopup="true"
        aria-expanded={open}
        data-tr-chip={id}
        onClick={() => {
          onToggle(open ? undefined : id);
        }}
      >
        <span>{name}</span>
        <span className="trep-chip-value">{value}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="trep-pop" role="group" aria-label={`Filter by ${name.toLowerCase()}`}>
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
        <div className="trep-pop-foot">
          <button
            type="button"
            className="trep-link-button"
            onClick={() => {
              onChange([]);
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="trep-link-button trep-link-accent"
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
        <p className="trep-quiet trep-pop-empty">Nothing in this range yet.</p>
      ) : (
        options.map((o) => (
          <label key={o.value} className="trep-option" data-tr-option={o.value}>
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
            <span className="trep-option-label">{o.label}</span>
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
      className="trep-avatar"
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
    return <span className={`trep-dot trep-kind-${face.kind}`} aria-hidden="true" />;
  }
  if (face.none === true) return <span className="trep-dashed" aria-hidden="true" />;
  return null;
}

// ----------------------------------------------------------------- states

/** The figures being read, in bones (frame 1j), and said once to a screen reader. */
function Reading() {
  return (
    <div className="trep-reading" data-tr-loading>
      <div className="trep-stats" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="trep-stat">
            <span className="trep-bone trep-bone-a" />
            <span className="trep-bone trep-bone-b" />
            <span className="trep-bone trep-bone-c" />
          </span>
        ))}
      </div>
      <div className="trep-bone-bars" aria-hidden="true">
        {[62, 40, 74, 55, 30, 8, 8].map((h, i) => (
          <span key={i} className="trep-bone trep-bone-bar" style={{ height: `${String(h)}%` }} />
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
          // Drafts not asked for are not looked at, so this can say only what was confirmed.
          sub: report.include_drafts
            ? `Nothing was tracked or drafted, ${label}.`
            : `Nothing was confirmed, ${label}.`,
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
        <p className="trep-note trep-note-info" role="note" data-tr-partial>
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
            <div className="trep-empty" data-tr-empty={empty.state}>
              <p className="trep-empty-title">{empty.title}</p>
              <p className="trep-empty-sub">{empty.sub}</p>
              <button type="button" className="trep-pill-button" onClick={empty.act}>
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
  // A phone prints the short figure (frame 1c); the words stay for everyone else.
  const short = statsOf(report, drafts, scope, today, firstName, true);
  const agent = report.agent_minutes;
  return (
    <>
      <ul className="trep-stats" aria-label="Figures">
        {stats.map((s, i) => (
          <li key={s.key} className="trep-stat" data-tr-stat={s.key}>
            <span className="trep-stat-label">{s.label}</span>
            <span className="trep-stat-value">
              <span className="trep-long">{s.value}</span>
              <span className="trep-short">{short[i]?.value ?? s.value}</span>
            </span>
            <span className="trep-stat-sub">{s.sub}</span>
          </li>
        ))}
      </ul>
      {agent !== null && agent > 0 && (
        <p className="trep-agent" data-tr-agent>
          <span className="trep-agent-mark" aria-hidden="true">
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
  const gap = n <= 7 ? 'trep-bars-wide' : n <= 31 ? 'trep-bars-mid' : 'trep-bars-dense';

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const to = barKey(event.key, at, n);
    if (to === undefined) return;
    event.preventDefault();
    setFocusAt(to);
    group.current?.querySelectorAll('button')[to]?.focus();
  };

  return (
    <section className="trep-chart" aria-labelledby={id} data-tr-chart>
      <div className="trep-chart-head">
        <h3 className="trep-h3" id={id}>
          Hours per day
        </h3>
        <div className="trep-legend" aria-hidden="true">
          <span className="trep-legend-item">
            <span className="trep-swatch trep-swatch-confirmed" />
            Confirmed
          </span>
          {drafts && (
            <span className="trep-legend-item">
              <span className="trep-swatch trep-swatch-drafted" />
              Drafted
            </span>
          )}
        </div>
      </div>
      <div className="trep-plot">
        <div className="trep-axis" aria-hidden="true">
          {axis.lines.map((g) => (
            <span key={g.label} className="trep-axis-label" style={{ bottom: `${String(g.pct)}%` }}>
              {g.label}
            </span>
          ))}
        </div>
        <div className="trep-area">
          {axis.lines.map((g) => (
            <span
              key={g.label}
              className="trep-gridline"
              aria-hidden="true"
              style={{ bottom: `${String(g.pct)}%` }}
            />
          ))}
          <div
            ref={group}
            className={`trep-bars ${gap}`}
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
                    ? 'trep-col trep-col-on'
                    : 'trep-col'
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
                  className={b.future ? 'trep-stack trep-stack-future' : 'trep-stack'}
                  style={{ height: `${String(b.height)}%` }}
                >
                  <span
                    className="trep-fill-confirmed"
                    style={{ flexBasis: `${String(b.confirmedPct)}%` }}
                  />
                  <span
                    className="trep-fill-drafted"
                    style={{ flexBasis: `${String(b.draftedPct)}%` }}
                  />
                </span>
              </button>
            ))}
          </div>
          {tip !== undefined && hover !== undefined && (
            <div
              className="trep-tip"
              aria-hidden="true"
              style={{
                left: `${String(Math.min(90, Math.max(10, ((hover + 0.5) / n) * 100)))}%`,
                bottom: `calc(${String(Math.min(80, tip.height))}% + 0.5rem)`,
              }}
            >
              <span className="trep-tip-date">{dayLong(tip.day)}</span>
              <span className="trep-tip-total">{tip.future ? '—' : hoursWords(tip.total)}</span>
              <span className="trep-tip-sub">
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
        <div className={`trep-day-names ${gap}`} aria-hidden="true">
          {bars.map((b) => (
            <span
              key={b.day}
              className={
                b.today
                  ? 'trep-day-name trep-day-today'
                  : b.future || b.weekend
                    ? 'trep-day-name trep-day-quiet'
                    : 'trep-day-name'
              }
            >
              <span>{b.top}</span>
              <span className="trep-mono">{b.bottom}</span>
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
      className="trep-chip-wrap"
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
        className="trep-chip trep-chip-strong"
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
        <div ref={menu} className="trep-pop trep-menu" role="menu" aria-label={aria}>
          {options.map((g) => (
            <button
              key={g}
              type="button"
              role="menuitemradio"
              aria-checked={g === current}
              className={g === current ? 'trep-menu-item trep-menu-item-on' : 'trep-menu-item'}
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

/** Run after React has drawn the change a click asked for. */
function afterPaint(go: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(go);
  });
}

/** Focus `selector` inside `scope`; scroll it into view when `show`. */
function focusIn(scope: Element | null, selector: string, show = false): void {
  const el = scope?.querySelector<HTMLElement>(selector);
  if (el === null || el === undefined) return;
  el.focus({ preventScroll: true });
  if (show) el.scrollIntoView({ block: 'nearest' });
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
  // How many of an open group's rows show (LAI-1162): ten, then *Show N more*.
  const [shown, setShown] = useState<ReadonlyMap<string, number>>(new Map());
  const [people, setPeople] = useState<PeopleOrder>('az');
  const [menu, setMenu] = useState<string | undefined>();
  const [active, setActive] = useState<string | undefined>();
  const groups = useMemo(
    () => groupRows(report.rows, first, second, drafts, kindName, people),
    [report.rows, first, second, drafts, people],
  );
  const slices = slicesOf(groups);
  const split = drafts;
  // People first: how widely each one's time went, beside their hours (LAI-1164).
  const spread = first === 'member';
  const all = useMemo(() => spreadOf(report.rows, drafts), [report.rows, drafts]);
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
    <div className="trep-breakdown">
      <section className="trep-table-wrap" aria-labelledby={`${ids}-group`} data-tr-table>
        <div className="trep-group-bar">
          <h3 className="trep-group-title" id={`${ids}-group`}>
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
              setShown(new Map());
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
              setShown(new Map());
            }}
          />
          <button
            type="button"
            className="trep-swap"
            aria-label="Swap the two groupings"
            disabled={!canSwap(scope, second)}
            data-tr-swap
            onClick={() => {
              if (second === 'none') return;
              setGrouping([second, first]);
              setOpen(new Map());
              setShown(new Map());
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7h12l-3-3M17 17H5l3 3" />
            </svg>
            Swap
          </button>
          {(first === 'member' || second === 'member') && (
            // A–Z unless the reader asks for the most time first (D-141).
            <div className="trep-segments" role="radiogroup" aria-label="List people">
              {(
                [
                  ['az', 'A–Z'],
                  ['time', 'Most time'],
                ] as const
              ).map(([v, name]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={people === v}
                  className={people === v ? 'trep-segment trep-segment-on' : 'trep-segment'}
                  data-tr-people={v}
                  onClick={() => {
                    setPeople(v);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className={`trep-table${split ? ' trep-table-split' : ''}${spread ? ' trep-table-spread' : ''}`}
          role="table"
          aria-label={tableLabel}
        >
          <div role="rowgroup">
            <div role="row" className="trep-row trep-row-head">
              <span role="columnheader">{DIMENSION_LABELS[first]}</span>
              {spread && (
                <>
                  <span role="columnheader" className="trep-num">
                    Spaces
                  </span>
                  <span role="columnheader" className="trep-num">
                    Tasks
                  </span>
                </>
              )}
              {split && (
                <>
                  <span role="columnheader" className="trep-num">
                    Confirmed
                  </span>
                  <span role="columnheader" className="trep-num">
                    Drafted
                  </span>
                </>
              )}
              <span role="columnheader" className="trep-num">
                Total
              </span>
            </div>
          </div>
          <div role="rowgroup">
            {groups.map((g) => {
              const leaf = g.children.length === 0;
              // Closed until opened (LAI-1162); a lone group opens by itself.
              const isOpen = !leaf && (open.get(g.face.key) ?? groups.length === 1);
              const meta = childCount(second, g.children.length);
              const win = childWindow(g.children.length, shown.get(g.face.key));
              return (
                <div key={g.face.key} className="trep-group" data-tr-row={g.face.key}>
                  <div role="row" className="trep-row">
                    <span role="rowheader" className="trep-cell-name">
                      <button
                        type="button"
                        className="trep-row-toggle"
                        aria-expanded={leaf ? undefined : isOpen}
                        disabled={leaf}
                        onClick={() => {
                          setOpen((m) => new Map(m).set(g.face.key, !isOpen));
                          // Closed and opened again, it starts from ten.
                          if (isOpen) {
                            setShown((m) => {
                              const next = new Map(m);
                              next.delete(g.face.key);
                              return next;
                            });
                          }
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className={
                            isOpen
                              ? 'trep-chev trep-chev-open'
                              : leaf
                                ? 'trep-chev trep-chev-none'
                                : 'trep-chev'
                          }
                        >
                          <path d="m9 6 6 6-6 6" />
                        </svg>
                        <span
                          className="trep-swatch"
                          style={{ background: g.color }}
                          aria-hidden="true"
                        />
                        <Mark face={g.face} />
                        {g.face.code !== undefined && (
                          <span className="trep-code">{g.face.code}</span>
                        )}
                        {spread ? (
                          // The counts are the columns; on a phone, a line under the name.
                          <span className="trep-row-text">
                            <span className="trep-row-label">{g.face.label}</span>
                            <span className="trep-row-spread" data-tr-spread-words>
                              {spreadWords(g.spread)}
                            </span>
                          </span>
                        ) : (
                          <>
                            <span className="trep-row-label">{g.face.label}</span>
                            {meta !== '' && <span className="trep-row-meta">{meta}</span>}
                          </>
                        )}
                      </button>
                    </span>
                    {spread && (
                      <>
                        <span
                          role="cell"
                          className="trep-num trep-num-quiet"
                          data-tr-spread="spaces"
                        >
                          {g.spread.spaces}
                        </span>
                        <span
                          role="cell"
                          className="trep-num trep-num-quiet"
                          data-tr-spread="tasks"
                        >
                          {g.spread.tasks}
                        </span>
                      </>
                    )}
                    {split && (
                      <>
                        <span role="cell" className="trep-num trep-num-quiet">
                          {hoursCompact(g.confirmed)}
                        </span>
                        <span role="cell" className="trep-num trep-num-quiet">
                          {hoursCompact(g.drafted)}
                        </span>
                      </>
                    )}
                    <span role="cell" className="trep-num trep-num-strong">
                      {hoursCompact(g.total)}
                    </span>
                  </div>
                  {isOpen &&
                    g.children.slice(0, win.draw).map((k) => (
                      <div
                        role="row"
                        key={k.face.key}
                        className="trep-row trep-row-child"
                        data-tr-child={k.face.key}
                      >
                        <span role="rowheader" className="trep-cell-name trep-cell-child">
                          <Mark face={k.face} />
                          {k.face.code !== undefined && (
                            <span className="trep-code">{k.face.code}</span>
                          )}
                          <span className="trep-row-label trep-quiet-text">{k.face.label}</span>
                        </span>
                        {spread && (
                          <>
                            <span role="cell" className="trep-num" />
                            <span role="cell" className="trep-num" />
                          </>
                        )}
                        {split && (
                          <>
                            <span role="cell" className="trep-num trep-num-muted">
                              {hoursCompact(k.confirmed)}
                            </span>
                            <span role="cell" className="trep-num trep-num-muted">
                              {hoursCompact(k.drafted)}
                            </span>
                          </>
                        )}
                        <span role="cell" className="trep-num trep-num-quiet">
                          {hoursCompact(k.total)}
                        </span>
                      </div>
                    ))}
                  {isOpen && (win.more > 0 || win.draw > CHILD_STEP) && (
                    <div role="row" className="trep-row trep-row-child trep-row-more">
                      <span role="cell" className="trep-cell-child">
                        {win.more > 0 && (
                          <button
                            type="button"
                            className="trep-more"
                            data-tr-more
                            onClick={(event) => {
                              const at = event.currentTarget.closest('[data-tr-row]');
                              const last = win.draw + win.more >= g.children.length;
                              setShown((m) => new Map(m).set(g.face.key, win.draw + win.more));
                              // The last step takes this button away: keep focus on the row's other one.
                              if (last) afterPaint(() => focusIn(at, '[data-tr-fewer]'));
                            }}
                          >
                            Show {win.more} more
                          </button>
                        )}
                        <span className="trep-quiet trep-small">
                          {win.draw} of {g.children.length}
                        </span>
                        {win.draw > CHILD_STEP && (
                          <button
                            type="button"
                            className="trep-more"
                            data-tr-fewer
                            onClick={(event) => {
                              const at = event.currentTarget.closest('[data-tr-row]');
                              setShown((m) => new Map(m).set(g.face.key, CHILD_STEP));
                              // This button goes with the rows: focus and view go back to the group.
                              afterPaint(() => focusIn(at, '.trep-row-toggle', true));
                            }}
                          >
                            Show fewer
                          </button>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div role="rowgroup">
            <div role="row" className="trep-row trep-row-total" data-tr-total>
              <span role="rowheader">Total</span>
              {spread && (
                <>
                  <span role="cell" className="trep-num">
                    {all.spaces}
                  </span>
                  <span role="cell" className="trep-num">
                    {all.tasks}
                  </span>
                </>
              )}
              {split && (
                <>
                  <span role="cell" className="trep-num">
                    {hoursCompact(sum.c)}
                  </span>
                  <span role="cell" className="trep-num">
                    {hoursCompact(sum.d)}
                  </span>
                </>
              )}
              <span role="cell" className="trep-num trep-num-strong">
                {hoursCompact(sum.t)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="trep-donut-wrap" aria-labelledby={`${ids}-donut`} data-tr-donut>
        <h3 className="trep-h3" id={`${ids}-donut`}>
          {donutTitle}
        </h3>
        <div className="trep-donut-row">
          <div
            className="trep-donut"
            role="img"
            aria-label={spoken}
            style={{ background: donutBackground(slices, active) }}
          >
            <div className="trep-donut-hole" aria-hidden="true">
              <span className="trep-donut-value">{hoursCompact(sum.t)}</span>
              <span className="trep-donut-caption">{drafts ? 'tracked' : 'confirmed'}</span>
            </div>
          </div>
          <ul className="trep-slices" aria-label={donutTitle}>
            {slices.map((s) => (
              <li
                key={s.key}
                className={
                  active === undefined
                    ? 'trep-slice'
                    : active === s.key
                      ? 'trep-slice trep-slice-on'
                      : 'trep-slice trep-slice-dim'
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
                <span className="trep-swatch" style={{ background: s.color }} aria-hidden="true" />
                <span className="trep-slice-label">{s.label}</span>
                <span className="trep-mono trep-strong">{hoursCompact(s.minutes)}</span>
                <span className="trep-mono trep-slice-pct">{s.pct}</span>
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
      className="trep-weeks"
      aria-label={`Confirmed time a week in ${report.project.name}`}
      data-tr-weeks
    >
      <p className="trep-note trep-note-info" role="note" data-tr-space-banner>
        <b>Totals for {report.project.name}.</b> One figure a week, confirmed time only, with no
        per-person split. A week fewer than three people besides you worked in is withheld.
      </p>
      <ol className="trep-week-list">
        {lines.map((w) => (
          <li key={w.from} className="trep-week" data-tr-week={w.from}>
            <span className="trep-week-label">{w.label}</span>
            <span className="trep-week-track" aria-hidden="true">
              {w.minutes !== null && (
                <span className="trep-week-fill" style={{ width: `${String(w.width)}%` }} />
              )}
            </span>
            {w.minutes === null ? (
              <span className="trep-week-withheld" data-tr-withheld>
                {WITHHELD}
              </span>
            ) : (
              <span className="trep-week-figure">
                <span className="trep-mono trep-strong">{hoursWords(w.minutes)}</span>
                <span className="trep-quiet">
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
