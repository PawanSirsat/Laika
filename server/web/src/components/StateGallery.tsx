import { useState } from 'react';
import { ConnectionBanner } from './ConnectionBanner.tsx';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';
import { PermissionDenied } from './PermissionDenied.tsx';
import './state-gallery.css';

/**
 * Every state on one page (LAI-020 AC7), so they can be reviewed — and their
 * copy argued with — without navigating an app that does not exist yet.
 *
 * The copy below is the design's own wherever the prototype writes a sentence:
 * "Nothing in this lane", "Nothing waiting on review", "No projects yet",
 * "Nothing here for this filter", and the reconnect banner verbatim. The task
 * says those are better than anything invented here, and they are.
 *
 * The host in the banner is a prop, not the prototype's `laika.kvelld.internal`
 * — that string is a fixture (`docs/design/README.md`).
 */

interface Specimen {
  readonly title: string;
  readonly note: string;
  readonly render: () => React.ReactNode;
}

const SPECIMENS: readonly Specimen[] = [
  {
    title: 'Empty — board lane',
    note: "Prototype copy. Per-lane, not generic: 'review' says something different.",
    render: () => <EmptyState headline="Nothing in this lane" />,
  },
  {
    title: 'Empty — review lane',
    note: 'Same component, different sentence. This is the point of per-instance copy.',
    render: () => <EmptyState headline="Nothing waiting on review" />,
  },
  {
    title: 'Empty — filtered',
    note: 'Empty because of a filter is not empty because there is nothing.',
    render: () => (
      <EmptyState
        headline="Nothing here for this filter"
        body="Widen the range or switch the filter."
      />
    ),
  },
  {
    title: 'Empty — with an action',
    note: 'First-run. The action is the whole point of the screen.',
    render: () => (
      <EmptyState
        headline="No projects yet"
        body="Create the first one and point it at a repo."
        action={{ label: 'New project', onClick: () => undefined }}
      />
    ),
  },
  {
    title: 'Loading — cards',
    note: 'Shaped like the board cards it replaces, so nothing shifts.',
    render: () => <LoadingState shape="card" count={3} label="Loading tasks" />,
  },
  {
    title: 'Loading — rows',
    note: 'Shaped like a table row: avatar, key, title.',
    render: () => <LoadingState shape="row" count={4} label="Loading activity" />,
  },
  {
    title: 'Error — retryable',
    note: 'Says what failed, that retrying helps, and carries the request_id (SPEC §13.2).',
    render: () => (
      <ErrorState
        headline="Could not load the board"
        body="The server did not answer in time. This usually clears on a retry."
        requestId="01J9Z6M4Q7X2K8V3B1N5"
        onRetry={() => undefined}
      />
    ),
  },
  {
    title: 'Error — not retryable',
    note: 'No retry button, deliberately: mashing it cannot fix a rejected payload.',
    render: () => (
      <ErrorState
        headline="That task could not be saved"
        body="The status change was rejected as an illegal transition. Reload to see where the task actually is."
      />
    ),
  },
  {
    title: 'Permission denied — project',
    note: 'Distinct from empty. Names the role that would be allowed.',
    render: () => <PermissionDenied resource="this project" requiredRole="member" />,
  },
  {
    title: 'Permission denied — organisation',
    note: 'Org-scoped wording.',
    render: () => (
      <PermissionDenied
        resource="organisation settings"
        requiredRole="admin"
        scope="organisation"
      />
    ),
  },
  {
    title: 'Connection lost',
    note: 'Banner, not a blocking state — reads still work. Design copy, verbatim.',
    render: () => <ConnectionBanner host="laika.example.com" retryInSeconds={8} attempt={3} />,
  },
  {
    title: 'Connection lost — no countdown',
    note: 'Before the first scheduled attempt.',
    render: () => <ConnectionBanner host="laika.example.com" />,
  },
];

export function StateGallery() {
  // Proves the empty state's action is wired and focusable, without inventing
  // data: the counter is the gallery's own, not content.
  const [clicks, setClicks] = useState(0);

  return (
    <section className="gallery" aria-labelledby="gallery-heading">
      <h2 id="gallery-heading" className="gallery-heading">
        States
      </h2>
      <p className="gallery-sub">
        Empty, loading, error, permission-denied and connection-lost. Switch the theme above — all
        five are rendered from tokens. Actions fired: {clicks}
      </p>

      <div className="gallery-grid">
        {SPECIMENS.map((s) => (
          <article key={s.title} className="gallery-item">
            <header>
              <h3 className="gallery-item-title">{s.title}</h3>
              <p className="gallery-item-note">{s.note}</p>
            </header>
            <div
              className="gallery-stage"
              onClickCapture={() => {
                setClicks((n) => n + 1);
              }}
            >
              {s.render()}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
