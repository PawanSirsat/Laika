---
id: LAI-100
title: Nothing checks SPEC §3 against `can()`
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-004]
discovered-from: LAI-111
finished: 2026-08-24T21:58:24Z
started: 2026-08-24T21:50:19Z
status: review
---

## Goal

`matrix.test.ts` calls itself *"the executable version of SPEC §3.1 and §3.2"* —
but it **restates** the matrix in TypeScript rather than reading it. So the two
can disagree silently, and the test would keep passing.

Found while settling LAI-111: I checked whether editing §3.1 would break a test
before touching it. It would not — which is convenient today and is the gap.

**This is the same class as §4↔`schema.ts` (LAI-051) and `schema.ts`↔migrations
(LAI-061), on the one axis still unguarded.** Those two exist because the same
drift went unnoticed twice; §3 is the remaining side of the same shape, and it is
the one governing **who may do what**.

## Acceptance criteria

- [x] A check reads the §3.1 and §3.2 tables out of `docs/SPEC.md` and compares
      them against `can()` — every action, every role, both directions.
- [x] It fails when a matrix row has no action, when an action has no row, and
      when a **cell disagrees** — the last is the one that matters and the
      easiest to omit.
- [x] Prove all three by making each change and watching it go red.
- [x] Rows that are prose rather than a matrix cell — like LAI-111's paragraph on
      the org activity feed — must be handled deliberately: either parsed, or
      **listed as prose exemptions with a reason**, never silently skipped.
- [x] Reuse LAI-080's planned-mark if §3 needs to describe something not yet
      built. Do not invent a second mechanism.

## Notes / context

**`matrix.test.ts` stays.** It is the executable contract and it is good. This
adds the link between it and the document it claims to be executing — right now
that claim is unverified.

The parsing is the fiddly part and the reason to do it once, carefully: markdown
tables with `✓`, `—`, and qualifiers like `✓ (not to Owner)` and
`✓ (read_only forced)`. **A qualifier that the parser silently drops is worse
than not parsing at all** — it would assert agreement on a cell whose meaning it
had discarded.


---

## Builder-A notes (2026-08-25)

### It found real drift on its first run

**`token.read_own` and `token.revoke_own` are allowed by `can()` and granted by
no §3.1 row.** §3.1 grants *generating* your own token and *revoking anyone's*
(admin+); reading or revoking **your own** appears nowhere. The behaviour is
almost certainly right — `can.ts` says *"Self-scoped: reading and revoking your
own tokens is always yours to do"* — but until now that comment was the only
authority for it, and §3.3 says `can()` implements §3 rather than defining it.

Filed as **LAI-134** with both options written out. Not a security hole: the
actions are self-scoped and behave correctly. It is a documentation gap nobody
could see until the two were compared mechanically, which is the argument for
this task existing.

### Qualifiers are verified, and an unknown one fails

The Notes were right that this is the dangerous part. There are seven —
`not to Owner`, `as member`, `as viewer`, `read_only forced`, `own + any`, `own`,
`own-created` — and none is a boolean. Each is registered with an assertion of
what it *means*: `own` checks that a member may act on their own comment and not
someone else's; `read_only forced` checks `forcedTokenScope`; `as viewer` checks
`projectRoleOnJoin`.

**An unregistered qualifier fails the suite** rather than being flattened to
`true`. Probed it: adding `✓ (except themselves)` to a cell goes red with
*"uses a qualifier nothing verifies"*. A parser that guessed would have asserted
agreement on a cell whose meaning it discarded, which reads as coverage and is
worse than no check.

### §3.1's table is interrupted by prose, and that nearly cost a row

Three paragraphs about the org-wide activity feed sit **between**
`Export audit log` and `Configure webhooks`. A parser that stopped at the first
non-table line would silently drop the last row — a permission nobody is
checking, reported as success. Rows are collected across the whole section and
the count is asserted, and there is a probe that reintroduces the naive parser
and watches it go red.

### AC4 — the prose is listed, not skipped

Two prose rules, each recorded with a reason **and a phrase that must still be
present**, so deleting the prose fails this file rather than quietly emptying the
exemption:

- §3.1's org-feed paragraph — grants no new capability, routes the org-scoped
  feed to `audit_log.export`, and says outright that a separate cell is
  deliberately not added.
- §3.2's implicit-lead sentence — not a cell; it changes which *role* §3.2 is
  read with. Asserted directly against `effectiveProjectRole`'s behaviour.

### AC5 — LAI-080's planned mark was not needed

§3 describes nothing unbuilt, so there was nothing to mark. Recorded rather than
left as an unanswered criterion: no second mechanism was invented because none
was required.

### The one hand-written thing, and why it is small

A row's prose ("Invite users / change org roles") cannot be derived from an
action id, so the row→action map is declared. Everything else — the roles, the
cells, the qualifiers — is read from the document, and the map is checked in
**both** directions, so a renamed row and an unmapped action both fail.

### Verification

Eight probes, all eight fail when broken, covering all three AC2 cases:

| probe | result |
| --- | --- |
| §3 grows a row nothing implements | red |
| `can()` grows an action §3 never grants | red |
| a §3.1 cell disagrees | red — *"§3.1 Deactivate user · Member · user.deactivate"* |
| a §3.2 cell disagrees | red — *"§3.2 Add comment · Member · comment.create"* |
| `can()` changes under an unchanged §3 | red |
| §3 grows an unregistered qualifier | red |
| the parser stops at the prose | red |
| a qualifier is flattened to a tick | red |

The failure names the exact cell, which is what makes it actionable rather than
just noisy. 1027 tests pass — the check contributes 114, one per cell.
