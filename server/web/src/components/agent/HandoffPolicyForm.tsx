import { useId } from 'react';
import { Dropdown } from '../Dropdown.tsx';
import { Switch } from '../Switch.tsx';
import { OFFER_TTL_CHOICES, type HandoffPolicy } from './agent-states.ts';
import './agent.css';

export interface HandoffPolicyFormProps {
  readonly policy: HandoffPolicy;
  readonly onChange: (next: HandoffPolicy) => void;
  /** False for anyone who is not a project admin: the values are shown, not editable. */
  readonly mayEdit: boolean;
}

/** The most completed hand-offs one task may have; past it a person reassigns. */
const MAX_HANDOFFS = 10;

/**
 * A project's hand-off policy, on Settings → Access (LAI-536, proposal §4.5).
 *
 * Four settings, each saying in words what it changes. **Approval between
 * owners only applies once other owners' agents are allowed**, so its switch
 * is disabled until then and says why rather than greying out silently. The
 * approver is a person — the task's assignee or a project admin — and never
 * the receiving agent's owner acting on their own offer.
 */
export function HandoffPolicyForm({ policy, onChange, mayEdit }: HandoffPolicyFormProps) {
  const othersLabel = useId();
  const othersHelp = useId();
  const approvalLabel = useId();
  const approvalHelp = useId();
  const maxId = useId();
  const maxHelp = useId();
  const ttlLabel = useId();
  const set = (patch: Partial<HandoffPolicy>): void => {
    onChange({ ...policy, ...patch });
  };
  // Approval between owners means nothing until other owners' agents are let in.
  const approvalApplies = policy.allowOtherOwners;

  return (
    <section className="handoff-policy" aria-label="Agent hand-off" data-handoff-policy>
      <div className="handoff-policy-row handoff-policy-row-switch">
        <div className="handoff-policy-text">
          <span id={othersLabel} className="handoff-policy-label">
            Agents other people own can take over this space’s tasks
          </span>
          <p id={othersHelp} className="handoff-policy-help">
            {policy.allowOtherOwners
              ? 'Any member’s registered agent with access to this space can be offered a task.'
              : 'Off: a task is only handed between agents its current owner registered.'}
          </p>
        </div>
        <Switch
          checked={policy.allowOtherOwners}
          onChange={(on) => {
            set({ allowOtherOwners: on });
          }}
          labelledBy={othersLabel}
          describedBy={othersHelp}
          disabled={!mayEdit}
        />
      </div>

      <div
        className={
          approvalApplies
            ? 'handoff-policy-row handoff-policy-row-switch'
            : 'handoff-policy-row handoff-policy-row-switch handoff-policy-row-inert'
        }
        data-applies={approvalApplies}
      >
        <div className="handoff-policy-text">
          <span id={approvalLabel} className="handoff-policy-label">
            A person approves a hand-off to another owner’s agent
          </span>
          <p id={approvalHelp} className="handoff-policy-help">
            {approvalApplies
              ? 'The task’s assignee or a project admin approves — never the receiver itself.'
              : 'Does not apply: only the owner’s own agents can take over. Applies only when other people’s agents are allowed.'}
          </p>
        </div>
        <Switch
          checked={policy.crossOwnerRequiresApproval}
          onChange={(on) => {
            set({ crossOwnerRequiresApproval: on });
          }}
          labelledBy={approvalLabel}
          describedBy={approvalHelp}
          disabled={!mayEdit || !approvalApplies}
        />
      </div>

      <div className="handoff-policy-row handoff-policy-row-field">
        <label className="handoff-policy-label" htmlFor={maxId}>
          Hand-offs per task
        </label>
        <input
          id={maxId}
          className="input handoff-policy-number"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_HANDOFFS}
          value={policy.maxHandoffs}
          disabled={!mayEdit}
          aria-describedby={maxHelp}
          onChange={(event) => {
            const n = Number.parseInt(event.target.value, 10);
            if (Number.isInteger(n)) set({ maxHandoffs: Math.min(MAX_HANDOFFS, Math.max(1, n)) });
          }}
        />
        <p id={maxHelp} className="handoff-policy-help">
          After {policy.maxHandoffs} completed hand-offs a person has to reassign the task.
        </p>
      </div>

      <div className="handoff-policy-row handoff-policy-row-field">
        <span id={ttlLabel} className="handoff-policy-label">
          An offer expires after
        </span>
        <Dropdown
          value={String(policy.offerTtlMinutes)}
          options={OFFER_TTL_CHOICES.map((m) => ({
            value: String(m),
            label: m < 60 ? `${String(m)} minutes` : `${String(m / 60)} hour${m === 60 ? '' : 's'}`,
          }))}
          onChange={(v) => {
            set({ offerTtlMinutes: Number(v) });
          }}
          aria-labelledby={ttlLabel}
          disabled={!mayEdit}
        />
        <p className="handoff-policy-help">An expired offer resumes the sender’s paused claim.</p>
      </div>

      {!mayEdit && <p className="handoff-policy-help">Only a project admin can change these.</p>}
    </section>
  );
}
