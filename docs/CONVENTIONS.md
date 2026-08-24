# Laika — code conventions

Status: **binding for all sessions** · Owner: PM · Last updated: 2026-08-24

`CLAUDE.md` §5 says what must be true of the code (TypeScript strict, Drizzle
only, `can()` on every endpoint, no unnamed dependencies). This document says
where things go and what they are called.

These rules apply **everywhere** — `server/`, `server/web/`, `plugin/`, `cli/`,
`docker/` — not only to the frontend. Where a rule is enforced by a lint rule or
a test, that is named, because a rule nobody can forget beats a rule everyone
must remember.

---

## 1. Directory structure

```
server/src/
  index.ts          process bootstrap only — no business logic
  app.ts            wiring only — middleware order, route mounting
  env.ts  log.ts  paths.ts  version.ts     process concerns, flat
  errors.ts         the §6.3 error vocabulary — flat because BOTH services/ and
                    http/ raise it, and services/ may not import http/
  db/               schema, client, migrations, low-level data helpers
  policy/           can(), actions — pure, no I/O
  services/         business logic. Takes an Actor. Returns data.
  http/             transport only
    middleware/     Hono bindings
    routes/         thin handlers
    *.ts            shared transport helpers — errors, pagination, validation
  mcp/              M3 — thin wrappers over services/
```

`server/web/src/` follows the same idea: `theme/`, and later `components/`,
`routes/`, `api/`. `plugin/`, `cli/` and `docker/` keep their own shapes — §3
naming and §4 tests still apply to them.

**A file that does not obviously belong in one of these is a signal**, not a
puzzle to solve quietly. Say so in your log; a directory that needs inventing is
usually a spec question.

---

## 2. Layering — the load-bearing rule

Dependencies point one way:

```
http/routes  →  services  →  policy
mcp/         →  services  →  db
```

| Layer | May import | Never imports |
| --- | --- | --- |
| `db/` | — | `http/`, `services/`, `policy/`, `mcp/` |
| `policy/` | — (pure) | everything else |
| `services/` | `db/`, `policy/` | `http/`, `mcp/` |
| `http/routes/` | `services/`, `http/` helpers | `db/` |
| `mcp/` | `services/` | `http/`, `db/` |

**Enforced by `no-restricted-imports` in `eslint.config.js`.** A route importing
`db/` fails `pnpm lint`.

### Why this one matters more than the others

SPEC §7 says every MCP tool is "a thin wrapper over the same service layer the
REST routes use", and §11.2 says "handlers stay thin, logic lives in service
modules that take an `Actor` — which is what lets MCP tools reuse them exactly".

If routes and MCP tools can each only reach data through `services/`, **they
cannot diverge**. The parity tests in §13.3 then confirm a property the structure
already guarantees, instead of being the only thing holding it up. Put the logic
in a handler and M3 stops being a wrapper and becomes a rewrite.

### What belongs in a service

A service function takes an `Actor` and plain arguments, calls `assertCan`, does
the work through Drizzle, writes the `activity` row, and returns data. It knows
nothing about HTTP: no `Context`, no status codes, no headers. If a service needs
to signal a failure, it throws the §6.3 `ApiError` — which the transport layer
maps to a status and the MCP layer maps to a tool error.

---

## 3. Naming

- **kebab-case** for every file and directory: `resolve-actor.ts`,
  `security-headers.ts`, `http/middleware/`.
- **PascalCase only for React component files**, matching the component's own
  name: `TokenReference.tsx` exports `TokenReference`.
- **No barrel files.** No `index.ts` that only re-exports. They hide the import
  graph that §2 depends on, and they defeat `no-restricted-imports`.

### The paired-module pattern

Already in use for `rate-limit` and `idempotency`, and worth repeating
deliberately:

```
http/rate-limit.ts             pure, unit-testable logic
http/middleware/rate-limit.ts  the Hono binding, same name
```

The same name is the point — it says these are two halves of one thing. Test the
bare module directly; test the middleware through the app.

---

## 4. Tests

- `server/test/` **mirrors** `server/src/`: `src/policy/can.ts` →
  `test/policy/can.test.ts`.
- Helpers live in `test/helpers/`, tooling checks in `test/tooling/`.
- **Enforced by `server/test/tooling/structure.test.ts`**, which also enforces
  §3 naming and the no-barrels rule.

### Two test runners, deliberately

| Package | Runner | Why |
| --- | --- | --- |
| `@laika/server` | **vitest** | Concurrency, fixtures, and a large suite (278 tests). Already a named dependency. |
| `@laika/web` | **`node --test`** | Zero test dependencies; Node 22 runs TypeScript natively. |

This is a decision, not drift. The web package was able to reach 24 tests without
adding a devDependency, and `CLAUDE.md` §5 forbids dependencies no task named.
Both are reachable from the root `pnpm test`, so one command still runs
everything.

**If web ever needs component rendering**, that is the moment to revisit — say so
in a task rather than reaching for vitest quietly.

### Structural tests are a first-class idiom here

`tokens.test.ts` walks the CSS, `build.test.ts` walks `dist/`,
`format-fix.test.ts` builds a real git repo. Prefer this over adding a lint
plugin: it needs no dependency, and the failure message can explain itself.

### Assert absences, do not merely omit them

When a rule says something must **not** exist — no barrel files, no `SYSTEM`
group, no `postgres` in the status panel, no magic-link sign-in, no old env name
— write a test that says so. A thing that is absent because nobody added it comes
back the first time somebody adds it. A thing that is absent because a test says
so does not.

This emerged from the builders rather than from this document, and it is now
house style. Examples in the tree: `no longer reads the old SERVER_SECRET name`,
`no SYSTEM group (AC2)`, `the status panel never says Postgres (AC6, D-001)`,
`contains no barrel files`, `the mockup fixtures are absent`.

The comment beside such a test should say *why* the thing is absent, so the next
reader finds the reason where they looked for the feature.

**Confirm every new guard is able to fail before trusting it.** Break the thing
it guards, watch it go red, put it back. A test never seen to fail has not been
shown to work.

---

## 5. Enforcement summary

| Rule | Enforced by | Fails |
| --- | --- | --- |
| Layering (§2) | `no-restricted-imports` | `pnpm lint` |
| File naming, no barrels (§3) | `structure.test.ts` | `pnpm test` |
| Test mirrors src (§4) | `structure.test.ts` | `pnpm test` |
| TypeScript strict, `@ts-ignore` descriptions | `eslint.config.js` | `pnpm lint` |
| Formatting | Prettier | `pnpm format` |

Everything else in this document is enforced at PM review. If a rule here keeps
being missed, that is an argument for automating it — file a task.
