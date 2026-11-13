import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  FLASH_MS,
  MOTION_MS,
  motionAllowed,
  recentlyTouched,
  remoteTaskTouch,
  TOUCH_TTL_MS,
  transitionName,
  type MotionContext,
} from '../../../../src/routes/screens/board/board-motion.ts';

const OK: MotionContext = {
  supported: true,
  reducedMotion: false,
  visible: true,
  dragging: false,
  boardView: true,
  overlayOpen: false,
};

void describe('board motion, the decisions (LAI-708)', () => {
  void test('the durations are the app’s and the design’s', () => {
    assert.equal(MOTION_MS, 200);
    assert.equal(FLASH_MS, 3600);
  });

  void test('a transition name is a safe CSS identifier', () => {
    assert.equal(transitionName('01J8ZABC'), 'task-01J8ZABC');
    assert.equal(transitionName('a b/c'), 'task-a_b_c');
  });

  void test('motion needs every condition, and any one stops it', () => {
    assert.equal(motionAllowed(OK), true);
    for (const key of Object.keys(OK) as (keyof MotionContext)[]) {
      const flipped = { ...OK, [key]: !OK[key] };
      assert.equal(motionAllowed(flipped), false, `${key} flipped still allowed motion`);
    }
  });

  void test('someone else’s change counts; my own move as myself does not', () => {
    assert.equal(
      remoteTaskTouch({ task_id: 't1', actor_id: 'u2', actor_kind: 'user' }, 'u1'),
      't1',
    );
    assert.equal(
      remoteTaskTouch({ task_id: 't1', actor_id: 'u1', actor_kind: 'user' }, 'u1'),
      undefined,
    );
    // My own agent changed it, not me in this tab.
    assert.equal(
      remoteTaskTouch({ task_id: 't1', actor_id: 'u1', actor_kind: 'agent' }, 'u1'),
      't1',
    );
    assert.equal(
      remoteTaskTouch({ task_id: 't1', actor_id: null, actor_kind: 'system' }, 'u1'),
      't1',
    );
    assert.equal(
      remoteTaskTouch({ task_id: null, actor_id: 'u2', actor_kind: 'user' }, 'u1'),
      undefined,
    );
  });

  void test('only recent touches count, and expired ones are pruned', () => {
    const touches = new Map([
      ['t1', 1_000],
      ['t2', 1_000 + TOUCH_TTL_MS],
    ]);
    const now = 1_000 + TOUCH_TTL_MS + 1;
    assert.deepEqual(recentlyTouched(touches, ['t1', 't2', 't3'], now), ['t2']);
    assert.equal(touches.has('t1'), false, 'an expired touch was kept');
  });
});

void describe('board motion, the stylesheet (LAI-708)', () => {
  const css = readFileSync(
    fileURLToPath(
      new URL('../../../../src/routes/screens/board/board-motion.css', import.meta.url),
    ),
    'utf8',
  );
  const motion = readFileSync(
    fileURLToPath(new URL('../../../../src/styles/motion.css', import.meta.url)),
    'utf8',
  );
  const reduced =
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? '';

  void test('the glide is 200ms, scoped to the board, and takes no clicks', () => {
    assert.match(css, /:root\.board-motion \{\s*view-transition-name: none;/);
    assert.match(css, /::view-transition \{\s*pointer-events: none;/);
    // 200ms is D-071's, held by `--duration-glide` in styles/motion.css.
    assert.match(css, /animation-duration: var\(--duration-glide\);/);
    assert.match(motion, /--duration-glide: 200ms;/);
  });

  void test('reduced motion stops the glide and keeps the glow as a still mark', () => {
    assert.ok(reduced.length > 0, 'no reduced-motion block — the scan is blind');
    // The glide stops through the global rule (LAI-1208): the glide token is
    // zero under reduced motion; motion-tokens.test.ts asserts the whole set.
    assert.match(
      motion,
      /prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{[^}]*--duration-glide: 0ms;/,
    );
    assert.match(
      reduced,
      /\.card\[data-flash\] \{\s*animation: card-flash var\(--duration-flash\) steps\(1, end\);/,
    );
    assert.match(
      reduced,
      /\.list-row\[data-flash\] > td \{\s*animation: row-flash var\(--duration-flash\) steps\(1, end\);/,
    );
    // …and the hold stays 3.6s, because the flash token is not zeroed.
    assert.match(motion, /--duration-flash: 3\.6s;/);
  });

  void test('colours come from the theme, never written here', () => {
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
