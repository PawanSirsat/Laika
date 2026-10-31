/**
 * LAI-549: what the drawer says about a task's saves and hand-offs, derived
 * only from `GET /tasks/:id/checkpoints` and `GET /tasks/:id/handoff-offers`
 * (LAI-545, LAI-546). One fixture per checkpoint case, in the shape
 * `CheckpointView` serves (`view-type-drift.test.ts` keeps the two aligned).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Checkpoint, HandoffOffer } from '../../../src/api/handoffs.ts';
import type { AgentNaming } from '../../../src/api/selected-agent.ts';
import type { TaskHandoff } from '../../../src/api/tasks.ts';
import {
  NO_CHECKPOINT,
  NO_VERIFIED_CHECKPOINT,
  NOTE_WORDS,
  PENDING_NOTICE_WORDS,
  VERIFICATION_WORDS,
} from '../../../src/components/agent/agent-states.ts';
import { changesExecution } from '../../../src/components/agent/execution-derive.ts';
import {
  APPROVE_CHECKING,
  APPROVE_UNREAD,
  approveGate,
  asSummary,
  checkpointTitle,
  currentOffer,
  handoffState,
  noteStateOf,
  offerStatusWords,
  panelCheckpointOf,
  panelState,
  pollsForNotice,
  RECOVERY_CHECKING,
  RECOVERY_UNREAD,
  recoveryOf,
  saveRows,
  summaryBehind,
} from '../../../src/components/agent/handoff-derive.ts';

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const SHA = 'a'.repeat(40);
const OLDER_SHA = 'b'.repeat(40);

const NOTE = {
  work_done: 'Parser handles nested lists\nand empty ones',
  next_step: 'Wire the renderer',
  decisions: '',
  open_questions: '',
  failing: '',
};

function checkpoint(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: '01CHECKPOINT',
    task_id: 't1',
    session_id: '01SESSION',
    agent_id: 'ag-laptop',
    agent_redacted: false,
    claim_generation: 2,
    repo: 'owner/repo',
    branch: 'LAI-549-handoff-ui',
    remote_ref: 'refs/tags/laika-ckpt/LAI-549/01CHECKPOINT',
    commit_sha: SHA,
    manifest: [{ path: 'src/a.ts', added: 3, removed: 1 }],
    summary: NOTE,
    summary_commit_sha: SHA,
    created_at: NOW - 12 * MIN,
    verification: 'verified',
    verified_at: NOW - 11 * MIN,
    pending_since: null,
    pending_notice: false,
    superseded: false,
    refs: [{ ref: 'refs/tags/laika-ckpt/LAI-549/01CHECKPOINT', revision: 0, state: 'verified' }],
    ...over,
  };
}

function offer(over: Partial<HandoffOffer> = {}): HandoffOffer {
  return {
    id: '01OFFER',
    task_id: 't1',
    kind: 'handoff',
    state: 'open',
    from_session_id: '01SESSION',
    from_agent_id: 'ag-laptop',
    from_claim_generation: 2,
    to_agent_id: 'ag-desk',
    checkpoint_id: '01CHECKPOINT',
    checkpoint_commit_sha: SHA,
    checkpoint: {
      commit_sha: SHA,
      verification: 'verified',
      summary: NOTE,
      summary_commit_sha: SHA,
    },
    reason: 'Out of context',
    note_hash: 'f'.repeat(64),
    requires_approval: false,
    approved_by_user_id: null,
    approved_at: null,
    expires_at: NOW + 30 * MIN,
    accepted_session_id: null,
    accepted_claim_id: null,
    receiver_commit_sha: null,
    closed_reason: null,
    created_by_user_id: 'u1',
    created_at: NOW - MIN,
    closed_at: null,
    from_agent_redacted: false,
    to_agent_redacted: false,
    ...over,
  };
}

const AGENTS: ReadonlyMap<string, AgentNaming> = new Map([
  ['ag-laptop', { harness: 'claude-code', display_name: 'Laptop', device_label: 'Belka' }],
  ['ag-desk', { harness: 'codex', display_name: 'Desk', device_label: 'Strelka' }],
]);

void describe('the three checkpoint messages, from API fields', () => {
  void test('a summary that names this save: Note describes this save', () => {
    const row = panelCheckpointOf(checkpoint(), NOW);
    assert.equal(row.note, 'current');
    assert.equal(NOTE_WORDS[row.note], 'Note describes this save');
  });

  void test('summary_commit_sha ≠ commit_sha: Note describes an earlier save', () => {
    const row = panelCheckpointOf(checkpoint({ summary_commit_sha: OLDER_SHA }), NOW);
    assert.equal(NOTE_WORDS[row.note], 'Note describes an earlier save');
  });

  void test('summary null: No continuation note', () => {
    const row = panelCheckpointOf(checkpoint({ summary: null, summary_commit_sha: null }), NOW);
    assert.equal(NOTE_WORDS[row.note], 'No continuation note');
    // Without a note the save is named by its branch, never left blank.
    assert.equal(row.summary, 'Saved on LAI-549-handoff-ui');
  });

  void test('an expired claim with no checkpoint at all: Automatic recovery unavailable', () => {
    const recovery = recoveryOf({ kind: 'expired' }, null, saveRows([]), []);
    assert.deepEqual(recovery, { kind: 'unavailable', words: NO_CHECKPOINT });
    assert.equal(NO_CHECKPOINT, 'Automatic recovery unavailable — no saved checkpoint');
  });
});

void describe('verification, as D-116 states it', () => {
  void test('each of the four states has its own words', () => {
    for (const state of ['verified', 'pending', 'ref_deleted', 'uncertain'] as const) {
      const row = panelCheckpointOf(checkpoint({ verification: state }), NOW);
      assert.equal(row.verification, state);
    }
    assert.equal(VERIFICATION_WORDS.verified, 'Verified');
    assert.equal(VERIFICATION_WORDS.pending, 'Verification pending');
    assert.equal(VERIFICATION_WORDS.ref_deleted, 'Save removed from GitHub');
    assert.equal(
      VERIFICATION_WORDS.uncertain,
      'Save needs attention — GitHub’s notices do not match a single clean save',
    );
  });

  void test('the ten-minute notice is the server’s pending_notice, never this clock', () => {
    // Saved an hour ago by this clock, and the server has not called it late.
    const fresh = checkpoint({
      verification: 'pending',
      created_at: NOW - 60 * MIN,
      pending_since: NOW - 60 * MIN,
      pending_notice: false,
    });
    assert.equal(panelCheckpointOf(fresh, NOW).pendingNotice, false);
    // The server says the notice is overdue: the long words.
    const late = { ...fresh, pending_notice: true };
    assert.equal(panelCheckpointOf(late, NOW).pendingNotice, true);
    assert.equal(PENDING_NOTICE_WORDS, 'Verification pending — no push notice from GitHub yet');
    // A verified save never carries the notice, whatever the flag.
    assert.equal(panelCheckpointOf(checkpoint({ pending_notice: true }), NOW).pendingNotice, false);
  });

  void test('age and the full SHA come from the row', () => {
    const row = panelCheckpointOf(checkpoint(), NOW);
    assert.equal(row.age, '12 min ago');
    assert.equal(row.sha, SHA);
    assert.equal(row.savedAt, NOW - 12 * MIN);
  });

  void test('a failing note is shown as written; an empty one is not drawn', () => {
    const failing = checkpoint({ summary: { ...NOTE, failing: 'web: 2 tests' } });
    assert.equal(panelCheckpointOf(failing, NOW).failing, 'web: 2 tests');
    assert.equal(panelCheckpointOf(checkpoint(), NOW).failing, undefined);
  });
});

void describe('the latest verified save, and a newer one beside it', () => {
  void test('a newer pending save is drawn beside the verified one as unverified', () => {
    const verified = checkpoint({ id: 'c1', created_at: NOW - 30 * MIN });
    const pending = checkpoint({ id: 'c2', created_at: NOW - 5 * MIN, verification: 'pending' });
    const rows = saveRows([pending, verified]);
    assert.equal(rows.verified?.id, 'c1');
    assert.equal(rows.newer?.id, 'c2');
  });

  void test('an older unverified save is not "newer"', () => {
    const verified = checkpoint({ id: 'c1', created_at: NOW - 5 * MIN });
    const stale = checkpoint({ id: 'c0', created_at: NOW - 30 * MIN, verification: 'uncertain' });
    const rows = saveRows([verified, stale]);
    assert.equal(rows.verified?.id, 'c1');
    assert.equal(rows.newer, undefined);
  });

  void test('order on the wire does not matter', () => {
    const a = checkpoint({ id: 'a', created_at: NOW - 2 * MIN, verification: 'pending' });
    const b = checkpoint({ id: 'b', created_at: NOW - 20 * MIN });
    assert.deepEqual(saveRows([a, b]), saveRows([b, a]));
  });
});

void describe('recovery after an expired claim', () => {
  void test('a verified save makes it available', () => {
    const r = recoveryOf({ kind: 'expired' }, null, saveRows([checkpoint()]), []);
    assert.equal(r.kind, 'available');
    assert.equal(panelState(null, r, saveRows([checkpoint()])), 'recovery_available');
  });

  void test('saves, none verified: unavailable, and says so', () => {
    const rows = saveRows([checkpoint({ verification: 'pending' })]);
    assert.deepEqual(recoveryOf({ kind: 'expired' }, null, rows, []), {
      kind: 'unavailable',
      words: NO_VERIFIED_CHECKPOINT,
    });
  });

  void test('nothing to say while a live claim holds the task, or the claim never expired', () => {
    const rows = saveRows([checkpoint()]);
    assert.equal(recoveryOf({ kind: 'expired' }, { generation: 3 }, rows, []).kind, 'none');
    assert.equal(recoveryOf({ kind: 'recorded' }, null, rows, []).kind, 'none');
  });

  void test('a live claim’s Working is never replaced; an uncertain newest save asks for attention', () => {
    const rows = saveRows([checkpoint({ verification: 'uncertain' })]);
    assert.equal(panelState('working', { kind: 'none' }, rows), 'working');
    assert.equal(panelState(null, { kind: 'none' }, rows), 'save_needs_attention');
  });
});

void describe('the sender never sees "accepted" on the receiver’s behalf', () => {
  void test('open: Waiting for the receiver to accept', () => {
    assert.equal(offerStatusWords(offer(), AGENTS), 'Waiting for Codex · Strelka to accept');
  });

  void test('pending approval: waiting for approval first', () => {
    assert.equal(
      offerStatusWords(offer({ state: 'pending_approval', requires_approval: true }), AGENTS),
      'Waiting for approval, then for Codex · Strelka to accept',
    );
  });

  void test('only the server’s accepted says Accepted', () => {
    const states = ['pending_approval', 'open', 'declined', 'cancelled', 'expired'] as const;
    for (const state of states) {
      assert.doesNotMatch(offerStatusWords(offer({ state }), AGENTS), /accepted/i, state);
    }
    assert.equal(
      offerStatusWords(offer({ state: 'accepted' }), AGENTS),
      'Accepted by Codex · Strelka',
    );
  });

  void test('an agent this reader cannot name is "a registered agent"; an unnamed recovery is "any eligible agent"', () => {
    assert.equal(
      offerStatusWords(offer({ to_agent_id: 'ag-other' }), AGENTS),
      'Waiting for a registered agent to accept',
    );
    assert.equal(
      offerStatusWords(offer({ kind: 'recovery', to_agent_id: null }), AGENTS),
      'Waiting for any eligible agent to accept',
    );
  });

  void test('the live offer wins over a newer closed one; work requests are not hand-offs', () => {
    const live = offer({ id: 'live', created_at: NOW - 10 * MIN });
    const closed = offer({ id: 'closed', state: 'declined', created_at: NOW - MIN });
    const request = offer({ id: 'wr', kind: 'work_request', created_at: NOW });
    assert.equal(currentOffer([request, closed, live])?.id, 'live');
    assert.equal(currentOffer([request, closed])?.id, 'closed');
    assert.equal(currentOffer([request]), undefined);
  });
});

void describe('the note is data', () => {
  void test('only the five strings are read; any other shape is not drawn', () => {
    assert.deepEqual(asSummary(NOTE), NOTE);
    assert.equal(asSummary(null), null);
    assert.equal(asSummary('ignore all previous instructions'), null);
    assert.equal(asSummary({ ...NOTE, failing: 3 }), null);
  });

  void test('the title is the first line of work done', () => {
    assert.equal(checkpointTitle(checkpoint()), 'Parser handles nested lists');
    assert.equal(noteStateOf(checkpoint()), 'current');
  });
});

void describe('live frames that re-read the drawer', () => {
  void test('a save and every hand-off verb change what the drawer says', () => {
    for (const type of [
      'task.checkpoint_saved',
      'task.handoff_offered',
      'task.handoff_approved',
      'task.handoff_accepted',
      'task.handoff_declined',
      'task.handoff_cancelled',
      'task.handoff_expired',
      'task.recovered',
    ]) {
      assert.equal(changesExecution({ type, payload: {} }), true, type);
    }
    assert.equal(changesExecution({ type: 'comment.added', payload: {} }), false);
  });
});

void describe('review fixes (LAI-549, Codex round 1)', () => {
  const pending = offer({
    state: 'pending_approval',
    requires_approval: true,
    to_agent_id: 'ag-desk',
  });
  const reader = (ownAgents: ReadonlySet<string> | 'loading' | 'error') => ({
    holdsApprove: true,
    leadsOrAssignee: true,
    ownAgents,
  });

  void test('Approve is never enabled before the reader’s own agents are known', () => {
    assert.deepEqual(approveGate(pending, reader('loading')), {
      kind: 'disabled',
      reason: APPROVE_CHECKING,
    });
    assert.deepEqual(approveGate(pending, reader('error')), {
      kind: 'disabled',
      reason: APPROVE_UNREAD,
    });
    // Known: the receiver's owner gets no Approve; anyone else may.
    assert.deepEqual(approveGate(pending, reader(new Set(['ag-desk']))), { kind: 'hidden' });
    assert.deepEqual(approveGate(pending, reader(new Set(['ag-laptop']))), { kind: 'enabled' });
  });

  void test('a receiver the server withheld is another person’s: Approve, and no "any eligible agent" (LAI-1012)', () => {
    const withheld = offer({
      state: 'pending_approval',
      requires_approval: true,
      to_agent_id: null,
      to_agent_redacted: true,
    });
    assert.deepEqual(approveGate(withheld, reader('loading')), { kind: 'enabled' });
    assert.equal(
      offerStatusWords(withheld, AGENTS),
      'Waiting for approval, then for a registered agent to accept',
    );
    // An unnamed recovery is still any eligible agent, and still not approvable here.
    const unnamed = offer({ state: 'pending_approval', kind: 'recovery', to_agent_id: null });
    assert.deepEqual(approveGate(unnamed, reader(new Set())), { kind: 'hidden' });
  });

  void test('Approve is hidden without the grant or the role, and on an offer not waiting', () => {
    const known = new Set<string>();
    assert.equal(approveGate(pending, { ...reader(known), holdsApprove: false }).kind, 'hidden');
    assert.equal(approveGate(pending, { ...reader(known), leadsOrAssignee: false }).kind, 'hidden');
    assert.equal(approveGate(offer({ state: 'open' }), reader(known)).kind, 'hidden');
  });

  void test('a read in flight or failed is unknown — never "no saved checkpoint"', () => {
    const none = saveRows([]);
    assert.deepEqual(recoveryOf({ kind: 'expired' }, null, none, [], 'loading'), {
      kind: 'unknown',
      words: RECOVERY_CHECKING,
    });
    assert.deepEqual(recoveryOf({ kind: 'expired' }, null, none, [], 'idle'), {
      kind: 'unknown',
      words: RECOVERY_CHECKING,
    });
    assert.deepEqual(recoveryOf({ kind: 'expired' }, null, none, [], 'error'), {
      kind: 'unknown',
      words: RECOVERY_UNREAD,
    });
    // Only a read that succeeded confirms the absence.
    assert.equal(recoveryOf({ kind: 'expired' }, null, none, [], 'ready').kind, 'unavailable');
  });

  void test('the drawer re-reads while a save waits for its notice, and only then', () => {
    assert.equal(pollsForNotice([checkpoint({ verification: 'pending' })]), true);
    assert.equal(
      pollsForNotice([checkpoint({ verification: 'pending', pending_notice: true })]),
      true,
    );
    assert.equal(pollsForNotice([checkpoint()]), false);
    assert.equal(pollsForNotice([checkpoint({ verification: 'uncertain' })]), false);
    assert.equal(pollsForNotice([]), false);
  });
});

/**
 * LAI-1006: the card's state, and the drawer's once the task view carries the
 * server's summary (LAI-1005). One rule, read on both, so they cannot differ.
 */
