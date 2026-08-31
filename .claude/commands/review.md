---
description: CHIEF only — review every task in .tasks/review/ against its acceptance criteria
---

**CHIEF session only.** If you are a builder, stop: you cannot move tasks to done.

For **each** file in `.tasks/review/`, oldest first:

**1. Read the task.** Goal, every acceptance criterion, notes, `depends-on`.

**Check what each `depends-on` actually delivers, not that it is in `done/`.**
LAI-086 depended on LAI-059 — *"Project members — list, change role, remove"* —
which built `/projects/:slug/members`, **project-level (§3.2)**. The org-level
equivalent it needed was never built. The titles are near enough that the
dependency read as satisfied from the task file alone, and nothing caught it
short of opening the route file.

> **A satisfied dependency is not the same as a satisfied need.**

Open the thing the dependency built. It costs a minute and it is a whole task's
round trip when it is wrong.

**2. Read the actual diff**, not the summary. The work is on the builder's
branch, not on `master`:

```bash
git log --all --oneline --grep="<TASK-ID>"
git log master..core --oneline          # or shell
git diff master...core -- <the area that task owns>
```

Also read the builder's log entry for that task in `logs/<session>-*.md`.

**3. Check each criterion against the diff.** A ticked box is a claim, not
evidence. For each one, find the code that satisfies it. Where a criterion says
"tested", find the test and confirm it asserts the thing.

**3b. For a `web` task, render it. Do not review UI from the diff alone.**

A screenshot is the only thing that catches what the diff cannot: the sidebar
leaking onto a signed-out page, copy from another screen, a layout that breaks in
one theme. Both of the defects found in the 2026-08-24 audit were invisible in
the code and obvious in a browser.

```bash
pnpm build
LAIKA_DB_PATH=<scratch>/ui.db LAIKA_SECRET=<32+ chars> \
LAIKA_PUBLIC_URL=http://localhost:3999 PORT=3999 node server/dist/index.js &
```

Then drive it with a real browser — first boot, sign in, the screens the task
touched — and capture **both themes**. `playwright-core` in the scratchpad
against the system Chromium works; do not add a browser dependency to the repo.

Check, in this order:

- **Against the design.** `docs/design/Laika Prototype.dc.html` is canonical;
  `Laika 05-07 - Auth, Setup, Projects.dc.html` is the only detailed source for
  login, first boot and project home. Render the design file too and compare
  side by side rather than from memory.
- **Signed out.** Open the pre-auth routes in a **fresh context**. A session you
  are already holding hides exactly the class of bug LAI-062 was.
- **Both themes**, every time, **driven through the real control** — click the
  Light/Dark radios, never `documentElement.classList.toggle('dk')`. Flipping the
  class changes CSS variables without re-rendering React, so anything that
  computes a colour **in JavaScript** keeps the old palette and the screenshot
  looks correct. That is precisely the bug LAI-059 found: `useTheme` held state
  per component, and dark mode rendered light-theme avatars — pale chips with
  dark text — on every screen with a person on it. A class-toggle check would
  have passed. A component that only works in light is not done.
- **No fixture data.** Grep the diff for `Mira`, `Kellner`, `Sana`, `Verma`,
  `kvelld.internal`, `13/34`, `laika-core`, `v0.4`. Any hardcoded number, name or
  count is a defect even when it looks right.
- **Tokens, if the diff touched styling.** Read the computed custom properties
  off the running page and compare to the table in `docs/design/README.md`. Do
  not eyeball colour.

Attach what you found to the review notes. If a mismatch is real but outside the
task, **file it — do not widen the task**.

**4. Check the boundaries.**
- Did the diff touch only files that session owns? (Root-level files only if the
  task explicitly named them, file by file.)
- Commit messages in `<type>(<area>): <summary> [<task-id>]` format?
- `can()` called on every endpoint the diff added? All DB access through Drizzle?
  TypeScript strict, no unexplained `@ts-ignore`? New dependencies named in the
  task?
- Log entry written, with real file paths and actual decisions?

**5. Decide.**

*Accept* — every criterion is met and the boundaries hold. **CHIEF is the sole
integrator** (CLAUDE.md §4.2): merge the builder's branch, then close the task.
```bash
git merge --no-ff core        # or shell — whichever owns the task
git mv .tasks/review/<file> .tasks/done/
```
If the merge conflicts, resolve it in CHIEF's favour for `docs/`, `.tasks/`,
`.claude/` and `CLAUDE.md`, and in the builder's favour inside their own area.
A conflict outside those bounds means a boundary was crossed — send it back.
Set `status: done` and `reviewed: <ISO-8601>` in the frontmatter. Append a short
`## Review` section noting what you verified. Commit:
`chore(tasks): accept <TASK-ID> [<TASK-ID>]`

*Send back* — anything is unmet, unverifiable, or out of bounds:
```bash
git mv .tasks/review/<file> .tasks/in-progress/
```
Set `status: in-progress`, untick the criteria that are not actually met, and
append:
```markdown
## Review notes — <ISO-8601>
- [ ] <specific, checkable thing to fix — not "improve error handling">
```
Commit: `chore(tasks): review changes requested <TASK-ID> [<TASK-ID>]`

Send back for unmet criteria, missing tests, or crossed boundaries. Do **not**
send back over style preferences the task never asked for — if you want a
different approach, that is a new task.

**6. File what you found.** Anything real but out of scope becomes a new backlog
task with `discovered-from: <TASK-ID>`. Never widen a task during review.

**7. Log it.** Append one entry per reviewed task to `logs/chief-<today>.md`: task
id, accepted or returned, what you verified, what you filed. Then print a summary
of accepted / returned / newly filed.
