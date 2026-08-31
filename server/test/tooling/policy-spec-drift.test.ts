import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type OrgRole, type ProjectRole } from '../../src/db/enums.ts';
import { SERVER_ROOT } from '../../src/paths.ts';
import {
  ALL_ACTIONS,
  type Action,
  type OrgAction,
  type ProjectAction,
} from '../../src/policy/actions.ts';
import { type Actor, can, forcedTokenScope, projectRoleOnJoin } from '../../src/policy/can.ts';
import { parseMatrix, type Cell } from '../helpers/policy-matrix.ts';

/**
 * SPEC §3 against `can()` (LAI-100).
 *
 * `policy/matrix.test.ts` calls itself *"the executable version of SPEC §3.1 and
 * §3.2"*, but it **restates** the tables in TypeScript. Nothing checked that the
 * restatement still matched the document, so editing §3 broke no test — which is
 * convenient right up until somebody edits §3.
 *
 * This is the third side of the same shape: §4↔`schema.ts` (LAI-051),
 * `schema.ts`↔migrations (LAI-061), and now §3↔`can()`. It is the one that
 * governs **who may do what**, so it is the one where silent drift costs most.
 *
 * ## The hand-written part is one map, and it is the smallest it can be
 *
 * A row's prose ("Invite users / change org roles") cannot be derived from an
 * action id, so the row→action link is declared below. Everything else — which
 * roles exist, which cells are ticked, what the qualifiers say — is read from the
 * document. The maps are checked in **both** directions, so a row nobody mapped
 * and an action no row grants both fail.
 *
 * ## Qualifiers are verified, never flattened
 *
 * `✓ (not to Owner)`, `own-created`, `✓ (as viewer)` are not booleans. Reducing
 * them to `true` would assert agreement on a cell whose meaning had been thrown
 * away — worse than not checking, because it reads as coverage. Each is
 * registered with an assertion of what it actually means, and **an unregistered
 * qualifier fails the suite** rather than being guessed at.
 */

const ORG_MATRIX = '3.1 Org-level permission matrix';
const PROJECT_MATRIX = '3.2 Project-level permission matrix';

// --------------------------------------------------------- the declared link

const ORG_ROWS: ReadonlyMap<string, readonly OrgAction[]> = new Map([
  ['Delete org data / transfer ownership', ['org.delete', 'org.transfer_ownership']],
  ['Org settings (AI provider, SMTP, signup mode)', ['org.settings.edit']],
  ['Create / archive project', ['project.create', 'project.archive']],
  ['Invite users / change org roles', ['user.invite', 'user.set_role']],
  ['Deactivate user', ['user.deactivate']],
  ['View member list', ['member_list.read']],
  ['Join a public project', ['project.join_public']],
  [
    'Generate, read and revoke own tokens',
    ['token.create_own', 'token.read_own', 'token.revoke_own'],
  ],
  ["List / revoke anyone's token", ['token.list_any', 'token.revoke_any']],
  ['Log own unlisted work', ['unlisted.log_own']],
  ['Export audit log', ['audit_log.export']],
  ['Configure webhooks', ['webhook.configure']],
]);

const PROJECT_ROWS: ReadonlyMap<string, readonly ProjectAction[]> = new Map([
  ['Manage project members', ['project.members.manage']],
  ['Edit project settings and context_md', ['project.settings.edit']],
  ['Create / edit / delete sprints', ['sprint.manage']],
  ["Apply or remove a task's tags", ['task.write']],
  ['Rename or delete a tag project-wide', ['project.settings.edit']],
  ['Assign tasks into or out of a sprint', ['task.assign_sprint']],
  ['Create / edit / move any task', ['task.write']],
  ['Claim a task (start_working)', ['task.claim']],
  ['Assign a task to someone else', ['task.assign_other']],
  ['Add comment', ['comment.create']],
  ['Edit / delete comment', ['comment.edit', 'comment.delete']],
  ['Cancel / delete task', ['task.delete']],
  ['Add / remove dependencies', ['task.dependency.write']],
  ['Read tasks, comments, activity, capacity', ['project.read']],
  ['Apply a meeting-diff proposal', ['meeting_proposal.apply']],
]);

/**
 * Actions `can()` has that no §3 row grants.
 *
 * **This list should be empty and is not.** Each entry is a real gap between the
 * code and the document, not a design decision, and the staleness test below
 * removes an entry the moment §3 grows a row for it.
 */
