/**
 * The task card renders real fields, and no colour it invented (LAI-066).
 *
 * Two guarantees that would fail silently:
 *
 * 1. **Tags are real.** They were `demoTags(task.id)` until LAI-079 shipped the
 *    tags table. D-032 is explicit that *a demo module beside a real endpoint
 *    is a defect* — and the failure mode is invisible, because plausible sample
 *    chips look exactly like working ones.
 * 2. **No per-tag colour.** D-027 refused a palette on purpose: a colour must be
 *    chosen, stored, kept legible in both themes, and explained to whoever adds
 *    the tenth tag. The server sends `string[]`, so there is nothing to colour
 *    by even if someone wanted to.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from '../../../helpers/code.ts';

let card = '';
let css = '';

before(async () => {
  const dir = new URL('../../../../src/routes/screens/board/', import.meta.url);
  card = code(await readFile(fileURLToPath(new URL('TaskCard.tsx', dir)), 'utf8'));
  css = await readFile(fileURLToPath(new URL('board.css', dir)), 'utf8');
});

void describe('tags come from the API', () => {
  void test('the card imports no demo module', () => {
    assert.ok(!card.includes('demo/'), 'the card still reads sample data');
    assert.ok(!card.includes('demoTags'), 'demoTags is still referenced');
  });

  void test('it reads task.tags', () => {
    assert.match(card, /task\.tags/, 'tags are not taken from the task');
  });
});

void describe('no per-tag colour (D-027)', () => {
  void test('the chip class carries no tone suffix', () => {
    // `card-tag-agent`, `card-tag-auth` and friends went with the demo module
    // that invented the tones.
    //
    // `[\w$]` rather than `\w`: the first version of this guard missed
    // `card-tag-${tag}` — a template literal, which is precisely how anyone
    // would reintroduce a per-tag class — because `$` is not a word character.
    // Found by mutation-testing the guard rather than by reading it.
    assert.ok(!/card-tag-[\w$]/.test(card), 'the card still varies the chip class per tag');
    assert.ok(!/\.card-tag-[\w$]/.test(css), 'tone rules survive in the stylesheet');
  });

  void test('the one chip rule uses neutral tokens', () => {
    // AC7 names them: `--tub` ground, `--bd` border, `--tx2` text.
    const rule = /\.card-tag\s*\{[^}]*\}/.exec(css);
    assert.ok(rule, 'no .card-tag rule found — the guard has nothing to check');
    for (const token of ['--tub', '--bd', '--tx2']) {
      assert.ok(rule[0].includes(token), `the chip does not use ${token}`);
    }
    for (const coloured of ['--pur', '--acc', '--grn', '--amb', '--red']) {
      assert.ok(!rule[0].includes(coloured), `the chip is tinted with ${coloured}`);
    }
  });
});

void describe('the blocked banner names its blocker', () => {
  void test('it renders the blocking task, not just the word blocked', () => {
    // "blocked by a dependency" tells someone they are stuck and then makes
    // them go hunting for what by — the cost of being blocked, paid twice.
    assert.match(card, /blockers\(/, 'the card does not resolve which task blocks it');
    assert.match(card, /card-blocked-what/, 'the blocker title is not rendered');
  });

  void test('the key is never truncated, only the title', () => {
    // The key is what you go and look up; a shortened one matches no task.
    const keyRule = /\.card-blocked b\s*\{[^}]*\}/.exec(css);
    assert.ok(keyRule, 'no rule for the blocker key');
    assert.match(keyRule[0], /flex:\s*none/, 'the key can be squeezed');

    const titleRule = /\.card-blocked-what\s*\{[^}]*\}/.exec(css);
    assert.ok(titleRule, 'no rule for the blocker title');
    assert.match(titleRule[0], /text-overflow:\s*ellipsis/, 'the title does not truncate');
  });

  void test('the task key itself cannot break across lines', () => {
    // In a 167px column `LC-4` was breaking after the hyphen, rendering `LC-`
    // above `4` — which reads as two things and matches nothing.
    const rule = /\.card-key\s*\{[^}]*\}/.exec(css);
    assert.ok(rule, 'no .card-key rule found');
    assert.match(rule[0], /white-space:\s*nowrap/, 'the key can wrap mid-token');
  });
});

void describe('the stale marker is drawn, and never decided here (LAI-157)', () => {
  void test('the card reads the served timestamp', () => {
    assert.match(card, /task\.stale_flagged_at/, 'the card does not read the flag');
    assert.match(card, /marker-stale/, 'no stale marker is drawn');
  });

  void test('it says how long, rather than only that it is stale', () => {
    // §11.4.1's marker, and the reason LAI-208 sent a timestamp instead of a
    // boolean: "stale" and "stale for 9 days" are different messages to
    // somebody scanning a board.
    assert.match(card, /staleFor\(/, 'the marker prints no duration');
  });

  void test('the card invents no second definition of stale', () => {
    // §11.6's rule is three conditions evaluated by the nightly job. The client
    // may render the flag; it may not decide it, and the tempting version of
    // that is a status guard.
    //
    // **The lag is deliberate and must not be papered over here.** The job owns
    // the field in both directions, so a task rescued at noon keeps its marker
    // until tonight. Hiding it on non-`in_progress` tasks would be a third
    // staleness rule that disagrees with the other two; if the lag is judged too
    // visible the fix is the job's schedule.
    assert.ok(!card.includes('in_progress'), 'the marker is gated on status');
    assert.ok(!/stale[^;]*task\.status/.test(card), 'staleness is decided from status here');

    // A third assertion here forbade the word `heartbeat` outright, and it was
    // wrong: the tooltip names the signals so a reader learns what stale means,
    // and the card has no heartbeat data to reason *from* in any case. **An
    // assertion that cannot tell explaining from deciding is not a guard** — it
    // fails on good text and would have been silenced by weakening the tooltip.
    // The two above carry the property; the rule lives in §11.6.
  });
});
