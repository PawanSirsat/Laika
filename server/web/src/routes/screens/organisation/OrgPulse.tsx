import { useCallback, useEffect, useState } from 'react';
import { getOrgOverview, type OrgOverview } from '../../../api/org.ts';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { pulseTiles } from './org-pulse.ts';

type PulseState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly overview: OrgOverview };

/**
 * The organisation's pulse (LAI-989): people seen this week and the open,
 * in-review, blocked and overdue work, in the Overview's own tile style.
 *
 * Its own request and its own failure: the Overview's other figures and its
 * settings still read when this one cannot, so a failure is a line with a
 * retry rather than an error state over the tab.
 */
export function OrgPulse() {
  const [state, setState] = useState<PulseState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    getOrgOverview(controller.signal).then(
      (overview) => {
        if (!controller.signal.aborted) setState({ status: 'ready', overview });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt]);

  if (state.status === 'error') {
    return (
      <p className="org-note org-pulse-error" role="alert">
        The organisation’s pulse could not be read.{' '}
        <button type="button" className="bar-control" onClick={retry}>
          Try again
        </button>
      </p>
    );
  }

  if (state.status === 'loading') {
    return <LoadingState shape="row" count={1} label="Reading the organisation’s pulse" />;
  }

  return (
    <dl className="org-stats org-pulse" aria-label="This week">
      {pulseTiles(state.overview).map((tile) => (
        <div key={tile.id} className="org-stat" data-pulse={tile.id}>
          <dt>{tile.label}</dt>
          <dd>
            <span className="org-stat-value">{tile.value}</span>
            <span className="org-stat-sub">{tile.sub}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
