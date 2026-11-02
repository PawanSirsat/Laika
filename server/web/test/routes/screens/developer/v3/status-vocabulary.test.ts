/**
 * Every status the Tools and Devices tabs can show has words (LAI-1086), and
 * the words a chip shows are the legend's.
 *
 * - Every branch of `toolStatus()`, `readiness()`, `updateStatus()` and
 *   `deviceChip()` is driven here, and each status they return must have an
 *   entry — so a status added without copy fails this file (and, being keyed
 *   by the code's own union types, the typecheck before it).
 * - The legend lists nothing the code cannot return: the statuses reached are
 *   exactly the vocabulary's keys.
 * - The time thresholds are the code's constants, in words.
 * - Each chip's description is its row's own evidence: the reason the code
 *   gave, and the first check its verification still fails, in that check's
 *   own words.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { Device } from '../../../../../src/api/devices.ts';
import { timeLabel } from '../../../../../src/api/time-label.ts';
import type { TokenView } from '../../../../../src/api/tokens.ts';
import type { AgentVerification } from '../../../../../src/api/tool-setup.ts';
import {
  chipTone,
  deviceChip,
  needsConfirm,
  toolStatus,
} from '../../../../../src/routes/screens/developer/v3/devices-view.ts';
import {
  ACTIVE_MS,
  OFFLINE_MS,
} from '../../../../../src/routes/screens/developer/v3/overview-state.ts';
import {
  DEVICE_ORDER,
  DEVICE_STATUS,
  DUPLICATE,
  TOOL_ORDER,
  TOOL_STATUS,
  UPDATE_ORDER,
  UPDATE_STATUS,
  deviceChipDescription,
  deviceChipKey,
  deviceVersionDescription,
  duplicateDescription,
  toolChipDescription,
  updateChipDescription,
  type StatusCopy,
} from '../../../../../src/routes/screens/developer/v3/status-vocabulary.ts';
import {
  catalogTool,
  type ToolCapability,
} from '../../../../../src/routes/screens/developer/v3/tool-catalog.ts';
import {
  checkLines,
  readiness,
} from '../../../../../src/routes/screens/developer/v3/tool-readiness.ts';
import {
  updateStatus,
  versionChip,
  type ClientReport,
  type UpdateManifest,
  type UpdateStatus,
} from '../../../../../src/routes/screens/developer/v3/update-status.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function tool(slug: string): ToolCapability {
  const found = catalogTool(slug);
  assert.ok(found, `${slug} is in the catalog`);
  return found;
}

const token = (over: Partial<TokenView> = {}): TokenView => ({
  id: 't1',
  name: 't1',
  prefix: 'lai_abcd',
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  kind: 'agent',
  agent_id: 'a1',
  agent_label: 'Codex · Belka',
  expires_at: null,
  revoked_at: null,
  created_at: 1,
  ...over,
});

const agent = (over: Partial<RegisteredAgent> = {}): RegisteredAgent => ({
  id: 'a1',
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: 'a1',
  harness: 'codex',
  device_label: 'Belka',
  status: 'active',
  grants: [],
  tokens: [token()],
  created_at: 1,
  revoked_at: null,
  last_seen_at: NOW - MIN,
  ...over,
});

const pass = <D>(detail: D, at: number | null = NOW - MIN) => ({
  state: 'pass' as const,
  at,
  detail,
});
const fail = <D>(detail: D) => ({ state: 'fail' as const, at: null, detail });

interface Over {
  readonly harness?: string;
  readonly status?: 'active' | 'revoked';
  readonly installed?: boolean;
  readonly used?: boolean;
  readonly own?: boolean;
  readonly missing?: readonly string[];
  readonly session?: boolean;
  readonly requestAt?: number | null;
}

function verification(over: Over = {}): AgentVerification {
  const harness = over.harness ?? 'codex';
  const own = over.own === true;
  const missing = over.missing ?? [];
  return {
    agent_id: 'a1',
    harness,
    status: over.status ?? 'active',
    now: NOW,
    last_seen_at: NOW - 31 * MIN,
    checks: {
      device_paired: pass({ device_id: 'd1' }),
      credential_installed:
        over.installed === false
          ? fail({ token_id: null, via_exchange: false })
          : pass({ token_id: 't1', via_exchange: true }),
      credential_used: over.used === false ? fail(null) : pass(null),
      tool_request: own
        ? pass(
            {
              evidence: 'client_info' as const,
              mcp_client_name: 'specific' as const,
              client_slug: harness,
              client_name: harness,
              client_version: '1.0.0',
              self_reported: true,
            },
            over.requestAt === undefined ? NOW - MIN : over.requestAt,
          )
        : fail({
            evidence: null,
            mcp_client_name: harness === 'omnigent' ? ('generic' as const) : ('specific' as const),
            client_slug: null,
            client_name: null,
            client_version: null,
            self_reported: true,
          }),
      required_capabilities: {
        state: missing.length === 0 ? ('pass' as const) : ('fail' as const),
        at: null,
        detail: { required: [...missing], missing: [...missing] },
      },
      session_hooks: over.session === false ? fail({ harness: null }) : pass({ harness }),
    },
    client_report: null,
  };
}

const device = (over: Partial<Device> = {}): Device => ({
  id: 'd1',
  display_name: 'Belka',
  device_label: 'belka',
  kind: 'local',
  origin: 'paired',
  status: 'active',
  confirmed: true,
  confirmed_at: null,
  paired_at: NOW - 2 * DAY,
  key_fingerprint: null,
  last_seen_at: null,
  active_count: 1,
  revoked_count: 0,
  agents: [agent()],
  created_at: 1,
  revoked_at: null,
  ...over,
});

const manifest: UpdateManifest = {
  helperCommit: 'cea011d6b1a2c3d4e5f60718293a4b5c6d7e8f90',
  protocol: { current: 2, minClient: 1 },
  minProtocolFor: { device_pairing: 2 },
  enabled: ['device_pairing'],
  whatsNew: [],
};

const report = (over: Partial<ClientReport> = {}): ClientReport => ({
  cli_version: '0.1.0',
  cli_commit: manifest.helperCommit,
  protocol: 2,
  capabilities: [],
  harness_version: null,
  harness: null,
  reported_at: NOW,
  self_reported: true,
  ...over,
});

/** Every branch of `toolStatus()` and `readiness()`: what a tool chip can say. */
function everyToolStatus(): { key: string; word: string; via: string }[] {
  const out: { key: string; word: string; via: string }[] = [];
  const t = (over: Partial<RegisteredAgent>, via: string) => {
    const s = toolStatus(agent(over), NOW);
    out.push({ key: s.key, word: s.word, via: `toolStatus ${via}` });
  };
  t({ status: 'revoked' }, 'revoked');
  t({ tokens: [] }, 'no live token');
  t({ tokens: [token({ expires_at: NOW - MIN })] }, 'expired');
  t({ last_seen_at: null }, 'never used');
  t({ last_seen_at: NOW - MIN }, 'recent');
  t({ last_seen_at: NOW - ACTIVE_MS - MIN }, 'idle');
  t({ last_seen_at: NOW - OFFLINE_MS - MIN }, 'offline');

  const r = (over: Over, via: string, slug = 'claude-code') => {
    const s = readiness(verification({ harness: slug, ...over }), tool(slug));
    out.push({ key: s.key, word: s.word, via: `readiness ${via}` });
  };
  r({ status: 'revoked' }, 'revoked');
  r({ installed: false }, 'no credential');
  r({ used: false }, 'unused');
  r({}, 'reached, not the tool');
  // LAI-1088: a tool whose MCP client names no tool is Connected until the helper says which it is.
  r({}, 'in use, the helper has not said which tool', 'omnigent');
  r({ own: true, missing: ['client_report'] }, 'helper report missing');
  r({ own: true, session: false }, 'no session');
  r({ own: true, requestAt: null }, 'presence off');
  r({ own: true }, 'ready');
  r({ own: true, requestAt: NOW - ACTIVE_MS - MIN }, 'idle');
  r({ own: true, requestAt: NOW - OFFLINE_MS - MIN }, 'offline');
  return out;
}