const ACTIONS_WITHOUT_A_ROW: ReadonlyMap<Action, string> = new Map([
  // One entry for one merge, the same shape LAI-408 used and retired.
  //
  // LAI-417 needs `POST /api/v1/heartbeats` to call `can()` and §3.1 has no
  // cell for sending presence. CHIEF writes the row — "Send own heartbeat" —
  // and applies it to `docs/SPEC.md` in the merge commit, because `docs/` is
  // CHIEF's and `server/` is CORE's and neither half is useful alone.
  //
  // The staleness test below deletes this the moment §3.1 carries the row,
  // which is the merge itself.
  [
    'heartbeat.send_own',
    'Awaiting §3.1\'s "Send own heartbeat" row, written by CHIEF and applied in the merge commit for LAI-417. Same shape as `unlisted.log_own`: your own record about your own work, ✓ for every role, refused in practice to a Viewer because §9.1 is token-only and a Viewer\'s token is forced `read_only`. The staleness test removes this entry the moment the row lands.',
  ],
]);

/**
 * Prose in §3 that carries a rule but is not a matrix cell.
 *
 * Recorded rather than skipped: a paragraph that grants something is a
 * permission, and one nobody wrote down is one nobody checks. Each entry names
 * a phrase that must still be present, so deleting the prose fails this file
 * rather than silently emptying the exemption.
 */
const PROSE_RULES: readonly {
  readonly section: string;
  readonly phrase: string;
  readonly why: string;
}[] = [
  {
    section: ORG_MATRIX,
    phrase: 'Reading the org-wide activity feed follows',
    why: 'Grants no new capability — it routes the org-scoped feed to `audit_log.export`, which the "Export audit log" row already covers. §3.1 says outright that a separate cell is deliberately not added, and `services/events.ts` implements exactly that.',
  },
  {
    section: PROJECT_MATRIX,
    phrase: 'unless the actor is org Owner/Admin',
    why: 'The implicit-lead rule. Not a cell: it changes which *role* §3.2 is read with, and `effectiveProjectRole` implements it. Asserted directly below.',
  },
];

/**
 * Actions whose answer depends on **whose** resource it is (§3.1, LAI-134).
 *
 * `can(actor, 'token.read_own')` with no resource is `false` — correctly, since
 * "read your own token" is meaningless without saying which token. §3.1 carries
 * that in the **row label** ("Generate, read and revoke own tokens") rather than
 * as a cell qualifier, so the cell is a plain `✓` and the check has to supply
 * the ownership the label implies.
 *
 * Listing them explicitly rather than inferring: an action that is self-scoped
 * and **not** listed fails loudly against its own `✓`, which is the right way to
 * be wrong. The reverse — inferring self-scope from a `false` answer — would
 * silently excuse a genuine disagreement.
 *
 * **`comment.edit` and `comment.delete` are deliberately not here.** They *look*
 * self-scoped and are not: a lead may act on anyone's comment. §3.2 says so in
 * the cell (`own + any` against `own`), so they take the qualifier path, and
 * listing them would make this file assert that a lead cannot touch another's
 * comment the moment that cell were ever written plainly.
 */
const SELF_SCOPED: ReadonlySet<Action> = new Set<Action>(['token.read_own', 'token.revoke_own']);

// ------------------------------------------------------------- the qualifiers

interface QualifierCheck {
  readonly why: string;
  readonly verify: (action: Action, role: string) => void;
}

function orgActor(orgRole: OrgRole): Actor {
  return { userId: 'me', orgRole, isActive: true, projectRole: null };
}

function projectActor(role: ProjectRole): Actor {
  // A plain org member so the project role is the one under test — an owner or
  // admin would hold implicit lead and answer for a different row.
  return { userId: 'me', orgRole: 'member', isActive: true, projectRole: role };
}

