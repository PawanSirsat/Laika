import { useState, type MouseEvent } from 'react';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { forcedTokenScope } from '../../../api/tokens.ts';
import type { MeProfile } from '../../../api/me.ts';
import {
  AGENT_GUIDES,
  guideFor,
  setupBlocks,
  type AgentChoice,
} from '../connect/connect-agents.ts';
import { suggestTokenName } from '../connect/connect-token-name.ts';

/** The wizard's own key (`ConnectScreen`): read here, written only there. */
const AGENT_KEY = 'laika.connect.agent';

function storedAgent(): string | null {
  try {
    return window.localStorage.getItem(AGENT_KEY);
  } catch {
    return null;
  }
}

/** The first lines of a block, enough to recognise it — the wizard has the rest. */
const PREVIEW_LINES = 3;

export interface ConnectCardProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
  readonly onNavigate: (to: string) => void;
}

/**
 * *Connect an agent*, compact (LAI-796): the Connect wizard's first three
 * steps at a glance, at the top of Developer access.
 *
 * **Nothing here mints or holds a secret.** The one-time plaintext lives in
 * the wizard's single hook (`ConnectScreen`), and a second place that held it
 * would be a second thing to blank. So the card *shows* what the wizard will
 * do — which agent, the token's real name and scope, and the start of the
 * setup with the token left as a placeholder — and its buttons open the wizard
 * there: *Create token* on the token step, *Full setup* on the first. Every
 * agent, every step and every optional section stay in the wizard.
 */
export function ConnectCard({ me, origin, onNavigate }: ConnectCardProps) {
  const [agentId, setAgentId] = useState<AgentChoice>(() => guideFor(storedAgent()).id);
  const guide = guideFor(agentId);
  const primary = AGENT_GUIDES.filter((g) => g.primary);
  const shown = primary.some((g) => g.id === agentId) ? primary : [...primary, guide];

  const tokenName = suggestTokenName(navigator.userAgent, guide.tokenWord);
  const scope = me === undefined ? 'full' : forcedTokenScope(me.org_role, 'full');
  const first = setupBlocks(guide.id, { origin, secret: undefined })[0];
  const lines = first?.text.split('\n') ?? [];

  const wizard = (step?: 2): string => {
    const params = new URLSearchParams({ agent: guide.id });
    if (step !== undefined) params.set('step', String(step));
    return `/developer/connect?${params.toString()}`;
  };
  const follow = (to: string) => (event: MouseEvent) => {
    // Modified clicks stay the browser's — new tab, new window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  return (
    <section className="dev-card dev-connect" aria-labelledby="dev-connect-title">
      <header className="dev-card-head">
        <h2 className="dev-card-title" id="dev-connect-title">
          Connect an agent
        </h2>
        <a className="dev-card-link" href={wizard()} onClick={follow(wizard())}>
          Full setup, every agent →
        </a>
      </header>

      <ol className="dev-steps">
        <li className="dev-step">
          <h3 className="dev-step-title">
            <span className="dev-step-num" aria-hidden="true">
              1
            </span>
            Pick your agent
          </h3>
          <div className="dev-agents" role="group" aria-label="Agent">
            {shown.map((g) => (
              <button
                key={g.id}
                type="button"
                className="dev-agent"
                aria-pressed={g.id === agentId}
                onClick={() => {
                  setAgentId(g.id);
                }}
              >
                <AgentMark client={g.client} size="sm" />
                {g.name}
              </button>
            ))}
          </div>
        </li>

        <li className="dev-step">
          <h3 className="dev-step-title">
            <span className="dev-step-num" aria-hidden="true">
              2
            </span>
            Create a token
          </h3>
          <p className="dev-step-body">
            Named <code>{tokenName}</code>, scope <code>{scope}</code>, all your projects, for 90
            days. It is shown once, then only its prefix.
          </p>
          <a
            className="dev-step-action"
            href={wizard(2)}
            onClick={follow(wizard(2))}
            data-agent={guide.id}
          >
            Create token
          </a>
        </li>

        <li className="dev-step">
          <h3 className="dev-step-title">
            <span className="dev-step-num" aria-hidden="true">
              3
            </span>
            {first?.label ?? 'Run the setup'}
          </h3>
          {first !== undefined && (
            <pre className="dev-preview" aria-label={`The start of ${first.what}`}>
              <code>
                {lines.slice(0, PREVIEW_LINES).join('\n')}
                {lines.length > PREVIEW_LINES ? '\n…' : ''}
              </code>
            </pre>
          )}
          <p className="dev-step-note">
            The wizard fills in your token and checks the agent arrives.
          </p>
        </li>
      </ol>
    </section>
  );
}
