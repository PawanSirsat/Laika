import { useEffect, useMemo, useState } from 'react';
import { attachTo, type EditorAttach } from './attachment-upload.ts';
import { getOrg } from './org.ts';

/**
 * The board's attachment limit (D-150): `OrgView.attachments.max_bytes`,
 * `null` when the board has no store, `undefined` until `/org` answers. Read
 * from the cached `/org` every screen already asks for (`client.ts`), so a
 * panel with four editors costs no more requests than one.
 */
export function useAttachmentLimit(): number | null | undefined {
  const [limit, setLimit] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    getOrg(controller.signal)
      .then((org) => {
        if (!controller.signal.aborted) setLimit(org.attachments?.max_bytes ?? null);
      })
      .catch(() => {
        // Unreadable is off: no paperclip beats one that fails on every file.
        if (!controller.signal.aborted) setLimit(null);
      });
    return () => {
      controller.abort();
    };
  }, []);
  return limit;
}

/**
 * What an editor attaches files with, aimed at `slug` and `taskId` (LAI-1301)
 * — or `undefined` where the board has no store, or has not said yet, so the
 * editor shows no paperclip and behaves exactly as it did before D-150.
 */
export function useEditorAttach(
  slug: string | undefined,
  taskId: string | undefined,
): EditorAttach | undefined {
  const limit = useAttachmentLimit();
  return useMemo(
    () =>
      slug === undefined || limit === null || limit === undefined
        ? undefined
        : attachTo(slug, taskId, limit),
    [slug, taskId, limit],
  );
}
