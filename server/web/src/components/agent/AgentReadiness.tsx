import { READINESS, READINESS_WORDS, type Readiness } from './agent-states.ts';
import './agent.css';

export interface AgentReadinessProps {
  /** Which of the three facts are true. Each is shown on its own line. */
  readonly reached: ReadonlySet<Readiness>;
}

/**
 * The three facts about a registered agent, kept apart: **credential
 * created**, **connected**, **ready for recovery**. Each says yes or not yet
 * in words, so an agent with a token that has never called in is never read
 * as one that can take over work.
 */
export function AgentReadiness({ reached }: AgentReadinessProps) {
  return (
    <ul className="readiness" data-readiness>
      {READINESS.map((fact) => {
        const yes = reached.has(fact);
        const words = READINESS_WORDS[fact];
        return (
          <li key={fact} className="readiness-row" data-fact={fact} data-reached={yes}>
            <svg
              className="readiness-icon"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {yes ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <path d="M6 12h12" />}
            </svg>
            <span>
              <b>{words.label}</b>
              <span className="readiness-verdict">{yes ? ' — yes' : ' — not yet'}</span>
              <span className="readiness-why">{yes ? words.done : words.notYet}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
