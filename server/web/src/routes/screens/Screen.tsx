import { EmptyState } from '../../components/EmptyState.tsx';
import { SCREEN_COPY } from './screen-copy.ts';
import type { Route } from '../route-table.ts';
import './screen.css';

/**
 * A routed screen before its endpoints exist.
 *
 * One component rather than twelve near-identical files: the difference between
 * screens today is entirely their copy, and twelve wrappers around the same
 * `EmptyState` would be twelve files to delete later. Each screen gets its own
 * file when it gets its own behaviour — that is the task that has its endpoints.
 */
export function Screen({ route }: { readonly route: Route }) {
  const copy = SCREEN_COPY[route.path];

  return (
    <>
      <header className="screen-head">
        <h1 className="screen-title">{route.label}</h1>
        <p className="screen-phase">{route.phase}</p>
      </header>

      {copy === undefined ? (
        <EmptyState headline={route.label} />
      ) : (
        <EmptyState headline={copy.headline} body={copy.body} />
      )}
    </>
  );
}