const QUALIFIERS: ReadonlyMap<string, QualifierCheck> = new Map([
  [
    'not to Owner',
    {
      why: 'An Admin may grant any role except Owner — otherwise an Admin promotes themselves and the distinction is decorative.',
      verify: (action: Action) => {
        const admin = orgActor('admin');

        if (action === 'user.set_role') {
          expect(can(admin, 'user.set_role', { targetOrgRole: 'owner' })).toBe(false);
          for (const role of ['admin', 'member', 'viewer'] as const) {
            expect(can(admin, 'user.set_role', { targetOrgRole: role })).toBe(true);
          }
          return;
        }

        // The other half of the row. Inviting is plain `✓` for an Admin; the
        // "(not to Owner)" constraint is carried by `user.set_role`, which
        // `services/invites.ts` also asserts when an invite names a role.
        expect(can(admin, action, {})).toBe(true);
      },
    },
  ],
  [
    'as member',
    {
      why: 'Names the project role a joiner lands on, not whether they may join.',
      verify: () => {
        expect(can(orgActor('member'), 'project.join_public', { visibility: 'public' })).toBe(true);
        expect(projectRoleOnJoin('member')).toBe('member');
      },
    },
  ],
  [
    'as viewer',
    {
      why: 'Same as "as member": an org Viewer joins, and lands as a project viewer.',
      verify: () => {
        expect(can(orgActor('viewer'), 'project.join_public', { visibility: 'public' })).toBe(true);
        expect(projectRoleOnJoin('viewer')).toBe('viewer');
      },
    },
  ],
  [
    'read_only forced, so never in practice',
    {
      why: "The role permits it and the credential does not. A Viewer holds this permission and can never exercise it: their token is forced `read_only` (§4.9, LAI-402) and `unlisted.log_own` is not a read action, so `tokenAllows` refuses it. The cell says ✓ rather than — because the restriction is not the role's, and if `read_only` forcing were ever relaxed the matrix already says what should happen.",
      verify: (action: Action) => {
        const viewer = orgActor('viewer');

        // Both halves, because either alone is misleading. The ✓ on its own
        // reads as a Viewer gaining a write; the refusal on its own reads as
        // the role denying it, which is not what §3.1 says.
        expect(can(viewer, action, {}), 'the role permits it').toBe(true);

        expect(
          can(
            { ...viewer, token: { id: 'tok', scope: 'read_only', projectIds: null } },
            action,
            {},
          ),
          'the credential refuses it',
        ).toBe(false);

        // And the forcing is what makes a Viewer's token `read_only` in the
        // first place — without this the pair above would hold for a Viewer who
        // simply happened to ask for a read-only token.
        expect(forcedTokenScope('viewer', 'full')).toBe('read_only');

        // The refusal is the scope's, not the action's: a member's `full` token
        // may do it, so this is not an action nobody can ever perform.
        expect(
          can(
            { ...orgActor('member'), token: { id: 'tok', scope: 'full', projectIds: null } },
            action,
            {},
          ),
        ).toBe(true);
      },
    },
  ],
  [
    'read_only forced',
    {
      why: 'A Viewer may hold a token; its scope is forced regardless of what was asked for.',
      verify: (action: Action) => {
        const viewer = orgActor('viewer');

        // The row covers three actions since LAI-134, and only the first is
        // about creating. Asserting the forcing for all three would be a
        // tautology for two of them — the self-scoped pair is verified for what
        // it actually says instead.
        if (action === 'token.create_own') {
          expect(can(viewer, 'token.create_own', {})).toBe(true);
          expect(forcedTokenScope('viewer', 'full')).toBe('read_only');
          expect(forcedTokenScope('member', 'full')).toBe('full');
          return;
        }

        expect(can(viewer, action, { ownerId: viewer.userId })).toBe(true);
        expect(can(viewer, action, { ownerId: 'someone-else' })).toBe(false);
      },
    },
  ],
  [
    'own + any',
    {
      why: "A lead may edit or delete anyone's comment, including their own.",
      verify: (action: Action) => {
        const lead = projectActor('lead');
        expect(can(lead, action, { projectId: 'p', ownerId: 'me' })).toBe(true);
        expect(can(lead, action, { projectId: 'p', ownerId: 'someone-else' })).toBe(true);
      },
    },
  ],
  [
    'own',
    {
      why: 'A member may act on their own comment and nobody else’s.',
      verify: (action: Action) => {
        const member = projectActor('member');
        expect(can(member, action, { projectId: 'p', ownerId: 'me' })).toBe(true);
        expect(can(member, action, { projectId: 'p', ownerId: 'someone-else' })).toBe(false);
      },
    },
  ],
  [
    'own-created',
    {
      why: 'A member may delete a task they created and nobody else’s.',
      verify: (action: Action) => {
        const member = projectActor('member');
        expect(can(member, action, { projectId: 'p', createdBy: 'me' })).toBe(true);
        expect(can(member, action, { projectId: 'p', createdBy: 'someone-else' })).toBe(false);
      },
    },
  ],
]);

