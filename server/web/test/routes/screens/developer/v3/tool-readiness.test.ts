/**
 * One tool's status and checks (LAI-1061, plan LAI-1042 §E.3, §H), from
 * `GET /agents/:id/verification` and the catalog alone.
 *
 * - *Ready* only on the tool's **own** request on its own credential, plus a
 *   session where the tool has hooks, seen within 15 minutes.
 * - Another tool's request on the credential never counts (per-tool
 *   isolation), even if a server said `pass` for it.
 * - Every check that fails says what is missing.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentVerification } from '../../../../../src/api/tool-setup.ts';
import {
  catalogTool,
  type ToolCapability,
} from '../../../../../src/routes/screens/developer/v3/tool-catalog.ts';
import {
  checkLines,
  readiness,
  readinessSummary,
} from '../../../../../src/routes/screens/developer/v3/tool-readiness.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function tool(slug: string): ToolCapability {
  const found = catalogTool(slug);
  assert.ok(found, `${slug} is in the catalog`);
  return found;
}

const fail = <D>(detail: D) => ({ state: 'fail' as const, at: null, detail });
const pass = <D>(detail: D, at = NOW - MIN) => ({ state: 'pass' as const, at, detail });

interface Over {
  readonly harness?: string;
  readonly status?: 'active' | 'revoked';
  readonly installed?: boolean;
  readonly used?: boolean;
  /** The tool's MCP request: the slug it named, the board's verdict, and what passed it. */
  readonly request?: {
    readonly slug: string;
    readonly state: 'pass' | 'fail';
    readonly evidence?: 'client_info' | 'client_report';
  } | null;
  readonly session?: boolean;
  readonly lastSeen?: number | null;
  readonly cliVersion?: string | null;
  /** The harness the CLI's report names. */
  readonly reportedHarness?: string | null;
  readonly missing?: readonly string[];
  readonly required?: readonly string[];
}

function verification(over: Over = {}): AgentVerification {
  const harness = over.harness ?? 'claude-code';
  const request = over.request === undefined ? null : over.request;
  const generic = harness === 'omnigent' || harness === 'hermes';
  const required = over.required ?? (generic ? ['tool_setup_exchange', 'client_report'] : []);
  const missing = over.missing ?? [];
  const reported = over.cliVersion !== undefined || over.reportedHarness !== undefined;
  return {
    agent_id: 'a1',
    harness,
    status: over.status ?? 'active',
    now: NOW,
    last_seen_at: over.lastSeen === undefined ? NOW - MIN : over.lastSeen,
    checks: {
      device_paired: pass({ device_id: 'd1' }),
      credential_installed:
        over.installed === false
          ? fail({ token_id: null, via_exchange: false })
          : pass({ token_id: 't1', via_exchange: true }),
      credential_used: over.used === true || request !== null ? pass(null) : fail(null),
      tool_request:
        request === null
          ? fail({
              evidence: null,
              mcp_client_name: generic ? ('generic' as const) : ('specific' as const),
              client_slug: null,
              client_name: null,
              client_version: null,
              self_reported: true,
            })
          : {
              state: request.state,
              at: request.state === 'pass' && over.lastSeen !== null ? NOW - MIN : null,
              detail: {
                evidence: request.state === 'pass' ? (request.evidence ?? 'client_info') : null,
                mcp_client_name: generic ? ('generic' as const) : ('specific' as const),
                client_slug: request.slug,
                client_name: request.slug,
                client_version: '2.1.0',
                self_reported: true,
              },
            },
      required_capabilities: {
        state: missing.length === 0 ? 'pass' : 'fail',
        at: null,
        detail: { required, missing },
      },
      session_hooks: over.session === true ? pass({ harness }) : fail({ harness: null }),
    },
    client_report: !reported
      ? null
      : {
          cli_version: over.cliVersion ?? '0.2.0',
          cli_commit: null,
          protocol: 2,
          capabilities: required.filter((c) => !missing.includes(c)),
          harness_version: null,
          harness: over.reportedHarness ?? null,
          reported_at: NOW,
          self_reported: true,
        },
  };
}

