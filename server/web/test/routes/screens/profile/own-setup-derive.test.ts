import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activityLine,
  anchorFor,
  attentionItems,
  confirmCopy,
  doneLine,
  OWN_NOTIFY_LINE,
  pairingStep,
  setupWord,
  toolState,
  voiceFor,
} from '../../../../src/routes/screens/profile/developer-setup-derive.ts';
import {
  ownSetupView,
  toFixCount,
  toFixLabel,
} from '../../../../src/routes/screens/profile/own-setup-derive.ts';
import { DAY, MIN, NOW, setup, tool } from '../../../helpers/developer-setup-fixture.ts';
import { agentOf, ownReadsFrom } from '../../../helpers/own-setup-fixture.ts';

const ME = { id: 'u2', name: 'Rowan Vale', org_role: 'member', is_active: true };

void describe('your own reads, as the one shape both tabs draw (LAI-1156)', () => {
  void test('devices, tools, tokens, repositories and requests come through unchanged', () => {
    const admin = setup();
    const own = ownSetupView(ownReadsFrom(admin, ME));
    assert.deepEqual(own.tools, admin.tools);
    // An admin's read names who unpaired a device; your own reads do not.
    assert.deepEqual(
      own.devices,
      admin.devices.map((d) => ({ ...d, revoked_by: null })),
    );
    assert.deepEqual(own.tokens, admin.tokens);
    assert.deepEqual(own.repositories, admin.repositories);
    assert.deepEqual(own.pending_pairing, admin.pending_pairing);
    assert.deepEqual(own.activity, admin.activity);
    assert.equal(own.can_revoke, true, 'your own is always yours to change');
    assert.deepEqual(own.unverified, []);
  });

  void test('the summary is counted from the reads, with nothing hidden from you', () => {
    const own = ownSetupView(ownReadsFrom(setup(), ME));
    assert.deepEqual(own.summary, {
      devices_active: 1,
      devices_revoked: 1,
      tools_active: 2,
      tools_revoked: 0,
      repositories: 1,
      repositories_hidden: 0,
      tokens_active: 3,
      tokens_inactive: 2,
      pending_pairing: 1,
      last_seen_at: NOW - 2 * MIN,
    });
  });

  void test('a tool on no device is still listed, and one only a device carries is too', () => {
    const loose = tool('a9', 'cursor', { device_id: null });
    const reads = ownReadsFrom(setup({ tools: [...setup().tools, loose] }), ME);
    // `/agents` misses a2; only its device carries it.
    const own = ownSetupView({ ...reads, agents: reads.agents.filter((a) => a.id !== 'a2') });
    assert.deepEqual(own.tools.map((t) => [t.id, t.device_id]).sort(), [
      ['a1', 'd1'],
      ['a2', 'd1'],
      ['a9', null],
    ]);
  });

  void test('a tool whose verification was not read falls back to its own stamps, not to failed checks', () => {
    const reads = ownReadsFrom(setup(), ME);
    const verifications = new Map(reads.verifications);
    verifications.delete('a1');
    const own = ownSetupView({ ...reads, verifications });
    assert.deepEqual(own.unverified, ['a1']);
    const a1 = own.tools.find((t) => t.id === 'a1')!;
    // With failed checks a1 would read *Needs setup*; its stamps say it is in use.
    assert.equal(toolState(a1, own.now).key, 'needs-setup');
    assert.notEqual(toolState(a1, own.now, true).key, 'needs-setup');
    assert.ok(!attentionItems(own, undefined).some((i) => i.target === anchorFor.tool('a1')));
  });

  void test('a consent that was not read is Not given; one that was is kept', () => {
    const reads = ownReadsFrom(
      setup({ tools: [tool('a1', 'claude-code', { checkpoint_consent: true })] }),
      ME,
    );
    assert.equal(ownSetupView(reads).tools[0]?.checkpoint_consent, true);
    assert.equal(
      ownSetupView({ ...reads, consents: new Map() }).tools[0]?.checkpoint_consent,
      false,
    );
  });

  void test('a revoked tool is never asked for its verification and never unverified', () => {
    const revoked = tool('a3', 'cursor', { status: 'revoked', revoked_at: NOW - DAY });
    const reads = ownReadsFrom(setup({ tools: [...setup().tools, revoked] }), ME);
    assert.equal(reads.verifications.has('a3'), false);
    assert.deepEqual(ownSetupView(reads).unverified, []);
  });
});

