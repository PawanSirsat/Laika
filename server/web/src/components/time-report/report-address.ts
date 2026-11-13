import { ENTRY_KINDS, type EntryKind, type ReportLink } from '../../api/time.ts';
import { REPORT_RANGES, type ReportRange } from './time-report-derive.ts';

/**
 * The Time report's period and filters as an address (LAI-1189, LAI-1216):
 * what Insights → Time writes after the query, so a reload or a pasted link
 * opens the same report. Every field is optional and absent means the
 * report's own default — a default is never written, so an untouched report
 * keeps the clean address. Reading is lenient: anything this client does not
 * recognise is read as absent, never as an error.
 *
 * | key      | value                                   |
 * | -------- | --------------------------------------- |
 * | `period` | `day` · `week` · `month` · `range`       |
 * | `date`   | the day the stepper is on (`YYYY-MM-DD`) |
 * | `from`   | a range's first day                      |
 * | `to`     | a range's last day                       |
 * | `space`  | space slugs, comma-separated             |
 * | `member` | user ids, comma-separated                |
 * | `kind`   | entry kinds, comma-separated             |
 * | `link`   | `task` · `general` · `untied`            |
 * | `drafts` | `include`                                |
 */
export interface ReportAddress {
  readonly range?: ReportRange | undefined;
  readonly anchor?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly spaces?: readonly string[] | undefined;
  readonly members?: readonly string[] | undefined;
  readonly kinds?: readonly EntryKind[] | undefined;
  readonly link?: ReportLink | undefined;
  readonly drafts?: boolean | undefined;
}

/** Every key the report owns in the address, so writing one clears the rest. */
export const REPORT_ADDRESS_KEYS = [
  'period',
  'date',
  'from',
  'to',
  'space',
  'member',
  'kind',
  'link',
  'drafts',
] as const;

const LINKS: readonly ReportLink[] = ['task', 'general', 'untied'];

/** A real calendar day in `YYYY-MM-DD`, or nothing. */
export function dayParam(value: string | null): string | undefined {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

/** A comma list, trimmed, without blanks or repeats; empty is absent. */
function listParam(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  const items = [
    ...new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
    ),
  ];
  return items.length === 0 ? undefined : items;
}

/** The report's address as `params` carries it, read leniently. */
export function readReportAddress(params: URLSearchParams): ReportAddress {
  const period = params.get('period');
  const range = (REPORT_RANGES as readonly string[]).includes(period ?? '')
    ? (period as ReportRange)
    : undefined;
  const kinds = listParam(params.get('kind'))?.filter((k): k is EntryKind =>
    (ENTRY_KINDS as readonly string[]).includes(k),
  );
  const link = params.get('link');
  return {
    range,
    anchor: dayParam(params.get('date')),
    from: dayParam(params.get('from')),
    to: dayParam(params.get('to')),
    spaces: listParam(params.get('space')),
    members: listParam(params.get('member')),
    kinds: kinds === undefined || kinds.length === 0 ? undefined : kinds,
    link: LINKS.includes(link as ReportLink) ? (link as ReportLink) : undefined,
    drafts: params.get('drafts') === 'include' ? true : undefined,
  };
}

/**
 * `params` with the report's keys replaced by `address`: other keys (`tab`,
 * `view`) are kept as they are, and an absent field leaves no key behind.
 */
export function writeReportAddress(
  params: URLSearchParams,
  address: ReportAddress,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of REPORT_ADDRESS_KEYS) next.delete(key);
  const set = (key: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') next.set(key, value);
  };
  set('period', address.range);
  set('date', address.anchor);
  set('from', address.from);
  set('to', address.to);
  set('space', address.spaces?.join(','));
  set('member', address.members?.join(','));
  set('kind', address.kinds?.join(','));
  set('link', address.link);
  if (address.drafts === true) next.set('drafts', 'include');
  return next;
}
