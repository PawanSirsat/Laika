import { type Db } from './client.ts';
import { type TaskStatus } from './enums.ts';
import { newId } from './ids.ts';
import { boardColumns, boardColumnStatuses } from './schema.ts';

/**
 * The seed shapes a board starts from (LAI-266).
 *
 * **In `db/` rather than beside the service that owns the rest of the feature**,
 * and the reason is a layering rule rather than taste: `db/backfill.ts` has to
 * create these rows for projects that predate the table, and CONVENTIONS §2
 * makes `db/` the bottom layer — it imports none of the others. A backfill
 * reaching up into `services/` inverts that, and eslint refuses it.
 *
 * So the data and the one function that writes it live here, and
 * `services/board-columns.ts` re-exports them for everybody else.
 */

export interface ColumnSeed {
  name: string;
  /** Primary first — the order is the contract, not a detail. */
  statuses: readonly TaskStatus[];
  hidden?: boolean;
}

export const COLUMN_NAME_MAX = 40;

/**
 * What a **new** project gets: four lanes, plus `cancelled`'s hidden home.
 *
 * **`todo` is listed before `backlog` deliberately, and it is not cosmetic.**
 * The first status is the primary — what a drop sets and what the lane's colour
 * comes from — so the order decides two visible things:
 *
 *  - a card dropped on "To do" becomes `todo`, which is what the label says. Had
 *    `backlog` been first, the List view's pill would read *Backlog* on a card
 *    the board shows under *To do*, which is the kind of disagreement people
 *    report as a bug;
 *  - the client has no `.lane-dot-backlog` rule — its absence is asserted on
 *    purpose — so a "To do" column whose primary is `backlog` draws the grey
 *    fallback dot. With `todo` first the default board is chromatically
 *    identical to the one this replaced.
 */
export const DEFAULT_COLUMNS: readonly ColumnSeed[] = [
  { name: 'To do', statuses: ['todo', 'backlog'] },
  { name: 'In progress', statuses: ['in_progress'] },
  { name: 'Review', statuses: ['review'] },
  { name: 'Done', statuses: ['done'] },
  { name: 'Cancelled', statuses: ['cancelled'], hidden: true },
];

/**
 * What a project that **predates** this table gets.
 *
 * Five lanes, one status each, named exactly as the client's `COLUMN_LABELS`
 * named them. Not `DEFAULT_COLUMNS`: upgrading must not reshape a board somebody
 * is already using, and silently merging their Backlog and To do lanes on boot
 * is the worst outcome this feature could have. A lead who wants the four-column
 * shape can merge them in two clicks; nobody can undo it being done to them.
 */
export const BACKFILL_COLUMNS: readonly ColumnSeed[] = [
  { name: 'Backlog', statuses: ['backlog'] },
  { name: 'To do', statuses: ['todo'] },
  { name: 'In progress', statuses: ['in_progress'] },
  { name: 'Review', statuses: ['review'] },
  { name: 'Done', statuses: ['done'] },
  { name: 'Cancelled', statuses: ['cancelled'], hidden: true },
];

/**
 * Write a seed set for a project that has none.
 *
 * **No `can()`, and that is not an exception to §5's rule.** It reads and writes
 * nothing the caller has not already been authorised for: every caller is inside
 * a transaction that has just created the project, or is the migration backfill
 * acting as no one. There is no actor to ask about and no resource that existed
 * before this call. `createProject` has already answered `project.create`.
 *
 * Exported because three callers need it and the third is the one that gets
 * missed: `createProject`, first-boot setup, and the test `seed()` helper.
 */
export function createDefaultBoardColumns(
  db: Db,
  projectId: string,
  now: number,
  seeds: readonly ColumnSeed[] = DEFAULT_COLUMNS,
): void {
  seeds.forEach((seed, position) => {
    const id = newId();

    db.insert(boardColumns)
      .values({
        id,
        projectId,
        name: seed.name,
        position,
        hidden: seed.hidden === true ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(boardColumnStatuses)
      .values(
        seed.statuses.map((status, i) => ({
          projectId,
          status,
          columnId: id,
          isPrimary: i === 0 ? 1 : 0,
          createdAt: now,
        })),
      )
      .run();
  });
}
