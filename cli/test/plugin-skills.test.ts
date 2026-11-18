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
import { REVISION_3_RULES } from '../src/project-check.ts';

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

const SHOW = `${SKILLS}laika-show-your-work/SKILL.md`;

void describe('the skill that has an agent show its work (D-162, LAI-1351)', () => {
  void test('ships as a skill: its own directory, a SKILL.md with a name and a description', () => {
    assert.ok(existsSync(SHOW), `${SHOW} is missing`);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(SHOW, 'utf8'))?.[1] ?? '';
    assert.match(front, /^name: laika-show-your-work$/m);
    assert.match(front, /^description: .{40,}$/m);
  });

  void test('covers each case the task names', () => {
    const body = readFileSync(SHOW, 'utf8');
    for (const [what, pattern] of [
      ['when to attach', /## When to attach, and when not/],
      ['when not: tests are the proof', /tests are the whole proof/],
      ['the command', /laika attach LAI-42 /],
      ['before and after', /\*\*Before and after\*\*/],
      ['light and dark', /\*\*Light and dark\*\*/],
      ['laptop and phone', /\*\*Laptop and phone\*\*/],
      ['captions', /## Captions/],
      [
        'spreadsheets: masked copy and a rendition',
        /\*\*a masked copy\*\*[\s\S]{0,40}\*\*a PDF or screenshot rendition\*\*/,
      ],
      ['recordings', /## Recordings/],
      ['blockers and incidents', /## Blockers and incidents/],
      ['no override', /There is no override/],
      ['masking examples', /\| `password,\*\*\*\*\*\*\*\*` \|/],
      ['the parent and child rule', /## One parent per feature/],
    ] as const) {
      assert.match(body, pattern, what);
    }
  });

  void test('states the parent and child rule in the words the repo block uses', () => {
    const plain = (text: string): string => text.replace(/\s+/g, ' ');
    const rule = plain(REVISION_3_RULES[1]).replace(/^8\. \*\*One parent per feature\.\*\* /, '');
    assert.ok(rule.startsWith('A new feature'), 'the rule was not read — the probe is broken');
    assert.ok(plain(readFileSync(SHOW, 'utf8')).includes(rule));
  });

  void test('names only tools the server serves — read from both sides', () => {
    const served = registeredTools();
    const NOT_TOOLS = new Set(['id_rsa']);
    const named = [...readFileSync(SHOW, 'utf8').matchAll(/`([a-z]+_[a-z_]+)`/g)]
      .map((m) => m[1] ?? '')
      .filter((name) => !NOT_TOOLS.has(name));
    assert.ok(named.length >= 5, `only ${String(named.length)} tools named — the probe is broken`);
    assert.deepEqual(
      named.filter((name) => !served.has(name)),
      [],
      'the skill names a tool the server does not serve',
    );
  });
});
