---
id: LAI-950
title: 'Organisation has no Roles & Permissions view: an owner cannot see what each role may do'
area: web
assignee: shell
priority: p1
depends-on: [LAI-885]
discovered-from:
status: in-progress
started: 2026-10-22T12:08:00Z
---

## Goal

The owner asked (2026-10-22) for a proper roles and permissions screen.
LAI-885 serves `GET /api/v1/permissions`, computed by `can()` itself. This
task shows it, so the matrix can never drift from policy. Read-only: roles
are still assigned where they are today (Organisation → People for org roles,
project Members for project roles).

## Acceptance criteria

- [ ] Organisation gains a **Roles & permissions** tab, visible to every
      signed-in role (the endpoint is `org.read`).
- [ ] It renders two tables from `GET /api/v1/permissions` — organisation
      actions × `owner|admin|member|viewer`, project actions ×
      `lead|member|viewer` — each cell yes / no / conditional, a conditional
      cell showing the condition text the server sends. Session-only and
      read-only actions are marked. An action the server sends with no label
      shows its action name, not invented text.
- [ ] A "What you can do" summary from the response's `me` block, including
      the token-scope fields as the server sends them.
- [ ] Links: "Change someone's role" → Organisation → People (owner/admin);
      project roles → that project's Members.
- [ ] No role, action or label is hardcoded in the client: every string comes
      from the response (a test feeds a fixture with an invented action and
      asserts it renders).
- [ ] `server/web/test/api/endpoint-coverage.test.ts` no longer lists
      `api/v1/permissions` (the screen is its caller).
- [ ] Light and dark, 1440 and 390, no sideways scroll; design tokens only.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 — on a branch
      that has LAI-885 merged in (CLAUDE.md §4.4 step 4).

## Notes

Base the branch on `master` with `origin/LAI-885-permissions-catalogue`
merged in. Match `docs/design/` (Organisation members list in
`Laika Prototype.dc.html`) for style only.
