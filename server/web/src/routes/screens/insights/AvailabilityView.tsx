import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { listPeopleAvailability, type AvailabilityRow } from '../../../api/availability.ts';
import { projectRoleLabel, type ProjectRole } from '../../../api/members.ts';
import { useGates } from '../../../api/permissions.ts';
import { useProjects } from '../../../api/use-projects.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Switch } from '../../../components/Switch.tsx';
import { AvailabilityPill } from '../../../components/availability/AvailabilityPill.tsx';
import {
  canTake,
  firstName,
  hoursMinutes,
  tagsOf,
  updatedAgo,
} from '../../../components/availability/availability-derive.ts';
import '../../../components/availability/availability.css';
import { AddToProjectDialog, type AddableSpace } from './AddToProjectDialog.tsx';
import { TIME_REPORT_READ, TIME_REPORT_READ_PROJECT } from './time-tab.ts';

type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly rows: readonly AvailabilityRow[] };

/** The action that lets a reader put someone in a space (§3.2). */
const MANAGE_MEMBERS = 'project.members.manage';

/**
 * Insights → Time → **Availability** (frames 2g–2i, 2n–2o; D-131, D-137;
 * LAI-1139): who has room for another project, and *Add to project…*.
 *
 * - **A–Z, never by how busy someone is** (D-088 item 1). The server sorts;
 *   the list has no sort control and asks for none.
 * - **Every column past the pill is the server's to send** (D-137): *Can
 *   take* for a space admin and up, *In progress* where it is counted, *Last
 *   2 weeks* only with *See everyone's analytics* — a column whose field never
 *   came is not drawn, so nobody reads an empty column as a zero.
 * - **No free hours** (plan frame 2m, owner answer d): there is no such column.
 * - Deactivated people are not on the list; the server leaves them out.
 */
