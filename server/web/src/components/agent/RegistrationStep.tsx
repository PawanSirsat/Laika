import { useId } from 'react';
import { AGENT_CLIENTS, agentClientName, type AgentClient } from '../../api/agent-clients.ts';
import { agentLabel } from '../../api/selected-agent.ts';
import { AgentMark } from '../agent-mark/AgentMark.tsx';
import { CopyButton } from '../CopyButton.tsx';
import { Dropdown } from '../Dropdown.tsx';
import { Spinner } from '../Spinner.tsx';
import { TextInput } from '../forms/TextInput.tsx';
import { RegistrationSteps } from './RegistrationSteps.tsx';
import { VERIFY_WORDS, type VerifyState } from './agent-states.ts';
import './agent.css';

export type ProjectScope = 'none' | 'read_only' | 'full';

export interface ProjectGrant {
  readonly id: string;
  readonly name: string;
  readonly scope: ProjectScope;
}

/** One step of the wizard and what it shows. The index is the step's place in the five. */
export type WizardStep =
  | {
      readonly kind: 'identity';
      readonly client: AgentClient;
      readonly device: string;
      /**
       * The owner's agent already on this pair, by its label — the `409
       * agent_exists_for_harness_device` notice (D-120). Absent when free.
       */
      readonly existing?: string | undefined;
    }
  | { readonly kind: 'access'; readonly grants: readonly ProjectGrant[] }
  | {
      readonly kind: 'credential';
      readonly agentName: string;
      /** The token, once. `null` once it has been dismissed — it is never shown again. */
      readonly secret: string | null;
    }
  | { readonly kind: 'instructions'; readonly client: AgentClient; readonly device: string }
  | {
      readonly kind: 'verify';
      readonly state: VerifyState;
      readonly client: AgentClient;
      readonly device: string;
      /** What arrived, or what did not, in words. */
      readonly detail: string;
    };

const STEP_INDEX: Readonly<Record<WizardStep['kind'], number>> = {
  identity: 0,
  access: 1,
  credential: 2,
  instructions: 3,
  verify: 4,
};

const SCOPE_WORDS: Readonly<Record<ProjectScope, string>> = {
  none: 'No access',
  read_only: 'Read only',
  full: 'Full',
};

export interface RegistrationStepProps {
  readonly step: WizardStep;
  /** Called with the step as edited. Absent where the step has nothing to edit. */
  readonly onStep?: ((next: WizardStep) => void) | undefined;
  /** The last step's way out of `failed`. */
  readonly onRetry?: (() => void) | undefined;
}

/**
 * One step of Developer access → Agents → Register (LAI-536, proposal §6):
 * where it sits in the five, and what it asks for or shows.
 *
 * The last step proves a request **from this agent**, signed with its own
 * token — not that a token exists, and not a request made with yours. It
 * has three outcomes and each says which in words.
 */
export function RegistrationStep({ step, onStep, onRetry }: RegistrationStepProps) {
  return (
    <div className="agent-wizard" data-wizard-step={step.kind}>
      <RegistrationSteps current={STEP_INDEX[step.kind]} />
      <div className="agent-wizard-body">
        <StepBody step={step} onStep={onStep} onRetry={onRetry} />
      </div>
    </div>
  );
}