void describe('status words come from evidence only', () => {
  void test('no credential is Needs setup', () => {
    const r = readiness(verification({ installed: false }), tool('claude-code'));
    assert.equal(r.key, 'needs-setup');
    assert.equal(r.word, 'Needs setup');
  });

  void test('a credential nothing used is Needs setup, not Connected', () => {
    const r = readiness(verification(), tool('claude-code'));
    assert.equal(r.key, 'needs-setup');
    assert.match(r.reason, /nothing has used it/);
  });

  void test('a credential used (a curl) without the tool’s own request is Connected, never Ready', () => {
    const r = readiness(verification({ used: true }), tool('claude-code'));
    assert.equal(r.key, 'connected');
    assert.match(r.reason, /Claude Code itself has not called it yet/);
  });

  void test('Claude Code needs a session too: its request alone is Connected', () => {
    const r = readiness(
      verification({ request: { slug: 'claude-code', state: 'pass' } }),
      tool('claude-code'),
    );
    assert.equal(r.key, 'connected');
    assert.match(r.reason, /no session/);
  });

  void test('Claude Code with its own request and a session, seen lately, is Ready', () => {
    const r = readiness(
      verification({ request: { slug: 'claude-code', state: 'pass' }, session: true }),
      tool('claude-code'),
    );
    assert.equal(r.key, 'ready');
    assert.equal(r.word, 'Ready');
    assert.equal(r.tone, 'ok');
  });

  void test('an MCP-only tool is Ready on its own request alone — sessions are not its to have', () => {
    const r = readiness(
      verification({ harness: 'cursor', request: { slug: 'cursor', state: 'pass' } }),
      tool('cursor'),
    );
    assert.equal(r.key, 'ready');
  });

  void test('the same evidence seen hours ago is Idle, and a week ago Offline', () => {
    const base = { request: { slug: 'claude-code', state: 'pass' as const }, session: true };
    assert.equal(
      readiness(verification({ ...base, lastSeen: NOW - 3 * 60 * MIN }), tool('claude-code')).key,
      'idle',
    );
    assert.equal(
      readiness(verification({ ...base, lastSeen: NOW - 8 * 24 * 60 * MIN }), tool('claude-code'))
        .key,
      'offline',
    );
  });

  void test('revoked says so', () => {
    assert.equal(readiness(verification({ status: 'revoked' }), tool('codex')).key, 'revoked');
  });

  void test('Version unknown until the CLI or the tool reports a version', () => {
    assert.equal(readiness(verification(), tool('claude-code')).versionUnknown, true);
    assert.equal(
      readiness(verification({ cliVersion: '0.2.0' }), tool('claude-code')).versionUnknown,
      false,
    );
    assert.equal(
      readiness(
        verification({ request: { slug: 'claude-code', state: 'pass' } }),
        tool('claude-code'),
      ).versionUnknown,
      false,
    );
  });
});

void describe('per-tool isolation', () => {
  void test('Codex’s request on Claude Code’s credential does not tick Claude Code', () => {
    const v = verification({ request: { slug: 'codex', state: 'fail' }, session: true });
    const r = readiness(v, tool('claude-code'));
    assert.notEqual(r.key, 'ready');
    const line = checkLines(v, tool('claude-code'), 'Belka').find((l) => l.id === 'tool_request');
    assert.equal(line?.state, 'fail');
    assert.match(line?.detail ?? '', /named Codex, not Claude Code/);
  });

  void test('even a server saying pass for another tool’s name is not Ready here', () => {
    const v = verification({ request: { slug: 'codex', state: 'pass' }, session: true });
    assert.notEqual(readiness(v, tool('claude-code')).key, 'ready');
    assert.equal(
      checkLines(v, tool('claude-code'), 'Belka').find((l) => l.id === 'tool_request')?.state,
      'fail',
    );
  });
});