export function AvailabilityView({ now = Date.now() }: { readonly now?: number }) {
  const gates = useGates();
  const projects = useProjects();
  const [space, setSpace] = useState<string | undefined>(undefined);
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [openOnly, setOpenOnly] = useState(false);
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [asked, setAsked] = useState(0);
  const [knownTags, setKnownTags] = useState<readonly string[]>([]);
  const [adding, setAdding] = useState<AvailabilityRow | undefined>(undefined);
  const [added, setAdded] = useState<Readonly<Record<string, string>>>({});
  const trigger = useRef<HTMLElement | null>(null);
  const id = useId();

  useEffect(() => {
    const controller = new AbortController();
    setList((l) => (l.status === 'ready' ? l : { status: 'loading' }));
    listPeopleAvailability({ space, tag, openOnly }, controller.signal)
      .then((answer) => {
        if (controller.signal.aborted) return;
        setList({ status: 'ready', rows: answer.data });
        // The tag filter offers what people carry: learnt from an unfiltered read.
        if (tag === undefined)
          setKnownTags((was) =>
            [...new Set([...was, ...tagsOf(answer.data)])].sort((a, b) => a.localeCompare(b)),
          );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setList({ status: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [space, tag, openOnly, asked]);

  const reload = useCallback(() => {
    setAsked((n) => n + 1);
  }, []);

  const visible = projects.status === 'ready' ? projects.projects : [];
  const addable: readonly AddableSpace[] = useMemo(
    () =>
      visible
        .filter((p) => gates.project(p.id, MANAGE_MEMBERS))
        .map((p) => ({ id: p.id, slug: p.slug, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [visible, gates],
  );
  // The Space filter (review item 6): everyone's spaces for an owner or an
  // analytics reader; for a space admin, only the spaces they lead — the only
  // people the server lists for them (D-137 item 2).
  const readsAll = gates.org(TIME_REPORT_READ);
  const filterable = [...visible]
    .filter((p) => readsAll || gates.project(p.id, TIME_REPORT_READ_PROJECT))
    .sort((a, b) => a.name.localeCompare(b.name));
  const spaceName = visible.find((p) => p.slug === space)?.name;

  if (list.status === 'loading') {
    return <LoadingState shape="table" count={6} label="Reading who has room" />;
  }
  if (list.status === 'error') {
    return <ApiErrorState error={list.error} resource="availability" onRetry={reload} />;
  }

  const rows = list.rows;
  const has = (field: 'in_progress' | 'last_2_weeks_minutes'): boolean =>
    rows.some((r) => r[field] !== undefined);
  const showCanTake = rows.some((r) => r.availability?.hours_per_week !== undefined);
  const showInProgress = has('in_progress');
  const showLast2 = has('last_2_weeks_minutes');
  const canAdd = (row: AvailabilityRow): boolean =>
    addable.some((s) => !row.spaces.some((m) => m.id === s.id));

  const filtered = space !== undefined || tag !== undefined || openOnly;
  const count = `${String(rows.length)} ${rows.length === 1 ? 'person' : 'people'}`;

  const openAdd = (row: AvailabilityRow, from: HTMLElement): void => {
    trigger.current = from;
    setAdding(row);
  };

  return (
    <section className="avail-view" aria-labelledby={`${id}-title`} data-availability-view>
      <header className="avail-view-head">
        <h2 className="avail-view-title" id={`${id}-title`}>
          Availability <span>Who has room for another project?</span>
        </h2>
        <span className="avail-notice">
          Owners, admins and space admins · read-only · people can see who looked
        </span>
      </header>

      <div className="avail-filters">
        <span className="avail-filter">
          <span id={`${id}-space`}>Space</span>
          <Dropdown
            value={space ?? ''}
            aria-labelledby={`${id}-space`}
            className="avail-filter-pick"
            options={[
              { value: '', label: 'All spaces' },
              ...filterable.map((p) => ({ value: p.slug, label: p.name })),
            ]}
            onChange={(v) => {
              setSpace(v === '' ? undefined : v);
            }}
          />
        </span>
        <span className="avail-filter">
          <span id={`${id}-tag`}>Skills / areas</span>
          <Dropdown
            value={tag ?? ''}
            aria-labelledby={`${id}-tag`}
            className="avail-filter-pick"
            options={[
              { value: '', label: 'Any' },
              ...knownTags.map((t) => ({ value: t, label: t })),
            ]}
            onChange={(v) => {
              setTag(v === '' ? undefined : v);
            }}
          />
        </span>
        <Switch checked={openOnly} onChange={setOpenOnly} className="avail-filter">
          Open to more work only
        </Switch>
      </div>

      <p className="avail-count" data-availability-count>
        {count} · sorted A–Z, never by how busy someone is
      </p>

      {rows.length === 0 ? (
        <div className="avail-empty" data-availability-empty>
          <p className="avail-empty-title">
            {openOnly
              ? `Nobody has marked themselves open to more work in ${space === undefined ? 'any space' : 'this space'}.`
              : 'Nobody matches these filters.'}
          </p>
          <p className="avail-quiet">
            Availability is set by each person from My day. People at capacity or away are still
            listed when the filter is off.
          </p>
          {filtered && (
            <button
              type="button"
              className="avail-link"
              onClick={() => {
                if (openOnly) {
                  setOpenOnly(false);
                } else {
                  setSpace(undefined);
                  setTag(undefined);
                }
              }}
            >
              {openOnly ? `Show everyone in ${spaceName ?? 'all spaces'}` : 'Clear filters'}
            </button>
          )}
        </div>
      ) : (
        <>
          <table
            className="avail-table"
            aria-label={`People in ${spaceName ?? 'all spaces'}, sorted A to Z`}
          >
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Availability</th>
                {showCanTake && <th scope="col">Can take</th>}
                <th scope="col">Projects</th>
                {showInProgress && (
                  <th scope="col" className="avail-num">
                    In progress
                  </th>
                )}
                {showLast2 && (
                  <th scope="col" className="avail-num">
                    Last 2 weeks
                  </th>
                )}
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const updated = updatedAgo(row.availability?.updated_at, now);
                return (
                  <tr key={row.user.id} data-person={row.user.id}>
                    <td>
                      <Person row={row} done={added[row.user.id]} />
                    </td>
                    <td>
                      <div className="avail-person">
                        <AvailabilityPill availability={row.availability} hideHours />
                        {row.availability === null && <span className="avail-quiet">Not set</span>}
                        {updated !== null && (
                          <span className="avail-quiet" data-stale={updated.stale}>
                            {updated.text}
                            {updated.stale && ' · may be out of date'}
                          </span>
                        )}
                      </div>
                    </td>
                    {showCanTake && <td>{canTake(row.availability)}</td>}
                    <td>
                      <Spaces row={row} />
                    </td>
                    {showInProgress && <td className="avail-num">{row.in_progress ?? '—'}</td>}
                    {showLast2 && (
                      <td className="avail-num">
                        {row.last_2_weeks_minutes === undefined
                          ? '—'
                          : hoursMinutes(row.last_2_weeks_minutes)}
                      </td>
                    )}
                    <td>
                      {canAdd(row) && (
                        <button
                          type="button"
                          className="avail-add"
                          aria-label={`Add ${row.user.name} to a project`}
                          onClick={(e) => {
                            openAdd(row, e.currentTarget);
                          }}
                        >
                          Add to project…
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <ul
            className="avail-cards"
            aria-label={`People in ${spaceName ?? 'all spaces'}, sorted A to Z`}
          >
            {rows.map((row) => (
              <li key={row.user.id} className="avail-card" data-person-card={row.user.id}>
                <Person row={row} done={added[row.user.id]} />
                <AvailabilityPill availability={row.availability} hideHours />
                <div className="avail-card-facts">
                  {showCanTake && <span>Can take {canTake(row.availability)}</span>}
                  {showInProgress && <span>In progress {row.in_progress ?? '—'}</span>}
                  {showLast2 && row.last_2_weeks_minutes !== undefined && (
                    <span>Last 2 weeks {hoursMinutes(row.last_2_weeks_minutes)}</span>
                  )}
                </div>
                <Spaces row={row} />
                {canAdd(row) && (
                  <button
                    type="button"
                    className="avail-add"
                    aria-label={`Add ${row.user.name} to a project`}
                    onClick={(e) => {
                      openAdd(row, e.currentTarget);
                    }}
                  >
                    Add to project…
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {adding !== undefined && (
        <AddToProjectDialog
          row={adding}
          spaces={addable}
          onAdded={(to: AddableSpace, role: ProjectRole) => {
            setAdded((a) => ({
              ...a,
              [adding.user.id]:
                `Added to ${to.name} as ${projectRoleLabel(role)} · ${firstName(adding.user.name)} was notified`,
            }));
            setAdding(undefined);
            reload();
          }}
          onStale={reload}
          onClose={() => {
            setAdding(undefined);
          }}
          restore={() => trigger.current}
        />
      )}
    </section>
  );
}

function Person({
  row,
  done,
}: {
  readonly row: AvailabilityRow;
  readonly done: string | undefined;
}) {
  const a = row.availability;
  return (
    <div className="avail-person">
      <span className="avail-person-name">{row.user.name}</span>
      {a?.note !== null && a?.note !== undefined && <span className="avail-note">“{a.note}”</span>}
      {a !== null && a.tags.length > 0 && (
        <span className="avail-tagrow">
          {a.tags.map((t) => (
            <span key={t} className="avail-chip">
              {t}
            </span>
          ))}
        </span>
      )}
      {done !== undefined && (
        <span className="avail-done" role="status">
          ✓ {done}
        </span>
      )}
    </div>
  );
}

function Spaces({ row }: { readonly row: AvailabilityRow }) {
  if (row.spaces.length === 0) return <span className="avail-quiet">—</span>;
  return (
    <span className="avail-spaces">
      {row.spaces.map((s) => (
        <span key={s.id} className="avail-chip">
          {s.name}
        </span>
      ))}
    </span>
  );
}
