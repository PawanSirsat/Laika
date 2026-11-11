/**
 * The stubbed board LAI-1086's browser tests open Developer access V3 against:
 * the owner's own Tools tab on 2026-11-02 — Claude Code · Belka *Ready*,
 * Codex · Belka and Omnigent · Belka *Connected*, one revoked tool — on a
 * paired device, with each tool's helper report set per test. Beside it an
 * imported device, Strelka, whose Claude Code is *Connected*: its checklist's
 * *Device paired* fails, which `readiness()` never asks for (review round 1).
 */

import type { Locator } from 'playwright';
import type { ApiStub } from './harness.ts';
import { NEVER_REPORTED } from '../helpers/launcher.ts';

export const NOW = Date.now();
const MIN = 60_000;

/** The commit the board was built from, and an older one. */
export const BOARD = 'cea011d6b1a2c3d4e5f60718293a4b5c6d7e8f90';
export const OLDER = '19f85875aa00bb11cc22dd33ee44ff5566778899';
/** Never anywhere on a page. */
export const SECRET = 'lai_s3cr3tS3CR3Ts3cr3t';

export type Board = 'p2' | 'p3';

/** Protocol 2, accepting 1, pairing and tools and reports on — or a later protocol-3 board. */
export const compat = (board: Board = 'p2') => ({
  server: { version: '0.1.0', build_commit: BOARD },
  protocol: { current: board === 'p2' ? 2 : 3, min_client: 1 },
  features: {
    developer_access: 'v3',
    device_pairing: true,
    tool_setup_exchange: true,
    client_reports: true,
    project_setups: false,
  },
  cli: {
    min_protocol_for: {
      device_pairing: 2,
      tool_setup_exchange: 2,
      client_reports: 2,
      project_setups: 2,
    },
    source: {
      type: 'git',
      url: 'https://github.com/PawanSirsat/Laika.git',
      commit: BOARD,
      path: 'cli',
    },
  },
  release_notes: { ref: BOARD, whats_new: [] },
});

export const me = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};

const token = (agentId: string, revoked = false) => ({
  id: `t-${agentId}`,
  name: `t-${agentId}`,
  prefix: `lai_${agentId}xx`,
  scope: 'full',
  project_ids: null,
  last_used_at: NOW - 31 * MIN,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  kind: 'agent',
  agent_id: agentId,
  agent_label: null,
  expires_at: null,
  revoked_at: revoked ? NOW - 60 * MIN : null,
  created_at: 1,
});

export const agentRow = (id: string, harness: string, revoked = false, device = 'Belka') => ({
  id,
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: id,
  harness,
  device_label: device,
  status: revoked ? 'revoked' : 'active',
  grants: [],
  tokens: [token(id, revoked)],
  created_at: 1,
  revoked_at: revoked ? NOW - 60 * MIN : null,
  last_seen_at: NOW - 31 * MIN,
  launcher: NEVER_REPORTED,
});

export type Agent = ReturnType<typeof agentRow>;

/** The owner's tools: a1 Ready, a2 and a3 Connected, r1 revoked. */
export const CLAUDE = agentRow('a1', 'claude-code');
export const CODEX = agentRow('a2', 'codex');
export const OMNIGENT = agentRow('a3', 'omnigent');
export const REVOKED = agentRow('r1', 'cursor', true);
export const TOOLS = [CLAUDE, CODEX, OMNIGENT, REVOKED];
/** Claude Code on the imported device. */
export const STRELKA_CLAUDE = agentRow('a4', 'claude-code', false, 'Strelka');

export const deviceRow = (agents: readonly Agent[], over: object = {}) => ({
  id: 'd1',
  display_name: 'Belka',
  device_label: 'belka',
  kind: 'local',
  origin: 'paired',
  status: 'active',
  confirmed: true,
  confirmed_at: null,
  paired_at: NOW - 3 * 60 * MIN,
  key_fingerprint: '7f3a91c20b5e44d1',
  last_seen_at: NOW - MIN,
  active_count: agents.filter((a) => a.status === 'active').length,
  revoked_count: agents.filter((a) => a.status !== 'active').length,
  agents,
  launcher: NEVER_REPORTED,
  created_at: 1,
  revoked_at: null,
  ...over,
});

/** A helper's version report, as `GET /agents/:id/verification` carries it. */
export const report = (over: object = {}) => ({
  cli_version: '0.1.0',
  cli_commit: BOARD,
  protocol: 2,
  capabilities: ['client_report', 'doctor', 'update'],
  harness_version: null,
  harness: null,
  reported_at: NOW - 5 * MIN,
  self_reported: true,
  ...over,
});

/**
 * A tool's verification. `ready`: its own MCP request, naming itself, two
 * minutes ago, with a session from its hooks. Otherwise its credential
 * reached the board, the tool has not named itself on it — *Connected*.
 */
