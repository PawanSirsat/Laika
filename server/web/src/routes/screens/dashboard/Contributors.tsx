import { useState, type ReactNode } from 'react';
import { Donut } from '../../../components/Donut.tsx';
import { percentLabel, roundedPercents } from '../../../components/donut-arcs.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import { PersonLink } from '../../../components/PersonLink.tsx';
import type { Contributors as ContributorList } from './contributors-derive.ts';
import { DashLink, boardHref, listHref } from './DashLink.tsx';
import type { PersonLoad, Workload } from './summary-derive.ts';

/**
 * Slice colours **by rank**, not by person.
 *
 * Avatar colours come from an eight-hue hash of the user id, so two of four
 * people share a hue more often than not — on a ring that reads as one slice.
 * Ranking guarantees every named slice its own colour; the legend still shows
 * each person's own avatar beside it, so they are found by face, not by hue.
 * **Orange is review's** (the board's lane colour), so it is never a person's.
 */
const RANK_COLORS = [
  'var(--chip-blue)',
  'var(--chip-purple)',
  'var(--chip-green)',
  'var(--chip-pink)',
];
const OTHERS_COLOR = 'var(--chip-neutral)';
const UNASSIGNED_COLOR = 'var(--text-muted)';
const REVIEW_COLOR = 'var(--chip-orange)';
const REVIEW_KEY = 'review';

function colorOf(row: PersonLoad, rank: number): string {
  if (row.kind === 'others') return OTHERS_COLOR;
  if (row.kind === 'unassigned') return UNASSIGNED_COLOR;
  return RANK_COLORS[rank % RANK_COLORS.length] ?? OTHERS_COLOR;
}

/** "2 in progress · 3 to do · 5 backlog · 1 blocked" — only what is not zero. */
function detail(row: PersonLoad): string {
  const parts: string[] = [];
  if (row.byStatus.in_progress > 0) parts.push(`${String(row.byStatus.in_progress)} in progress`);
  if (row.byStatus.todo > 0) parts.push(`${String(row.byStatus.todo)} to do`);
  if (row.byStatus.backlog > 0) parts.push(`${String(row.byStatus.backlog)} backlog`);
  if (row.blocked > 0) parts.push(`${String(row.blocked)} blocked`);
  return parts.join(' · ');
}

