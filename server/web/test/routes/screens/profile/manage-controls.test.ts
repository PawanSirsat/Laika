import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  adminControls,
  anyAdminControl,
  manageSections,
  type AdminSubject,
} from '../../../../src/routes/screens/profile/manage-controls.ts';

/** `/permissions` as a set: the reader holds exactly these org actions. */
const holding = (...actions: string[]) => ({ org: (action: string) => actions.includes(action) });

/** Every org action the Manage member panel asks about. */
const ALL = [
  'user.set_role',
  'profile.set_kind',
  'user.deactivate',
  'user.sign_out',
  'user.reset_password',
  'token.list_any',
  'token.revoke_any',
  'member_list.read',
];

const OWNER = { id: 'u1', org_role: 'owner' };
const ADMIN = { id: 'u4', org_role: 'admin' };
const bea: AdminSubject = { id: 'u2', name: 'Bea', org_role: 'member', is_active: true };
const ada: AdminSubject = { id: 'u1', name: 'Ada', org_role: 'owner', is_active: true };

void describe('adminControls (LAI-1134: the Manage member panel)', () => {
  void test('an owner holding every action gets every control on a member', () => {
    const c = adminControls(holding(...ALL), OWNER, bea);
    assert.deepEqual(c, {
      role: true,
      kind: true,
      deactivate: true,
      signOut: true,
      resetLink: true,
      tokens: true,
      revokeTokens: true,
      spaces: true,
    });
    assert.deepEqual(manageSections(c), ['role', 'spaces', 'tokens', 'security', 'danger']);
  });

  void test('on the owner, an admin gets no role, no deactivate and no reset link (D-104)', () => {
    const c = adminControls(holding(...ALL), ADMIN, ada);
    assert.equal(c.role, false);
    assert.equal(c.deactivate, false);
    assert.equal(c.resetLink, false);
    assert.equal(c.signOut, true);
    // D-133, LAI-1143: the owner's tokens are listed, never revocable by an admin.
    assert.equal(c.tokens, true);
    assert.equal(c.revokeTokens, false);
    // Role stays for the profile kind; Danger zone is not drawn at all (frame 1r).
    assert.deepEqual(manageSections(c), ['role', 'spaces', 'tokens', 'security']);
  });

  void test('on yourself, only the profile kind — nothing about your own access', () => {
    const c = adminControls(holding(...ALL), OWNER, ada);
    assert.deepEqual(
      Object.entries(c)
        .filter(([, on]) => on)
        .map(([name]) => name),
      ['kind'],
    );
    assert.deepEqual(manageSections(c), ['role']);
  });

  void test('a section is drawn only for what is granted', () => {
    // Withdrawn admin (person-admin's CONTROLS case): only the spaces read is left.
    const c = adminControls(
      holding('member_list.read', 'user.sign_out', 'profile.read'),
      ADMIN,
      bea,
    );
    assert.deepEqual(manageSections(c), ['spaces']);
    assert.equal(c.signOut, false, 'user.sign_out alone is about yourself');
  });

  void test('with nothing granted there is no panel, and so no ⋯', () => {
    const c = adminControls(holding('org.read', 'profile.read'), ADMIN, bea);
    assert.equal(anyAdminControl(c), false);
    assert.deepEqual(manageSections(c), []);
  });

  void test('a deactivated person keeps Danger zone (to reactivate) but no Security', () => {
    const c = adminControls(holding(...ALL), OWNER, { ...bea, is_active: false });
    assert.deepEqual(manageSections(c), ['role', 'spaces', 'tokens', 'danger']);
  });

  void test('revoking tokens needs both reading and revoking them', () => {
    const c = adminControls(holding('token.revoke_any'), OWNER, bea);
    assert.equal(c.tokens, false);
    assert.equal(c.revokeTokens, false);
  });
});

void describe('the owner rule in the panel (LAI-1140, D-133)', () => {
  void test('an owner keeps Revoke on an admin’s tokens', () => {
    const c = adminControls(holding(...ALL), OWNER, { ...bea, org_role: 'admin' });
    assert.equal(c.revokeTokens, true);
  });
});
