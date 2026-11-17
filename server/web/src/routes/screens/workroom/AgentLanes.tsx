import type { Lane } from './agent-lanes.ts';

/**
 * The four lanes (LAI-1199): label, the lane's fact, and the field it came
 * from. A lane with nothing behind it reads in words, never as another
 * lane's state.
 */
export function AgentLanes({ lanes }: { readonly lanes: readonly Lane[] }) {
  return (
    <dl className="wr-lanes">
      {lanes.map((lane) => (
        <div key={lane.id} className="wr-lane" data-lane={lane.id} data-state={lane.state}>
          <dt className="wr-lane-label">{lane.label}</dt>
          <dd className="wr-lane-value">
            <span className="wr-lane-dot" data-tone={lane.tone ?? 'none'} aria-hidden="true" />
            <span className="wr-lane-text">{lane.value}</span>
          </dd>
          {lane.detail !== undefined && <dd className="wr-lane-detail">{lane.detail}</dd>}
          <dd className="wr-lane-source">From: {lane.source}</dd>
        </div>
      ))}
    </dl>
  );
}