/** Every branch of `updateStatus()`. */
function everyUpdateStatus(): { status: UpdateStatus; via: string }[] {
  return [
    { status: updateStatus('failed', report()), via: 'manifest failed' },
    { status: updateStatus(manifest, 'failed'), via: 'report failed' },
    { status: updateStatus(undefined, report()), via: 'reading' },
    { status: updateStatus(manifest, null), via: 'no report' },
    {
      status: updateStatus(
        { ...manifest, protocol: { current: 3, minClient: 2 } },
        report({ protocol: 1 }),
      ),
      via: 'below min_client',
    },
    { status: updateStatus(manifest, report({ protocol: 1 })), via: 'feature needs more' },
    { status: updateStatus(manifest, report()), via: 'same commit' },
    { status: updateStatus(manifest, report({ protocol: 3, cli_commit: null })), via: 'ahead' },
    {
      status: updateStatus(
        { ...manifest, protocol: { current: 3, minClient: 1 }, enabled: [] },
        report({ cli_commit: null }),
      ),
      via: 'older, accepted',
    },
    {
      status: updateStatus(manifest, report({ cli_commit: '19f85875aa00bb11cc22' })),
      via: 'other commit',
    },
  ];
}

const keys = <K extends string>(record: Readonly<Record<K, StatusCopy>>): K[] =>
  Object.keys(record) as K[];

