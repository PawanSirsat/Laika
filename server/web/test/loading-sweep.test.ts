/**
 * The loading-state sweep (LAI-293, phase 3).
 *
 * Phases 1 and 2 built the primitives and fixed the named screens. This file
 * guards the part that is easy to do once and lose: **every** control that
 * waits shows the same feedback, in the same way, across the whole app.
 *
 * These are source scans rather than renders, for the reason `code.ts` exists:
 * what is being asserted is structural — that a pattern is present everywhere
 * it should be, and absent everywhere it should not. A render test proves one
 * screen; the defect here is the screen nobody re-rendered.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from './helpers/code.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Every `.tsx` under `src/`, as stripped source keyed by path relative to it. */
const sources = new Map<string, string>();

before(async () => {
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}${entry.name}`;
      if (entry.isDirectory()) {
        await walk(`${full}/`);
      } else if (entry.name.endsWith('.tsx')) {
        sources.set(full.slice(SRC.length), code(await readFile(full, 'utf8')));
      }
    }
  };
  await walk(SRC);
});

void describe('the sweep covered the app, not a sample', () => {
  void test('it found the files at all', () => {
    // A walk that silently returns nothing would make every assertion below
    // pass by vacancy — the same defect as a workspace whose tests cannot fail.
    assert.ok(sources.size > 50, `only ${String(sources.size)} components found`);
    assert.ok(sources.has('components/forms/Button.tsx'), 'the walk missed a known file');
  });

  void test('no button swaps its label while busy', () => {
    /*
     * The retired behaviour: `{busy ? 'Creating…' : 'Create task'}`. The button
     * resized mid-click and the word you pressed disappeared. It was in eight
     * files and `Button`'s own `busyLabel` prop, and it is the thing most
     * likely to be typed again from habit by whoever adds the next form.
     */
    const swap = /\?\s*'[A-Z][a-z]+(?:ing|ting)…'/;
    const offenders = [...sources].filter(([, src]) => swap.test(src)).map(([path]) => path);
    assert.deepEqual(offenders, [], 'these swap their label instead of spinning');
  });

  void test('every file that spins imports the one spinner', () => {
    /*
     * Not a second hand-rolled `<span className="spinner">` somewhere. The
     * specifier is relative and its depth varies — `Button.tsx` lives inside
     * `components/` and reaches it as `../Spinner.tsx`, so matching on the
     * directory name would exempt the one component every form goes through.
     */
    let checked = 0;
    for (const [path, src] of sources) {
      if (!src.includes('<Spinner') || path === 'components/Spinner.tsx') continue;
      assert.match(
        src,
        /import \{ Spinner \} from '(?:\.\.\/)+(?:components\/)?Spinner\.tsx'/,
        path,
      );
      checked += 1;
    }
    assert.ok(checked > 10, `only ${String(checked)} components spin — the sweep shrank`);
  });
});

void describe('a spinner names the control that is actually working', () => {
  let card = '';
  let hook = '';

  before(async () => {
    const read = async (rel: string) => await readFile(`${SRC}${rel}`, 'utf8');
    card = code(await read('routes/screens/sprints/SprintCard.tsx'));
    hook = code(await read('routes/screens/sprints/use-sprints.ts'));
  });

  void test('the sprints hook keys its in-flight mutation', () => {
    /*
     * `busy` is screen-wide: one flag shared by every card. Spinning on it
     * would spin all four buttons on every card for one click — feedback that
     * points at the wrong control is worse than none, because the user waits
     * on the thing they did not press.
     */
    assert.match(hook, /readonly pending: string \| undefined/);
    assert.match(hook, /run\(`activate:\$\{id\}`/);
    assert.match(hook, /run\(`remove:\$\{id\}`/);
    // `busy` must stay derived from it, or the two can disagree.
    assert.match(hook, /const busy = pending !== undefined/);
  });

  void test('the card spins the pressed button and not its siblings', () => {
    assert.match(card, /pending === `activate:\$\{sprint\.id\}` && <Spinner/);
    assert.match(card, /pending === `remove:\$\{sprint\.id\}` && <Spinner/);
    // Its Edit and Add buttons open panels — nothing is in flight, so nothing
    // may spin. A bare `busy && <Spinner` anywhere here is that bug.
    assert.doesNotMatch(card, /\{busy && <Spinner/, 'a sibling spins on the shared flag');
  });
});

void describe('a control with no button still says it is working', () => {
  void test('inline edit reports the save it commits on blur', async () => {
    /*
     * `InlineEdit` has no submit button at all — Enter and blur commit it — so
     * there is nowhere for the usual spinner to go. Without this the field
     * greys out and nothing else happens, which reads as "broken", not "busy".
     */
    const src = code(await readFile(`${SRC}routes/screens/task/InlineEdit.tsx`, 'utf8'));
    assert.match(src, /busy \? \(/);
    assert.match(src, /<Spinner size="sm" label=\{`Saving \$\{label\}`\}/);
    // Labelled, not decorative: there is no `aria-busy` button here to carry it.
    assert.match(src, /Saving…/);
  });
});
