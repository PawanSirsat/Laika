import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  profileNotice,
  profileTab,
  profileTabLabel,
  profileTabs,
} from '../../../../src/routes/screens/profile/profile-shell.ts';

/**
 * The profile's frame (SPEC §11.4.2.1, D-139, LAI-1152): the tabs a reader
 * gets on their own profile and on someone else's, their names, and the
 * notice at the top right.
 */
void describe('the profile’s tabs (D-139, LAI-1152)', () => {
  void test('your own profile has all four, whatever you hold', () => {
    assert.deepEqual(profileTabs(true, false, false), ['overview', 'day', 'time', 'dev']);
  });

  void test('someone else’s offers each tab only to a reader granted it', () => {
    assert.deepEqual(profileTabs(false, false, false), ['overview']);
    assert.deepEqual(profileTabs(false, true, false), ['overview', 'day', 'time']);
    assert.deepEqual(profileTabs(false, false, true), ['overview', 'dev']);
    assert.deepEqual(profileTabs(false, true, true), ['overview', 'day', 'time', 'dev']);
  });

  void test('Developer setup is Developer access on your own', () => {
    assert.equal(profileTabLabel('dev', true), 'Developer access');
    assert.equal(profileTabLabel('dev', false), 'Developer setup');
    assert.equal(profileTabLabel('time', true), 'Time report');
  });

  void test('`?tab=hours`, the Time report’s old name, still opens it', () => {
    assert.equal(profileTab('hours'), 'time');
    assert.equal(profileTab('nonsense'), 'overview');
  });
});

void describe('the notice at the top right (SPEC §11.4.2.1)', () => {
  void test('someone else’s names them by first name', () => {
    assert.equal(
      profileNotice(false, 'Lindiwe Dube'),
      'Owners and admins only · read-only · Lindiwe can see that you looked',
    );
  });

  void test('your own says who sees it and that you see who looked', () => {
    assert.equal(
      profileNotice(true, 'Pawan Sirsat'),
      'Owners and admins see a read-only copy · you can see who looked',
    );
  });
});
