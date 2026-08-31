---
id: LAI-412
title: Edit the project context document
area: web
assignee: shell
priority: p2
depends-on: [LAI-404]
discovered-from:
status: done
started: 2026-08-31T19:55:12Z
finished: 2026-09-01T02:45:00Z
---

## Goal

`context_md` is the document served to **every** agent session on the project
(SPEC §7.3) — the thing that is written once instead of re-explained to each
teammate's agent. It needs somewhere to be written.

Project settings, `lead`+ to edit, everyone with project read access can view.

## Acceptance criteria

- [x] Reads `GET /api/v1/projects/:slug/context` and writes
      `PATCH …/context`. Not the general project `PATCH`.
- [x] A `viewer` and a `member` see the document read-only, with no edit affordance
      that will fail — not a disabled button with no explanation, and not a
      control that produces a `403`.
- [x] Editing is plain markdown in a monospace field. **No rich-text editor and
      no new dependency** — the value is served verbatim to agents, so what is
      typed is what ships.
- [x] The **100,000 character limit is visible before it is hit**: a live count
      that becomes prominent as it approaches, and a save error that names the
      limit and the actual length. SPEC §7.3 is explicit that a context document
      must not silently blow an agent's context window.
- [x] Unsaved changes are not lost silently on navigation.
- [x] Shows when it was last edited and by whom, from the endpoint.
- [x] An empty document gets an empty state that says what the file is **for** —
      architecture and conventions, closed decisions, glossary, things
      deliberately not done — and what does not belong in it: task-specific
      detail, anything secret, anything per-session. Take the wording from
      SPEC §7.3. This is the screen's whole job; a blank textarea teaches nobody.
- [x] Both themes. Rendered in a real browser.
- [x] Full gate green.

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

---

## Build note — SHELL, 2026-09-01

### The client half was already done

Built before this task was released for the two p1s, and it survived the round
trip: `api/project-context.ts` and `routes/screens/projects/context-copy.ts`
with 18 green tests. Only the panel was left. That is the argument for releasing
a task cleanly rather than abandoning it.

### A defect the criteria depend on, found by rendering

**AC4 could not be met as the server stands.** SPEC §7.3 requires the size
refusal to name "both the limit *and the actual length*", and
`updateProjectContext` raises exactly that — **but it is unreachable over REST**.
The route's schema carries `.max(CONTEXT_MD_LIMIT)` as well, so zod refuses
first. Measured:

```
PATCH /projects/laika-core/context      (100,400 characters)
422 {"message":"Invalid request body","details":{"issues":[
     {"path":"context_md","message":"Too big: expected string to have <=100000 characters"}]}}
```

The limit is there in prose; **the length — the half §7.3 singles out — is not**.
On screen that read as *"Invalid request body"*, which tells a writer nothing.

Filed as **LAI-228** against `server`. Meanwhile the client reads *both* shapes
and supplies the length itself, since it knows what was just typed. The
workaround is marked with that task id so it is removed rather than inherited.

The schema's own comment says *"The size bound is the service's, not this
schema's"* — and the schema enforces it anyway. **A bound enforced in two layers
is enforced by whichever runs first, and here that is the less informative one.**

### The unsaved-changes guard proved itself by getting in my way

Navigation started timing out mid-verification. The cause was my own
`beforeunload` handler: the textarea held 100,400 unsaved characters and the
browser was waiting on a confirm dialog. AC5 verified by being blocked by it.

### A viewer gets no Save button at all

Not a disabled one. Measured as `grace@example.com`, a project viewer: document
loads (785 chars), textarea `readOnly`, **no `.ctx-save` in the DOM**, and a line
saying editing needs the lead role. Her `PATCH` returns `403`, so the display
decision and the server agree.

### Where it lives, and why that is not arbitrary

A slide-over on the **Projects** screen. SPEC §11.4.2 maps
`get_project_context` to Projects, and the task detail is the precedent for a
panel that is deliberately not a route. No route-table or sidebar change, so no
nav entry for a screen that is not a screen.

### Measured in a browser

| | result |
| --- | --- |
| load | 741 chars from the real endpoint, no demo module |
| save | 741 → 785, "Saved", dirty cleared, timestamp and author updated |
| budget at 50% | `50,000 / 100,000 characters`, quiet |
| budget at 92% | `92,000 / 100,000 · 8,000 left`, amber |
| over | `100,400 / 100,000 · 400 over`, red |
| refusal | *"Too long by 400 characters — 100,400 of 100,000 allowed."* |
| viewer | read-only, no Save, reason given |
| empty project | the §7.3 guide, `Never edited.`, Save disabled |
| both themes | panel, editor and monospace face all correct |

Empty state wording is held against `docs/SPEC.md` §7.3 by a test that reads the
spec, so it cannot drift from the section it claims to quote.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** Verified in a browser against the seeded 988-character document.

| check | result |
| --- | --- |
| owner: real document, textarea, Save | loaded, `988 / 100,000 characters` |
| budget at oversize | `100,400 / 100,000 characters · 400 over` |
| save refusal | **"Too long by 400 characters — 100,400 of 100,000 allowed."** |
| does `Invalid request body` leak? | **no** |
| viewer: Save button | **0 — absent, not disabled** |
| viewer: told why | *"Read-only. Editing the context document needs the lead role on this project."* |
| viewer's `PATCH` | `403` — display and server agree |

### The finding, and it corrects something I wrote

`updateProjectContext` raises exactly the error §7.3 asks for. **It is
unreachable over REST**, because `routes/projects.ts:79` carries
`.max(CONTEXT_MD_LIMIT)` and zod refuses first — so a caller gets
`"Invalid request body"` with the limit in prose and **the length absent**,
which is the half §7.3 says matters.

> **A bound enforced in two layers is enforced by whichever runs first** — and
> here that is the one carrying less information.

The schema's own comment says *"the size bound is the service's, not this
schema's"*, and the schema enforces it anyway.

**That qualifies LAI-404's accept note.** I wrote that the substance was
*"promoting the bound into the service so both entry points share one rule"* and
that *"a bound only one entry point applies is not a bound."* Both still true —
but I implied the service's error was what a REST caller would see, and it never
was. **The bound moved; the message did not.** Filed as **LAI-228** against
`server`, with the client's workaround carrying that id so it is removed rather
than inherited.

It could exist anywhere a zod `.max` shadows a service rule, which is worth a
sweep when someone takes LAI-228.

### AC5 verified by obstructing its own verification

Browser navigation began timing out mid-check because `beforeunload` was waiting
on a confirm dialog — the textarea held 100,400 unsaved characters. **The
unsaved-changes guard proved itself by getting in the way of the person testing
it.**

### Two probe errors of mine, both the usual shape

`innerText` does not include a textarea's value, so my first check reported the
document as not loaded when the `988` count proves it was. And Tomas sees **one**
project, not three, so `.nth(1)` timed out — which is itself correct behaviour I
mis-read as a failure. Both times the evidence was on screen.

### For LAI-227's case

A `.tsx` needs no mirrored test — the structure rule requires the **directory**
to exist and only `.ts` modules need a mirror. So this 242-line panel has **no
test of its own and the suite is content.** The pure parts are covered; the
component is not, and cannot be. **Third task running where the honest answer was
"verified in a browser by hand."** That is the argument LAI-227 needs and it is
now three occurrences long.
