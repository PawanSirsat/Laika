import { useState } from 'react';
import { dateTime } from '../../../../api/time-label.ts';
import type { ProfileCurrentWork, ProfileDelivery, ProfileTask } from '../../../../api/profiles.ts';
import { durationLabel, workTab } from '../profile-derive.ts';
import { capNote, deliveredLine, moreLabel, WORK_ROWS, type WorkList } from './overview-derive.ts';
import { CardLink, follow, OverviewCard } from './OverviewCard.tsx';
import { Tabs, tabId } from '../../../../components/tabs/Tabs.tsx';

const TILES: readonly (readonly [WorkList, string])[] = [
  ['in_progress', 'In progress'],
  ['in_review', 'In review'],
  ['due', 'Due in 7 days'],
];

/** One row: key, the title cut to fit (whole on hover), and how long. */
function TaskRow({
  task,
  now,
  list,
}: {
  readonly task: ProfileTask;
  readonly now: number;
  readonly list: WorkList;
}) {
  const since = list === 'in_review' ? task.review_since : task.started_at;
  const age = since === null ? '—' : durationLabel(Math.max(0, now - since));
  return (
    <li className="ov-work-row" data-task={task.key}>
      <span className="prof-key">{task.key}</span>
      <span className="prof-task-title" title={task.title}>
        {task.title}
      </span>
      <span
        className="prof-when"
        title={
          since === null
            ? undefined
            : list === 'in_review'
              ? `In Review since ${dateTime(since, now)}`
              : `First started ${dateTime(since, now)}`
        }
      >
        {list === 'in_review' && since !== null ? `waiting ${age}` : age}
      </span>
    </li>
  );
}

/**
 * Work (SPEC §11.4.2.1, frame A): three tiles that are its tabs — In
 * progress, In review, Due in 7 days — then five rows of the chosen list,
 * longest running or waiting first (the server's order). *Show all* opens the
 * rest inside the card in a bounded scroll, as many as the server sent (its
 * cap is 50). The footer is the delivery record in one line (D-139 item 8).
 *
 * **Due in 7 days is a count only**: the profile serves `due_7d` and no list
 * of those cards, so that tab says how many and sends the reader to Work for
 * them rather than inventing rows.
 */
export function WorkCard({
  work,
  delivery,
  joined,
  workHref,
  onWork,
  weeks,
  now,
}: {
  /** Absent from a response that predates D-139 item 2: read as nothing open. */
  readonly work: ProfileCurrentWork | undefined;
  readonly delivery: ProfileDelivery | undefined;
  readonly joined: { readonly at: number; readonly since: number };
  readonly workHref: string;
  readonly onWork: () => void;
  /** The window the footer counts over: the profile's twelve weeks. */
  readonly weeks: number;
  readonly now: number;
}) {
  const inProgress = work?.in_progress ?? [];
  const inReview = work?.in_review ?? [];
  const counts: Readonly<Record<WorkList, number | undefined>> = {
    in_progress: work?.in_progress_total ?? 0,
    in_review: work?.in_review_total ?? 0,
    due: work?.due_7d,
  };
  const [list, setList] = useState<WorkList>(() =>
    workTab({ in_progress_total: counts.in_progress ?? 0, in_review_total: counts.in_review ?? 0 }),
  );
  const [all, setAll] = useState(false);
  // The server sends in-progress work oldest start first.
  const oldest = inProgress.find((task) => task.started_at !== null)?.started_at ?? null;
  const rows = list === 'in_progress' ? inProgress : list === 'in_review' ? inReview : [];
  const total = counts[list] ?? 0;
  const shown = all ? rows : rows.slice(0, WORK_ROWS);
  const note = all ? capNote(rows.length, total) : undefined;
  const panelId = 'prof-work-panel';

  return (
    <OverviewCard
      name="work"
      title="Work"
      caption={oldest === null ? undefined : `oldest started ${durationLabel(now - oldest)}`}
      link={
        <CardLink name="work" href={workHref} onGo={onWork}>
          Open in Work
        </CardLink>
      }
    >
      <Tabs
        label="Which work"
        className="ov-work-tiles"
        tabClassName="ov-work-tile"
        idBase="prof-work-tab"
        panelId={panelId}
        selected={list}
        onSelect={(id) => {
          setList(id);
          setAll(false);
        }}
        items={TILES.map(([id, label]) => {
          const n = counts[id];
          return {
            id,
            data: { 'data-work-tab': id },
            label: (
              <>
                <span className="ov-work-tile-label">{label}</span>
                <span className="ov-work-tile-n">
                  {n === undefined ? '—' : n.toLocaleString('en-GB')}
                </span>
              </>
            ),
          };
        })}
      />

      <div
        className="ov-work-panel"
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId('prof-work-tab', list)}
        data-expanded={all}
        tabIndex={all ? 0 : undefined}
      >
        {list === 'due' ? (
          <p className="prof-empty" data-work-due>
            {total === 0 ? (
              'Nothing due in the next 7 days.'
            ) : (
              <>
                {total.toLocaleString('en-GB')} due in the next 7 days.{' '}
                <a className="ov-link" href={workHref} onClick={follow(onWork)}>
                  See them in Work
                </a>
              </>
            )}
          </p>
        ) : shown.length === 0 ? (
          <p className="prof-empty">Nothing here right now.</p>
        ) : (
          <ul
            className="ov-work-list"
            aria-label={list === 'in_progress' ? 'Cards in progress' : 'Cards in review'}
          >
            {shown.map((task) => (
              <TaskRow key={task.id} task={task} now={now} list={list} />
            ))}
          </ul>
        )}
        {note !== undefined && <p className="prof-more">{note}</p>}
      </div>

      {list !== 'due' && rows.length > WORK_ROWS && (
        <button
          type="button"
          className="ov-more"
          aria-expanded={all}
          aria-controls={panelId}
          onClick={() => {
            setAll((open) => !open);
          }}
        >
          {moreLabel(all, total)}
        </button>
      )}

      <p className="ov-foot" data-delivered>
        <b>Delivered · {weeks} weeks</b> · {deliveredLine(delivery, { ...joined, now })}
      </p>
    </OverviewCard>
  );
}