export const verification = (
  agentId: string,
  harness: string,
  clientReport: object | null,
  ready = false,
  paired = true,
) => {
  const check = (state: string, detail: unknown, at: number | null = null) => ({
    state,
    at,
    detail,
  });
  return {
    agent_id: agentId,
    harness,
    status: 'active',
    now: Date.now(),
    last_seen_at: NOW - (ready ? 2 : 31) * MIN,
    checks: {
      device_paired: paired
        ? check('pass', { device_id: 'd1' })
        : check('fail', { device_id: null }),
      credential_installed: check(
        'pass',
        { token_id: `t-${agentId}`, via_exchange: true },
        NOW - 60 * MIN,
      ),
      credential_used: check('pass', null),
      tool_request: ready
        ? check(
            'pass',
            {
              evidence: 'client_info',
              mcp_client_name: 'specific',
              client_slug: harness,
              client_name: harness,
              client_version: '2.1.0',
              self_reported: true,
            },
            Date.now() - 2 * MIN,
          )
        : check('fail', {
            evidence: null,
            mcp_client_name: harness === 'omnigent' ? 'generic' : 'specific',
            client_slug: null,
            client_name: null,
            client_version: null,
            self_reported: true,
          }),
      required_capabilities: check('pass', { required: [], missing: [] }),
      session_hooks: ready
        ? check('pass', { harness }, NOW - 2 * MIN)
        : check('fail', { harness: null }),
    },
    client_report: clientReport,
  };
};

const NO_CONSENT = { given: false, given_by_user_id: null, given_at: null, withdrawn_at: null };

export interface StubOver {
  readonly board?: Board;
  readonly agents?: readonly Agent[];
  /** Each tool's verification answer, by agent id. */
  readonly verifications?: Readonly<Record<string, unknown>>;
  readonly device?: object;
  readonly routes?: ApiStub;
}

/**
 * The owner's three tools: a1 on the board's commit, a2 an older one, a3
 * never reported — and a4 on imported Strelka, on the board's commit, not
 * paired, its own request not seen yet.
 */
export const DEFAULT_VERIFICATIONS: Readonly<Record<string, unknown>> = {
  a1: verification('a1', 'claude-code', report(), true),
  a2: verification('a2', 'codex', report({ cli_commit: OLDER, protocol: 1 })),
  a3: verification('a3', 'omnigent', null),
  a4: verification('a4', 'claude-code', report(), false, false),
};

/** Strelka: imported from what its tools reported, confirmed, never paired. */
export const importedDevice = (agents: readonly Agent[]) =>
  deviceRow(agents, {
    id: 'd2',
    display_name: 'Strelka',
    device_label: 'strelka',
    origin: 'imported',
    confirmed: true,
    paired_at: null,
    key_fingerprint: null,
  });

export function stub(over: StubOver = {}): ApiStub {
  // The default board has the imported device too; a test that names its own tools does not.
  const imported = over.agents === undefined ? [STRELKA_CLAUDE] : [];
  const onBelka = over.agents ?? TOOLS;
  const agents = [...onBelka, ...imported];
  const verifications = { ...DEFAULT_VERIFICATIONS, ...over.verifications };
  const perAgent: Record<string, unknown> = {};
  for (const a of agents) {
    perAgent[`/api/v1/agents/${a.id}/checkpoint-consent`] = NO_CONSENT;
    perAgent[`/api/v1/agents/${a.id}`] = { ...a, sessions: [] };
    if (verifications[a.id] !== undefined) {
      perAgent[`/api/v1/agents/${a.id}/verification`] = verifications[a.id];
    }
  }
  return {
    '/api/v1/me': me,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents': { data: agents, next_cursor: null },
    '/api/v1/agents/devices': { data: [] },
    '/api/v1/devices': {
      data: [
        deviceRow(onBelka, over.device),
        ...(imported.length > 0 ? [importedDevice(imported)] : []),
      ],
    },
    '/api/v1/project-setups': { data: [] },
    '/api/v1/developer/compatibility': compat(over.board),
    ...perAgent,
    ...over.routes,
  };
}

/**
 * Open one of Tool details' or Device details' folded sections (LAI-1100) —
 * `checks`, `helper`, `projects`, `credential`, `checkpoints`, `launcher`,
 * `device`, `tools`, `helpers`, `name` — by its summary row, as a person
 * does, and wait until it is open. Already open, it is left open. Returns
 * the section.
 */
export async function unfold(scope: Locator, name: string): Promise<Locator> {
  const fold = scope.locator(`details[data-fold="${name}"]`);
  await fold.locator(':scope > summary').waitFor({ timeout: 20_000 });
  if (!(await fold.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await fold.locator(':scope > summary').click();
  }
  await fold.locator(':scope > .dv3-fold-body').waitFor({ state: 'visible', timeout: 10_000 });
  return fold;
}
