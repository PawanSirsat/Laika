import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readsSharedRow } from '../../../../src/routes/screens/profile/profile-availability.ts';

/**
 * Which profiles read someone's availability for the head card's pill (D-137,
 * LAI-1152, LAI-1159). A reader holding *See everyone's analytics* reads that
 * one person's `GET /people/:id/load` — the list would log a look at everyone
 * on it — and anyone else reads their row of `GET /people/availability`, which
 * logs nothing for them. Never for yourself: your own is *My availability*'s.
 */
void describe('whose availability the head card reads from the list (LAI-1152)', () => {
  void test('someone else’s profile reads their row', () => {
    assert.equal(readsSharedRow('u2', 'u1'), true);
  });

  void test('your own never does — My availability reads and saves it', () => {
    assert.equal(readsSharedRow('u1', 'u1'), false);
  });

  void test('nothing before anyone is named, or before /me has answered', () => {
    assert.equal(readsSharedRow(undefined, 'u1'), false);
    assert.equal(readsSharedRow('', 'u1'), false);
    assert.equal(readsSharedRow('u2', undefined), false);
  });
});
