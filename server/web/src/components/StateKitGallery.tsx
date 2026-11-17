import { useState } from 'react';
import { ApiErrorPanel } from './ApiErrorPanel.tsx';
import { EmptyPanel } from './EmptyPanel.tsx';
import { ErrorPanel } from './ErrorPanel.tsx';
import { InlineBusy } from './InlineBusy.tsx';
import {
  Skeleton,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonText,
} from './Skeleton.tsx';
import { StaleBanner } from './StaleBanner.tsx';
import { ApiError, NetworkError } from '../api/errors.ts';
import './state-gallery.css';
import './state-kit.css';
import './state-kit-gallery.css';

/**
 * The LAI-1207 state kit on `/design/states`: every variant, and a working
 * example of each behaviour a test drives — a filter that Clear filters
 * clears, a load that is fast and one that is slow, a Retry that recovers,
 * a stale banner over rows that stay.
 *
 * Its own chunk, loaded by `StateGallery` with `import()`, so these example
 * rows reach the browser only on this page. Theme comes from the app's own
 * switch, as for the rest of the gallery: every rule is a token, so the page
 * is the same specimen in light and dark.
 */

const ROWS = ['Write the release notes', 'Rotate the deploy key', 'Answer the support thread'];

function Specimen({
  title,
  note,
  children,
  id,
}: {
  readonly title: string;
  readonly note: string;
  readonly children: React.ReactNode;
  readonly id: string;
}) {
  return (
    <article className="gallery-item" data-kit-specimen={id}>
      <header>
        <h3 className="gallery-item-title">{title}</h3>
        <p className="gallery-item-note">{note}</p>
      </header>
      <div className="gallery-stage">{children}</div>
    </article>
  );
}