// ------------------------------------------------------------------ the tests

const org = parseMatrix(ORG_MATRIX);
const project = parseMatrix(PROJECT_MATRIX);

describe('the parser reads §3, prose and all', () => {
  it('finds both matrices with their real columns', () => {
    expect(org.roles).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
    expect(project.roles).toEqual(['Lead', 'Member', 'Viewer']);
  });

  it('does not lose the row that sits after §3.1’s prose', () => {
    // Three paragraphs about the org-wide activity feed sit between
    // `Export audit log` and `Configure webhooks`. A parser that stopped at the
    // first non-table line would drop a permission and report success.
    expect(org.rows.map((row) => row.label)).toContain('Configure webhooks');
  });

  it('does not read past §3.1 into §3.2’s table', () => {
    // The other half of the same property, and the one `toContain` cannot
    // carry: a parser that recovered from the prose by swallowing everything to
    // the end of §3 would also find `Configure webhooks`, and would silently
    // grant every project permission at org level.
    //
    // **This was `expect(org.rows).toHaveLength(11)` and
    // `expect(project.rows).toHaveLength(15)` until LAI-408.** Counts are
    // contingent facts, not the property: §3.1 legitimately grew a twelfth row
    // ("Log own unlisted work") and the assertion fired on correct work —
    // D-037, and not the first time. The overlap below says the same thing
    // about the parser and stays true however many rows §3 grows.
    const orgLabels = new Set(org.rows.map((row) => row.label));
    const leaked = project.rows.map((row) => row.label).filter((label) => orgLabels.has(label));

    expect(leaked, '§3.2 rows appearing in the §3.1 matrix — the parser over-read').toEqual([]);

    // And both tables were genuinely read, so an empty overlap is evidence
    // rather than an accident of one of them being empty.
    expect(org.rows.length).toBeGreaterThan(5);
    expect(project.rows.length).toBeGreaterThan(5);
  });

  it('keeps qualifiers instead of flattening them to a tick', () => {
    const invite = org.rows.find((row) => row.label.startsWith('Invite users'));
    expect(invite?.cells.get('Admin')?.qualifier).toBe('not to Owner');

    const comment = project.rows.find((row) => row.label === 'Edit / delete comment');
    expect(comment?.cells.get('Lead')?.qualifier).toBe('own + any');
    expect(comment?.cells.get('Member')?.qualifier).toBe('own');
  });
});

describe('§3 and can() name the same things', () => {
  it('maps every §3.1 row to at least one action', () => {
    const unmapped = org.rows.filter((row) => !ORG_ROWS.has(row.label)).map((row) => row.label);
    expect(unmapped, 'a §3.1 row grants something no action implements').toEqual([]);
  });

  it('maps every §3.2 row to at least one action', () => {
    const unmapped = project.rows
      .filter((row) => !PROJECT_ROWS.has(row.label))
      .map((row) => row.label);
    expect(unmapped, 'a §3.2 row grants something no action implements').toEqual([]);
  });

  it('drops a mapping whose row has left the document', () => {
    // The other direction: a row renamed in §3 must not leave a mapping pointing
    // at nothing, or the check quietly stops covering that row.
    const labels = new Set([...org.rows, ...project.rows].map((row) => row.label));
    const stale = [...ORG_ROWS.keys(), ...PROJECT_ROWS.keys()].filter(
      (label) => !labels.has(label),
    );

    expect(stale, 'these mappings name a §3 row that no longer exists').toEqual([]);
  });

  it('grants every action from some row, or records why not', () => {
    const granted = new Set<string>([
      ...[...ORG_ROWS.values()].flat(),
      ...[...PROJECT_ROWS.values()].flat(),
    ]);

    const orphans = ALL_ACTIONS.filter(
      (action) => !granted.has(action) && !ACTIONS_WITHOUT_A_ROW.has(action),
    );

    expect(orphans, 'can() allows an action §3 never grants').toEqual([]);
  });

  it('removes an exemption once §3 grants the action', () => {
    const granted = new Set<string>([
      ...[...ORG_ROWS.values()].flat(),
      ...[...PROJECT_ROWS.values()].flat(),
    ]);

    const stale = [...ACTIONS_WITHOUT_A_ROW.keys()].filter((action) => granted.has(action));
    expect(stale, 'these are exempted but a row now grants them — drop the entry').toEqual([]);
  });

  it('gives every exemption a reason naming a task', () => {
    const weak = [...ACTIONS_WITHOUT_A_ROW.entries()]
      .filter(([, reason]) => reason.length < 40 || !/LAI-\d{3}/.test(reason))
      .map(([action]) => action);

    expect(weak).toEqual([]);
  });
});

