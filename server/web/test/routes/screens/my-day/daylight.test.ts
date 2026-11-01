import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { glyphAt, skyPhases, sunTimes } from '../../../../src/routes/screens/my-day/daylight.ts';

/** The sky's arithmetic (LAI-895): sunrise and sunset by place, and the phases between. */

const near = (actual: number | undefined, expected: number, within: number, what: string) => {
  assert.ok(actual !== undefined, `${what}: no time`);
  assert.ok(
    Math.abs(actual - expected) <= within,
    `${what}: ${String(actual)} is not within ${String(within)} of ${String(expected)}`,
  );
};

void describe('sunTimes — the sun at a place on a day', () => {
  void test('New Delhi, 23 Oct 2026: up about 6:26, down about 5:44 PM, in India’s own clock', () => {
    const sun = sunTimes('2026-10-23', 28.61, 77.21, 'Asia/Kolkata');
    near(sun?.rise, 6 * 60 + 26, 6, 'sunrise');
    near(sun?.set, 17 * 60 + 44, 6, 'sunset');
  });

  void test('London the same day: up about 7:38, down about 5:52 PM, summer time still on', () => {
    const sun = sunTimes('2026-10-23', 51.51, -0.13, 'Europe/London');
    near(sun?.rise, 7 * 60 + 38, 6, 'sunrise');
    near(sun?.set, 17 * 60 + 52, 6, 'sunset');
  });

  void test('Johannesburg in midsummer: a long day, up before 5:15 and down after 6:55 PM', () => {
    const sun = sunTimes('2026-12-21', -26.2, 28.05, 'Africa/Johannesburg');
    near(sun?.rise, 5 * 60 + 12, 8, 'sunrise');
    near(sun?.set, 18 * 60 + 59, 8, 'sunset');
  });

  void test('the same place read in another zone shifts by the zone, not the sun', () => {
    const local = sunTimes('2026-10-23', 28.61, 77.21, 'Asia/Kolkata');
    const utc = sunTimes('2026-10-23', 28.61, 77.21, 'UTC');
    assert.ok(local !== undefined && utc !== undefined);
    assert.equal(local.rise - utc.rise, 330);
    assert.equal(local.set - utc.set, 330);
  });

  void test('a polar night has no sun', () => {
    assert.equal(sunTimes('2026-12-21', 78.22, 15.63, 'Arctic/Longyearbyen'), undefined);
  });
});

void describe('skyPhases and glyphAt — the sky across the axis', () => {
  const sun = { rise: 6 * 60 + 26, set: 17 * 60 + 44 };

  void test('night, dawn, day, dusk, night — clipped to the axis, each edge an hour wide', () => {
    assert.deepEqual(skyPhases(sun, 5 * 60, 20 * 60), [
      { kind: 'night', start: 300, end: 356 },
      { kind: 'dawn', start: 356, end: 416 },
      { kind: 'day', start: 416, end: 1034 },
      { kind: 'dusk', start: 1034, end: 1094 },
      { kind: 'night', start: 1094, end: 1200 },
    ]);
  });

  void test('an axis inside the day is one phase', () => {
    assert.deepEqual(skyPhases(sun, 9 * 60, 15 * 60), [{ kind: 'day', start: 540, end: 900 }]);
  });

  void test('the sun stays on the hour through dusk, and the moon takes over after it', () => {
    assert.equal(glyphAt(sun, 5 * 60), 'moon');
    assert.equal(glyphAt(sun, 6 * 60), 'sun');
    assert.equal(glyphAt(sun, 17 * 60), 'sun');
    assert.equal(glyphAt(sun, 18 * 60), 'sun');
    assert.equal(glyphAt(sun, 19 * 60), 'moon');
  });
});
