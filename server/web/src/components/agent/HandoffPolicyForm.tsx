import { useEffect, useId, useState } from 'react';
import { HANDOFF_POLICY_BOUNDS } from '../../api/handoffs.ts';
import { Dropdown } from '../Dropdown.tsx';
import { Switch } from '../Switch.tsx';
import { OFFER_TTL_CHOICES, type HandoffPolicy } from './agent-states.ts';
import './agent.css';

export interface HandoffPolicyFormProps {
  readonly policy: HandoffPolicy;
  readonly onChange: (next: HandoffPolicy) => void;
  /** False for anyone who is not a project admin: the values are shown, not editable. */
  readonly mayEdit: boolean;
  /** A save is in flight: every control waits for it. */
  readonly busy?: boolean | undefined;
  /**
   * Moves each time a save settles, refused or not. The number field's draft
   * then shows what the server holds again — a refused value must not sit in
   * the field as if it were saved (LAI-550 review).
   */
  readonly settled?: number | undefined;
}

const { maxHandoffs: MAX_BOUNDS, offerTtlMinutes: TTL_BOUNDS } = HANDOFF_POLICY_BOUNDS;

/** *30 minutes*, *2 hours*, *90 minutes*. */
function ttlWords(m: number): string {
  if (m < 60 || m % 60 !== 0) return `${String(m)} minutes`;
  return `${String(m / 60)} hour${m === 60 ? '' : 's'}`;
}

/**
 * A project's hand-off policy, on Settings → Access (LAI-536, proposal §4.5).
 *
 * Four settings, each saying in words what it changes. **Approval between
 * owners only applies once other owners' agents are allowed**, so its switch
 * is disabled until then and says why rather than greying out silently. The
 * approver is a person — the task's assignee or a project admin — and never
 * the receiving agent's owner acting on their own offer.
 */
export function HandoffPolicyForm({
  policy,
  onChange,
  mayEdit,
  busy = false,
  settled = 0,
}: HandoffPolicyFormProps) {
  const locked = !mayEdit || busy;
  // The number is a draft until it is committed — on leaving the field or
  // Enter — so a space that saves each change does not save every keystroke.
  const [draft, setDraft] = useState(String(policy.maxHandoffs));
  useEffect(() => {
    setDraft(String(policy.maxHandoffs));
  }, [policy.maxHandoffs, settled]);
  const commitMax = (): void => {
    const n = Number.parseInt(draft, 10);
    if (!Number.isInteger(n)) {
      setDraft(String(policy.maxHandoffs));
      return;
    }
    const bounded = Math.min(MAX_BOUNDS.max, Math.max(MAX_BOUNDS.min, n));
    setDraft(String(bounded));
    if (bounded !== policy.maxHandoffs) set({ maxHandoffs: bounded });
  };
  // A value the space holds is always offered, even one no preset names.
  const ttlChoices = [...new Set([...OFFER_TTL_CHOICES, policy.offerTtlMinutes])]
    .filter((m) => m >= TTL_BOUNDS.min && m <= TTL_BOUNDS.max)
    .sort((a, b) => a - b);
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
          disabled={locked}
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
          disabled={locked || !approvalApplies}
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
          min={MAX_BOUNDS.min}
          max={MAX_BOUNDS.max}
          value={draft}
          disabled={locked}
          aria-describedby={maxHelp}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={commitMax}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitMax();
          }}
        />
        <p id={maxHelp} className="handoff-policy-help">
          {policy.maxHandoffs === 0
            ? 'No hand-offs: a person reassigns the task.'
            : `After ${String(policy.maxHandoffs)} completed hand-offs a person has to reassign the task.`}{' '}
          From {MAX_BOUNDS.min} to {MAX_BOUNDS.max}.
        </p>
      </div>

      <div className="handoff-policy-row handoff-policy-row-field">
        <span id={ttlLabel} className="handoff-policy-label">
          An offer expires after
        </span>
        <Dropdown
          value={String(policy.offerTtlMinutes)}
          options={ttlChoices.map((m) => ({ value: String(m), label: ttlWords(m) }))}
          onChange={(v) => {
            set({ offerTtlMinutes: Number(v) });
          }}
          aria-labelledby={ttlLabel}
          disabled={locked}
        />
        <p className="handoff-policy-help">An expired offer resumes the sender’s paused claim.</p>
      </div>

      {!mayEdit && (
        <p className="handoff-policy-help" data-policy-readonly>
          Only a space lead can change these.
        </p>
      )}
    </section>
  );
}
