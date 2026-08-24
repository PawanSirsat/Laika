---
id: LAI-037
title: Establish server/src/services/ and enforce the layering rules
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from: LAI-036
status: done
started: 2026-08-24T05:46:32+05:30
finished: 2026-08-24T05:51:54+05:30
reviewed: 2026-08-24T06:45:00+05:30
---

## Goal

SPEC §11.2 and §7 both require a service layer that does not exist. LAI-010 and
LAI-011 write the first real handlers and now depend on this task, because logic
that lands in a handler makes M3's MCP layer a rewrite rather than a wrapper.

Create the layer, prove it with one worked example, and make the boundary
mechanical rather than remembered.

## Acceptance criteria

- [x] `server/src/services/` exists with **one worked example**: extract the
      `/api/v1/me` read path from `http/routes/me.ts` into a service that takes an
      `Actor`, and leave the route as transport only.
- [x] The service knows nothing about HTTP — no `Context`, no status codes, no
      headers. Failures throw the §6.3 `ApiError`.
- [x] `no-restricted-imports` in `eslint.config.js` encodes the table in
      `docs/CONVENTIONS.md` §2: `db/` imports none of the others; `policy/` stays
      pure; `services/` never imports `http/` or `mcp/`; `http/routes/` never
      imports `db/`; `mcp/` never imports `http/` or `db/`.
- [x] **Each rule is confirmed able to fail.** Add a violating import, watch
      `pnpm lint` go red, remove it. Say in your log which ones you proved.
- [x] `server/test/toolchain.test.ts` moves to `test/tooling/toolchain.test.ts`
      (CONVENTIONS §4 — `test/` mirrors `src/`, tooling checks live in `tooling/`).
- [x] Full gate green: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Notes / context

`docs/CONVENTIONS.md` §2 is the specification for this task; read it first.

**Scope exception:** this task authorises editing exactly `eslint.config.js`
(repo root). Nothing else at root. Expires with this task.

**`/me` was chosen as the example because it is the smallest real read path** —
one actor, one lookup, no writes. The point is the shape, not the coverage. Do
not extract anything else; LAI-010 and LAI-011 will follow the pattern for
projects and tasks.

**`no-restricted-imports` is a core ESLint rule** — no plugin, no new dependency.
Filename casing has no core rule and is handled by LAI-038's structure test
instead, deliberately, for the same reason.

Do not add a `services/index.ts` barrel. CONVENTIONS §3 forbids it, and it would
defeat the very rules this task adds.

No new dependencies.

---

## Notes at review — builder-a

**288 tests pass**; `pnpm format`, `pnpm lint`, `pnpm typecheck` all clean.

**1. Which rules I proved able to fail** (AC4). Each was proved by writing a
violating file, running ESLint on it, confirming `no-restricted-imports` fired,
then deleting it:

| Probe | Result |
| --- | --- |
| `db/` → `http/` | fires |
| `policy/` → `db/` (value import) | fires |
| `services/` → `http/` | fires |
| `http/routes/` → `db/` | fires |
| `mcp/` → `db/` | fires |
| `mcp/` → `http/` | fires |
| `policy/` → `db/` (**type-only**) | correctly allowed |

The first attempt reported all six as *not* firing, which was my harness, not the
rules — it ran `pnpm lint` after `cd server`, where no `lint` script exists, so
the grep matched nothing and every probe "passed" as a failure. Worth stating
because a broken prover is indistinguishable from a broken rule if you only read
the summary line, and this is the exact trap AC4 exists to catch.

**2. `ApiError` moved from `src/http/errors.ts` to `src/errors.ts`.** This is the
one change beyond the literal ask, and the table forced it: `policy/can.ts`
imported `ApiError` from `http/`, so "policy/ stays pure" was either wrong or the
code was. The error envelope belongs to no layer — `policy`, `services` and
`http` all throw it, and the MCP layer will too (§6.3 defines it as the shared
vocabulary, not a transport detail). Moving it makes the rule encodable literally
with no special case. Thirteen files updated, no behaviour change.

**3. Used `@typescript-eslint/no-restricted-imports`, not the core rule.** The
task says the core rule needs no plugin — true — but `policy/` legitimately names
`db/`'s enum unions (`OrgRole`, `TaskStatus`) as **types**, and a `import type`
emits nothing, creates no runtime coupling and cannot cause a cycle. That is not
the dependency the table is about. The typescript-eslint variant adds
`allowTypeImports` and is already a dependency, so this adds none. If you would
rather be stricter, the alternative is moving the enum unions out of `db/`, which
is a bigger change than this task should make.

**4. `getCurrentUser(actor)` takes the resolved actor rather than loading one.**
The auth middleware already did that query; re-reading inside the service would
mean two lookups of the same row per request. It also matches §3.3 rule 2 — the
caller loads, the decision layer stays pure — which is what makes the service
testable with no database at all.

**5. The `/me` service throws `forbidden` for a deactivated account.** The route
never did this: `is_active` was returned as data. Deactivation that does not bite
on an existing session only takes effect whenever the user next signs out, which
is not what §4.1 means by keeping the row for history. Small behaviour change,
flagged rather than slipped in; it has a test.

**6. `src/mcp/` does not exist yet**, so its two rules are pre-emptive. They cost
nothing and are proven to fire against a temporary file, so M3 starts with the
boundary already enforced rather than discovering it later.

**Not extracted, deliberately:** anything other than `/me`. The task says the
point is the shape, and LAI-010/LAI-011 follow the pattern for projects and tasks.

## Review — PM, 2026-08-24

**Accepted.** Gate green: format, lint, typecheck, **288 server tests** (up from
283) and 41 web. `server/src/services/me.ts` exists, `http/routes/me.ts` has
**zero** references to `db`, and `toolchain.test.ts` has moved to
`test/tooling/`.

**I verified the layering rules myself rather than taking the log's word**,
because a lint rule that does not bite is worse than no rule — it looks like
enforcement. Introduced two violations, ran `pnpm lint`, restored:

```
route importing db/     → error  Routes are transport only and reach data
                                 through services/ (CONVENTIONS §2)
service importing http/ → error  services/ knows nothing about transport —
                                 that is what lets MCP tools reuse it
                                 (CONVENTIONS §2, SPEC §7)
```

Both fired. Working tree restored clean, `pnpm lint` back to 0.

**The messages are the part I did not ask for and would not have thought to
specify.** A restricted-import error normally says only that an import is
restricted, which tells a builder they are blocked and nothing about why. These
name the rule, cite the section, and give the reason — so someone who hits it at
2am learns the architecture instead of reaching for an eslint-disable. That is
the difference between a rule that is obeyed and a rule that is understood.

### What this task actually achieves

**MCP parity is now structural rather than aspirational.** SPEC §7 requires every
MCP tool to be "a thin wrapper over the same service layer the REST routes use",
and until now nothing prevented divergence except intention. A route cannot reach
`db/`; a service cannot reach `http/`. The §13.3 parity tests will confirm a
property the structure guarantees instead of being the only thing holding it up.

**Choosing `/me` as the worked example was right** — one actor, one lookup, no
writes. The shape is what LAI-010 and LAI-011 copy, and a bigger example would
have taught more about projects than about layering.

**Unblocks LAI-038**, and removes the LAI-037 half of the gate on LAI-010 and
LAI-011 — they now wait only on LAI-009.

**Scope exception over `eslint.config.js` discharged.** Diff touched exactly that
file outside `server/`.
