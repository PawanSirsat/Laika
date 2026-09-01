---
id: LAI-222
title: No org endpoint, and no way to change an org role or deactivate anyone
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-086
status: review
started: 2026-09-01T20:25:00Z
finished: 2026-09-01T21:15:00Z
finished:
---

## Goal

LAI-086 (the Organisation screen) told me to check `GET /api/v1/org` before
building and to file rather than stub if it was missing. It is missing — and so
is more than the task expected.

**Probed on a running instance, signed in as an `admin`:**

```
GET    /api/v1/org                        404
GET    /api/v1/orgs                       404
PATCH  /api/v1/users/:id                  404
DELETE /api/v1/users/:id                  404
PATCH  /api/v1/users/:id/role             404
POST   /api/v1/users/:id/deactivate       404
```

`app.ts` mounts no org router, and `http/routes/users.ts` has exactly one
handler: `app.get('/')`.

### Two separate holes

**1. The org itself has no endpoint.** SPEC §6.4 lists one; nothing is mounted.
`GET /me` does not carry the org either — it returns `id, email, name, org_role,
is_active, memberships` and no org id or name. So **the signed-in UI cannot
learn which organisation it is looking at.** The only place an org name is
served today is the *pre-auth invite preview*, which needs an invite token.

**2. Org role changes and deactivation do not exist.** SPEC §3.1 gives Owner and
Admin *"Invite users / change org roles"* and *"Deactivate user"*, and the
`users` table carries `org_role` and `is_active`, but no route writes either.

**LAI-086 named LAI-059 as its dependency for this, and LAI-059 built something
else** — *"Project members — list, change role, remove"*, at
`/projects/:slug/members`. That is project-level (§3.2). The org-level
equivalent was never built, and the dependency reads as satisfied because the
titles are so close.

## Acceptance criteria

- [x] `GET /api/v1/org` returns the caller's organisation — at least id and
      name — and answers `401` when signed out. Mounted in `app.ts`, not merely
      written.
- [x] Changing another user's `org_role`, gated by `can()` per §3.1: Owner may
      set any role; **Admin may not set or remove Owner**; Member and Viewer may
      not change roles at all.
- [x] Deactivating and reactivating a user, same gate. `is_active` already
      exists on the row.
- [x] **The last Owner cannot be demoted or deactivated.** An org with no owner
      is unrecoverable — there is no route back and no console. Refuse with a
      `409` that says why, the way a project refuses to lose its last lead.
- [x] Nobody can demote or deactivate themselves out of their own last
      privilege — same trap, one actor.
- [x] Both actions write `member.role_changed` / the appropriate §4.8 activity
      row, so the audit log shows who did it.
- [x] Tests drive each refusal, and each is proven able to fail.

## Notes

- **Until this lands the Organisation screen is read-only.** LAI-086 ships the
  people list and invite management (both fully served today) and states plainly
  on the screen that role changes need this task, rather than rendering controls
  that 403 or, worse, appear to work.
- The org endpoint is the smaller half and unblocks the screen's header on its
  own. Worth doing first if these are split.
- Whoever takes this: check whether `avatar_color` on the user row is meant to
  be authoritative or derived. The client derives its own from the id
  (`theme/avatar-color.ts`, per SPEC §4.1), so the served column may be dead —
  worth a separate task rather than a silent decision here.

---

## Two rulings — CHIEF, 2026-09-01 (D-048)

**1. `user.deactivated` and `user.reactivated`. Two verbs.** Your argument is
right and the LAI-113 test is what distinguishes them from `sprint.tasks_changed`:
that one is single because both directions answer *the same* reader question.
These do not — *"who was locked out, and when"* and *"who was let back in"* are
different questions, and one verb would put the answer in the payload, which is
what the closed vocabulary exists to prevent.

`user.` rather than `member.`: `member.*` is already written by **both**
`invites.ts` (joining the org) and `projects.ts` (project membership).
Deactivation is neither.

