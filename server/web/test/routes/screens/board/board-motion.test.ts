import assert from 'node:assert/strict';
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
  drawerOpen: false,
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
    assert.equal(remoteTaskTouch({ task_id: 't1', actor_id: 'u2', actor_kind: 'user' }, 'u1'), 't1');
    assert.equal(remoteTaskTouch({ task_id: 't1', actor_id: 'u1', actor_kind: 'user' }, 'u1'), undefined);
    // My own agent changed it, not me in this tab.
    assert.equal(remoteTaskTouch({ task_id: 't1', actor_id: 'u1', actor_kind: 'agent' }, 'u1'), 't1');
    assert.equal(remoteTaskTouch({ task_id: 't1', actor_id: null, actor_kind: 'system' }, 'u1'), 't1');
    assert.equal(remoteTaskTouch({ task_id: null, actor_id: 'u2', actor_kind: 'user' }, 'u1'), undefined);
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
