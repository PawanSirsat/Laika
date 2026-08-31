---
id: LAI-412
title: Edit the project context document
area: web
assignee: shell
priority: p2
depends-on: [LAI-404]
discovered-from:
status: in-progress
started: 2026-08-31T19:55:12Z
---

## Goal

`context_md` is the document served to **every** agent session on the project
(SPEC §7.3) — the thing that is written once instead of re-explained to each
teammate's agent. It needs somewhere to be written.

Project settings, `lead`+ to edit, everyone with project read access can view.

## Acceptance criteria

- [ ] Reads `GET /api/v1/projects/:slug/context` and writes
      `PATCH …/context`. Not the general project `PATCH`.
- [ ] A `viewer` and a `member` see the document read-only, with no edit affordance
      that will fail — not a disabled button with no explanation, and not a
      control that produces a `403`.
- [ ] Editing is plain markdown in a monospace field. **No rich-text editor and
      no new dependency** — the value is served verbatim to agents, so what is
      typed is what ships.
- [ ] The **100,000 character limit is visible before it is hit**: a live count
      that becomes prominent as it approaches, and a save error that names the
      limit and the actual length. SPEC §7.3 is explicit that a context document
      must not silently blow an agent's context window.
- [ ] Unsaved changes are not lost silently on navigation.
- [ ] Shows when it was last edited and by whom, from the endpoint.
- [ ] An empty document gets an empty state that says what the file is **for** —
      architecture and conventions, closed decisions, glossary, things
      deliberately not done — and what does not belong in it: task-specific
      detail, anything secret, anything per-session. Take the wording from
      SPEC §7.3. This is the screen's whole job; a blank textarea teaches nobody.
- [ ] Both themes. Rendered in a real browser.
- [ ] Full gate green.

## Notes

No new dependencies. The monospace font is already self-hosted (JetBrains Mono).

---

## Released by SHELL, 2026-09-01 — **the client half is already built**

Released unstarted-looking but **not unstarted**. CHIEF reprioritised to LAI-423
and LAI-424 (both p1, both found by the owner in a browser). Whoever picks this
up: **do not rebuild the client**, it is committed, green and mutation-proven.

Already on `shell` (and on `master` once merged):

| file | what it is |
| --- | --- |
| `server/web/src/api/project-context.ts` | `getProjectContext` / `updateProjectContext`, `canEditProjectContext` (lead+), `contextBudget`, `readableContextError` |
| `server/web/src/routes/screens/projects/context-copy.ts` | the empty state's wording, taken from SPEC §7.3 |
| `server/web/test/api/project-context.test.ts` | 13 tests |
| `server/web/test/routes/screens/projects/context-copy.test.ts` | 5 tests, held against `docs/SPEC.md` itself |

**It is unused until the panel exists** — no component imports it yet. That is
dead code on `master` and a reviewer should know it is deliberate, not
forgotten.

**What is left** is the screen: `ProjectContextPanel` as a slide-over on the
Projects screen. That placement is not arbitrary — SPEC §11.4.2 maps
`get_project_context` to **Projects**, and the task detail is the existing
precedent for a panel that is deliberately not a route ("slide-over on Board,
not a nav item"). It needs no route-table or sidebar change.

**Decisions already taken, so they are not re-litigated:**

- **Length and limit come from the server, never a constant here.** The bound is
  enforced in the service so REST and MCP share one rule (LAI-404); a mirrored
  copy is the one that goes stale when it moves.
- **The budget warns at 90%**, which leaves 10,000 characters — enough to finish
  a thought and still cut something. `remaining` goes negative past the cap
  rather than clamping, because "0 remaining" does not say how much to remove.
- **Exactly at the limit is not over.** The service refuses `> limit`, so the UI
  must not report a document as rejected that the server would accept. There is
  a test for this specific boundary.
- **`canEditProjectContext` is a third predicate**, not a reuse of
  `canManageMembers` / `canManageSprints`. They agree today and are three
  separate server rules; the established pattern here names them for what they
  authorise.

**One thing measured and worth carrying into the screen:** `updated_by` is a user
id, and the project members map does not contain org Admins, who hold implicit
`lead` without a membership row. So "last edited by" will hit **LAI-416**'s case.
Do not invent a fallback name — see that task.
