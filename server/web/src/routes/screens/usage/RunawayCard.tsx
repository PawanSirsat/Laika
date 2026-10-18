import type { Usage } from '../../../api/usage.ts';
import { InfoTip } from '../profile/InfoTip.tsx';

/**
 * Runaway-agent alerts per space, for owners and admins (LAI-773): **a count,
 * a day after the assignee heard**, never which task or whose, in space name
 * order — never a ranking. Drawn only when the server sent it.
 */
export function RunawayCard({ usage }: { readonly usage: Usage }) {
  if (usage.runaway === null) return null;
  return (
    <section
      className="prof-card usage-card"
      data-section="runaway"
      aria-labelledby="usage-runaway-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="usage-runaway-title">
          Runaway-agent alerts
        </h3>
        <span className="prof-card-caption">a count per space · after a day</span>
        <InfoTip label="About runaway-agent alerts">
          <p className="usage-info">
            A claimed task whose agent spent past its forecast’s p95 with nothing landing for an
            hour. The person working it is told first and alone; here it is only counted, a day
            later, and never says which task or whose.
          </p>
        </InfoTip>
      </header>
      {usage.runaway.length === 0 ? (
        <p className="prof-empty">None in this range.</p>
      ) : (
        <ul className="usage-rework">
          {usage.runaway.map((r) => (
            <li key={r.project.slug} className="usage-rework-row" data-runaway={r.project.slug}>
              <span className="usage-rework-name">{r.project.name}</span>
              <span className="usage-rework-line">
                {String(r.alerts)} {r.alerts === 1 ? 'alert' : 'alerts'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
