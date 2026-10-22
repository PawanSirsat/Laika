/**
 * A work folder's chosen name on My day (LAI-866, D-098): the name the person
 * gave a folder on their machine, and its branch when they turned that on —
 * never the folder's own name or path, which never reach the board.
 */

/** `Acme`, or `Acme · feature/x` with a branch; `undefined` with no name. */
export function folderOf(item: {
  readonly folder?: string | null;
  readonly branch?: string | null;
}): string | undefined {
  if (item.folder === undefined || item.folder === null) return undefined;
  return item.branch === undefined || item.branch === null
    ? item.folder
    : `${item.folder} · ${item.branch}`;
}

/** What an untied block reads: *Needs a card*, and its folder's name when it has one. */
export function needsACard(item: { readonly folder?: string | null }): string {
  return item.folder === undefined || item.folder === null
    ? 'Needs a card'
    : `Needs a card · ${item.folder}`;
}