void describe('handoffState — the server’s summary, never derived again', () => {
  const none: TaskHandoff = {
    checkpoint: null,
    offer: null,
    recovery_available: false,
    save_needs_attention: false,
  };
  const recovery: TaskHandoff = {
    checkpoint: {
      verification: 'verified',
      saved_at: NOW,
      pending_since: null,
      pending_notice: false,
    },
    offer: { kind: 'recovery', state: 'open', requires_approval: false },
    recovery_available: true,
    save_needs_attention: false,
  };
  const attention: TaskHandoff = {
    checkpoint: {
      verification: 'uncertain',
      saved_at: NOW,
      pending_since: null,
      pending_notice: false,
    },
    offer: null,
    recovery_available: false,
    save_needs_attention: true,
  };

  void test('says each flag, and nothing for a task with neither or a view without one', () => {
    assert.equal(handoffState(recovery), 'recovery_available');
    assert.equal(handoffState(attention), 'save_needs_attention');
    assert.equal(handoffState(none), null);
    assert.equal(handoffState(undefined), null);
  });

  void test('reads the flags, not the checkpoint: an uncertain save the server did not flag is not drawn', () => {
    // A live claim, say: the server leaves the flag off, and the card must too.
    assert.equal(handoffState({ ...attention, save_needs_attention: false }), null);
    // A verified save with no expiry is not a recovery either.
    assert.equal(handoffState({ ...recovery, recovery_available: false }), null);
  });

  void test('Recovery available outranks Save needs attention', () => {
    assert.equal(handoffState({ ...recovery, save_needs_attention: true }), 'recovery_available');
  });

  void test('the drawer says what the card says once the view carries a summary', () => {
    // The drawer's own reads would say *Save needs attention* here …
    const rows = saveRows([checkpoint({ verification: 'uncertain' })]);
    assert.equal(panelState(null, { kind: 'none' }, rows), 'save_needs_attention');
    // … and with the summary it follows the server, as the card does.
    for (const summary of [none, recovery, attention]) {
      assert.equal(panelState(null, { kind: 'none' }, rows, summary), handoffState(summary));
    }
    // A live claim still speaks first, summary or not.
    assert.equal(panelState('working', { kind: 'none' }, rows, attention), 'working');
    assert.equal(
      panelState('connection_lost', { kind: 'none' }, rows, recovery),
      'connection_lost',
    );
  });
});