**Do not add `depends-on: [LAI-113]`.** These two verbs are not in LAI-113's
seven, so it is not a dependency — it is the same *shape* of two-owner change,
carried the same way. **§4.8's half is written and held**
(`scratchpad/lai-222-spec.patch`) and applied at merge; take the
`ACTIVITY_TYPES` exemption in your own file, or submit red quoting the
`schema-spec-drift` failure (D-045). Either is fine — the exemption is in your
area, so §4.4 step 2 is available.

**2. `GET /api/v1/org` gets a new §3.1 row, `org.read`. Do not borrow
`member_list.read`.**

Your reasoning — *"if you may see who is in the organisation, you may see what it
is called"* — is true, and **it is not what this endpoint returns**. §11.4.2 has
the Organisation screen showing **AI provider configuration: `configured`,
`provider`, `key_last4`**. Whether an org has an LLM provider wired up is not
implied by a member list by any reading.

**The borrow would have been a contingent fact about today's payload, not a
property of the row** — D-037's shape, in a permission matrix, where it is worst:
the next field added to the response inherits a grant nobody reviewed.

- **`org.read`**, granted `✓ ✓ ✓ ✓`, and **a read action** — it belongs in
  `READ_ACTIONS`, so a `read_only` token may call it.
- **The AI provider block is gated separately on `org.settings.edit`**,
  field-level, admin+. No second new action. The response already does
  field-level gating (`ai_api_key` write-only), so this is the pattern the
  endpoint has rather than a new one.
- [x] A test that a **Viewer** gets the org and **not** the provider block, and
      an Admin gets both. The field-level gate is the whole of this ruling and it
      is the part that silently regresses.

**Your three self-decided calls are all right**, and the first is the one worth
saying so about: **the last-owner guard is one invariant, not two rules.** AC4
and AC5 describing the same trap from two angles is exactly how two code paths
that can disagree get written. An Admin self-demoting being allowed is right for
the reason you give — only Owner-count is unrecoverable — and `avatar_color`
being filed rather than decided is right.


---

## Submitted — CORE, 2026-09-01

Server **1474 of 1475**; the one failure is LAI-113's, inherited. Lint and format
clean. Web unchanged from LAI-113's two.

### The red, quoted

```
server/test/tooling/schema-spec-drift.test.ts
  × lists every activity type the enum allows
      sprint.created, sprint.updated, sprint.deleted, sprint.tasks_changed,
      project.context_updated, unlisted.promoted, unlisted.dismissed
                                        → LAI-113's §4.8 half, held for LAI-147

server/web/test/api/use-events.test.ts:22          → LAI-147
server/web/test/routes/.../dashboard-derive.test.ts:208 → LAI-147
```

**Exactly LAI-113's seven, listed rather than asserted** — I read the failure to
check none of them were mine. `org.read`, `user.deactivated` and
`user.reactivated` carry in-flight exemptions in `policy-spec-drift` and
`schema-spec-drift`, both files in my area (§4.4 step 2), both entries
self-expiring.

### On your ruling — you were right and my argument was the wrong shape

I recommended borrowing `member_list.read` and gave a true argument for it. It
was true **of what the endpoint returns today**, which is exactly the thing
D-037 says a guard may not be built on — and a permission matrix is the worst
place to put a contingent fact, because the next field inherits the grant.

I could not have seen §11.4.2's provider block from the code. But I could have
noticed that my argument's form was *"nothing this returns is sensitive"* rather
than *"nothing this row grants is sensitive"*, and those differ the moment the
response grows. That is the transferable part.

`org.read` is `✓ ✓ ✓ ✓` and in `READ_ACTIONS`. The provider block is field-gated
on `org.settings.edit`, **absent rather than null** for a caller who may not see
it — `null` says "no provider is configured", which is a different fact and one a
Viewer would act on. Your added criterion is
`gives a Viewer the org and not the provider block`, plus a serialisation-level
check that the key and the other encrypted columns never reach the wire at any
grade.

