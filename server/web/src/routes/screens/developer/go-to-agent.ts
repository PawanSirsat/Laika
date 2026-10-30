import { agentAnchor } from '../../../api/agents.ts';

/**
 * Bring an agent's row in the Agents tab into view and give it focus — what
 * a link to `#agent-<id>` means here (LAI-1001). A fragment jump scrolls but
 * leaves focus where it was, so a keyboard reader would still be in the
 * wizard; the row takes focus instead (it carries `tabIndex={-1}`). Returns
 * whether the row was there, so a link can fall back to its `href`.
 */
export function goToAgent(agentId: string): boolean {
  const row = document.getElementById(agentAnchor(agentId));
  if (row === null) return false;
  row.scrollIntoView({ block: 'center' });
  row.focus();
  return true;
}
