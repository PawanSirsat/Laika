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

void describe('what the MCP entry is, said the same on both sides (LAI-1072)', () => {
  /** The CLI's harness name for a board slug: VS Code is `copilot-vscode` there. */
  const cliHarness = (slug: string): string => (slug === 'vscode' ? 'copilot-vscode' : slug);

  void test('every tool planFor leaves to MCP by hand says "MCP set up by hand", with its own variable', () => {
    const { named } = cliPlans();
    const manual = TOOL_CATALOG.filter((tool) => named.get(tool.harness) === 'mcp-manual');
    assert.deepEqual(
      manual.map((tool) => tool.harness),
      ['cursor', 'gemini-cli', 'vscode'],
    );
    for (const tool of manual) {
      const notes = tool.notes.join(' ');
      assert.match(notes, /MCP set up by hand/, tool.harness);
      // `tokenVar()` in cli/src/tool-add.ts: LAIKA_AGENT_TOKEN_ and the harness in capitals.
      const variable = `LAIKA_AGENT_TOKEN_${cliHarness(tool.harness)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_')}`;
      assert.ok(notes.includes(variable), `${tool.harness} names no ${variable}`);
      assert.match(notes, /`laika tool add` prints the exact step/, tool.harness);
    }
  });

  void test('Claude Code is automatic and no longer says plain claude gets no Laika tools', () => {
    const claude = catalogTool('claude-code');
    assert.equal(claude?.mode, 'automatic');
    const notes = claude?.notes.join(' ') ?? '';
    assert.doesNotMatch(notes, /gets no Laika tools/);
    assert.match(notes, /MCP entry in `~\/\.claude\.json` reads this tool’s own credential/);
    // The CLI really writes it: planFor's Claude Code is `full`, and tool add calls claudeMcp.
    const source = readFileSync(
      new URL('../../../../../../../cli/src/tool-add.ts', import.meta.url),
      'utf8',
    );
    assert.match(source, /if \(target === 'claude-code'\) mcp = claudeMcp\(/);
  });
});
