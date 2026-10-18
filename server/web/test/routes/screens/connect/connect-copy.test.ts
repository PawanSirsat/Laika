/**
 * The text the Connect page hands people (LAI-622).
 *
 * These strings are the deliverable — one is pasted into a session, the other
 * is committed to a repository — so they are asserted here, without a renderer,
 * rather than eyeballed on the page.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  projectBlock,
  manualCommands,
  PLACEHOLDER_TOKEN,
  setupPrompt,
} from '../../../../src/routes/screens/connect/connect-copy.ts';

const ORIGIN = 'http://board.example.test:9999';
const SECRET = 'lai_ThisIsTheWholeSecretAndMustNotEscape';
const PROJECT = { slug: 'onroute', prefix: 'ONR', name: 'OnRoute' };

void describe('the setup prompt', () => {
  void test('it was built at all', () => {
    // Vacuity guard: every assertion below is a `match` on this string, and a
    // `match` against an empty string fails in a way that reads like a content
    // problem rather than an empty return.
    const prompt = setupPrompt({ origin: ORIGIN, secret: SECRET, project: PROJECT });
    assert.ok(prompt.length > 800, `the prompt is ${String(prompt.length)} characters`);
  });

  void test('it names the board this reader is actually on', () => {
    const prompt = setupPrompt({ origin: ORIGIN, secret: SECRET, project: PROJECT });
    assert.ok(prompt.includes(ORIGIN), 'the prompt does not name the board');
    // The owner's deployment, and the prototype's fixture host. Either one
    // appearing means something was hardcoded instead of read from the page.
    assert.doesNotMatch(prompt, /52\.72\.203\.206/);
    assert.doesNotMatch(prompt, /kvelld\.internal/);
  });

  void test('the installer is fed the URL first and the token second', () => {
    const prompt = setupPrompt({ origin: ORIGIN, secret: SECRET, project: PROJECT });
    const heredoc = /<<'LAIKA_SETUP'\n(.+)\n(.+)\nLAIKA_SETUP/.exec(prompt);
    assert.ok(heredoc !== null, 'no heredoc in the prompt');
    assert.equal(heredoc[1], ORIGIN, 'the first answer is not the board URL');
    assert.equal(heredoc[2], SECRET, 'the second answer is not the token');
  });

  void test('it does every job the page promises', () => {
    const prompt = setupPrompt({ origin: ORIGIN, secret: SECRET, project: PROJECT });
    assert.match(prompt, /git clone/, 'it never fetches the plugin');
    assert.match(prompt, /install\.sh/, 'it never runs the installer');
    assert.match(prompt, /\/api\/v1\/me/, 'it never checks the board answers');
    assert.match(prompt, /CLAUDE\.md/, 'it never writes the project block');
    assert.match(prompt, /Report back/, 'it never reports');
  });

  void test('it tells Claude not to use the tools it has just installed', () => {
    /*
     * Claude Code loads plugins at startup, so the tools cannot exist in the
     * session that ran the install. Without this line that session spends ten
     * minutes calling a tool that is not there and reports the setup broken.
     */
    const prompt = setupPrompt({ origin: ORIGIN, secret: SECRET, project: PROJECT });
    assert.match(prompt, /loads plugins at startup/);
  });

  void test('CONTROL: with no token it shows a placeholder, never `undefined`', () => {
    const prompt = setupPrompt({ origin: ORIGIN, secret: undefined, project: PROJECT });
    assert.ok(prompt.includes(PLACEHOLDER_TOKEN), 'no placeholder for the missing token');
    // Word-bounded: the clone line legitimately contains `2>/dev/null`, and an
    // assertion that cannot tell that from a leaked value is one that has to be
    // weakened the first time it fires — which is how a control stops being one.
    assert.doesNotMatch(prompt, /\bundefined\b/, 'a missing token leaked as `undefined`');
    assert.match(prompt, /Token: {2}lai_/, 'the token line lost its placeholder');
  });

  void test('with no project it skips the block rather than inventing one', () => {
    const prompt = setupPrompt({ origin: ORIGIN, secret: SECRET, project: undefined });
    assert.match(prompt, /Skip this step/);
    assert.doesNotMatch(prompt, /--- begin block ---/);
  });
});

