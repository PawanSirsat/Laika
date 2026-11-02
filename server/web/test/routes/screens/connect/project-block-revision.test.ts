/**
 * The revision-2 instructions block and the Project setup prompt (LAI-1052,
 * plan LAI-1042 §G).
 *
 * `replaceLaikaBlock` is the prompt's rules as a pure function, so each rule
 * is a fixture here: a file is created, appended to, updated from revision 1
 * or an older marked block, or left alone — and in every case the text
 * outside the Laika block is byte-identical.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  AGENT_GUIDES,
  instructionsTarget,
} from '../../../../src/routes/screens/connect/connect-agents.ts';
import {
  BLOCK_END,
  BLOCK_MARKER,
  blockBegin,
  markedProjectBlock,
  PLACEHOLDER_TOKEN,
  PROJECT_BLOCK_REVISION,
  projectBlock,
  projectPrompt,
  projectSetupPrompt,
  replaceLaikaBlock,
} from '../../../../src/routes/screens/connect/connect-copy.ts';
import { targetFor } from '../../../../src/routes/screens/developer/v3/project-setup.ts';

const ORIGIN = 'http://board.example.test:9999';
const PROJECT = { slug: 'onroute', prefix: 'ONR', name: 'OnRoute' };
const BLOCK = markedProjectBlock(ORIGIN, PROJECT);

const HUMAN_TOP = `# OnRoute

Our own rules. Do not touch.

- Use pnpm.
`;
const HUMAN_BOTTOM = `## Deploying

Run the gate first.
`;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

void describe('the revision-2 block', () => {
  void test('keeps the BLOCK_MARKER line byte-identical, on line 3 of the block proper', () => {
    const lines = BLOCK.split('\n');
    assert.equal(lines[0], blockBegin(PROJECT.slug));
    assert.equal(lines[1], '## Laika');
    assert.equal(lines[3]?.startsWith(BLOCK_MARKER), true);
    assert.equal(BLOCK_MARKER, 'This project is tracked on a Laika board.');
    assert.equal(lines.at(-1), BLOCK_END);
  });

  void test('the activity census pattern still finds it', () => {
    // cli/src/activity-census.ts: LAIKA_BLOCK_PATTERN.
    assert.match(BLOCK, /This project is tracked on (?:a|the) Laika board/);
  });

  void test('names its template revision, which is not the brief’s context_revision', () => {
    assert.equal(PROJECT_BLOCK_REVISION, 2);
    assert.ok(BLOCK.includes(`revision=${String(PROJECT_BLOCK_REVISION)} project=onroute`));
    assert.doesNotMatch(BLOCK, /context_revision/);
  });

  void test('CONTROL: the classic block and prompt are byte-for-byte what master served', () => {
    // Hashes of origin/master's projectBlock / projectPrompt for this fixture,
    // taken before LAI-1052 touched the file.
    const block = projectBlock(ORIGIN, PROJECT);
    assert.equal(sha(block), 'dd09272699899abe7882b88741146a536067f6f33c447f44e9d58e5ab09271d6');
    assert.equal(
      sha(projectPrompt({ origin: ORIGIN, project: PROJECT, path: 'CLAUDE.md', block })),
      'b8342a5a3712ac8048c5fda710e36a12dc002a54d6cedd369a48a1eeddd7d4b9',
    );
  });
});

void describe('replaceLaikaBlock', () => {
  void test('a missing file is created with the wrapped block', () => {
    const wrapped = `---\nalwaysApply: true\n---\n\n${BLOCK}`;
    const out = replaceLaikaBlock(null, BLOCK, wrapped);
    assert.equal(out.outcome, 'created');
    assert.equal(out.text, `${wrapped}\n`);
  });

  void test('no block: appended, everything already there kept byte for byte', () => {
    const before = HUMAN_TOP + '\n' + HUMAN_BOTTOM;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.outcome, 'appended');
    assert.ok(out.text.startsWith(before));
    assert.equal(out.text, `${before}\n${BLOCK}\n`);
  });

  void test('a file with no final newline gains a blank line, not a run-on', () => {
    const out = replaceLaikaBlock('# Notes', BLOCK);
    assert.equal(out.text, `# Notes\n\n${BLOCK}\n`);
  });

  void test('revision 1 between human sections: only the ## Laika section is replaced', () => {
    const old = projectBlock('http://old.example.test', PROJECT);
    const before = `${HUMAN_TOP}\n${old}\n\n${HUMAN_BOTTOM}`;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.outcome, 'updated');
    assert.equal(out.from, 1);
    assert.equal(out.text, `${HUMAN_TOP}\n${BLOCK}\n\n${HUMAN_BOTTOM}`);
    assert.ok(!out.text.includes('old.example.test'));
  });

  void test('revision 1 at the end of the file: replaced, the trailing newline kept', () => {
    const before = `${HUMAN_TOP}\n${projectBlock(ORIGIN, PROJECT)}\n`;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.text, `${HUMAN_TOP}\n${BLOCK}\n`);
  });

  void test('a ## Laika section of someone’s own, without the marker, is not ours', () => {
    const before = `${HUMAN_TOP}\n## Laika\n\nOur notes about the dog.\n`;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.outcome, 'appended');
    assert.ok(out.text.startsWith(before));
  });

  void test('an older marked block is replaced between its markers, and nothing else', () => {
    const older = `${blockBegin(PROJECT.slug, 1)}\n## Laika\n\nold words\n${BLOCK_END}`;
    const before = `${HUMAN_TOP}\n${older}\n\n${HUMAN_BOTTOM}`;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.outcome, 'updated');
    assert.equal(out.from, 1);
    assert.equal(out.text, `${HUMAN_TOP}\n${BLOCK}\n\n${HUMAN_BOTTOM}`);
  });

  void test('a revision-2 block for another project is replaced, not taken as current', () => {
    const other = markedProjectBlock(ORIGIN, { slug: 'other', prefix: 'OTH', name: 'Other' });
    const before = `${HUMAN_TOP}\n${other}\n\n${HUMAN_BOTTOM}`;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.outcome, 'updated');
    assert.equal(out.from, 2);
    assert.equal(out.text, `${HUMAN_TOP}\n${BLOCK}\n\n${HUMAN_BOTTOM}`);
  });

  void test('a revision-2 block written before a prefix change is replaced', () => {
    const stale = markedProjectBlock(ORIGIN, { ...PROJECT, prefix: 'OLD' });
    assert.ok(stale.includes(blockBegin(PROJECT.slug)), 'same slug, so only the prefix differs');
    const before = `${HUMAN_TOP}\n${stale}\n`;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.outcome, 'updated');
    assert.equal(out.text, `${HUMAN_TOP}\n${BLOCK}\n`);
  });

  void test('a begin marker with no end marker is not a marked block', () => {
    const before = `${HUMAN_TOP}\n${blockBegin(PROJECT.slug)}\nhalf a block\n`;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.outcome, 'appended');
    assert.ok(out.text.startsWith(before));
  });

  void test('a current block is left exactly as it is, human edits inside it included', () => {
    const edited = BLOCK.replace('Mirror work onto it', 'We mirror work onto it');
    const before = `${HUMAN_TOP}\n${edited}\n`;
    const out = replaceLaikaBlock(before, BLOCK);
    assert.equal(out.outcome, 'current');
    assert.equal(out.text, before);
  });
});

void describe('the Project setup prompt', () => {
  const target = instructionsTarget('claude-code');
  const prompt = projectSetupPrompt({
    origin: ORIGIN,
    project: PROJECT,
    path: target.path,
    block: BLOCK,
  });

  void test('it was built at all, and carries the block verbatim', () => {
    assert.ok(prompt.length > 1000, `the prompt is ${String(prompt.length)} characters`);
    assert.ok(prompt.includes(`--- begin block ---\n${BLOCK}\n--- end block ---`));
  });

  void test('it inspects first, diffs before replacing, and touches only the Laika block', () => {
    assert.match(prompt, /Read \.\/CLAUDE\.md first/);
    assert.match(prompt, /diff and wait for me to confirm/);
    assert.match(prompt, /replace only that block/);
    assert.match(prompt, /keeping\s+everything already in the file/);
    assert.ok(prompt.includes(BLOCK_MARKER), 'it must name the revision-1 marker');
    assert.ok(prompt.includes(BLOCK_END));
  });

  void test('up to date means this revision, this project and this prefix, end marker included', () => {
    assert.match(
      prompt,
      /a line starting "<!-- laika:begin" and a\s+later "<!-- laika:end -->" line/,
    );
    assert.match(prompt, /revision of\s+2 or more and project=onroute/);
    assert.match(prompt, /task keys look like\s+`ONR-42`, it is already up to date/);
    assert.match(
      prompt,
      /Otherwise, if it has a Laika block[\s\S]*whatever its revision or project/,
    );
  });

  void test('it never inserts a token, commits, reinstalls Laika or touches MCP config', () => {
    assert.match(prompt, /must never gain one/);
    assert.match(prompt, /do not commit or push/);
    assert.match(prompt, /Do not install, reinstall or update Laika/);
    assert.match(prompt, /do not edit any MCP configuration/);
  });

  void test('before it appends, it looks for a hand-written Laika section and asks (LAI-1084)', () => {
    // OnRoute's CLAUDE.md had `## Laika board ritual`: no markers, no
    // BLOCK_MARKER line. The prompt appended a second block beside it.
    const look = prompt.indexOf(
      'look for a section someone wrote by\n   hand about this Laika board',
    );
    const append = prompt.indexOf('append the block below');
    assert.ok(look !== -1, 'the detection step is missing');
    assert.ok(look < append, 'it must look before it appends');
    const step = prompt.slice(look, append);
    for (const sign of [
      'a heading that mentions\n   Laika',
      'laika_whoami',
      'get_project_context',
      'start_working',
      'finish_task',
      ORIGIN,
      '`ONR-42`',
    ]) {
      assert.ok(step.includes(sign), `it names ${sign}`);
    }
    assert.match(step, /show it to me and offer to replace\s+that whole section/);
    assert.match(step, /Ask which of its\s+lines I want to keep/);
    assert.match(step, /Show me the diff and wait for me to confirm/);
    assert.match(step, /If I\s+say no, change nothing and stop/);
    assert.match(prompt, /Never add a second Laika section to a file that has one/);
    assert.match(prompt, /replaced a hand-written Laika section/);
  });

  void test('and it gave up none of the guarantees it had before LAI-1084', () => {
    for (const guarantee of [
      // Inspect first; only the Laika block is the tool's to change.
      /Read \.\/CLAUDE\.md first\. Do not assume what is in it\./,
      /Only the Laika block in that file is\s+yours to change/,
      // Up to date: this revision, this project, this prefix — unchanged.
      /whose begin line says a revision of\s+2 or more and project=onroute, and whose task keys look like\s+`ONR-42`, it is already up to date: tell me so and stop\./,
      // A marked or revision-1 block: shown as a diff, confirmed, replaced alone.
      /show me the exact old and new text\s+as a diff and wait for me to confirm\. Then replace only that block\./,
      /keeping everything already in the file\. Create the file only if it\s+does not exist\./,
      // No token, no install, no MCP config, no commit, nothing else.
      /Change nothing else\./,
      /It contains no token and must never gain one/,
      /do not ask me for one/,
      /Do not install, reinstall or update Laika, do not pair\s+a device, do not edit any MCP configuration, and do not commit or push/,
    ]) {
      assert.match(prompt, guarantee);
    }
  });

  void test('CONTROL: zero secrets — no lai_ token, no placeholder, no command that mints one', () => {
    for (const text of [prompt, BLOCK]) {
      assert.doesNotMatch(text, /lai_[A-Za-z0-9…]/);
      assert.ok(!text.includes(PLACEHOLDER_TOKEN));
      assert.doesNotMatch(text, /LAIKA_TOKEN|Authorization|Bearer|install\.sh|git clone/);
    }
  });

  void test('a rule-file tool gets its frontmatter only for a new file', () => {
    const cursor = instructionsTarget('cursor');
    const preamble = cursor.wrap('').trimEnd();
    const text = projectSetupPrompt({
      origin: ORIGIN,
      project: PROJECT,
      path: cursor.path,
      block: BLOCK,
      preamble,
    });
    assert.ok(preamble.startsWith('---'));
    assert.ok(
      text.includes(`A new file starts with these lines, before the block:\n\n${preamble}`),
    );
    assert.ok(!prompt.includes('A new file starts with'));
  });
});

void describe('per-tool targets', () => {
  void test('every catalogue tool’s target is instructionsTarget()’s, path for path', () => {
    for (const guide of AGENT_GUIDES) {
      if (guide.id === 'any' || guide.id === 'rest') continue;
      assert.equal(targetFor(guide.client).path, instructionsTarget(guide.id).path, guide.id);
    }
  });

  void test('a client with no guide of its own writes AGENTS.md', () => {
    assert.equal(targetFor('other').path, 'AGENTS.md');
    assert.equal(targetFor('roo').path, instructionsTarget('any').path);
  });
});
