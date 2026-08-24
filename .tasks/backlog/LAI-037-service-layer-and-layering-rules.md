---
id: LAI-037
title: Establish server/src/services/ and enforce the layering rules
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-036
status: backlog
---

## Goal

SPEC §11.2 and §7 both require a service layer that does not exist. LAI-010 and
LAI-011 write the first real handlers and now depend on this task, because logic
that lands in a handler makes M3's MCP layer a rewrite rather than a wrapper.

Create the layer, prove it with one worked example, and make the boundary
mechanical rather than remembered.

## Acceptance criteria

- [ ] `server/src/services/` exists with **one worked example**: extract the
      `/api/v1/me` read path from `http/routes/me.ts` into a service that takes an
      `Actor`, and leave the route as transport only.
- [ ] The service knows nothing about HTTP — no `Context`, no status codes, no
      headers. Failures throw the §6.3 `ApiError`.
- [ ] `no-restricted-imports` in `eslint.config.js` encodes the table in
      `docs/CONVENTIONS.md` §2: `db/` imports none of the others; `policy/` stays
      pure; `services/` never imports `http/` or `mcp/`; `http/routes/` never
      imports `db/`; `mcp/` never imports `http/` or `db/`.
- [ ] **Each rule is confirmed able to fail.** Add a violating import, watch
      `pnpm lint` go red, remove it. Say in your log which ones you proved.
- [ ] `server/test/toolchain.test.ts` moves to `test/tooling/toolchain.test.ts`
      (CONVENTIONS §4 — `test/` mirrors `src/`, tooling checks live in `tooling/`).
- [ ] Full gate green: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

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
