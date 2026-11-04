import { AGENT_CLIENTS, agentClientName } from './agent-clients.ts';
import type { ActivitySession } from './activity.ts';

/**
 * **What ran**, in one line (D-118, LAI-587; server LAI-586).
 *
 * An agent is one harness on one device — *Claude Code · Belka* — and the
 * session it ran says which harness and model did the work: *Claude Code ·
 * Belka · Codex · gpt-5.5*. Cards carry the agent alone; the drawer and
 * activity add the session's two words. Everything the session says about
 * itself is **self-reported** and decides nothing, so the screens label it as
 * such and never fill a gap: a part the session did not send is left out, and
 * a row older than the snapshot (`agent_session: null`) is the agent alone.
 *
 * Plain functions, no JSX, so `node --test` pins every rule.
 */

/** The session's harness as a person writes it: *Codex*. A slug Laika does not know is shown as sent. */
export function sessionHarnessName(slug: string): string {
  const known = AGENT_CLIENTS.find((client) => client === slug && client !== 'other');
  return known === undefined ? slug : agentClientName(known);
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** *Codex · gpt-5.5* — the session's part of the line, or `undefined` when it reported neither. */
export function sessionWords(session: ActivitySession | null | undefined): string | undefined {
  if (session === null || session === undefined) return undefined;
  const parts: string[] = [];
  if (present(session.harness)) parts.push(sessionHarnessName(session.harness));
  if (present(session.model)) parts.push(session.model);
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/**
 * *Claude Code · Belka · Codex · gpt-5.5* — the agent's name, then what its
 * session said ran. With no snapshot, the agent's name alone.
 */
export function agentLine(agentName: string, session: ActivitySession | null | undefined): string {
  const words = sessionWordsAfter(agentName, session);
  return words === undefined ? agentName : `${agentName} · ${words}`;
}

/**
 * What the session adds after the agent's own name (LAI-1123): its harness
 * only when it is not the agent's own — *Codex · gpt-5.5* under a Claude Code
 * agent, but *claude-opus-5-5* alone under one that ran Claude Code — so no
 * line says *Claude Code* twice. `undefined` when nothing is left to add.
 */
export function sessionWordsAfter(
  agentName: string,
  session: ActivitySession | null | undefined,
): string | undefined {
  if (session === null || session === undefined) return undefined;
  const product = agentName.split(' · ')[0];
  const own = present(session.harness) && sessionHarnessName(session.harness) === product;
  if (!own) return sessionWords(session);
  return present(session.model) ? session.model : undefined;
}