void describe('every status the code can return has copy, and the chips say the legend’s words', () => {
  void test('a tool: every branch of toolStatus() and readiness()', () => {
    const reached = new Set<string>();
    for (const { key, word, via } of everyToolStatus()) {
      assert.ok(key in TOOL_STATUS, `${via} returns "${key}", which has no legend copy`);
      assert.equal(word, TOOL_STATUS[key as keyof typeof TOOL_STATUS].word, via);
      reached.add(key);
    }
    // Nothing in the legend the code cannot say.
    assert.deepEqual([...reached].sort(), keys(TOOL_STATUS).sort());
    assert.deepEqual([...TOOL_ORDER].sort(), keys(TOOL_STATUS).sort());
  });

  void test('a tool’s helper: every branch of updateStatus(), and the row chip’s words', () => {
    const reached = new Set<string>();
    for (const { status, via } of everyUpdateStatus()) {
      const chip = versionChip(status.key);
      if (status.key === 'checking') {
        assert.equal(chip, undefined, `${via}: still reading shows no chip`);
        continue;
      }
      assert.ok(status.key in UPDATE_STATUS, `${via} returns "${status.key}", which has no copy`);
      assert.equal(chip?.word, UPDATE_STATUS[status.key].word, via);
      assert.equal(chip.tone, UPDATE_STATUS[status.key].tone, via);
      reached.add(status.key);
    }
    assert.deepEqual([...reached].sort(), keys(UPDATE_STATUS).sort());
    assert.deepEqual([...UPDATE_ORDER].sort(), keys(UPDATE_STATUS).sort());
    // A device's chip for several tools all up to date.
    assert.equal(versionChip('up-to-date', 2)?.word, 'Helpers up to date');
  });

  void test('a device: every branch of deviceChip()', () => {
    const cases: [Device, string][] = [
      [device({ status: 'revoked', revoked_at: NOW - DAY }), 'revoked'],
      [device(), 'paired'],
      [device({ origin: 'imported', paired_at: null, confirmed: false }), 'confirm'],
      [device({ origin: 'imported', paired_at: null }), 'imported'],
    ];
    const reached = new Set<string>();
    for (const [d, expected] of cases) {
      const key = deviceChipKey(d, needsConfirm(d));
      assert.equal(key, expected);
      const chip = deviceChip(d);
      assert.equal(chip.word, DEVICE_STATUS[key].word, key);
      assert.equal(chip.tone, DEVICE_STATUS[key].tone, key);
      reached.add(key);
    }
    assert.deepEqual([...reached].sort(), keys(DEVICE_STATUS).sort());
    assert.deepEqual([...DEVICE_ORDER].sort(), keys(DEVICE_STATUS).sort());
  });

  void test('each entry: a word, one plain sentence of meaning, and what to do', () => {
    const all: [string, StatusCopy][] = [
      ...Object.entries(TOOL_STATUS),
      ['duplicate', DUPLICATE],
      ...Object.entries(UPDATE_STATUS),
      ...Object.entries(DEVICE_STATUS),
    ];
    for (const [key, copy] of all) {
      assert.ok(copy.word.trim() !== '', key);
      assert.match(copy.meaning, /^[A-Z].*[.]$/, `${key}: the meaning is a sentence`);
      assert.equal(
        copy.meaning.split(/(?<=[.!?])\s+(?=[A-Z])/).length,
        1,
        `${key}: the meaning is one sentence — ${copy.meaning}`,
      );
      assert.ok(copy.todo.trim().length > 0, `${key}: says what to do`);
      assert.doesNotMatch(`${copy.meaning} ${copy.todo}`, /lai_[A-Za-z0-9]/, key);
    }
  });

  void test('the thresholds are the code’s constants, in words', () => {
    const recent = `${String(ACTIVE_MS / MIN)} minutes`;
    const stale = `${String(OFFLINE_MS / DAY)} days`;
    assert.match(TOOL_STATUS.ready.meaning, new RegExp(`in the last ${recent}`));
    assert.match(TOOL_STATUS.idle.meaning, new RegExp(`between ${recent} and ${stale} ago`));
    assert.match(TOOL_STATUS.offline.meaning, new RegExp(`more than ${stale} ago`));
  });
});

