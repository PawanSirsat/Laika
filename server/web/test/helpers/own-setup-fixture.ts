/**
 * Your own developer setup as your own reads serve it (LAI-1156): the admin
 * fixture (`developer-setup-fixture.ts`) taken apart into what `GET /devices`,
 * `GET /agents`, `GET /agents/:id/verification`, `…/checkpoint-consent`,
 * `GET /project-setups`, `GET /tokens`, `GET /devices/pairing-requests` and
 * `GET /me/developer-setup/activity` each answer — so the adapter can be
 * checked against the one shape both tabs draw. Shared by the derive test and
 * the browser test.
 */

import type { RegisteredAgent } from '../../src/api/agents.ts';
import type {
  DeveloperSetup,
  SetupToken,
  SetupTool,
  SetupUser,
} from '../../src/api/developer-setup.ts';
import type { Device } from '../../src/api/devices.ts';
import type { TokenView } from '../../src/api/tokens.ts';
import type { AgentVerification } from '../../src/api/tool-setup.ts';
import type { OwnReads } from '../../src/routes/screens/profile/own-setup-derive.ts';

const plain = ({ project_ids_hidden: _hidden, ...t }: SetupToken): TokenView => t;

export function agentOf(tool: SetupTool): RegisteredAgent {
  const {
    device_id: _device,
    grants_hidden: _grants,
    checks: _checks,
    client_report: _report,
    checkpoint_consent: _consent,
    revoked_by: _by,
    tokens,
    ...agent
  } = tool;
  return { ...agent, tokens: tokens.map(plain) };
}

export function verificationOf(tool: SetupTool, now: number): AgentVerification {
  return {
    agent_id: tool.id,
    harness: tool.harness,
    status: tool.status,
    now,
    last_seen_at: tool.last_seen_at,
    checks: tool.checks,
    client_report: tool.client_report,
  };
}

/** The admin read, as the reads your own Developer access makes would answer it. */
export function ownReadsFrom(view: DeveloperSetup, user: SetupUser = view.user): OwnReads {
  const agents = view.tools.map(agentOf);
  const devices: Device[] = view.devices.map(
    ({ agent_ids, revoked_by: _by, ...device }): Device => ({
      ...device,
      agents: agents.filter((a) => agent_ids.includes(a.id)),
    }),
  );
  const live = view.tools.filter((t) => t.status === 'active');
  return {
    now: view.now,
    user,
    devices,
    agents,
    verifications: new Map(live.map((t) => [t.id, verificationOf(t, view.now)])),
    consents: new Map(live.map((t) => [t.id, t.checkpoint_consent])),
    setups: view.repositories,
    tokens: [...view.tokens.personal, ...view.tokens.tool_credentials].map(plain),
    pending: view.pending_pairing,
    activity: view.activity,
  };
}
