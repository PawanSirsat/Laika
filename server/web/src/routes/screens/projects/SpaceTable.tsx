import type { Project } from '../../../api/projects.ts';
import { ago, progressOf, spaceSubline, updatedAt } from './spaces-model.ts';
import {
  AccessBadge,
  SpaceActions,
  SpaceAvatar,
  SpaceBar,
  SpaceCounts,
  SpaceFaces,
  type SpaceItemProps,
} from './SpaceParts.tsx';

export interface SpaceTableProps {
  readonly spaces: readonly Project[];
  readonly label: string;
  readonly row: (space: Project) => SpaceItemProps;
}

/**
 * A section of the list view (D-103 item 12, LAI-978).
 *
 * **Fixed column widths, and every cell truncates inside its own column.** The
 * owner's list screenshot ran Members into Updated (`4 peopl2h ago`); with
 * `table-layout: fixed` a cell cannot grow into its neighbour, and a long name
 * ends in an ellipsis rather than overlapping. Below a tablet width the table
 * stacks into one block per space, each cell labelled.
 */
export function SpaceTable({ spaces, label, row }: SpaceTableProps) {
  return (
    <div className="spaces-table-wrap">
      <table className="spaces-table" aria-label={label}>
        <colgroup>
          <col className="spaces-col-space" />
          <col className="spaces-col-access" />
          <col className="spaces-col-progress" />
          <col className="spaces-col-blocked" />
          <col className="spaces-col-members" />
          <col className="spaces-col-updated" />
          <col className="spaces-col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Space</th>
            <th scope="col">Access</th>
            <th scope="col">Progress</th>
            <th scope="col">Blocked</th>
            <th scope="col">Members</th>
            <th scope="col">Updated</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {spaces.map((space) => (
            <SpaceRow key={space.id} {...row(space)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpaceRow(props: SpaceItemProps) {
  const { space, kind, theme, now, handlers } = props;
  const blocked = progressOf(space).blocked;
  return (
    <tr
      className={kind === 'archived' ? 'space-row space-row-archived' : 'space-row'}
      data-space={space.slug}
    >
      <td className="space-cell-space" data-label="Space">
        <span className="space-cell-who">
          <SpaceAvatar space={space} size="md" />
          <span className="space-cell-names">
            {kind === 'yours' ? (
              <button
                type="button"
                className="space-cell-name project-card-open"
                onClick={() => {
                  handlers.onOpen(space);
                }}
              >
                {space.name}
              </button>
            ) : (
              <span className="space-cell-name">{space.name}</span>
            )}
            <span className="space-cell-sub">{spaceSubline(space)}</span>
          </span>
        </span>
      </td>
      <td data-label="Access">
        <AccessBadge space={space} />
      </td>
      <td className="space-cell-progress" data-label="Progress">
        <SpaceBar space={space} />
        <SpaceCounts space={space} blocked={false} />
      </td>
      <td data-label="Blocked">
        <span className={blocked > 0 ? 'space-cell-blocked' : 'space-cell-blocked-none'}>
          {blocked}
        </span>
      </td>
      <td className="space-cell-members" data-label="Members">
        <span className="space-cell-who">
          <SpaceFaces space={space} theme={theme} />
          <span className="space-cell-people">
            {space.member_count} {space.member_count === 1 ? 'person' : 'people'}
          </span>
        </span>
      </td>
      <td className="space-cell-updated" data-label="Updated">
        {ago(updatedAt(space), now)}
      </td>
      <td className="space-cell-actions">
        <span className="space-row-actions">
          <SpaceActions {...props} settingsLabel="text" />
        </span>
      </td>
    </tr>
  );
}