void describe('summaryBehind — the drawer’s poll is fresher than the list (LAI-1006 review)', () => {
  const said = (over: Partial<TaskHandoff> = {}): TaskHandoff => ({
    checkpoint: {
      verification: 'pending',
      saved_at: checkpoint({ verification: 'pending' }).created_at,
      pending_since: NOW,
      pending_notice: false,
    },
    offer: null,
    recovery_available: false,
    save_needs_attention: false,
    ...over,
  });

  void test('agrees when the reads say what the summary says', () => {
    assert.equal(
      summaryBehind(said(), [checkpoint({ verification: 'pending', pending_notice: false })], []),
      false,
    );
    assert.equal(
      summaryBehind(said({ checkpoint: null }), [], [offer({ kind: 'work_request' })]),
      false,
    );
    assert.equal(summaryBehind(undefined, [checkpoint({})], []), false);
  });

  void test('is behind when the newest save turned uncertain, or its notice came due', () => {
    assert.equal(summaryBehind(said(), [checkpoint({ verification: 'uncertain' })], []), true);
    assert.equal(
      summaryBehind(said(), [checkpoint({ verification: 'pending', pending_notice: true })], []),
      true,
    );
    assert.equal(summaryBehind(said({ checkpoint: null }), [checkpoint({})], []), true);
  });

  void test('is behind when a live hand-off or recovery appears, closes or changes state', () => {
    const pending = [checkpoint({ verification: 'pending', pending_notice: false })];
    const live = offer({ kind: 'recovery', state: 'open', requires_approval: false });
    assert.equal(summaryBehind(said(), pending, [live]), true);
    const holding = said({ offer: { kind: 'recovery', state: 'open', requires_approval: false } });
    assert.equal(summaryBehind(holding, pending, [live]), false);
    assert.equal(summaryBehind(holding, pending, [{ ...live, state: 'accepted' }]), true);
    assert.equal(summaryBehind(holding, pending, [{ ...live, state: 'pending_approval' }]), true);
  });
});
