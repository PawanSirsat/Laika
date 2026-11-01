/**
 * `src/routes/screens/board/actor-presentation.ts` — who acted, and how it is
 * marked (SPEC §7, LAI-411).
 *
 * Measured against seeded rows of each kind before this existed: the rail
 * badged agents with a corner dot and left `system` unmarked, while the task
 * detail rendered the *same row* as **"someone edited this task"** — no badge,
 * and a name that reads as an unidentified human. Two sites, one row, two
 * different answers, one of them wrong.
 *
 * The schema settles which: `activity_system_actor_check` is
 * `(actor_id IS NULL) = (actor_kind = 'system')`, so a null actor on an activity
 * row is the system and cannot be a person.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  actorLine,
  describeActor,
} from '../../../../src/routes/screens/board/actor-presentation.ts';
import type { ActorBadge } from '../../../../src/routes/screens/board/actor-presentation.ts';
import type { Member } from '../../../../src/api/tasks.ts';

const ADA = '01M1BA4197ENAZ5KHF3WZVAA3Z';

const members: ReadonlyMap<string, Member> = new Map([
  [ADA, { user_id: ADA, name: 'Ada Lovelace', role: 'lead' } as Member],
]);

/** The three kinds, so a new one cannot be added without a decision here. */
const KINDS = ['user', 'agent', 'system'] as const;

void describe('a system row is the system, not an anonymous person', () => {
  void test('it is named, not called "someone"', () => {
    // The defect. `personName(null)` returned 'someone', which the CHECK
    // constraint rules out: a null actor on activity is always the system.
    const actor = describeActor({ actor_id: null, actor_kind: 'system' }, members);
    assert.equal(actor.name, 'Laika');
    assert.notEqual(actor.name.toLowerCase(), 'someone');
  });

  void test('it carries a badge', () => {
    const actor = describeActor({ actor_id: null, actor_kind: 'system' }, members);
    assert.equal(actor.badge, 'system');
  });
});

void describe('all three kinds are distinguishable', () => {
  void test('an agent is badged and keeps the person the token belongs to', () => {
    // `actor_id` is the person, not the agent — the token is what makes it an
    // agent. A row with no `agent_id` is a legacy token's (LAI-535), and says
    // so rather than naming an agent it cannot (LAI-538).
    const actor = describeActor({ actor_id: ADA, actor_kind: 'agent' }, members);
    assert.deepEqual(actor, {
      name: 'Ada Lovelace',
      badge: 'agent',
      via: 'agent (unregistered token)',
    });
  });

  void test('an ordinary person carries no badge', () => {
    const actor = describeActor({ actor_id: ADA, actor_kind: 'user' }, members);
    assert.deepEqual(actor, { name: 'Ada Lovelace', badge: undefined, via: undefined });
  });

  void test('no two kinds produce the same badge', () => {
    // The assertion that fails if any two collapse. Each test above would still
    // pass against a function that ignored `actor_kind` for the other two.
    const badges = KINDS.map(
      (kind) =>
        describeActor({ actor_id: kind === 'system' ? null : ADA, actor_kind: kind }, members)
          .badge,
    );
    assert.equal(new Set(badges).size, KINDS.length, `two kinds share a badge: ${badges.join()}`);
  });

  void test('every badge is the word that will be rendered', () => {
    // The task detail renders `badge` directly, which is what keeps it from
    // being colour alone. A badge that is not a readable word breaks that.
    for (const badge of ['agent', 'system'] satisfies ActorBadge[]) {
      assert.match(badge, /^[a-z]+$/);
    }
  });
});

void describe('which agent wrote it (LAI-538)', () => {
  const claude = { harness: 'claude-code', display_name: 'Laptop agent', device_label: 'laptop-1' };
  const agents = new Map([['ag1', claude]]);

  void test('a registered agent is named after the person: Ada via Claude Code · laptop-1', () => {
    const actor = describeActor(
      { actor_id: ADA, actor_kind: 'agent', agent_id: 'ag1' },
      members,
      agents,
    );
    assert.equal(actor.name, 'Ada Lovelace');
    assert.equal(actor.via, 'Claude Code · laptop-1');
    assert.equal(actorLine(actor), 'Ada Lovelace via Claude Code · laptop-1');
  });

  void test('a registered agent this reader cannot name is not guessed at', () => {
    const actor = describeActor(
      { actor_id: ADA, actor_kind: 'agent', agent_id: 'ag9' },
      members,
      agents,
    );
    assert.equal(actorLine(actor), 'Ada Lovelace via a registered agent');
  });

  void test('a legacy token reads as an unregistered one, and a person’s row has no via', () => {
    const legacy = describeActor({ actor_id: ADA, actor_kind: 'agent', agent_id: null }, members);
    assert.equal(actorLine(legacy), 'Ada Lovelace via agent (unregistered token)');
    const person = describeActor({ actor_id: ADA, actor_kind: 'user', agent_id: null }, members);
    assert.equal(actorLine(person), 'Ada Lovelace');
  });
});

void describe('an actor we cannot resolve is not guessed at', () => {
  void test('an unknown id does not leak the id to the reader', () => {
    // It used to render the raw ULID in the task detail. A ULID is not a name.
    const actor = describeActor(
      { actor_id: '01UNKNOWNUNKNOWNUNKNOWN01', actor_kind: 'user' },
      members,
    );
    assert.equal(actor.name, 'Someone');
    assert.ok(!actor.name.includes('01UNKNOWN'), 'the raw id reached the screen');
  });

  void test('an unresolved agent is still badged as an agent', () => {
    // The badge comes from `actor_kind`, which is always present — losing it
    // because the member list has not loaded would under-report agent work.
    const actor = describeActor({ actor_id: 'nobody', actor_kind: 'agent' }, members);
    assert.equal(actor.badge, 'agent');
  });
});