function FilteredDemo() {
  const [filter, setFilter] = useState<string | null>('Tag: launch');
  const rows = filter === null ? ROWS : [];
  return (
    <div data-kit-demo="filtered">
      <p className="gallery-item-note" data-kit-filter>
        {filter === null ? 'No filter' : `Filtered by ${filter}`}{' '}
        {filter === null && (
          <button
            type="button"
            className="kit-link"
            onClick={() => {
              setFilter('Tag: launch');
            }}
          >
            Filter again
          </button>
        )}
      </p>
      {rows.length === 0 ? (
        <EmptyPanel
          variant="filtered"
          size="compact"
          title="Nothing matches this filter"
          why="There are tasks in this space; the filter hides them."
          onClearFilters={() => {
            setFilter(null);
          }}
        />
      ) : (
        <ul className="kit-demo-rows" data-kit-rows>
          {rows.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoadingDemo() {
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState(0);
  const run = (ms: number): void => {
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      setRuns((n) => n + 1);
    }, ms);
  };
  return (
    <div data-kit-demo="loading">
      <div className="empty-panel-actions kit-demo-controls">
        <button
          type="button"
          className="button button-secondary kit-btn kit-btn-sm"
          onClick={() => {
            run(100);
          }}
        >
          Fast load (0.1 s)
        </button>
        <button
          type="button"
          className="button button-secondary kit-btn kit-btn-sm"
          onClick={() => {
            run(1500);
          }}
        >
          Slow load (1.5 s)
        </button>
      </div>
      {loading ? (
        <Skeleton label="Loading tasks">
          {ROWS.map((r) => (
            <SkeletonTableRow key={r} avatar columns={['55%', '25%']} />
          ))}
        </Skeleton>
      ) : (
        <ul className="kit-demo-rows" data-kit-rows data-kit-runs={runs}>
          {ROWS.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RetryDemo() {
  const [state, setState] = useState<'error' | 'retrying' | 'ok'>('error');
  if (state === 'ok') {
    return (
      <ul className="kit-demo-rows" data-kit-rows>
        {ROWS.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    );
  }
  return (
    <div data-kit-demo="retry">
      <ApiErrorPanel
        error={new NetworkError(new Error('offline'))}
        resource="tasks"
        size="compact"
        retrying={state === 'retrying'}
        onRetry={() => {
          setState('retrying');
          window.setTimeout(() => {
            setState('ok');
          }, 600);
        }}
      />
    </div>
  );
}

function StaleDemo() {
  const [readAt, setReadAt] = useState(() => Date.now() - 4 * 60_000);
  const [stale, setStale] = useState(true);
  const [retrying, setRetrying] = useState(false);
  return (
    <div data-kit-demo="stale" className="kit-demo-stack">
      {stale && (
        <StaleBanner
          what="tasks"
          readAt={readAt}
          error={new ApiError('internal', 'boom', 500)}
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            window.setTimeout(() => {
              setRetrying(false);
              setStale(false);
              setReadAt(Date.now());
            }, 600);
          }}
        />
      )}
      <ul className="kit-demo-rows" data-kit-rows>
        {ROWS.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function InlineBusyDemo() {
  const [saving, setSaving] = useState(false);
  return (
    <div data-kit-demo="inline" className="empty-panel-actions kit-demo-controls">
      <button
        type="button"
        className="button button-secondary kit-btn kit-btn-sm"
        onClick={() => {
          setSaving(true);
          window.setTimeout(() => {
            setSaving(false);
          }, 1500);
        }}
      >
        Save (1.5 s)
      </button>
      <InlineBusy active={saving} label="Saving" />
    </div>
  );
}

export default function StateKitGallery() {
  return (
    <section className="kit-gallery" aria-labelledby="kit-gallery-heading" data-kit-gallery>
      <h2 id="kit-gallery-heading" className="gallery-heading">
        State kit
      </h2>
      <p className="gallery-sub">
        LAI-1207. Empty states are neutral and never announce themselves; skeletons hold the space
        at once and draw only after 300 ms; errors say what happened, why, and offer Retry when it
        could help; a failed refresh keeps the data and says how old it is. Switch the theme above —
        every rule is a token.
      </p>

      <div className="gallery-grid">
        <Specimen
          id="first-use"
          title="Empty — first use"
          note="Nothing made yet. One primary action, one quiet secondary."
        >
          <EmptyPanel
            variant="first-use"
            title="No tokens yet"
            why="Create one to point your coding agent at this board as you."
            action={{ label: 'Create token', onClick: () => undefined }}
            secondary={{ label: 'What can a token do?', onClick: () => undefined }}
          />
        </Specimen>

        <Specimen
          id="filtered"
          title="Empty — filtered, no match"
          note="Live: Clear filters clears it and the rows come back."
        >
          <FilteredDemo />
        </Specimen>

        <Specimen
          id="no-permission"
          title="Empty — not yours to add"
          note="Quiet, not a refusal. A 403 still renders the permission-denied state."
        >
          <EmptyPanel
            variant="no-permission"
            title="No columns you can change"
            why="Only space admins add or rename columns. Ask one if this board needs another."
          />
        </Specimen>

        <Specimen
          id="caught-up"
          title="Empty — all caught up"
          note="The good outcome. No action, because nothing is owed."
        >
          <EmptyPanel
            variant="caught-up"
            title="Nothing waiting on review"
            why="Everything submitted has been looked at."
          />
        </Specimen>

        <Specimen
          id="compact"
          title="Empty — compact, no icon"
          note="Inside a lane or a card, where an icon would crowd the space."
        >
          <EmptyPanel
            variant="first-use"
            size="compact"
            icon={false}
            title="Nothing in this lane"
          />
        </Specimen>

        <Specimen
          id="primitives"
          title="Loading — primitives"
          note="Text line, avatar, card, table row. Drawn at once here; on a screen, after 300 ms."
        >
          {/* On a card, as the real rows are: the bars are drawn in the
              column colour, which is also this stage's. */}
          <Skeleton label="Loading the example" delayMs={0} className="kit-demo-surface">
            <SkeletonText size="title" width="40%" />
            <SkeletonText lines={2} />
            <span className="kit-demo-avatars">
              <SkeletonAvatar size="sm" />
              <SkeletonAvatar />
              <SkeletonAvatar size="lg" />
            </span>
            <SkeletonCard />
            <SkeletonTableRow avatar />
          </Skeleton>
        </Specimen>

        <Specimen
          id="loading"
          title="Loading — delayed"
          note="Live: a fast load never draws the skeleton; a slow one draws it after 300 ms."
        >
          <LoadingDemo />
        </Specimen>

        <Specimen
          id="inline"
          title="Loading — inline busy"
          note="For a small region with no shape: a row saving, a panel re-checking."
        >
          <InlineBusyDemo />
        </Specimen>

        <Specimen
          id="error"
          title="Error — retryable"
          note="What happened, why, Retry, and a quiet way elsewhere. The request id is selectable."
        >
          <ErrorPanel
            title="Couldn’t load members"
            why="Laika hit a problem on its side. Trying again usually clears it."
            requestId="01J9Z6M4Q7X2K8V3B1N5"
            onRetry={() => undefined}
            help={{ label: 'Go to Spaces', onClick: () => undefined }}
          />
        </Specimen>

        <Specimen
          id="error-final"
          title="Error — not retryable"
          note="The server's own words, and no Retry: a rejected request fails the same way twice."
        >
          <ApiErrorPanel
            error={new ApiError('conflict', 'A column with that name already exists.', 409)}
            resource="the column"
            verb="save"
            onRetry={() => undefined}
          />
        </Specimen>

        <Specimen
          id="retry"
          title="Error — offline, Retry recovers"
          note="Live: Retry shows it is working, keeps focus, then the rows arrive."
        >
          <RetryDemo />
        </Specimen>

        <Specimen
          id="stale"
          title="Stale data"
          note="Live: the rows stay, the banner says how old they are, Retry refreshes."
        >
          <StaleDemo />
        </Specimen>
      </div>
    </section>
  );
}
