import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  agentLines,
  hourLabelsShown,
  MOBILE_FOLD_PX,
  MOBILE_PX_PER_MINUTE,
  mobileBlockLines,
  mobileFolds,
  mobileScale,
  signalMark,
} from '../../../../src/routes/screens/my-day/timeline-mobile-derive.ts';

/**
 * The phone's vertical Timeline's arithmetic (LAI-518, the owner's
 * `TimelineMobileV2.dc.html`): a pace a minute at each zoom, idle stretches
 * folded at Fit only where that saves room, the lines a block has room for,
 * which hour labels stand, and where a signal sits in its five minutes.
 */

/** Floats from a pace a minute: equal to within rounding. */
function near(actual: number | undefined, expected: number, what: string): void {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-9,
    `${what}: ${String(actual)}, not ${String(expected)}`,
  );
}

void describe('mobileScale', () => {
  void test('linear at a pace: 6 AM to 10 PM at 1× is 960 minutes at 2.4px', () => {
    const s = mobileScale(6, 22, MOBILE_PX_PER_MINUTE['1']);
    near(s.total, 2304, 'the track');
    assert.equal(s.pos(6 * 60), 0);
    near(s.pos(7 * 60), 144, '7 AM');
    assert.equal(s.folded(7 * 60), false);
  });

  void test('2× is twice 1×, minute for minute', () => {
    const one = mobileScale(6, 22, MOBILE_PX_PER_MINUTE['1']);
    const two = mobileScale(6, 22, MOBILE_PX_PER_MINUTE['2']);
    near(two.total, one.total * 2, 'the track');
    near(two.pos(13 * 60), one.pos(13 * 60) * 2, '1 PM');
  });

  void test('a fold is drawn MOBILE_FOLD_PX tall, and what follows moves up by what it saved', () => {
    const k = MOBILE_PX_PER_MINUTE.fit;
    const s = mobileScale(6, 22, k, [{ start: 6 * 60, end: 8 * 60 + 40 }]);
    assert.equal(s.segments[0]?.folded, true);
    assert.equal(s.segments[0]?.p1, MOBILE_FOLD_PX);
    near(s.pos(8 * 60 + 40), MOBILE_FOLD_PX, 'the fold’s end');
    near(s.pos(9 * 60), MOBILE_FOLD_PX + 20 * k, '9 AM');
    assert.equal(s.folded(7 * 60), true);
    assert.equal(s.folded(8 * 60 + 40), false, 'the fold’s own edge is open');
    near(s.total, MOBILE_FOLD_PX + (22 * 60 - (8 * 60 + 40)) * k, 'the track');
  });

  void test('a stretch too short to save room is drawn as it is', () => {
    // 45 minutes at 1.7px is 76.5px — under the fold and its margin.
    const s = mobileScale(6, 22, MOBILE_PX_PER_MINUTE.fit, [{ start: 6 * 60, end: 6 * 60 + 45 }]);
    assert.equal(s.segments.length, 1);
    assert.equal(s.segments[0]?.folded, false);
  });

  void test('a fold reaching past the axis is clipped to it', () => {
    const s = mobileScale(6, 22, MOBILE_PX_PER_MINUTE.fit, [{ start: 17 * 60, end: 26 * 60 }]);
    assert.equal(s.segments.at(-1)?.t1, 22 * 60);
    assert.equal(s.segments.at(-1)?.folded, true);
  });
});

void describe('mobileBlockLines', () => {
  void test('the first line always; the range from 44px; the title from 64px', () => {
    assert.deepEqual(mobileBlockLines(43.9), { range: false, title: false });
    assert.deepEqual(mobileBlockLines(44), { range: true, title: false });
    assert.deepEqual(mobileBlockLines(63.9), { range: true, title: false });
    assert.deepEqual(mobileBlockLines(64), { range: true, title: true });
  });
});

void describe('mobileFolds', () => {
  void test('after now on today is Later today; before the first thing is No activity', () => {
    const folds = mobileFolds({ now: 15 * 60 }, [
      { start: 6 * 60, end: 8 * 60 },
      { start: 16 * 60, end: 22 * 60 },
    ]);
    assert.deepEqual(
      folds.map((f) => f.label),
      ['No activity', 'Later today'],
    );
  });

  void test('a past day has no now, so every fold is No activity', () => {
    const folds = mobileFolds({ now: undefined }, [{ start: 18 * 60, end: 22 * 60 }]);
    assert.equal(folds[0]?.label, 'No activity');
  });
});

void describe('hourLabelsShown', () => {
  void test('a label stands 20px or more below the last one shown', () => {
    assert.deepEqual(hourLabelsShown([0, 10, 25, 44, 70], undefined), [
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  void test('no label within 16px of the now pill', () => {
    assert.deepEqual(hourLabelsShown([0, 100, 200], 110), [true, false, true]);
    assert.deepEqual(hourLabelsShown([0, 100, 200], 117), [true, true, true]);
  });
});

void describe('signalMark', () => {
  void test('prompts are a bar at the left, longer the more, up to 10px, centred in the slot', () => {
    assert.deepEqual(signalMark('prompt', 1, 8.5), { top: 1.75, left: 1, width: 4, height: 5 });
    assert.equal(signalMark('prompt', 9, 8.5).width, 10);
  });

  void test('commits are a dot beside them, as big as the slot allows', () => {
    assert.deepEqual(signalMark('commit', 2, 10), { top: 1.5, left: 14.5, width: 7, height: 7 });
    assert.deepEqual(signalMark('commit', 2, 8.5), {
      top: 1,
      left: 14.75,
      width: 6.5,
      height: 6.5,
    });
    // A thin slot at a small pace still draws something you can see.
    const thin = signalMark('commit', 1, 2);
    assert.equal(thin.width, 3);
    assert.equal(signalMark('prompt', 1, 2).height, 2);
  });
});

void describe('agentLines', () => {
  void test('the name from 18px, how long from 32, the card from 46', () => {
    assert.deepEqual(agentLines(17), { name: false, time: false, card: false });
    assert.deepEqual(agentLines(18), { name: true, time: false, card: false });
    assert.deepEqual(agentLines(32), { name: true, time: true, card: false });
    assert.deepEqual(agentLines(46), { name: true, time: true, card: true });
  });
});