function Avatar({ id, name, theme }: { id: string; name: string; theme: Theme }) {
  const ink = avatarColor(id, theme);
  return (
    <span
      className="dash-avatar dash-legend-avatar"
      style={{ background: ink.background, color: ink.foreground, borderColor: ink.border }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

type Tab = 'delivered' | 'open';

/**
 * **Contributors** (LAI-817, D-092) — who did the work, and who holds what now.
 *
 * It was *Work by person*: open tasks touched in the range, by current
 * assignee. On OnRoute it ranked Ashutosh 24, Pawan 6 — fourteen of
 * Ashutosh's were waiting on a reviewer, and Pawan had delivered the most.
 * Two questions were folded into one number; they are two tabs now:
 *
 * - **Delivered** ranks people by what they moved into review, or into done
 *   without review, **in the range** (`contributors-derive.ts`), with what they
 *   reviewed beside it and self-closes footnoted. An agent's moves are its
 *   owner's.
 * - **Open work now** is every open task **as of now**, whatever the range,
 *   divided by who holds it — with work waiting for review drawn as its own
 *   share, because it waits on the reviewer, not the assignee.
 *
 * Each person on Open work now opens the board filtered to them; for an owner
 * or admin each person also carries a link to their profile (LAI-743).
 */
export function Contributors({
  contributors,
  workload,
  nameOf,
  slug,
  theme,
  window,
  filters,
  narrowed = false,
  filter,
}: {
  readonly contributors: ContributorList;
  readonly workload: Workload;
  readonly nameOf: (id: string) => string;
  readonly slug: string;
  readonly theme: Theme;
  /** "in the last 7 days", "all time" — the range Delivered covers. */
  readonly window: string;
  /** How many of the card's own filters are set — the subtitle says so. */
  readonly filters: number;
  /** The card's filter narrows the tasks, so an empty card is not an empty space. */
  readonly narrowed?: boolean;
  /** The card's filter control (`CardFilter`). */
  readonly filter?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('delivered');
  const filtered =
    filters > 0 ? ` · ${String(filters)} ${filters === 1 ? 'filter' : 'filters'}` : '';
  const people = contributors.rows.length;
  const meta =
    tab === 'delivered'
      ? `${String(people)} ${people === 1 ? 'person' : 'people'} · ${window}${filtered}`
      : `${String(workload.open)} open · now, any range${filtered}`;

  return (
    <section className="dash-card dash-people" aria-labelledby="dash-people-title">
      <header className="dash-card-head">
        <h2 id="dash-people-title" className="dash-card-title">
          Contributors
        </h2>
        <span className="dash-tabs" role="tablist" aria-label="Contributors">
          {(
            [
              ['delivered', 'Delivered'],
              ['open', 'Open work now'],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`dash-people-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="dash-people-panel"
              className={tab === id ? 'dash-tab dash-tab-on' : 'dash-tab'}
              onClick={() => {
                setTab(id);
              }}
            >
              {name}
            </button>
          ))}
        </span>
        <span className="dash-card-tools">
          <span className="dash-card-meta" title={meta}>
            {meta}
          </span>
          {filter}
        </span>
      </header>

      <div
        id="dash-people-panel"
        className="dash-people-panel"
        role="tabpanel"
        aria-labelledby={`dash-people-tab-${tab}`}
      >
        {tab === 'delivered' ? (
          <Delivered
            contributors={contributors}
            nameOf={nameOf}
            theme={theme}
            window={window}
            narrowed={narrowed}
          />
        ) : (
          <OpenWorkNow
            workload={workload}
            nameOf={nameOf}
            slug={slug}
            theme={theme}
            narrowed={narrowed}
          />
        )}
      </div>
    </section>
  );
}

function Delivered({
  contributors,
  nameOf,
  theme,
  window,
  narrowed,
}: {
  readonly contributors: ContributorList;
  readonly nameOf: (id: string) => string;
  readonly theme: Theme;
  readonly window: string;
  readonly narrowed: boolean;
}) {
  if (contributors.rows.length === 0) {
    return (
      <p className="dash-empty">
        {narrowed
          ? 'Nothing in this card’s scope was delivered or reviewed '
          : 'Nobody moved work into review or done '}
        {window}.
      </p>
    );
  }
  return (
    <>
      <table className="dash-contrib">
        <thead>
          <tr>
            <th scope="col" className="dash-contrib-who">
              <span className="visually-hidden">Person</span>
            </th>
            <th scope="col" className="dash-contrib-n" title="Moved into review, or into done">
              Delivered
            </th>
            <th
              scope="col"
              className="dash-contrib-n"
              title="Moved out of review on someone else’s work"
            >
              Reviewed
            </th>
          </tr>
        </thead>
        <tbody>
          {contributors.rows.map((row, i) => (
            <tr key={row.id} className="dash-contrib-row" data-person={row.id}>
              <th scope="row" className="dash-contrib-who">
                {/* The flex row lives inside the cell: a cell that is itself
                    flex stops being a table cell, and its rule drifts. */}
                <span className="dash-contrib-person">
                  <span className="dash-contrib-rank" aria-hidden="true">
                    {i + 1}
                  </span>
                  <Avatar id={row.id} name={nameOf(row.id)} theme={theme} />
                  <span className="dash-legend-who">
                    <span className="dash-legend-name">{nameOf(row.id)}</span>
                    {row.selfClosed > 0 && (
                      <span className="dash-legend-detail">
                        {row.selfClosed} closed without review*
                      </span>
                    )}
                  </span>
                  <PersonLink
                    userId={row.id}
                    onlyLink
                    className="dash-legend-profile"
                    label={`Open ${nameOf(row.id)}’s profile`}
                  >
                    Profile
                  </PersonLink>
                </span>
              </th>
              <td className="dash-contrib-n" data-col="delivered">
                {row.delivered}
              </td>
              <td className="dash-contrib-n dash-contrib-reviewed" data-col="reviewed">
                {row.reviewed}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dash-card-foot">
        Delivered: tasks moved into review, or into done, {window} — each task once, and an agent’s
        moves count for its owner.
        {contributors.selfClosed > 0 && (
          <>
            {' '}
            *{contributors.selfClosed} of them {contributors.selfClosed === 1 ? 'was' : 'were'}{' '}
            closed without review.
          </>
        )}
      </p>
    </>
  );
}

function OpenWorkNow({
  workload,
  nameOf,
  slug,
  theme,
  narrowed,
}: {
  readonly workload: Workload;
  readonly nameOf: (id: string) => string;
  readonly slug: string;
  readonly theme: Theme;
  readonly narrowed: boolean;
}) {
  const [active, setActive] = useState<string | undefined>(undefined);
  if (workload.open === 0) {
    return (
      <p className="dash-empty">
        {narrowed ? 'No open work in this card’s scope.' : 'No open work — nothing to divide.'}
      </p>
    );
  }

  let rank = 0;
  const colored = workload.rows.map((row) => {
    const color = colorOf(row, rank);
    if (row.kind === 'person') rank += 1;
    return { row, color };
  });
  const values = [...workload.rows.map((row) => row.count), workload.waitingForReview];
  const percents = roundedPercents(values);
  const label = (row: PersonLoad): string =>
    row.kind === 'person'
      ? nameOf(row.id)
      : row.kind === 'others'
        ? `${String(row.people.length)} others`
        : 'Unassigned';
  const hover = (key: string) => ({
    onMouseEnter: () => {
      setActive(key);
    },
    onMouseLeave: () => {
      setActive(undefined);
    },
    onFocus: () => {
      setActive(key);
    },
    onBlur: () => {
      setActive(undefined);
    },
  });

  return (
    <div className="dash-chart">
      <Donut
        label="Open work now by person"
        value={workload.open}
        caption={workload.open === 1 ? 'open task' : 'open tasks'}
        slices={[
          ...colored.map(({ row, color }) => ({
            key: row.id,
            label: label(row),
            value: row.count,
            color,
          })),
          {
            key: REVIEW_KEY,
            label: 'Waiting for review',
            value: workload.waitingForReview,
            color: REVIEW_COLOR,
          },
        ]}
        active={active}
        onActive={setActive}
      />
      <ul className="dash-legend dash-legend-people">
        {colored.map(({ row, color }, i) => {
          const body = (
            <>
              <span className="dash-swatch" style={{ background: color }} aria-hidden="true" />
              {row.kind === 'person' ? (
                <Avatar id={row.id} name={nameOf(row.id)} theme={theme} />
              ) : (
                <span className="dash-avatar dash-legend-avatar" aria-hidden="true">
                  {row.kind === 'others' ? '+' : '–'}
                </span>
              )}
              <span className="dash-legend-who">
                <span className="dash-legend-name">{label(row)}</span>
                <span className="dash-legend-detail">{detail(row)}</span>
                {/* Its own line: at the end of the detail it was the first
                    thing an ellipsis cut, and it is the split D-092 asks for. */}
                {row.review > 0 && (
                  <span className="dash-legend-detail dash-legend-review">
                    +{row.review} waiting for review
                  </span>
                )}
              </span>
              <span className="dash-legend-n" data-person={row.id}>
                {row.count}
              </span>
              <span className="dash-legend-pct">{percentLabel(percents[i] ?? 0, row.count)}</span>
            </>
          );
          return (
            <li key={row.id} className="dash-legend-item">
              {row.kind === 'others' ? (
                <span className="dash-legend-row" {...hover(row.id)}>
                  {body}
                </span>
              ) : (
                <DashLink
                  href={boardHref(slug, {
                    assignee: row.kind === 'unassigned' ? 'none' : row.id,
                  })}
                  className="dash-legend-row"
                  title={`Open ${label(row)}'s work on the board`}
                  {...hover(row.id)}
                >
                  {body}
                </DashLink>
              )}
              {/* The person's profile, beside the row rather than inside
                  it — the row already opens their board, and a link
                  cannot hold another. Owners and admins only (LAI-743);
                  nothing at all for anyone else. */}
              {row.kind === 'person' && (
                <PersonLink
                  userId={row.id}
                  onlyLink
                  className="dash-legend-profile"
                  label={`Open ${label(row)}’s profile`}
                >
                  Profile
                </PersonLink>
              )}
            </li>
          );
        })}
        {workload.waitingForReview > 0 && (
          <li className="dash-legend-item">
            <DashLink
              href={listHref(slug, { status: 'review' })}
              className="dash-legend-row"
              title="Open everything waiting for review in the List"
              {...hover(REVIEW_KEY)}
            >
              <span
                className="dash-swatch"
                style={{ background: REVIEW_COLOR }}
                aria-hidden="true"
              />
              <span className="dash-legend-who">
                <span className="dash-legend-name">Waiting for review</span>
                <span className="dash-legend-detail">waits on a reviewer, whoever holds it</span>
              </span>
              <span className="dash-legend-n" data-person={REVIEW_KEY}>
                {workload.waitingForReview}
              </span>
              <span className="dash-legend-pct">
                {percentLabel(percents.at(-1) ?? 0, workload.waitingForReview)}
              </span>
            </DashLink>
          </li>
        )}
      </ul>
    </div>
  );
}