void describe('the checklist says what is missing', () => {
  void test('a fresh exchange: paired, the rest missing with what to do', () => {
    const lines = checkLines(verification({ installed: false }), tool('claude-code'), 'Belka');
    assert.deepEqual(
      lines.map((l) => [l.id, l.state]),
      [
        ['device_paired', 'pass'],
        ['credential_installed', 'fail'],
        ['tool_request', 'fail'],
        ['session_hooks', 'fail'],
      ],
    );
    assert.match(lines[1]?.detail ?? '', /run the command on Belka/);
    assert.match(lines[1]?.detail ?? '', /nothing secret is shown here/);
    assert.match(lines[2]?.detail ?? '', /laika-claude/);
    assert.match(lines[3]?.detail ?? '', /hooks open one/);
  });

  void test('sessions are unsupported, not failed, for a tool without hooks', () => {
    const lines = checkLines(
      verification({ harness: 'omnigent', request: { slug: 'omnigent', state: 'pass' } }),
      tool('omnigent'),
      'Belka',
    );
    const sessions = lines.find((l) => l.id === 'session_hooks');
    assert.equal(sessions?.state, 'unsupported');
    assert.match(sessions?.detail ?? '', /no session claims or automatic checkpoints/);
  });

  void test('the live-region sentence names the status and what is still missing', () => {
    const v = verification({ used: true });
    const said = readinessSummary(
      readiness(v, tool('codex')),
      checkLines(v, tool('codex'), 'Belka'),
      'Codex',
    );
    assert.match(
      said,
      /^Codex: Connected\. Still missing: Codex connected, Sessions and claims\.$/,
    );
  });
});

void describe('a harness whose MCP client names no tool (D-125)', () => {
  void test('Omnigent is Ready on its request plus the helper’s report naming it, shown as self-reported', () => {
    const v = verification({
      harness: 'omnigent',
      request: { slug: 'other', state: 'pass', evidence: 'client_report' },
      reportedHarness: 'omnigent',
    });
    assert.equal(readiness(v, tool('omnigent')).key, 'ready');
    const line = checkLines(v, tool('omnigent'), 'Belka').find((l) => l.id === 'tool_request');
    assert.equal(line?.state, 'pass');
    assert.match(line?.detail ?? '', /helper’s report from the same credential/);
    assert.match(line?.detail ?? '', /own word for itself/);
  });

  void test('a report naming another harness does not tick it, whatever the board said', () => {
    const v = verification({
      harness: 'omnigent',
      request: { slug: 'other', state: 'pass', evidence: 'client_report' },
      reportedHarness: 'hermes',
    });
    assert.notEqual(readiness(v, tool('omnigent')).key, 'ready');
  });

  void test('required capabilities not reported yet: Connected, and the line says which', () => {
    const v = verification({
      harness: 'omnigent',
      request: { slug: 'other', state: 'pass', evidence: 'client_report' },
      reportedHarness: 'omnigent',
      missing: ['client_report'],
    });
    const r = readiness(v, tool('omnigent'));
    assert.equal(r.key, 'connected');
    assert.match(r.reason, /client_report/);
    const line = checkLines(v, tool('omnigent'), 'Belka').find(
      (l) => l.id === 'required_capabilities',
    );
    assert.equal(line?.state, 'fail');
    assert.match(line?.detail ?? '', /Not yet reported: client_report/);
  });

  void test('a tool with nothing required shows no capabilities line', () => {
    const lines = checkLines(verification(), tool('claude-code'), 'Belka');
    assert.equal(
      lines.find((l) => l.id === 'required_capabilities'),
      undefined,
    );
  });
});

void describe('presence off', () => {
  void test('every check passing but no time kept is Connected, never Ready', () => {
    const v = verification({
      request: { slug: 'claude-code', state: 'pass' },
      session: true,
      lastSeen: null,
    });
    const r = readiness(v, tool('claude-code'));
    assert.equal(r.key, 'connected');
    assert.match(r.reason, /does not record when/);
  });
});
