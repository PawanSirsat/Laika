import { EmptyState } from '../../components/EmptyState.tsx';
import { ScreenHeader } from '../../components/ScreenHeader.tsx';
import { DEFAULT_PATH } from '../route-table.ts';

/**
 * A real 404, not a blank frame (LAI-019 AC6).
 *
 * The shell stays around it — sidebar, theme, chrome — so a mistyped URL leaves
 * the reader somewhere they can navigate out of, rather than at a dead page.
 */
export function NotFound({
  path,
  onNavigate,
}: {
  readonly path: string;
  readonly onNavigate: (to: string) => void;
}) {
  return (
    <>
      <ScreenHeader title="Not found" context="404" />

      <EmptyState
        headline="There is no screen at this address"
        body={`Nothing is routed at ${path}. It may have moved, or the link may be wrong.`}
        action={{
          label: 'Go to the board',
          onClick: () => {
            onNavigate(DEFAULT_PATH);
          },
        }}
      />
    </>
  );
}
