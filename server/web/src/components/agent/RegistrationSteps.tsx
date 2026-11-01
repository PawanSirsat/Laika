import { REGISTRATION_STEPS } from './agent-states.ts';
import './agent.css';

export interface RegistrationStepsProps {
  /** 0-based index of the step the reader is on. */
  readonly current: number;
}

/**
 * Developer access → Agents: the registration wizard's steps (LAI-536,
 * proposal §6). Done, current and to-come are said in words beside the
 * number, not by colour.
 */
export function RegistrationSteps({ current }: RegistrationStepsProps) {
  return (
    <ol className="reg-steps" aria-label="Register an agent" data-reg-steps>
      {REGISTRATION_STEPS.map((step, i) => {
        const where = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={step}
            className={`reg-step reg-step-${where}`}
            aria-current={where === 'current' ? 'step' : undefined}
            data-step={where}
          >
            <span className="reg-step-number" aria-hidden="true">
              {where === 'done' ? '✓' : String(i + 1)}
            </span>
            <span className="reg-step-name">{step}</span>
            <span className="reg-step-where">
              {where === 'done' ? 'Done' : where === 'current' ? 'This step' : 'Next'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
