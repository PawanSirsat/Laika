---
id: LAI-261
title: 'The board keeps the old project when you switch space'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-260
started: 2026-09-18T16:13:40+05:30
finished: 2026-09-18T16:17:45+05:30
reviewed: 2026-09-19T10:40:00Z
status: done
---

## Goal

**Found on a running instance while checking LAI-260.** Clicking a space in
the sidebar updates the URL and the space bar's headline, and **the board keeps
showing the previous project's tasks** until the page is reloaded.

Measured, three clicks with a generous wait after each:

```
start              url=?project=laika-infra  header=laika-infra  cards=LI-1
after Laika Web    url=?project=laika-web    header=Laika Web    cards=LI-1   <-- wrong
after Laika Core   url=?project=laika-core   header=Laika Core   cards=LI-1   <-- wrong
after reload       url=?project=laika-core   header=Laika Core   cards=LC-1..LC-10
```

`BoardScreen` seeds its project into local state **once**:

```ts
const [slug, setSlug] = useState(params.get('project') ?? undefined);
```

and nothing re-reads it. The only writer is the default-project resolver, which
runs when the URL names no project at all. So a project chosen from outside the
board — which is now the primary way anyone changes project — never reaches it.

**The file already warns about this exact failure, from the other direction.**
The resolver's own comment reads: *"Holding it only in state is how someone ends
up reading project A under a header they never look at, believing it is B
(LAI-423)."* That is precisely what happens here; LAI-423 fixed the header and
left the state seeded once.

Not a regression from the space bar — but the space bar is what made switching
project a one-click action, so a latent defect became the main path.

## Acceptance criteria

- [x] Clicking a space re-renders the board with that project's tasks, with no
      reload. Asserted in a browser test that clicks between two spaces with
      **different, identifiable task keys** and reads the cards after each.
- [x] The default-project resolution still works: a `/board` with no
      `?project=` picks one and writes it into the URL (LAI-423).
- [x] Back and Forward across two spaces show each one's tasks.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

The fix is to stop treating the URL as an initial value. `slug` may stay state
for the resolver's sake, but a project named in the URL must win whenever it
changes.

**The existing board tests could not see this**: every one of them opens a
board at a fixed `?project=` and never changes it. A test that switches
project is the missing shape, not a missing assertion.

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.
