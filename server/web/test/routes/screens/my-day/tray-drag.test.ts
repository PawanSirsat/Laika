import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  endTrayDrag,
  startTrayDrag,
  trayDrag,
} from '../../../../src/routes/screens/my-day/tray-drag.ts';

/**
 * What the tray picked up, for the Timeline to read while the pointer is
 * over the track (LAI-512): the browser's drag carries only a string, so the
 * item's length and words travel here. One at a time, as a drag is.
 */

const D5 = { kind: 'draft', id: 'd5', minutes: 25, label: 'LAI-12' } as const;
const E9 = { kind: 'entry', id: 'e9', minutes: 40, label: 'Standup' } as const;

afterEach(() => {
  endTrayDrag();
});

void describe('the tray item in hand', () => {
  void test('nothing is in hand until the tray picks something up', () => {
    assert.equal(trayDrag(), null);
  });

  void test('the item picked up is the one read, length and words with it', () => {
    startTrayDrag(D5);
    assert.deepEqual(trayDrag(), D5);
  });

  void test('a second pick replaces the first: one drag at a time', () => {
    startTrayDrag(D5);
    startTrayDrag(E9);
    assert.deepEqual(trayDrag(), E9);
  });

  void test('let go, nothing is in hand — a later drag over the track finds no item', () => {
    startTrayDrag(D5);
    endTrayDrag();
    assert.equal(trayDrag(), null);
  });
});
