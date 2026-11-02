/**
 * Reading the Developer access mode off `GET /developer/compatibility`
 * (LAI-1048, plan §I): only the three names, and anything else is classic.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  boardBuildOf,
  DEVELOPER_ACCESS_MODES,
  developerAccessMode,
  modeWithin,
  type DeveloperAccessMode,
  type ModeTimer,
} from '../../src/api/developer-compat.ts';

const body = (mode: unknown) => ({
  server: { version: '0.1.0', build_commit: null },
  features: { developer_access: mode, device_pairing: false },
});

void describe('developerAccessMode', () => {
  void test('the three modes read as themselves', () => {
    for (const mode of DEVELOPER_ACCESS_MODES) assert.equal(developerAccessMode(body(mode)), mode);
    assert.deepEqual([...DEVELOPER_ACCESS_MODES], ['classic', 'preview', 'v3']);
  });

  void test('an unknown or missing mode is classic, never a half-built page', () => {
    for (const odd of ['V3', 'beta', '', 3, null, undefined, true]) {
      assert.equal(developerAccessMode(body(odd)), 'classic', String(odd));
    }
    for (const broken of [null, undefined, 'v3', 42, {}, { features: null }, { features: 'v3' }]) {
      assert.equal(developerAccessMode(broken), 'classic', JSON.stringify(broken));
    }
  });
});

/** A timer the test fires by hand. */
function handTimer() {
  let run: (() => void) | undefined;
  let cleared = false;
  const timer: ModeTimer = {
    set: (r) => {
      run = r;
      return 'handle';
    },
    clear: () => {
      cleared = true;
    },
  };
  return {
    timer,
    fire: () => run?.(),
    get cleared() {
      return cleared;
    },
  };
}

void describe('modeWithin: a hung compatibility request cannot hold the page (review round 1)', () => {
  void test('an answer in time is the answer, and the timer is cleared', async () => {
    const t = handTimer();
    const mode = await modeWithin(Promise.resolve('v3'), 4000, undefined, t.timer);
    assert.equal(mode, 'v3');
    assert.equal(t.cleared, true);
  });

  void test('no answer by the deadline is classic, and the request is told to stop', async () => {
    const t = handTimer();
    let aborted = false;
    const never = new Promise<DeveloperAccessMode>(() => undefined);
    const pending = modeWithin(
      never,
      4000,
      () => {
        aborted = true;
      },
      t.timer,
    );
    t.fire();
    assert.equal(await pending, 'classic');
    assert.equal(aborted, true);
  });

  void test('a late answer after the deadline changes nothing', async () => {
    const t = handTimer();
    let late: (mode: DeveloperAccessMode) => void = () => undefined;
    const slow = new Promise<DeveloperAccessMode>((resolve) => {
      late = resolve;
    });
    const pending = modeWithin(slow, 4000, undefined, t.timer);
    t.fire();
    late('v3');
    assert.equal(await pending, 'classic');
  });

  void test('a failed request is classic at once', async () => {
    const t = handTimer();
    assert.equal(
      await modeWithin(Promise.reject(new Error('500')), 4000, undefined, t.timer),
      'classic',
    );
    assert.equal(t.cleared, true);
  });

  void test('with the real clock, a request that never answers settles as classic', async () => {
    const started = Date.now();
    const mode = await modeWithin(new Promise<DeveloperAccessMode>(() => undefined), 50);
    assert.equal(mode, 'classic');
    assert.ok(Date.now() - started >= 45, 'settled before the deadline');
  });
});

void describe('boardBuildOf (LAI-1069)', () => {
  const answer = (server: unknown, protocol: unknown) => ({ server, protocol, features: {} });

  void test('reads the version, a hex commit and both protocol numbers', () => {
    assert.deepEqual(
      boardBuildOf(
        answer({ version: '0.1.0', build_commit: 'abc1234' }, { current: 2, min_client: 1 }),
      ),
      { version: '0.1.0', commit: 'abc1234', protocol: 2, minClient: 1 },
    );
  });

  void test('a missing or non-hex commit is null, not shown', () => {
    for (const commit of [null, undefined, 'main', 'ABC1234', 'abc', '<b>x</b>']) {
      assert.equal(
        boardBuildOf(
          answer({ version: '0.1.0', build_commit: commit }, { current: 2, min_client: 1 }),
        )?.commit,
        null,
        String(commit),
      );
    }
  });

  void test('an older board or a malformed body is undefined', () => {
    const good = { version: '0.1.0', build_commit: null };
    for (const odd of [
      null,
      'x',
      {},
      { server: good },
      answer(good, { current: '2', min_client: 1 }),
      answer(good, { current: 2.5, min_client: 1 }),
      answer({ version: 3, build_commit: null }, { current: 2, min_client: 1 }),
      answer({ version: 'a b', build_commit: null }, { current: 2, min_client: 1 }),
    ]) {
      assert.equal(boardBuildOf(odd), undefined, JSON.stringify(odd));
    }
  });
});
