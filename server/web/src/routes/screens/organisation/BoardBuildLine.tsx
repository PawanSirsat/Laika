import { useEffect, useState } from 'react';
import { loadBoardBuild, type BoardBuild } from '../../../api/developer-compat.ts';

/**
 * The board's build on Organisation → Overview (LAI-1069, plan §J E3): one
 * quiet line naming the server version, the commit it was built from and the
 * helper protocol, from `GET /developer/compatibility`. Shown to owners and
 * admins only — the caller decides — and absent when the answer cannot be read,
 * rather than a guess.
 */
export function BoardBuildLine() {
  const [build, setBuild] = useState<BoardBuild | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    void loadBoardBuild(controller.signal).then(setBuild);
    return () => {
      controller.abort();
    };
  }, []);
  if (build === undefined) return null;
  return (
    <p className="org-board-build" data-board-build>
      Board build <span className="org-board-build-value">{build.version}</span>
      {' · '}
      {build.commit === null ? (
        'commit not recorded'
      ) : (
        <code className="org-board-build-value" title={build.commit}>
          {build.commit.slice(0, 12)}
        </code>
      )}
      {' · '}
      helper protocol <span className="org-board-build-value">{String(build.protocol)}</span>
      {build.minClient === build.protocol ? '' : ` (accepts ${String(build.minClient)}+)`}
    </p>
  );
}
