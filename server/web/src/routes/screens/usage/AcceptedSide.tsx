import { reworkLine, type Usage } from '../../../api/usage.ts';
import { InfoTip } from '../profile/InfoTip.tsx';

/**
 * Beside *Cost per accepted task* (LAI-1127, the owner's design): what
 * send-backs cost, and the runaway-agent alerts — once two cards of their own.
 *
 * *Rework* (LAI-772): per space, never per person — the cost of a false done,
 * in tokens and time. *Runaway-agent alerts* (LAI-773), for owners and admins:
 * **a count, a day after the assignee heard**, never which task or whose, in
 * space name order — never a ranking. Drawn only when the server sent it.
 */
export function AcceptedSide({ usage }: { readonly usage: Usage }) {
  return (
    <div className="usage-side">
      <section
        className="usage-side-item"
        data-section="rework"
        aria-labelledby="usage-rework-title"
      >
        <h4 className="usage-side-title" id="usage-rework-title">
          Rework
        </h4>
        <p className="usage-side-caption">after a send-back · per space, never per person</p>
        {usage.rework.length === 0 ? (
          <p className="usage-side-empty">Nothing sent back</p>
        ) : (
          <ul className="usage-rework">
            {usage.rework.map((r) => (
              <li key={r.project.slug} className="usage-rework-row">
                <span className="usage-rework-name">{r.project.name}</span>
                <span className="usage-rework-line">{reworkLine(r)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {usage.runaway !== null && (
        <section
          className="usage-side-item"
          data-section="runaway"
          aria-labelledby="usage-runaway-title"
        >
          <h4 className="usage-side-title" id="usage-runaway-title">
            Runaway-agent alerts{' '}
            <InfoTip label="About runaway-agent alerts">
              <p className="usage-info">
                A claimed task whose agent spent past its forecast’s p95 with nothing landing for an
                hour. The person working it is told first and alone; here it is only counted, a day
                later, and never says which task or whose.
              </p>
            </InfoTip>
          </h4>
          <p className="usage-side-caption">a count per space · after a day</p>
          {usage.runaway.length === 0 ? (
            <p className="usage-side-empty">None in this range</p>
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
      )}
    </div>
  );
}
