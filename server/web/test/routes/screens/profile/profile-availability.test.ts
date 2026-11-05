import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  profileAvailabilityMode,
  type ModeInput,
} from '../../../../src/routes/screens/profile/profile-availability.ts';

const base: ModeInput = {
  userId: 'u2',
  meId: 'u1',
  allowed: true,
  settled: true,
  readsAnalytics: true,
};

void describe('which availability read a profile makes (D-137, LAI-1139)', () => {
  void test('your own profile reads your own record, whatever the gates', () => {
    assert.equal(profileAvailabilityMode({ ...base, meId: 'u2', settled: false }), 'self');
  });

  void test('an analytics reader reads the load — the one read that logs the look', () => {
    assert.equal(profileAvailabilityMode(base), 'load');
  });

  void test('any other reader reads the narrowed row, never the load', () => {
    assert.equal(profileAvailabilityMode({ ...base, readsAnalytics: false }), 'shared');
  });

  void test('nothing before the server has said what the reader may do', () => {
    assert.equal(profileAvailabilityMode({ ...base, settled: false }), undefined);
  });

  void test('nothing for a reader refused the profile, or before anyone is named', () => {
    assert.equal(profileAvailabilityMode({ ...base, allowed: false }), undefined);
    assert.equal(profileAvailabilityMode({ ...base, userId: undefined }), undefined);
    assert.equal(profileAvailabilityMode({ ...base, meId: undefined }), undefined);
  });
});
