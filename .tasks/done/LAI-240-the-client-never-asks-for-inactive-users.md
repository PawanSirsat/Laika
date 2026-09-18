---
id: LAI-240
title: 'A deactivated person vanishes from the Organisation screen — the client never asks for them'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-459
started: 2026-09-18T10:07:44+05:30
finished: 2026-09-18T10:34:07+05:30
status: done
---

## Goal

**`GET /users` returns active people only by default.** The server offers
`?include_inactive=true`; `ListUsersQuery` in `web/src/api/users.ts` has no such
field and `listAllUsers()` never passes it.

**So a deactivated person disappears from the Organisation screen**, and the
`DEACTIVATED` chip and the `Reactivate` button are unreachable in production.

**Measured on a live instance**, same database, same session:

| | |
| --- | --- |
| Capacity | **5 people**, Sam Okafor listed |
| Organisation | **4**, Sam absent |
| `GET /users?include_inactive=true` | **5** |

## Why p1

**LAI-238's token panel is gated behind this.** An admin revoking a departed
colleague's tokens is *the* case where that person is deactivated — **so today the
panel is unreachable for precisely the people it was built for.**

And LAI-459's criterion — *"a deactivated member stays visible in the list.
**Deactivation is not deletion** — the row is the record that they were here"* —
**is false in production and was ticked.** That tick is now struck in
`.tasks/done/LAI-459-*.md` with a pointer here.

## Acceptance criteria

- [x] `ListUsersQuery` carries `include_inactive`, and the Organisation screen
      passes it. **Capacity and Organisation must agree on the count** — assert
      that directly, because two screens disagreeing about how many people exist
      is the symptom a user actually reports.
- [x] **A deactivated person renders with the `DEACTIVATED` chip and a
      `Reactivate` control**, both reachable. That is LAI-459's criterion, met
      this time.
- [x] **The assertion must fail if the query parameter is dropped.** This is the
      whole difficulty: `test/browser/harness.ts` matches stubs on **path alone**,
      so a fixture answers whether or not the client asked. **If LAI-241 has not
      landed, say so and assert it another way** — a `page.on('request')` capture
      of the actual URL is sufficient and needs no harness change.
- [x] **Check the other `GET /users` callers** while here. Anything reading the
      member list for a *directory* wants inactive people; anything reading it to
      offer an *assignee* does not. **Say which each one is** rather than making
      them uniform.
- [~] Both themes. **`pnpm test` is `EXIT 0` (1932 passed). `pnpm lint` is
      `EXIT 1`, on `master`, in CORE's area** — see "The gate has two exit
      codes" below.

## Notes / context

**Do not change the server default.** Active-only is the right default for a
picker, and §6.4 documents the flag. **The client is the side that knows which
question it is asking.**


---

## Verified where the defect was found

Not only against fixtures — the fixtures are what hid it. On the running
instance (`localhost:3371`, five people, one deactivated):

| | before | after |
| --- | --- | --- |
| Organisation rows | **4** | **5** |
| Capacity names | 5 | 5 |
| `DEACTIVATED` chip | never rendered | renders, on Sam Okafor only |
| `Reactivate` control | unreachable | reachable |
| request | `/api/v1/users` | `/api/v1/users?include_inactive=true` |

**The two screens now agree**, which is AC1 stated as the symptom rather than
as a mechanism.

## The gate has two exit codes, and one of them is red

`pnpm test` from the repo root: **`EXIT 0`, `Tests 1932 passed (1932)`.**
LAI-239 landed, so LAI-459's inherited red is gone and nothing replaces it.

`pnpm lint`: **`EXIT 1`**, and it is not this task's:

```
server/test/jobs/restore-drill.test.ts
  147:32  error  Unexpected empty arrow function  @typescript-eslint/no-empty-function
```

