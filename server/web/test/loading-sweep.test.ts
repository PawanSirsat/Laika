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

void describe('the busy flag goes up before the wait, not after it', () => {
  void test('sign-in marks the session loading before it posts', async () => {
    /*
     * Found by driving the real instance, not by reading the diff: the Sign in
     * button showed nothing for the whole network round trip, then span for
     * the fast `/me` re-read afterwards. `setSession({ status: 'loading' })`
     * sat *below* `await apiSignIn(credentials)`, so `submitting` — which
     * `LoginRoute` derives from `session.status === 'loading'` — was false for
     * exactly the part anyone waits through.
     *
     * This asserts the order rather than the presence: both lines existed
     * before the fix, in the wrong sequence.
     */
    const src = code(
      await readFile(fileURLToPath(new URL('../src/api/use-session.ts', import.meta.url)), 'utf8'),
    );
    const start = src.indexOf('const signIn =');
    const end = src.indexOf('const signOut =');
    assert.ok(start !== -1 && end > start, 'signIn moved — this scan no longer reads it');
    const body = src.slice(start, end);

    const loading = body.indexOf("setSession({ status: 'loading' })");
    const post = body.indexOf('await apiSignIn(');
    assert.ok(loading !== -1, 'signIn no longer marks the session loading at all');
    assert.ok(post !== -1, 'signIn no longer posts — this scan is aimed at nothing');
    assert.ok(loading < post, 'the busy flag is set after the request it is meant to cover');

    // And it must come back down if the credentials are refused, or the
    // `loading` effect re-reads `/me`, takes a 401, and races the rejection.
    assert.match(body, /catch \(cause\) \{[\s\S]*?status: 'anonymous'[\s\S]*?throw cause/);
  });
});

void describe('the board skeleton mirrors the board it replaces', () => {
  void test('it builds the same grid template as LaneRow', async () => {
    /*
     * `LaneRow` sizes the add-column tile with a trailing `auto` track,
     * because `grid-auto-columns` gives every track one size and the tile
     * would otherwise take a full `1fr` share. The skeleton has to build the
     * same string or the lanes underneath it are a different width — measured
     * at 329px against the real 318px before this, which is the tile's 32px
     * plus its gap shared out among four lanes.
     *
     * Compared as strings, from both files, so neither can drift alone.
     */
    const read = async (rel: string) =>
      await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const laneRow = code(await read('../src/routes/screens/board/LaneRow.tsx'));
    const skeleton = code(await read('../src/components/LoadingState.tsx'));

    const track = /repeat\(\$\{String\([a-zA-Z.]+(?:\.length)?\)\}, (minmax\([^)]*\), 1fr\))\)/;
    const fromLane = track.exec(laneRow);
    const fromSkeleton = track.exec(skeleton);
    assert.ok(fromLane, 'LaneRow no longer builds a repeat() template — re-aim this');
    assert.ok(fromSkeleton, 'the board skeleton no longer builds one');
    assert.equal(fromSkeleton[1], fromLane[1], 'the lane track sizes have drifted apart');

    // And both must spend the trailing `auto` on the tile, conditionally.
    assert.match(laneRow, /: ' auto'/);
    assert.match(skeleton, /\? ' auto' : ''/);
  });

  void test('the skeleton reserves the tile on the same gate the board draws it', () => {
    /*
     * Matching templates is not enough: the skeleton can build the `auto`
     * track and still be told `addTile={false}`, which puts the 11px back.
     *
     * So both read **one named constant**, and this asserts it is the same
     * name in both places rather than two expressions that happen to agree.
     * Comparing the expressions was the earlier version and it anchored on the
     * wrong conditional spread — `mayConfigure && slug !== undefined`, a
     * different gate on a different concern — and reported drift that was its
     * own.
     */
    const screen = sources.get('routes/screens/BoardScreen.tsx');
    assert.ok(screen !== undefined, 'BoardScreen moved — this scan is aimed at nothing');

    const handler = screen.indexOf('onAddColumn:');
    assert.ok(handler !== -1, 'BoardScreen no longer wires onAddColumn');
    const spread = screen.lastIndexOf('{...(', handler);
    assert.ok(spread !== -1, 'onAddColumn is no longer inside a conditional spread');
    assert.match(
      screen.slice(spread, spread + 40),
      /^\{\.\.\.\(mayAddColumn\b/,
      'the real tile is drawn on some other gate than mayAddColumn',
    );
    assert.match(screen, /addTile=\{mayAddColumn\}/, 'the skeleton is told by some other gate');

    /*
     * And the gate must not depend on `project`, which is what the board is
     * fetching: consulting it would make the answer false for the whole time
     * the skeleton is on screen, which is the entire window that matters.
     */
    const defined = /const mayAddColumn =([\s\S]*?);\n/.exec(screen)?.[1];
    assert.ok(defined !== undefined, 'mayAddColumn is no longer defined in BoardScreen');
    assert.match(defined, /canConfigureProject/, 'the gate stopped asking the policy');
    assert.match(defined, /isFallbackColumn/, 'the gate stopped excluding fallback columns');
    assert.doesNotMatch(
      defined,
      /project !== undefined/,
      'the gate waits for the board it is meant to precede',
    );
  });
});

void describe('a count is not stated before it is known', () => {
  void test('presence-derived counts distinguish "none" from "not yet asked"', () => {
    /*
     * `presence?.present` is `undefined` until the fetch lands, and every
     * consumer here reached for `?? []` or optional chaining and then rendered
     * `.length`. That is `0` for *not asked yet* and `0` for *asked, nobody
     * there* — so the chip said "Agents 0" and the activity header said "0
     * agent sessions running" as facts, then changed them.
     *
     * CLAUDE.md §5.1: every number in the shipped UI comes from a response. A
     * count computed from absent data is a hardcoded value wearing a variable.
     */
    for (const path of [
      'components/space/SpaceTopBar.tsx',
      'routes/screens/activity/ActivityScreen.tsx',
      'routes/screens/activity/ActivityPanels.tsx',
    ]) {
      const src = sources.get(path);
      assert.ok(src !== undefined, `${path} moved — this scan is aimed at nothing`);
      assert.match(
        src,
        /presence [!=]== undefined/,
        `${path} renders a presence count without asking whether presence arrived`,
      );
    }
  });
});
