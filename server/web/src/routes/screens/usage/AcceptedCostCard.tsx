import { agentClientName } from '../../../api/agent-clients.ts';
import { compactTokens, COST_LABEL, costText, usd, type Usage } from '../../../api/usage.ts';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { InfoTip } from '../profile/InfoTip.tsx';
import { CostCaveats } from './CostCaveats.tsx';

/**
 * *Cost per accepted task* (LAI-773; the estimation research's idea 2): what
 * the work a person accepted in the range cost, API-equivalent, per space and
 * per agent — **never per person**, and an agent only where at least three
 * people stand behind its figure, since with fewer it would be a person's.
 */
export function AcceptedCostCard({ usage }: { readonly usage: Usage }) {
  const { accepted } = usage;
  return (
    <section
      className="prof-card usage-card"
      data-section="accepted"
      aria-labelledby="usage-accepted-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="usage-accepted-title">
          Cost per accepted task
        </h3>
        <span className="prof-card-caption">{COST_LABEL}</span>
        <InfoTip label="About cost per accepted task">
          <p className="usage-info">
            Every task a person accepted in this range, with all the tokens tied to it — the build
            and any rework — priced at list price on the vendor’s API. Per space and per agent,
            never per person; an agent is shown only where at least three people used it on these
            tasks.
          </p>
        </InfoTip>
      </header>
      {accepted.by_project.length === 0 ? (
        <p className="prof-empty">No task was accepted in this range.</p>
      ) : (
        <table className="usage-table" aria-label="Cost per accepted task, by space">
          <thead>
            <tr>
              <th scope="col">Space</th>
              <th scope="col">Accepted</th>
              <th scope="col">Per task</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {accepted.by_project.map((p) => (
              <tr key={p.project.slug}>
                <th scope="row">{p.project.name}</th>
                <td>{p.tasks}</td>
                <td className="usage-money">{usd(p.cost_per_task)}</td>
                <td className="usage-money" title={`${compactTokens(p.tokens)} tokens`}>
                  {costText(p.cost)}
                  <CostCaveats cost={p.cost} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {accepted.by_agent.length > 0 && (
        <table className="usage-table" aria-label="Cost per accepted task, by agent">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Tasks</th>
              <th scope="col">Per task</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {accepted.by_agent.map((a) => (
              <tr key={a.agent}>
                <th scope="row">
                  <span className="usage-row-name">
                    <AgentMark client={a.agent} size="sm" /> {agentClientName(a.agent)}
                  </span>
                </th>
                <td>{a.tasks}</td>
                <td className="usage-money">{usd(a.cost_per_task)}</td>
                <td className="usage-money">
                  {costText(a.cost)}
                  <CostCaveats cost={a.cost} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {accepted.agents_withheld > 0 && (
        <p className="usage-cost-caveat" data-withheld>
          {accepted.agents_withheld === 1
            ? '1 agent is not shown: fewer than three people used it on these tasks.'
            : `${String(accepted.agents_withheld)} agents are not shown: fewer than three people used each on these tasks.`}
        </p>
      )}
    </section>
  );
}