function StepBody({ step, onStep, onRetry }: RegistrationStepProps) {
  const harnessLabel = useId();
  switch (step.kind) {
    case 'identity':
      return (
        <>
          <div className="field">
            <span id={harnessLabel} className="field-label">
              Harness
            </span>
            <Dropdown
              value={step.client}
              options={AGENT_CLIENTS.map((c) => ({
                value: c,
                label: c === 'other' ? 'Other harness' : agentClientName(c),
                icon: <AgentMark client={c} size="sm" />,
              }))}
              onChange={(client) => onStep?.({ ...step, client })}
              aria-labelledby={harnessLabel}
              noun="harnesses"
            />
          </div>
          <TextInput
            label="Device"
            value={step.device}
            onChange={(device) => onStep?.({ ...step, device })}
            help="Required and self-reported, like the harness — or Cloud for a hosted runner."
          />
          <p className="agent-wizard-lead">
            Shown everywhere as{' '}
            <strong>{agentLabel({ harness: step.client, device_label: step.device })}</strong> — one
            agent for each harness on each device, and no other name.
          </p>
          {step.device.trim().toLowerCase() === 'cloud' && (
            <p className="agent-wizard-lead" role="note">
              Cloud runs somewhere you do not sit, so its token expires within 24 hours. Rotate it
              to give the runner a fresh one.
            </p>
          )}
          {step.existing !== undefined && (
            <p className="agent-wizard-lead" role="alert">
              You already have <strong>{step.existing}</strong>. Go to it, or rotate its token to
              set it up again.
            </p>
          )}
        </>
      );
    case 'access':
      return (
        <>
          <p className="agent-wizard-lead">
            This agent can never do more than you can. What it may do in a space is the overlap of
            your role there and what you choose here.
          </p>
          <ul className="agent-wizard-grants">
            {step.grants.map((g) => (
              <GrantRow
                key={g.id}
                grant={g}
                onScope={(scope) =>
                  onStep?.({
                    ...step,
                    grants: step.grants.map((x) => (x.id === g.id ? { ...x, scope } : x)),
                  })
                }
              />
            ))}
          </ul>
        </>
      );
    case 'credential':
      return step.secret === null ? (
        <p className="agent-wizard-lead">
          The token for {step.agentName} was shown once and is gone. To get another, rotate it —
          that revokes this one and leaves your other tokens alone.
        </p>
      ) : (
        <section className="agent-wizard-reveal" role="alert">
          <h4 className="agent-wizard-reveal-title">Copy this now — it is not shown again</h4>
          <p className="agent-wizard-lead">
            This token belongs to <strong>{step.agentName}</strong> alone. Laika stores a hash, not
            the secret, so nobody can show it to you again.
          </p>
          <div className="agent-wizard-reveal-row">
            <code className="agent-wizard-secret">{step.secret}</code>
            <CopyButton text={step.secret} what="the agent's token" />
          </div>
        </section>
      );
    case 'instructions':
      return (
        <>
          <p className="agent-wizard-lead">
            On {step.device}, for {agentClientName(step.client)}:
          </p>
          <ol className="agent-wizard-howto">
            <li>
              Put the token in this agent’s environment as <code>LAIKA_TOKEN</code> — never in the
              repository.
            </li>
            <li>
              In the task’s worktree, run <code>laika agent session start</code>.
            </li>
            <li>Leave it running. The helper checks in every 30 seconds while the agent works.</li>
          </ol>
        </>
      );
    case 'verify':
      return (
        <div className="agent-wizard-verify" data-verify={step.state} role="status">
          <p className="agent-wizard-verify-head">
            {step.state === 'waiting' ? (
              <Spinner />
            ) : (
              <svg
                className="readiness-icon"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {step.state === 'verified' ? (
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                ) : (
                  <path d="M12 3 2 21h20zM12 10v5M12 18h.01" />
                )}
              </svg>
            )}
            <b>{VERIFY_WORDS[step.state]}</b>
          </p>
          <p className="agent-wizard-lead">{step.detail}</p>
          {step.state === 'failed' && onRetry !== undefined && (
            <button type="button" className="button button-secondary" onClick={onRetry}>
              Check again
            </button>
          )}
        </div>
      );
  }
}

function GrantRow({
  grant,
  onScope,
}: {
  readonly grant: ProjectGrant;
  readonly onScope: (scope: ProjectScope) => void;
}) {
  const label = useId();
  return (
    <li className="agent-wizard-grant">
      <span id={label} className="agent-wizard-grant-name">
        {grant.name}
      </span>
      <Dropdown
        value={grant.scope}
        options={(['none', 'read_only', 'full'] as const).map((s) => ({
          value: s,
          label: SCOPE_WORDS[s],
        }))}
        onChange={onScope}
        aria-labelledby={label}
      />
    </li>
  );
}