describe('every cell agrees with can()', () => {
  for (const row of org.rows) {
    const actions = ORG_ROWS.get(row.label) ?? [];

    for (const action of actions) {
      for (const [role, cell] of row.cells) {
        it(`§3.1 ${row.label} · ${role} · ${action}`, () => {
          check(cell, action, role, orgActor(role.toLowerCase() as OrgRole));
        });
      }
    }
  }

  for (const row of project.rows) {
    const actions = PROJECT_ROWS.get(row.label) ?? [];

    for (const action of actions) {
      for (const [role, cell] of row.cells) {
        it(`§3.2 ${row.label} · ${role} · ${action}`, () => {
          check(cell, action, role, projectActor(role.toLowerCase() as ProjectRole), 'p');
        });
      }
    }
  }
});

/**
 * One cell.
 *
 * A plain cell is compared directly. A qualified one is handed to its registered
 * check, because the plain comparison would be wrong: `own` is neither `true`
 * nor `false` until you say whose comment it is.
 */
function check(cell: Cell, action: Action, role: string, actor: Actor, projectId?: string): void {
  if (cell.qualifier !== null) {
    const qualifier = QUALIFIERS.get(cell.qualifier);

    // The safety property. An unregistered qualifier is not guessed at.
    expect(
      qualifier,
      `§3 cell "${cell.raw}" uses a qualifier nothing verifies — register it in QUALIFIERS with what it means`,
    ).toBeDefined();

    qualifier?.verify(action, role);
    return;
  }

  if (SELF_SCOPED.has(action)) {
    const scoped = projectId === undefined ? {} : { projectId };

    // Both halves, or this asserts nothing: the cell says the role may act on
    // **their own**, which is only meaningful alongside the fact that they may
    // not act on anyone else's.
    expect(
      can(actor, action, { ...scoped, ownerId: actor.userId }),
      `${action} / ${role} / own`,
    ).toBe(cell.allowed);

    expect(
      can(actor, action, { ...scoped, ownerId: 'someone-else' }),
      `${action} / ${role} / someone else's — a self-scoped action must never allow this`,
    ).toBe(false);
    return;
  }

  const resource =
    projectId === undefined
      ? // `project.join_public` is the one org action whose answer depends on the
        // resource; §3.1's cell is about a public project.
        action === 'project.join_public'
        ? { visibility: 'public' as const }
        : {}
      : { projectId };

  expect(can(actor, action, resource), `${action} / ${role}`).toBe(cell.allowed);
}

describe('the prose rules in §3 are accounted for', () => {
  for (const rule of PROSE_RULES) {
    it(`${rule.section}: "${rule.phrase}" is still there`, () => {
      // An exemption for prose that has been deleted is an exemption for
      // nothing, and would sit here forever looking like coverage.
      const spec = readFileSync(join(SERVER_ROOT, '..', 'docs', 'SPEC.md'), 'utf8');
      const start = spec.indexOf(`### ${rule.section}`);
      const end = spec.indexOf('\n### ', start + 1);

      expect(spec.slice(start, end === -1 ? undefined : end)).toContain(rule.phrase);
      expect(rule.why.length).toBeGreaterThan(40);
    });
  }

  it('implements §3.2’s implicit-lead rule', () => {
    // The prose above §3.2's table, asserted rather than trusted: an org owner or
    // admin answers §3.2 as a lead without any membership row.
    for (const orgRole of ['owner', 'admin'] as const) {
      const actor: Actor = { userId: 'me', orgRole, isActive: true, projectRole: null };
      expect(can(actor, 'sprint.manage', { projectId: 'p' })).toBe(true);
    }

    // And a plain member with no membership gets nothing.
    const outsider: Actor = { userId: 'me', orgRole: 'member', isActive: true, projectRole: null };
    expect(can(outsider, 'project.read', { projectId: 'p' })).toBe(false);
  });
});