### The last-Owner invariant

One question in both write paths: does an **active** Owner remain? It counts
active rows, not rows — a deactivated Owner is not cover, or an org could be
locked out by somebody who cannot sign in. Driven six ways, and mutating the
`is_active` filter out goes red.

### Three existing guards caught real mistakes

- **The route lint rule** — I imported `db/enums.ts` into a route. The vocabulary
  is now re-exported from `services/users.ts`, which is what `services/tasks.ts`
  already does for the same reason.
- **`asserts every action in the closed union`** — `org.read` had no matrix
  assertion. That test exists so a new action cannot be added without stating its
  grades, and it worked.
- **`404s /users/:id`** — correct only while nothing was registered on that path.
  `PATCH` now exists, so it is `405` with `Allow: PATCH`. **Updated rather than
  deleted**, because the distinction it pins (404 for an unregistered path, 405
  for an unbuilt method on a registered one) is the part worth keeping.

### `avatar_color` — checked, and worse than the Notes expected

Filed as **LAI-148**. Three places disagree: §4.1 says *derived from id*, the
server derives it from **email** and stores it, and the client derives it from
**id** at render and ignores the served value entirely.

So the column is dead **and** contradicts the spec. The client is right and it is
not a preference: `avatarColor(id, theme)` is theme-aware, and one stored value
cannot be legible in both themes, which §5.1 requires.

Six mutations, all caught: the field gate removed, `ai` null instead of absent,
`org.read` narrowed to Admin+, the invariant counting rows instead of active rows,
the invariant skipped on deactivation, and `targetOrgRole` not passed so §3.1's
Admin caveat cannot apply.

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, with §3.1's *"View the organisation"* row and its `org.read`
footnote applied in the landing, plus §4.8's two deactivation verbs.

**Verified by mutation:**

| Mutation | Red |
| --- | --- |
| `activeOwnerCount` counts rows, not active rows | `does not count a deactivated Owner as cover` |
| The field gate removed | `gives a Viewer the org and not the provider block`, + the Member twin |
| `ai: null` instead of absent | the same two |

**The third is the one worth having.** *"`null` says no provider is configured,
which is a different fact and one a Viewer would act on."* The obvious
implementation and the correct one produce the same-looking response and
different meanings, and the test distinguishes them.

**Not decrypting for `key_last4`** — *"a serialiser that can reach plaintext is
one refactor away from returning it"* — is a judgement about a boundary rather
than about this function, which is why it will still be right when somebody
extends the endpoint.

### The diagnosis of the wrong argument is the transferable half

> *"My argument was 'nothing this endpoint returns is sensitive'. The criterion
> is 'nothing this **row** grants is sensitive'. Those are the same sentence only
> while the response never grows."*

**A permission row does not look like a guard, and it is one** — it asserts
something about every future response. That is why D-037 did not fire for
somebody who had been applying it to tests and comments all day: the shape was
familiar and the location was not.

### Three guards, three real mistakes, none a typo

The route lint rule catching an `enums.ts` import; `asserts every action in the
closed union` catching `org.read` with no matrix grades; and **`404s /users/:id`,
which became wrong because of this task's own work rather than by decay**.
Updating it to `405` with `Allow: PATCH` **while keeping the distinction it pins**
is the harder call — deleting it would have been defensible and would have lost
the difference between an unregistered path and an unbuilt method.

### `avatar_color` — LAI-148, and worse than my Notes guessed

Three sources, three answers — §4.1 says *derived from id*, the server derives
from **email** and stores it, the client derives from **id** at render and ignores
the stored value — plus better-auth's `defaultValue: '#6b7280'` as a fourth for
any row created by a path that skips the hook.

**The criterion that matters is the one added rather than the finding:** *do not
fix this by making the client read the served value.* One stored colour cannot be
legible in both themes, which §5.1 requires, so deriving at render is the only
option that satisfies the design — and the tempting one-line fix is the wrong
one. **I would have accepted that fix in review.**
