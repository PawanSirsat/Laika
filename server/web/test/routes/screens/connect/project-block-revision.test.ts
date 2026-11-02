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

/** `text` with any run of whitespace between its words, so a re-wrap cannot fail it. */
const phrase = (text: string) =>
  new RegExp(
    text
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+'),
  );

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

  /** The text between two markers of the prompt, both required. */
  const between = (from: RegExp, to: RegExp) => {
    const a = prompt.search(from);
    const b = prompt.search(to);
    assert.ok(a !== -1 && b > a, `${String(from)} … ${String(to)} not found in order`);
    return prompt.slice(a, b);
  };

  void test('a hand-written Laika section is clearly about the board, never a mention (LAI-1084)', () => {
    // OnRoute's CLAUDE.md had `## Laika board ritual`: no markers, no
    // BLOCK_MARKER line. The prompt appended a second block beside it.
    const definition = between(/A hand-written Laika section has/, /^1\. Read/m);
    assert.match(
      definition,
      phrase(
        'A hand-written Laika section has no Laika markers and is clearly about the Laika board',
      ),
    );
    for (const sign of [
      phrase('its heading names Laika'),
      /laika_whoami/,
      /get_project_context/,
      /start_working/,
      /finish_task/,
      phrase(ORIGIN),
      phrase('task keys like `ONR-42`'),
    ]) {
      assert.match(definition, sign);
    }
    // A mention under a heading about something else is asked about, not replaced.
    assert.match(
      definition,
      phrase('Mentions inside a section whose heading is about something else'),
    );
    assert.match(definition, phrase('show me those lines and ask what I want done with them'));
    // LAI-1090: the mention path has the diff step every other path has.
    assert.match(
      definition,
      phrase(
        'If I want them changed, show me the diff and wait for me to confirm before you change them',
      ),
    );
    assert.match(
      definition,
      phrase('never replace a section whose heading is about something else'),
    );
  });

  void test('the opening names what besides the block it may change (LAI-1084, LAI-1091)', () => {
    assert.match(
      prompt,
      phrase(
        'Only the Laika block in that file, or, with my confirmation, a hand-written Laika section or a Laika mention inside another section, is yours to change; everything else in it belongs to the people who wrote it.',
      ),
    );
  });

  void test('a confirmed edit to a mention is in step 8 and the report as well (LAI-1091)', () => {
    // The mention path asks before changing a line under another heading;
    // step 8 and the report must not then read as if that edit were not allowed.
    const step = between(/^8\. /m, /^9\. /m);
    assert.match(
      step,
      phrase(
        'In the file, change only the Laika block and, with my confirmation, a hand-written Laika section or a Laika mention inside another section. Change nothing else.',
      ),
    );
    assert.match(
      between(/^9\. Report in one line/m, /--- begin block ---/),
      phrase('changed N Laika mentions inside other sections'),
    );
  });

  void test('before it appends, it offers to replace every hand-written section, and waits', () => {
    const step = between(/^4\. Otherwise, before you append/m, /^5\. /m);
    assert.match(step, phrase('look for hand-written Laika sections'));
    assert.match(step, phrase('If you find one or more, show me each one'));
    assert.match(
      step,
      phrase('replace the first with the block below and fold the others into it'),
    );
    assert.match(
      step,
      phrase(
        'Ask which of their lines I want to keep, show me the diff and wait for me to confirm.',
      ),
    );
    assert.match(step, phrase('If I say a section is not about this board, leave it as it is'));
    assert.ok(
      prompt.search(/^4\. /m) < prompt.search(phrase('append the block below at the end')),
      'it must look before it appends',
    );
    assert.match(prompt, phrase('Never add a second Laika section to a file that has one.'));
  });

  void test('a current block beside a hand-written section is offered the fold first (LAI-1084)', () => {
    // OnRoute today: a current marked block *and* its old hand-written section.
    const step = between(/^2\. If it has a marked Laika block/m, /^3\. /m);
    const fold = step.search(phrase('offer to fold it into the block and remove the duplicate'));
    const stop = step.search(phrase('If there are none, tell me it is up to date and stop.'));
    assert.match(
      step,
      phrase(
        'it is already up to date. Before you tell me so, look for hand-written Laika sections elsewhere in the file. For each one',
      ),
    );
    assert.ok(fold !== -1 && stop > fold, 'the fold is offered before it stops as up to date');
    assert.match(step, phrase('show me the diff and wait for me to confirm'));
    // An older block being replaced offers the same, as its own change (LAI-1090).
    const replace = between(/^3\. /m, /^4\. /m);
    assert.match(
      replace,
      phrase(
        'Then offer, as a separate change with its own diff, to fold each hand-written Laika section elsewhere in the file into it',
      ),
    );
    assert.match(replace, phrase('so I can take the update without the fold.'));
    assert.doesNotMatch(replace, /in the same diff/);
    // Lines kept, never a second Laika heading.
    assert.match(prompt, phrase('keep lines, not headings'));
    assert.match(
      prompt,
      phrase(
        "drop the section's old Laika heading unless I ask for it, so the file ends up with one Laika heading.",
      ),
    );
  });

  void test('a no leaves only that change undone; the others confirmed still apply (LAI-1090)', () => {
    // Step 3 offers an upgrade and a fold. "Change nothing at all" made a no to
    // the fold throw away the upgrade too.
    const step = between(/^6\. /m, /^7\. /m);
    assert.match(
      step,
      phrase(
        'Offer each change on its own: the block, and each hand-written section you would replace or fold in.',
      ),
    );
    assert.match(
      step,
      phrase(
        'If I say no to one, leave that one exactly as it is and still make the others I confirmed.',
      ),
    );
    assert.match(step, phrase('If I say no to all of them, change nothing.'));
    assert.doesNotMatch(prompt, /change nothing at all/);
    // Before appending, each section is its own change too.
    assert.match(
      between(/^4\. Otherwise, before you append/m, /^5\. /m),
      phrase('fold the others into it, each section as its own change.'),
    );
  });

  void test('a fold goes into the block: a no to the block folds nothing (LAI-1091)', () => {
    // Step 6 makes each change stand alone, but a fold has nowhere to go
    // without the block it folds into.
    assert.match(
      between(/^6\. /m, /^7\. /m),
      phrase('A fold goes into the block: if I say no to the block, do not fold anything into it.'),
    );
    // Step 3's update, declined, leaves the old block or pre-marker section as
    // it was: nothing is folded into it either.
    assert.match(
      between(/^3\. /m, /^4\. /m),
      phrase('If I say no to the update, fold nothing into the old block or section.'),
    );
  });

  void test('lines kept below the end marker are left, never offered again (LAI-1090)', () => {
    const rules = between(/When you fold a hand-written Laika section/, /^1\. Read/m);
    assert.match(
      rules,
      phrase(
        'Lines directly below the end marker, up to the next heading, were kept on purpose; leave them.',
      ),
    );
    assert.match(
      rules,
      phrase('They are not a hand-written Laika section, so never offer them for folding again.'),
    );
  });

  void test('every outcome has its own words, a partial yes included', () => {
    const report = between(/^9\. Report in one line/m, /--- begin block ---/);
    for (const outcome of [
      'created the file',
      'appended the block',
      'updated it from revision N',
      'replaced a hand-written Laika section',
      'folded N hand-written Laika sections into the block',
      'changed N Laika mentions inside other sections',
      'already up to date',
      'you said no and I changed nothing',
      'If I said no to some changes and yes to others, say what you changed and what you left as it was.',
    ]) {
      assert.match(report, phrase(outcome));
    }
  });

  void test('and it gave up none of the guarantees it had before LAI-1084', () => {
    // Quoted from the prompt as it was before LAI-1084 (ec91f053), matched
    // across any re-wrap. Two of its phrases changed on purpose: "Only the
    // Laika block … is yours to change" now names the confirmed exception,
    // and "up to date: tell me so and stop" now looks for a duplicate first.
    for (const guarantee of [
      'Read ./CLAUDE.md first. Do not assume what is in it.',
      'everything else in it belongs to the people who wrote it.',
      'a line starting "<!-- laika:begin" and a later "<!-- laika:end -->" line',
      'whose begin line says a revision of 2 or more and project=onroute, and whose task keys look like `ONR-42`, it is already up to date',
      'show me the exact old and new text as a diff and wait for me to confirm. Then replace only that block.',
      'If I edited lines inside the old block, point them out in the diff so I can keep them.',
      'keeping everything already in the file. Create the file only if it does not exist.',
      'Copy the block exactly. It contains no token and must never gain one: do not add a token, key or password anywhere, and do not ask me for one.',
      'Change nothing else. Do not install, reinstall or update Laika, do not pair a device, do not edit any MCP configuration, and do not commit or push: I will review the change myself.',
    ]) {
      assert.match(prompt, phrase(guarantee));
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