void describe('N to fix (D-139 item 5)', () => {
  void test('is the health line’s items counted, by the same rule as someone else’s tab', () => {
    const admin = setup();
    const own = ownSetupView(ownReadsFrom(admin, ME));
    assert.equal(toFixCount(own, undefined), attentionItems(admin, undefined).length);
    assert.equal(toFixCount(own, undefined), 2);
    assert.equal(toFixLabel(toFixCount(own, undefined)), '2 to fix');
  });

  void test('nothing to fix, or nothing read yet, is no badge', () => {
    const ready = setup({ tools: [tool('a1', 'claude-code')], repositories: [] });
    const own = ownSetupView(ownReadsFrom(ready, ME));
    assert.equal(toFixCount(own, undefined), 0);
    assert.equal(toFixLabel(0), undefined);
    assert.equal(toFixLabel(undefined), undefined);
    assert.equal(toFixLabel(1), '1 to fix');
  });
});

void describe('your own words (frame F)', () => {
  void test('the notice and the empty state speak to you', () => {
    const v = voiceFor(true, 'Rowan Vale');
    assert.equal(
      v.notice,
      'Your setup · owners and admins see a read-only copy, and you can see when they look',
    );
    assert.equal(v.emptyTitle, 'You haven’t set up any tools yet');
    assert.equal(v.reach, 'by your live tools');
    assert.equal(voiceFor(false, 'Rowan Vale').emptyTitle, 'Rowan hasn’t set up any tools yet');
    assert.equal(setupWord('recorded', true), 'Recorded by you');
    assert.equal(setupWord('recorded', false), 'Recorded by them');
  });

  void test('your own disconnect and revokes notify nobody and carry no owner note', () => {
    const view = setup();
    const unpair = confirmCopy({ kind: 'unpair', id: 'd1' }, view, 'you', true)!;
    assert.equal(unpair.title, 'Disconnect rowan-box?');
    assert.match(unpair.lead, /stays paired/);
    assert.equal(unpair.notify, OWN_NOTIFY_LINE);
    const tok = confirmCopy({ kind: 'token', id: 'p1' }, view, 'you', true)!;
    assert.equal(tok.notify, OWN_NOTIFY_LINE);
    for (const copy of [unpair, tok]) {
      assert.doesNotMatch(JSON.stringify(copy), /notified|only the owner/i);
    }
    assert.equal(doneLine({ kind: 'token', id: 'p1' }, view, 'you', true), 'Token revoked.');
    assert.equal(
      doneLine({ kind: 'unpair', id: 'd1' }, view, 'you', true),
      'rowan-box is disconnected.',
    );
  });

  void test('your own acts read “by you” in the activity', () => {
    const [revoked] = setup().activity;
    assert.equal(activityLine(revoked!, 'u1'), 'Token gone-key revoked by you');
    assert.equal(activityLine(revoked!, 'u2'), 'Token gone-key revoked by Ada Admin');
  });

  void test('Approve and Decline are offered only once the device has claimed, and nothing says a code', () => {
    const [open] = setup().pending_pairing;
    const claimed = {
      ...open!,
      state: 'claimed' as const,
      claimed: { key_fingerprint: 'SHA256:abc', os: null, cli_version: null, claimed_at: NOW },
    };
    assert.deepEqual(pairingStep(open!), {
      line: 'waiting for the device to claim it',
      decide: false,
    });
    assert.equal(pairingStep(claimed).decide, true);
    assert.equal(pairingStep({ ...claimed, state: 'approved' }).decide, false);
    for (const p of [open!, claimed, { ...claimed, state: 'approved' as const }]) {
      assert.doesNotMatch(pairingStep(p).line, /code/i);
    }
  });

  void test('agentOf drops only what the admin read adds', () => {
    const a = agentOf(setup().tools[0]!);
    assert.equal('checks' in a, false);
    assert.equal('project_ids_hidden' in a.tokens[0]!, false);
  });
});
