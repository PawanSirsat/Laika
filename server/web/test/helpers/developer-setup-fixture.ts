/**
 * A member's developer setup, as `GET /people/:id/developer-setup` serves it
 * (LAI-1140). Shared by the derive test and the browser test. Its names are
 * this suite's own — never the owner's design samples, which
 * `no-prototype-data.test.ts` keeps out of the shipped code.
 */

import type {
  DeveloperSetup,
  SetupDevice,
  SetupToken,
  SetupTool,
} from '../../src/api/developer-setup.ts';

export const NOW = Date.UTC(2026, 10, 5, 12, 0);
export const MIN = 60_000;
export const DAY = 86_400_000;

const check = <D>(state: 'pass' | 'fail', detail: D, at: number | null = null) => ({
  state,
  at,
  detail,
});

const NEVER_REPORTED = {
  state: 'off',
  reported_at: null,
  started_at: null,
  running: null,
  max_concurrent: null,
  auto_pickup: null,
  cli_version: null,
} as const;

export const token = (id: string, over: Partial<SetupToken> = {}): SetupToken => ({
  id,
  name: `token-${id}`,
  prefix: `lai_${id.slice(0, 4).padEnd(4, 'x')}`,
  scope: 'full',
  project_ids: null,
  project_ids_hidden: 0,
  last_used_at: NOW - 3 * 60 * MIN,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: null,
  revoked_at: null,
  created_at: NOW - 40 * DAY,
  kind: 'personal',
  agent_id: null,
  agent_label: null,
  ...over,
});

export interface ToolOver extends Partial<SetupTool> {
  readonly mcp?: boolean;
  readonly used?: boolean;
}

export const tool = (id: string, harness: string, over: ToolOver = {}): SetupTool => {
  const { mcp = true, used = true, ...rest } = over;
  return {
    id,
    owner_user_id: 'u2',
    owner_display_name: 'Rowan Vale',
    display_name: harness,
    harness,
    device_label: 'rowan-box',
    status: 'active',
    grants: [{ project_id: 'p1', scope: 'full' }],
    grants_hidden: 0,
    tokens: [
      token(`c-${id}`, {
        name: `${harness} · rowan-box`,
        kind: 'agent',
        agent_id: id,
        last_mcp_at: mcp ? NOW - 2 * MIN : null,
        last_used_at: used ? NOW - 2 * MIN : null,
      }),
    ],
    created_at: NOW - 10 * DAY,
    revoked_at: null,
    last_seen_at: used ? NOW - 2 * MIN : null,
    launcher: NEVER_REPORTED,
    device_id: 'd1',
    checks: {
      device_paired: check('pass', { device_id: 'd1' }),
      credential_installed: check('pass', { token_id: `c-${id}`, via_exchange: true }),
      credential_used: check(used ? 'pass' : 'fail', null),
      tool_request: check(mcp ? 'pass' : 'fail', {
        evidence: mcp ? 'client_info' : null,
        mcp_client_name: 'specific',
        client_slug: mcp ? harness : null,
        client_name: mcp ? harness : null,
        client_version: mcp ? '2.1.0' : null,
        self_reported: true,
      } as const),
      required_capabilities: check('pass', { required: [], missing: [] }),
      session_hooks: check(mcp ? 'pass' : 'fail', { harness: mcp ? harness : null }),
    },
    client_report: null,
    checkpoint_consent: false,
    revoked_by: null,
    ...rest,
  };
};

export const device = (id: string, name: string, over: Partial<SetupDevice> = {}): SetupDevice => ({
  id,
  display_name: name,
  device_label: name,
  kind: 'local',
  origin: 'paired',
  status: 'active',
  confirmed: true,
  confirmed_at: NOW - 20 * DAY,
  paired_at: NOW - 20 * DAY,
  key_fingerprint: 'SHA256:fixturekey0001',
  last_seen_at: NOW - 2 * MIN,
  active_count: 1,
  revoked_count: 0,
  launcher: NEVER_REPORTED,
  created_at: NOW - 20 * DAY,
  revoked_at: null,
  agent_ids: [],
  revoked_by: null,
  ...over,
});

/** A full setup: one device with two tools (one not connected), a repo, tokens, activity. */
export function setup(over: Partial<DeveloperSetup> = {}): DeveloperSetup {
  const tools = [tool('a1', 'claude-code'), tool('a2', 'codex', { mcp: false })];
  const credentials = tools.flatMap((t) => t.tokens);
  const personal = [
    token('p1', { name: 'deploy-key' }),
    token('p2', { name: 'gone-key', revoked_at: NOW - 3 * DAY }),
    token('p3', { name: 'old-key', expires_at: NOW - 5 * DAY }),
  ];
  return {
    now: NOW,
    user: { id: 'u2', name: 'Rowan Vale', org_role: 'member', is_active: true },
    can_revoke: true,
    summary: {
      devices_active: 1,
      devices_revoked: 1,
      tools_active: 2,
      tools_revoked: 0,
      repositories: 1,
      repositories_hidden: 2,
      tokens_active: 3,
      tokens_inactive: 2,
      pending_pairing: 1,
      last_seen_at: NOW - 2 * MIN,
    },
    devices: [
      device('d1', 'rowan-box', { agent_ids: ['a1', 'a2'] }),
      device('d0', 'rowan-old', {
        status: 'revoked',
        revoked_at: NOW - 6 * DAY,
        revoked_by: { id: 'u1', name: 'Ada Admin' },
        last_seen_at: NOW - 7 * DAY,
      }),
    ],
    tools,
    pending_pairing: [
      {
        id: 'pr1',
        state: 'open',
        kind: 'local',
        display_name: 'rowan-spare',
        device_id: null,
        claimed: null,
        created_at: NOW - 60 * MIN,
        expires_at: NOW + 9 * MIN,
        decided_at: null,
        completed_at: null,
      },
    ],
    repositories: [
      {
        id: 'r1',
        agent_id: 'a1',
        device_label: 'rowan-box',
        project_id: 'p1',
        project_slug: 'fixture',
        repo_label: 'fixture-org/fixture-app',
        repo_key: 'fixture-org/fixture-app',
        instructions_path: 'CLAUDE.md',
        block_found: true,
        template_revision: 1,
        project_match: true,
        prefix_match: false,
        source: 'local_check',
        checked_at: NOW - 30 * MIN,
      },
    ],
    tokens: { personal, tool_credentials: credentials },
    activity: [
      {
        at: NOW - 3 * DAY,
        kind: 'token_revoked',
        subject: 'gone-key',
        by: { id: 'u1', name: 'Ada Admin' },
      },
      {
        at: NOW - 10 * DAY,
        kind: 'tool_added',
        subject: 'codex',
        by: { id: 'u2', name: 'Rowan Vale' },
      },
    ],
    ...over,
  };
}
