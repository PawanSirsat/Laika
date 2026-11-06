import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readsSharedRow } from '../../../../src/routes/screens/profile/profile-availability.ts';

/**
 * Which profiles read someone's row of `GET /people/availability` for the
 * head card's pill (D-137, LAI-1152). The load read that logs a look is gone
 * from the profile (D-139 item 8), so the list — which logs nothing — is the
 * only read, and never for yourself: your own is *My availability*'s.
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
