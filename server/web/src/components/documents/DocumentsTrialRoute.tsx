import { lazy, Suspense } from 'react';
import { LoadingState } from '../LoadingState.tsx';

/**
 * `/design/documents` in the route registry (LAI-1131).
 *
 * The only part of the deliverable trial in the entry chunk: everything else —
 * the renderer, lowlight, the fixtures and their diagrams — arrives through
 * this `import()`, as `StateGallery` loads its galleries. The bundle test in
 * `trial-fixtures.test.ts` fails if a fixture string reaches the entry chunk.
 */
const DocumentsTrial = lazy(() =>
  import('./trial/DocumentsTrial.tsx').then((m) => ({ default: m.DocumentsTrial })),
);

export function DocumentsTrialRoute() {
  return (
    <Suspense fallback={<LoadingState shape="card" count={2} label="Loading the document trial" />}>
      <DocumentsTrial />
    </Suspense>
  );
}