void describe('each chip’s description is its row’s own evidence', () => {
  const codex = tool('codex');

  void test('Connected, not Ready: the code’s reason, when the credential was last used, and the first missing check', () => {
    const v = verification();
    const status = { ...readiness(v, codex), evidence: true };
    assert.equal(status.key, 'connected');
    const missing = checkLines(v, codex, 'Belka').find((line) => line.state === 'fail');
    assert.ok(missing);
    const text = toolChipDescription({
      label: 'Codex · Belka',
      status,
      agent: agent({ last_seen_at: NOW - 31 * MIN }),
      verification: v,
      tool: codex,
      deviceName: 'Belka',
      now: NOW,
    });
    assert.ok(text.startsWith(`Connected, not Ready: Codex · Belka. ${status.reason}.`), text);
    assert.match(text, /Its credential last reached the board 31 min ago\./);
    assert.ok(text.endsWith(`To make it Ready: ${missing.detail}`), text);
  });

  void test('Connected because the helper has not reported: that missing report is named', () => {
    const v = verification({ own: true, missing: ['client_report'] });
    const status = { ...readiness(v, codex), evidence: true };
    const text = toolChipDescription({
      label: 'Codex · Belka',
      status,
      agent: agent(),
      verification: v,
      tool: codex,
      deviceName: 'Belka',
      now: NOW,
    });
    assert.match(
      text,
      /^Connected, not Ready: Codex · Belka\. The helper has not reported client_report yet\./,
    );
    assert.match(text, /To make it Ready: Not yet reported: client_report\./);
  });

  void test('Omnigent, whose MCP client names no tool: the reason and the step LAI-1088 gives', () => {
    const omnigent = tool('omnigent');
    const v = verification({ harness: 'omnigent' });
    const status = { ...readiness(v, omnigent), evidence: true };
    assert.equal(status.key, 'connected');
    const missing = checkLines(v, omnigent, 'Belka').find((line) => line.state === 'fail');
    assert.ok(missing);
    const text = toolChipDescription({
      label: 'Omnigent · Belka',
      status,
      agent: agent({ harness: 'omnigent' }),
      verification: v,
      tool: omnigent,
      deviceName: 'Belka',
      now: NOW,
    });
    assert.ok(
      text.startsWith(
        'Connected, not Ready: Omnigent · Belka. The credential is in use; the helper has not yet reported that it is Omnigent’s.',
      ),
      text,
    );
    // The chip's next step is the checklist's own line, word for word.
    assert.ok(text.endsWith(`To make it Ready: ${missing.detail}`), text);
    assert.match(missing.detail, /What is missing is the helper’s report from this credential/);
    // And the legend's Connected says the same of such a tool.
    assert.match(
      TOOL_STATUS.connected.meaning,
      /names no tool, such as Omnigent, the helper’s report saying which tool it is/,
    );
  });

  void test('Ready says nothing more is needed; a row before its checks says only what its stamps show', () => {
    const v = verification({ own: true });
    const ready = { ...readiness(v, codex), evidence: true };
    assert.equal(ready.key, 'ready');
    const text = toolChipDescription({
      label: 'Codex · Belka',
      status: ready,
      agent: agent(),
      verification: v,
      tool: codex,
      deviceName: 'Belka',
      now: NOW,
    });
    assert.equal(text, 'Ready: Codex · Belka. Codex is using its own credential. Nothing to do.');

    // Before its verification is read: toolStatus's reason, and the legend's what-to-do.
    const stamps = { ...toolStatus(agent({ last_seen_at: null }), NOW), evidence: false };
    assert.equal(
      toolChipDescription({
        label: 'Codex · Belka',
        status: stamps,
        agent: agent({ last_seen_at: null }),
        verification: undefined,
        tool: codex,
        deviceName: 'Belka',
        now: NOW,
      }),
      `Needs setup: Codex · Belka. Credential created, never used. ${TOOL_STATUS['needs-setup'].todo}`,
    );
  });

  void test('the helper chip: the reason updateStatus gave this row, and what to do', () => {
    const required = updateStatus(manifest, report({ protocol: 1 }));
    assert.equal(
      updateChipDescription('Codex · Belka', required),
      `${required.word}: Codex · Belka. ${required.reason}. ${UPDATE_STATUS.required.todo}`,
    );
    const unknown = updateStatus(manifest, null);
    assert.match(
      updateChipDescription('Codex · Belka', unknown),
      /Run laika update on that device/,
    );
    assert.equal(
      deviceVersionDescription(
        'Belka',
        'Helper updates: 1 update required, 1 up to date',
        'required',
      ),
      `Belka: Helper updates: 1 update required, 1 up to date. ${UPDATE_STATUS.required.todo}`,
    );
  });

  void test('the device chip: the row’s own facts', () => {
    assert.equal(
      deviceChipDescription(device(), 'paired', NOW),
      `Paired: Belka holds a key this board approved ${timeLabel(NOW - 2 * DAY, NOW).text}. ${DEVICE_STATUS.paired.todo}`,
    );
    assert.match(
      deviceChipDescription(device({ origin: 'imported', confirmed: false }), 'confirm', NOW),
      /^Imported — confirm it’s yours: Laika made Belka from the name your tools reported/,
    );
    assert.match(
      duplicateDescription('Codex · Belka'),
      /^Duplicate: Codex · Belka is one of two or more/,
    );
  });

  void test('the legend draws a tool chip in the tone readiness() gives it', () => {
    // A row draws the code's own tone; the legend's chip matches readiness(), which
    // decides every row once its checks are read.
    const cases: [Over, string][] = [
      [{ own: true }, 'ready'],
      [{}, 'connected'],
      [{ installed: false }, 'needs-setup'],
      [{ own: true, requestAt: NOW - ACTIVE_MS - MIN }, 'idle'],
      [{ own: true, requestAt: NOW - OFFLINE_MS - MIN }, 'offline'],
      [{ status: 'revoked' }, 'revoked'],
    ];
    for (const [over, key] of cases) {
      const r = readiness(verification({ harness: 'claude-code', ...over }), tool('claude-code'));
      assert.equal(r.key, key);
      assert.equal(chipTone(r.tone), TOOL_STATUS[r.key].tone, key);
    }
  });
});