void describe('the project block', () => {
  void test('CONTROL: it carries no token, because it is committed', () => {
    /*
     * **This is the assertion that keeps the two blocks apart.** They sit
     * inches from each other on the page and are built by the same module; the
     * prompt is pasted into a session and carries the secret by the owner's
     * decision, and this one goes into a git repository where a secret is a
     * leak rather than a bug.
     */
    const block = projectBlock(ORIGIN, PROJECT);
    assert.doesNotMatch(block, /lai_/, 'a token shape reached the committed block');
    assert.ok(!block.includes(SECRET), 'the secret reached the committed block');
  });

  void test('it names the project it was generated for', () => {
    const block = projectBlock(ORIGIN, PROJECT);
    assert.match(block, /`onroute`/, 'the slug is missing');
    assert.match(block, /ONR-42/, 'the key shape is missing');
    // An un-interpolated template is the failure this catches.
    assert.doesNotMatch(block, /\{SLUG\}|\{PREFIX\}|\$\{/);
  });

  void test('it is for any agent, and starts where the server says to start', () => {
    // LAI-737: the same text goes into AGENTS.md, GEMINI.md or a Cursor rule,
    // and LAI-736's server instructions tell every agent to call laika_whoami
    // first — a block that disagreed would be two rulebooks.
    const block = projectBlock(ORIGIN, PROJECT);
    assert.doesNotMatch(block, /Claude/, 'the block assumes one agent');
    assert.match(block, /laika_whoami/);
  });

  void test('it tells an agent to mark its task before starting, and to name its branch for the key (LAI-770)', () => {
    const block = projectBlock(ORIGIN, PROJECT);
    assert.match(block, /`start_working`[\s\S]{0,40}`branch`/);
    assert.match(block, /`update_status` to\s+`in_progress`/);
    assert.match(block, /`ONR-42-short-name`/);
    assert.match(block, /tokens/);
    // LAI-770 review, B2: start_working is the mark for a task already yours
    // and in progress; update_status to the status it has would be refused.
    assert.match(block, /also\s+when\s+it\s+is\s+already\s+yours\s+and\s+in\s+progress/);
    assert.doesNotMatch(
      block,
      /`update_status` to\s+`in_progress`\s+when the task\s+is already yours/,
    );
  });

  void test('it teaches review, never done', () => {
    const block = projectBlock(ORIGIN, PROJECT);
    assert.match(block, /review, never done/i);
    assert.match(block, /claim/i, 'it never says to claim before coding');
  });

  void test('it teaches finishing with proof, and reading a send-back first (LAI-762)', () => {
    const block = projectBlock(ORIGIN, PROJECT);
    assert.match(block, /`finish_task`[\s\S]{0,40}proof/, 'it never says to attach proof');
    for (const part of ['commits', 'branch', 'pull request', 'test commands', 'exit codes']) {
      assert.ok(block.includes(part), `the proof list does not name ${part}`);
    }
    assert.match(block, /sent back[\s\S]{0,60}reason in `get_task_context`/);
    assert.match(block, /fix that first/);
  });

  void test('its finishing rule says what the server tells every agent (LAI-762)', async () => {
    /*
     * The block and the server's `instructions` are two rulebooks for the same
     * board, so the wording is read from the server rather than written twice
     * here: the proof list and the send-back sentence are taken out of
     * `MCP_INSTRUCTIONS` and must appear in the block as they are.
     */
    const source = await readFile(
      new URL('../../../../../src/mcp/server.ts', import.meta.url),
      'utf8',
    );
    const instructions = flat(
      (/export const MCP_INSTRUCTIONS = `([\s\S]*?)`;/.exec(source)?.[1] ?? '').replaceAll(
        '\\`',
        '`',
      ),
    );
    const proof = /with your proof (\([^)]*\))/.exec(instructions)?.[1] ?? '';
    const sentBack = /A task a person sent back[^.]*\./.exec(instructions)?.[0] ?? '';
    // Vacuity guard: a pattern that stopped matching would compare `''`, which
    // every string includes.
    assert.ok(proof.includes('exit codes'), 'no proof list found in MCP_INSTRUCTIONS');
    assert.ok(sentBack.includes('get_task_context'), 'no send-back sentence found');

    const block = flat(projectBlock(ORIGIN, PROJECT));
    assert.ok(block.includes(proof), `the block's proof list differs from the server's ${proof}`);
    assert.ok(block.includes(sentBack), `the block does not say, as the server does: ${sentBack}`);
  });
});

/** Line breaks and indentation folded to single spaces, so wrapping is not wording. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

void describe('the manual commands', () => {
  void test('they are the two the installer actually needs', () => {
    const commands = manualCommands();
    assert.match(commands, /git clone/);
    assert.match(commands, /install\.sh/);
    assert.doesNotMatch(commands, /lai_/, 'the manual path must not carry a token');
  });
});
