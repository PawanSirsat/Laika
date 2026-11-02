/**
 * The tool catalog *Add tool* offers (LAI-1061, plan LAI-1042 §E.6, §M),
 * held in the web: one entry per tool the server accepts, by name from both
 * sides, with honest modes and only Claude Code and Codex claiming sessions.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

/**
 * What `laika tool add` does with each board slug, read from `planFor` in
 * `cli/src/tool-add.ts` (LAI-1060): the `case` labels above each `kind:`,
 * and `default` for every slug no case names.
 */
function cliPlans(): { readonly named: ReadonlyMap<string, string>; readonly fallback: string } {
  const source = readFileSync(
    new URL('../../../../../../../cli/src/tool-add.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('export function planFor(');
  assert.ok(start >= 0, 'cli/src/tool-add.ts no longer exports planFor');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  const named = new Map<string, string>();
  let pending: string[] = [];
  let fallback: string | undefined;
  let inDefault = false;
  for (const line of body.split('\n')) {
    const label = /^\s*case '([^']+)':/.exec(line);
    if (label?.[1] !== undefined) pending.push(label[1]);
    if (/^\s*default:/.test(line)) inDefault = true;
    const kind = /kind: '([a-z-]+)'/.exec(line);
    if (kind?.[1] !== undefined) {
      for (const slug of pending) named.set(slug, kind[1]);
      if (inDefault) fallback = kind[1];
      pending = [];
    }
  }
  assert.ok(named.size >= 3, 'read too few cases from planFor to trust');
  assert.ok(fallback !== undefined, 'planFor has no default the scan could read');
  return { named, fallback };
}

void describe('a command only for a tool the CLI sets up (#213)', () => {
  void test('cliSetup is true exactly where planFor does not refuse, slug by slug', () => {
    const { named, fallback } = cliPlans();
    const wrong = TOOL_CATALOG.filter((tool) => {
      const kind = named.get(tool.harness) ?? fallback;
      return tool.cliSetup !== (kind !== 'refused');
    }).map(
      (tool) =>
        `${tool.harness}: cliSetup ${String(tool.cliSetup)}, planFor ${named.get(tool.harness) ?? fallback}`,
    );
    assert.deepEqual(wrong, []);
    // The scan read the real thing: Claude Code is set up and Antigravity refused.
    assert.equal(named.get('claude-code'), 'full');
    assert.equal(named.get('antigravity'), 'refused');
  });

  void test('a refused tool says so and points at the manual way, not a command', () => {
    for (const tool of TOOL_CATALOG.filter((t) => !t.cliSetup)) {
      assert.match(tool.notes[0] ?? '', /refuses/, `${tool.harness}'s first note`);
      assert.match(tool.notes[0] ?? '', /personal token from Advanced/, tool.harness);
    }
  });
});
