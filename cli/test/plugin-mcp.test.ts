/**
 * The plugin's MCP wiring (LAI-419).
 *
 * Here rather than beside `plugin/` for the reason in `plugin-hooks.test.ts`:
 * `plugin/` has no workspace entry, so a test placed there would not run in the
 * gate (**LAI-230**).
 *
 * ## The count is the point
 *
 * The tool count has been wrong three times in three places — a task file said
 * **eight**, `CLAUDE.md` records *"ten listed and eleven served"*, and LAI-419's
 * own corrected criterion says **ten and ten**. Measured against both sources on
 * 2026-09-01: **§7.1's table lists eleven and `server/src/mcp/` registers
 * eleven**, and a live `tools/list` over `/mcp` returned exactly those eleven.
 *
 * So this asserts the **names**, from both sides, rather than a number somebody
 * has to keep in their head. A number in prose drifts silently; a name that
 * disappears fails here.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN = `${ROOT}plugin/`;
const MCP_DIR = `${ROOT}server/src/mcp/`;
const SPEC = `${ROOT}docs/SPEC.md`;

/** Every tool the server registers, read from the `registerTool` calls. */
function registeredTools(): readonly string[] {
  const names = new Set<string>();
  for (const file of readdirSync(MCP_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(MCP_DIR + file, 'utf8');
    for (const match of source.matchAll(/registerTool\(\s*'([a-z_]+)'/g)) {
      names.add(match[1] ?? '');
    }
  }
  return [...names].sort();
}

/** Every tool §7.1's table names, from its first column. */
function specTools(): readonly string[] {
  const spec = readFileSync(SPEC, 'utf8');
  const section = spec.slice(spec.indexOf('### 7.1'), spec.indexOf('### 7.2'));
  const names = new Set<string>();
  for (const line of section.split('\n')) {
    // Table rows only, and only the first cell — the later columns name fields
    // like `blocked_by` and `context_md`, which are not tools. Counting those is
    // how a grep gets this wrong.
    const cell = /^\|\s*`([a-z_]+)`\s*\|/.exec(line);
    if (cell !== null) names.add(cell[1] ?? '');
  }
  return [...names].sort();
}

void describe('the tool surface, from both sides', () => {
  void test('both readers found something — or every assertion below is vacuous', () => {
    assert.ok(registeredTools().length > 5, 'no registerTool calls parsed');
    assert.ok(specTools().length > 5, "§7.1's table parsed as empty");
  });

  void test('§7.1 and the registry name exactly the same tools', () => {
    assert.deepEqual(registeredTools(), specTools());
  });

  void test('and they are these eleven', () => {
    // Spelled out, so a tool appearing or vanishing is a deliberate edit here
    // rather than a number nobody re-counted. Verified against a live
    // `tools/list` on 2026-09-01, which returned exactly this set.
    assert.deepEqual(registeredTools(), [
      'add_comment',
      'create_task',
      'finish_task',
      'get_project_context',
      'get_task_context',
      'laika_whoami',
      'list_projects',
      'list_ready_tasks',
      'log_unlisted_work',
      'start_working',
      'update_status',
    ]);
  });
});

void describe('.mcp.json points at the deployment, and carries no secret', () => {
  const raw = readFileSync(`${PLUGIN}.mcp.json`, 'utf8');
  const parsed = JSON.parse(raw) as {
    mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
  };
  const laika = parsed.mcpServers.laika;

  void test('it is an http server at ${LAIKA_URL}/mcp', () => {
    assert.ok(laika !== undefined, 'no `laika` server declared');
    assert.equal(laika.type, 'http');
    assert.equal(laika.url, '${LAIKA_URL}/mcp');
  });

  void test('the token goes in a bearer header, from the environment', () => {
    assert.equal(laika?.headers.Authorization, 'Bearer ${LAIKA_TOKEN}');
  });

  void test('both values are placeholders, never a literal', () => {
    // A real URL here would point every installation at one deployment; a real
    // token would be a credential in git history for ever.
    assert.ok(!/https?:\/\//.test(laika?.url ?? ''), 'the URL is hardcoded');
    assert.ok(!/lai_[A-Za-z0-9]/.test(raw), 'a token-shaped literal is committed');
  });
});

void describe('no secret anywhere in plugin/', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) return walk(`${path}/`);
      return [path];
    });
  }

  void test('no `lai_`-prefixed string is committed', () => {
    const files = walk(PLUGIN);
    assert.ok(files.length > 5, `only ${String(files.length)} files walked — the probe is broken`);

    const offenders = files.filter((path) => {
      const body = readFileSync(path, 'utf8');
      // `lai_` followed by real token material. The prose `lai_...` in the
      // README and the `lai_` prefix check in laika-status.sh are the string
      // itself, not a token, and must stay legible.
      return /lai_[A-Za-z0-9]{6,}/.test(body);
    });
    assert.deepEqual(offenders, [], 'a token-shaped string is committed under plugin/');
  });
});
