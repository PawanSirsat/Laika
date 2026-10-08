import { useState } from 'react';
import { Donut } from '../../../components/Donut.tsx';
import { percentLabel, roundedPercents } from '../../../components/donut-arcs.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import { DashLink, boardHref } from './DashLink.tsx';
import type { PersonLoad, Workload } from './summary-derive.ts';

/**
 * Slice colours **by rank**, not by person.
 *
 * Avatar colours come from an eight-hue hash of the user id, so two of four
 * people share a hue more often than not — on a ring that reads as one slice.
 * Ranking guarantees every named slice its own colour; the legend still shows
 * each person's own avatar beside it, so they are found by face, not by hue.
 */
const RANK_COLORS = [
  'var(--chip-blue)',
  'var(--chip-purple)',
  'var(--chip-green)',
  'var(--chip-orange)',
  'var(--chip-pink)',
];
const OTHERS_COLOR = 'var(--chip-neutral)';
const UNASSIGNED_COLOR = 'var(--text-muted)';

function colorOf(row: PersonLoad, rank: number): string {
  if (row.kind === 'others') return OTHERS_COLOR;
  if (row.kind === 'unassigned') return UNASSIGNED_COLOR;
  return RANK_COLORS[rank % RANK_COLORS.length] ?? OTHERS_COLOR;
}

/** "2 in progress · 1 review · 3 to do · 1 blocked" — only what is not zero. */
function detail(row: PersonLoad): string {
  const parts: string[] = [];
  if (row.byStatus.in_progress > 0) parts.push(`${String(row.byStatus.in_progress)} in progress`);
  if (row.byStatus.review > 0) parts.push(`${String(row.byStatus.review)} review`);
  const waiting = row.byStatus.todo + row.byStatus.backlog;
  if (waiting > 0) parts.push(`${String(waiting)} to do`);
  if (row.blocked > 0) parts.push(`${String(row.blocked)} blocked`);
  return parts.join(' · ');
}

/**
 * **Work by person** (LAI-711) — the owner's "person-wise divide in a circle",
 * and Jira's Team workload in one card: open work per assignee, Unassigned
 * named as its own share.
 *
 * Each person opens the board filtered to them; Unassigned opens the board's
 * own "no assignee" filter. "Others" is several people and goes nowhere.
 */
export function WorkByPerson({
  workload,
  nameOf,
  slug,
  theme,
}: {
  readonly workload: Workload;
  readonly nameOf: (id: string) => string;
  readonly slug: string;
  readonly theme: Theme;
}) {
  const [active, setActive] = useState<string | undefined>(undefined);
  const percents = roundedPercents(workload.rows.map((row) => row.count));
  let rank = 0;
  const colored = workload.rows.map((row) => {
    const color = colorOf(row, rank);
    if (row.kind === 'person') rank += 1;
    return { row, color };
  });
  const label = (row: PersonLoad): string =>
    row.kind === 'person'
      ? nameOf(row.id)
      : row.kind === 'others'
        ? `${String(row.people.length)} others`
        : 'Unassigned';
  const people = workload.rows
    .filter((row) => row.kind !== 'unassigned')
    .reduce((sum, row) => sum + row.people.length, 0);

  return (
    <section className="dash-card dash-people" aria-labelledby="dash-people-title">
      <header className="dash-card-head">
        <h2 id="dash-people-title" className="dash-card-title">
          Work by person
        </h2>
        <span className="dash-card-meta">
          {people} {people === 1 ? 'person' : 'people'} · open work
        </span>
      </header>

      {workload.open === 0 ? (
        <p className="dash-empty">No open work — nothing to divide.</p>
      ) : (
        <div className="dash-chart">
          <Donut
            label="Open work by person"
            value={workload.open}
            caption={workload.open === 1 ? 'open task' : 'open tasks'}
            slices={colored.map(({ row, color }) => ({
              key: row.id,
              label: label(row),
              value: row.count,
              color,
            }))}
            active={active}
            onActive={setActive}
          />
          <ul className="dash-legend dash-legend-people">
            {colored.map(({ row, color }, i) => {
              const body = (
                <>
                  <span className="dash-swatch" style={{ background: color }} aria-hidden="true" />
                  {row.kind === 'person' ? (
                    <span
                      className="dash-avatar dash-legend-avatar"
                      style={(() => {
                        const ink = avatarColor(row.id, theme);
                        return {
                          background: ink.background,
                          color: ink.foreground,
                          borderColor: ink.border,
                        };
                      })()}
                      aria-hidden="true"
                    >
                      {initials(nameOf(row.id))}
                    </span>
                  ) : (
                    <span className="dash-avatar dash-legend-avatar" aria-hidden="true">
                      {row.kind === 'others' ? '+' : '–'}
                    </span>
                  )}
                  <span className="dash-legend-who">
                    <span className="dash-legend-name">{label(row)}</span>
                    <span className="dash-legend-detail">{detail(row)}</span>
                  </span>
                  <span className="dash-legend-n" data-person={row.id}>
                    {row.count}
                  </span>
                  <span className="dash-legend-pct">
                    {percentLabel(percents[i] ?? 0, row.count)}
                  </span>
                </>
              );
              const hover = {
                onMouseEnter: () => {
                  setActive(row.id);
                },
                onMouseLeave: () => {
                  setActive(undefined);
                },
              };
              return (
                <li key={row.id}>
                  {row.kind === 'others' ? (
                    <span className="dash-legend-row" {...hover}>
                      {body}
                    </span>
                  ) : (
                    <DashLink
                      href={boardHref(slug, {
                        assignee: row.kind === 'unassigned' ? 'none' : row.id,
                      })}
                      className="dash-legend-row"
                      title={`Open ${label(row)}'s work on the board`}
                      {...hover}
                      onFocus={hover.onMouseEnter}
                      onBlur={hover.onMouseLeave}
                    >
                      {body}
                    </DashLink>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
