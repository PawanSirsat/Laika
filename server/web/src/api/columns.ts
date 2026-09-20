import { request } from './client.ts';
import { type TaskStatus } from './tasks.ts';

/**
 * Board columns (LAI-266).
 *
 * Mirrors `server/src/services/board-columns.ts` exactly — `BoardColumnView`
 * there, `BoardColumn` here, paired in `view-type-drift.test.ts` so a field
 * added on one side cannot go unseen on the other.
 *
 * **Every mutation returns the whole board**, and this module returns it
 * unchanged rather than picking out the column that was touched. Two reasons,
 * and the second is the one that matters: moving a status changes *two* columns,
 * and re-deriving the other one client-side would be a second opinion about
 * something the server already answered.
 *
 * Paths are built as literal templates because `endpoint-coverage.test.ts`
 * cannot follow a path assembled from a variable — and a check that cannot see a
 * call site reports full coverage, which is worse than reporting none.
 */

export interface BoardColumn {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly position: number;
  /** Holds statuses but draws no lane. `cancelled`'s home by default. */
  readonly hidden: boolean;
  /** Primary first. The order is configuration — see `primaryStatus`. */
  readonly statuses: readonly TaskStatus[];
  /** `null` for a column holding nothing, which is a legal state. */
  readonly primary_status: TaskStatus | null;
}

interface BoardResponse {
  readonly columns: readonly BoardColumn[];
}

export function listColumns(slug: string, signal?: AbortSignal): Promise<BoardResponse> {
  return request<BoardResponse>(
    `/projects/${encodeURIComponent(slug)}/board-columns`,
    signal === undefined ? {} : { signal },
  );
}

export function createColumn(slug: string, name: string): Promise<BoardResponse> {
  return request<BoardResponse>(`/projects/${encodeURIComponent(slug)}/board-columns`, {
    method: 'POST',
    body: { name },
  });
}

export function renameColumn(slug: string, columnId: string, name: string): Promise<BoardResponse> {
  return request<BoardResponse>(
    `/projects/${encodeURIComponent(slug)}/board-columns/${encodeURIComponent(columnId)}`,
    { method: 'PATCH', body: { name } },
  );
}

export function setColumnHidden(
  slug: string,
  columnId: string,
  hidden: boolean,
): Promise<BoardResponse> {
  return request<BoardResponse>(
    `/projects/${encodeURIComponent(slug)}/board-columns/${encodeURIComponent(columnId)}`,
    { method: 'PATCH', body: { hidden } },
  );
}

/**
 * Replace a column's statuses — **one request, not one per column**.
 *
 * Moving `review` from QA to In progress touches two columns. As two `PATCH`es
 * it can half-apply, and the half that lands leaves `review` in no column at
 * all, which is the one state the model forbids. The server does both sides
 * inside a transaction.
 */
export function setColumnStatuses(
  slug: string,
  columnId: string,
  statuses: readonly TaskStatus[],
): Promise<BoardResponse> {
  return request<BoardResponse>(
    `/projects/${encodeURIComponent(slug)}/board-columns/${encodeURIComponent(columnId)}/statuses`,
    { method: 'PUT', body: { statuses } },
  );
}

export interface DeleteColumnResult extends BoardResponse {
  /** What moved, so the screen can say so rather than guess. */
  readonly reassigned: readonly TaskStatus[];
}

/**
 * Delete a column, naming where its statuses go.
 *
 * The destination is **required** by the server, not defaulted. A column's
 * statuses have to live somewhere, and letting the caller omit it would make
 * "wherever seems reasonable" a decision nobody took.
 */
export function deleteColumn(
  slug: string,
  columnId: string,
  reassignToColumnId: string,
): Promise<DeleteColumnResult> {
  return request<DeleteColumnResult>(
    `/projects/${encodeURIComponent(slug)}/board-columns/${encodeURIComponent(columnId)}`,
    { method: 'DELETE', body: { reassign_to_column_id: reassignToColumnId } },
  );
}

/**
 * The whole order, every id exactly once.
 *
 * Sending the full list rather than a moved-id and a neighbour means a client
 * working from a stale board is refused instead of silently dropping a lane.
 */
export function reorderColumns(slug: string, columnIds: readonly string[]): Promise<BoardResponse> {
  return request<BoardResponse>(`/projects/${encodeURIComponent(slug)}/board-columns/reorder`, {
    method: 'POST',
    body: { column_ids: columnIds },
  });
}
