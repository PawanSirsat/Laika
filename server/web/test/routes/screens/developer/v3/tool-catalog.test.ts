/**
 * The tool catalog *Add tool* offers (LAI-1061, plan LAI-1042 §E.6, §M),
 * held in the web: one entry per tool the server accepts, by name from both
 * sides, with honest modes and only Claude Code and Codex claiming sessions.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AGENT_CLIENTS } from '../../../../../src/api/agent-clients.ts';
import {
  TOOL_CATALOG,
  catalogGroups,
  catalogTool,
} from '../../../../../src/routes/screens/developer/v3/tool-catalog.ts';

void describe('the tool catalog held in the web', () => {
  void test('one entry per tool the server accepts — every AGENT_CLIENTS slug but other — by name, both ways', () => {
    const served = AGENT_CLIENTS.filter((slug) => slug !== 'other');
    const listed = TOOL_CATALOG.map((tool) => tool.harness);
    assert.deepEqual(
      served.filter((slug) => !listed.includes(slug)),
      [],
      'served, not in the catalog',
    );
    assert.deepEqual(
      listed.filter((slug) => !(served as readonly string[]).includes(slug)),
      [],
      'in the catalog, not served',
    );
    assert.equal(new Set(listed).size, listed.length, 'listed once each');
  });

  void test('only Claude Code and Codex have sessions, claims and checkpoints (plan §M)', () => {
    assert.deepEqual(
      TOOL_CATALOG.filter((tool) => tool.sessions).map((tool) => tool.harness),
      ['claude-code', 'codex'],
    );
  });

  void test('honest modes: automatic, MCP only, manual (Antigravity), the rest unverified', () => {
    assert.equal(catalogTool('claude-code')?.mode, 'automatic');
    assert.equal(catalogTool('omnigent')?.mode, 'mcp-only');
    assert.equal(catalogTool('antigravity')?.mode, 'manual');
    assert.equal(catalogTool('zed')?.mode, 'unverified');
    assert.equal(catalogTool('other'), undefined);
    assert.equal(catalogTool('any'), undefined);
    assert.deepEqual(
      catalogGroups().map((group) => group.mode),
      ['automatic', 'mcp-only', 'manual', 'unverified'],
    );
  });

  void test('the tool-specific notes the plan names are there', () => {
    assert.match(catalogTool('claude-code')?.notes.join(' ') ?? '', /laika-claude/);
    assert.match(catalogTool('codex')?.notes.join(' ') ?? '', /\/hooks/);
    assert.match(catalogTool('omnigent')?.notes.join(' ') ?? '', /credential only/);
    assert.match(catalogTool('antigravity')?.notes.join(' ') ?? '', /by hand/);
  });
});