From `46b4933` (LAI-466), present on `core`, `master` **and** `shell` — the line
is `logger: createLogger(() => {})`. **`server/test/` is CORE's**; only the
`WEB_*` maps in `structure.test.ts` are mine (D-026). Reported, not touched.

**Worth more than the one line: CLAUDE.md §5's gate rule is written about
`pnpm test` alone**, so somebody running the documented command sees green while
`pnpm lint` has been red on `master`. That is the same shape as everything else
in this task — an instrument that cannot see the thing.

## What changed

| file | |
| --- | --- |
| `web/src/api/users.ts` | `ListUsersQuery.includeInactive`; `listAllUsers(signal, {includeInactive?, maxPages?})` |
| `.../organisation/use-organisation.ts` | passes it — **a directory** |
| `.../screens/AddMemberForm.tsx` | does not — **a picker**, now stated |
| `web/test/api/users.test.ts` | two new tests, both on the URL |
| `web/test/browser/organisation-roles.test.ts` | two new tests |

**`listAllUsers` takes an options object now**, so `maxPages` stopped being a
positional second argument. One existing test moved from `listAllUsers(undefined, 3)`
to `{ maxPages: 3 }`. No other caller passed it.

## AC4 — the two callers ask different questions

- **`use-organisation.ts` — a directory.** Someone deactivated still holds
  history: tasks they created, comments they wrote. A list that omits them makes
  those references unattributable, which is §4.1's own argument for keeping the
  row. It is also the only route to `Reactivate`.
- **`AddMemberForm.tsx` — a picker.** Active only, which was already the
  behaviour and is now **written down rather than inherited from a default**.
  You cannot hand a project to somebody locked out; offering them would produce
  a member whose every action `can()` refuses.

No third caller. `api/sprints.ts` mentions `listAllUsers` in a comment only.

## AC3 — why these assertions can fail and the old one could not

**The old test asserted on the rendered list**, and `harness.ts` matches stubs on
**path alone**, so the fixture answered whether or not the client asked. Two
instruments replace it, neither needing LAI-241:

1. **`test/api/users.test.ts` asserts the URL the client builds** — the directory
   case must contain `include_inactive=true`, the picker case must not.
2. **`page.on('request')`** in the browser test captures the real URL for every
   `/users` request the screen makes.

A third test asserts **the flag survives onto page two, with the cursor**. The
server re-reads it per request, so dropping it after page one would truncate a
directory's tail to active people — a partial answer that looks complete, which
is this task's own bug one layer down.

And **AC1 is asserted as the symptom**: Organisation's row count must equal
Capacity's. Neither number is obviously wrong alone; the disagreement is the bug.

## Verification

**4/4 mutations caught**, each run against both test files, all files restored by
checksum:

| mutation | |
| --- | --- |
| directory drops the flag | red — *this is the original defect exactly*, and the old test could not see it |
| flag never reaches the URL | red |
| flag dropped after page one | red |
| picker asks for inactive too | red |

---

## Accepted — CHIEF, 2026-09-03

All three gates green. **Mutation here**: `include_inactive` never set. **Red on
three**, and the names say more than my criteria did:

```
not ok 3 - a directory asks for inactive people; a picker does not
not ok 4 - the flag is carried onto every page, not just the first
```

**The second is a criterion I did not write.** `listAllUsers` pages, and a flag
applied only to the first request gives a list that is correct until it is
long — **which is the bug that arrives months later on somebody else's org.**

### And the distinction in the first is exactly what AC4 asked for

*A directory wants inactive people; a picker does not.* **You did not make them
uniform**, and the assertion names which is which — so the next person adding a
caller has to decide rather than copy.

### The criterion that could not be met the normal way

AC3 said the assertion must fail if the parameter is dropped, and warned that the
harness could not see it. **You used `page.on('request')` and left a comment
saying `until LAI-241 teaches the harness about query strings`** — a stopgap that
names its own successor. **It is now redundant and correct, which is the right
order.**
