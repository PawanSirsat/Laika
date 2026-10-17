/**
 * The skills the plugin ships to a user's agent (`plugin/skills/`).
 *
 * Here rather than beside `plugin/` for the reason in `plugin-hooks.test.ts`:
 * `plugin/` has no workspace entry, so a test placed there would not run in
 * the gate (LAI-230).
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKILLS = `${ROOT}plugin/skills/`;
const MCP_DIR = `${ROOT}server/src/mcp/`;
const MARK = `${SKILLS}laika-mark-your-task/SKILL.md`;

/** Every tool the server registers, read from the `registerTool` calls. */
function registeredTools(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(MCP_DIR).filter((f) => f.endsWith('.ts'))) {
    for (const match of readFileSync(MCP_DIR + file, 'utf8').matchAll(
      /registerTool\(\s*'([a-z_]+)'/g,
    )) {
      names.add(match[1] ?? '');
    }
  }
  return names;
}

void describe('the skill that has an agent mark its task (LAI-770)', () => {
  void test('ships as a skill: its own directory, a SKILL.md with a name and a description', () => {
    assert.ok(existsSync(MARK), `${MARK} is missing`);
    const body = readFileSync(MARK, 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(body)?.[1] ?? '';
    assert.match(front, /^name: laika-mark-your-task$/m);
    assert.match(front, /^description: .{40,}$/m);
  });

  void test('says to mark the task before starting, with the branch, and to name the branch for the key', () => {
    const body = readFileSync(MARK, 'utf8');
    assert.match(body, /`start_working`[\s\S]{0,80}`branch`/);
    assert.match(body, /`update_status`[\s\S]{0,40}in_progress/);
    assert.match(body, /`<KEY>-/);
    assert.match(body, /`LAI-42-/);
    // And why: an agent that knows the reason does not look for a way round it.
    assert.match(body, /tokens/);
    // LAI-770 review, B2: start_working is the mark for a task already yours
    // and in progress — update_status to the status it has would be refused.
    assert.match(body, /also\s+when\s+it\s+is\s+already\s+yours\s+and\s+in\s+progress/);
    assert.doesNotMatch(body, /answers\s+`conflict` naming you/);
  });

  void test('names only tools the server serves — read from both sides', () => {
    const served = registeredTools();
    assert.ok(served.size > 5, 'no registerTool calls parsed');
    const named = [...readFileSync(MARK, 'utf8').matchAll(/`([a-z]+_[a-z_]+)`/g)]
      .map((m) => m[1] ?? '')
      .filter((name) => name !== 'in_progress');
    assert.ok(named.length >= 3, `only ${String(named.length)} tools named — the probe is broken`);
    assert.deepEqual(
      named.filter((name) => !served.has(name)),
      [],
      'the skill names a tool the server does not serve',
    );
  });
});
