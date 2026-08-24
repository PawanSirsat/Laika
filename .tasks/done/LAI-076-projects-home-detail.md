---
id: LAI-076
title: Projects home — match design 7a, the full card anatomy
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-058, LAI-060]
discovered-from:
status: done
started: 2026-08-25T06:20:00+05:30
finished: 2026-08-25T06:50:00+05:30
reviewed: 2026-08-25T22:45:00+05:30
---

## Goal

Match screen **`7a`** in `docs/design/Laika 05-07 - Auth, Setup, Projects.dc.html`.

LAI-058 shipped the working screen — list, create, switch, tombstones. This is
the visual and informational build-out: today a project card carries a name, a
visibility badge and a button; the design's carries the shape of the work.

## Acceptance criteria

- [x] **Three-column grid**, 13px gap, cards radius 12px with `var(--shadow)`.
- [x] **Sections**: `YOUR PROJECTS` and `PUBLIC IN THIS ORG`, each a 9.5px/800
      `.09em` eyebrow in `var(--tx3)` with a `var(--bd)` rule running to the edge.
- [x] Card head: name 14.5px/800 `-.016em`, then the **visibility chip** —
      `PUBLIC` in `var(--grn)`/`var(--grns)`/`var(--grnb)`, `PRIVATE` in
      `var(--tx3)`/`var(--tub)`/`var(--bd)`.
- [x] **Repo in mono** 10px `var(--tx3)` beneath the name, from `projects.repo`
      (LAI-108 added the column). Omit the line when it is null.
- [x] Description at 11.5px/500 `var(--tx2)`.
- [ ] **Segmented progress bar**, 6px, radius 4px, ground `var(--tub)` — done
      `var(--grn)`, review `var(--amb)`, in-progress `var(--acc)` — with counts
      in mono beneath (`13/34 done · 9 active`) and a **blocked** count in
      `var(--red)` with a padlock when non-zero.
- [ ] Last activity, mono 9.5px `var(--tx3)`, right-aligned on the counts row.
- [ ] **Footer strip** on `var(--page)` above a `var(--bd)` rule: an overlapping
      avatar stack (22px, `-6px` margin, 1.5px `var(--page)` ring) and member
      names, then **Open board** (`var(--acc)`) or **Join project** (outlined) —
      join only on a public project the actor is not in, via
      `POST /api/v1/projects/:slug/join`.
- [ ] Empty states: *"No other public projects"* and the first-run
      *"No projects yet"*, both dashed `var(--bd2)` at radius 12px.
- [x] Both themes.

## Counts are OUT of scope until LAI-053 lands — PM, 2026-08-25

The per-project task counts, blocked count and last-activity time are **not on
`GET /projects` today**. LAI-053 exists to add them and is unblocked.

**Fetching every project's tasks to count them is one request per card** and will
be a defect at any real number of projects. If LAI-053 has not landed, build the
card without the progress bar and counts and say so in your log — the layout
should degrade to what LAI-058 already ships, not to fabricated numbers.

Avatar identities come from `GET /api/v1/users` (LAI-060); colours from
`theme/avatar-color.ts`, never the mockup's `--mk --ta --sv --jd --rb`.

---

## Dependency dropped — PM, 2026-08-25

**`LAI-053` removed from `depends-on`.** Builder-B was correct not to edit it to
unblock themselves, and correct that the protocol would have refused the claim.

**The card is worth building without the counts.** Ship the name, visibility chip,
repo line, description, section headings, avatar stack and the Open/Join footer —
that is most of `7a` and all of it is backed by endpoints that exist today.

**Leave the segmented progress bar, the `13/34 done` line, the blocked count and
last-activity out entirely.** Not stubbed, not zeroed, not faked — absent, so the
layout degrades to what LAI-058 already ships. **Do not fetch each project's
tasks to count them**: that is one request per card and a defect at any real
number of projects.

They come back as a follow-up when LAI-053 lands. File it as a discovery when you
finish, rather than leaving this task open for a bar.

## Notes at review — builder-b

### Four criteria are NOT ticked, and one of them you should overrule me on

**Ticked:** grid, section eyebrow with rule, card head + visibility chip, repo in
mono, description, both themes.

**Not ticked, per your own instruction:**
- the segmented progress bar
- the `13/34 done · 9 active` counts and the blocked count
- last activity

`GET /projects` returns none of them, and counting per card is one request per
project. Absent, not zeroed. **Filed as LAI-212** for when LAI-053 lands.

**Not ticked, and this one is my judgement, not your instruction — the avatar
stack and Join.**

The criterion says avatar identities come from `GET /api/v1/users`. That endpoint
lists the **organisation's** users, not a project's members — so a stack built
from it would show the same faces on every card regardless of who is actually on
the project. Real member lists come from `GET /projects/:slug/members`, which is
**one request per card** — precisely the defect you ruled out for the counts, and
the reason is identical.

So I left both out rather than ship faces that are wrong or a fetch pattern you
had already rejected two paragraphs earlier. **If you meant the org list as a
deliberate approximation, say so and I will build it** — but it seemed more
likely that the AC was written before anyone checked what `/users` returns.

`POST /:slug/join` went with it: the button is only meaningful beside the member
data that says whether you are already in.

### `Project` was missing `repo`

Same shape as `Task.sprint_id` (LAI-121) and the third of these I have hit: the
server has served `repo` on every `ProjectView` since LAI-108, and the **client
type never declared it**, so nothing in the UI could show a project's repository
even though the column, the API and the data were all there. Declared, four test
fixtures updated.

Worth a general note: **three client types have now been silently behind the
server payload.** A test that diffs the declared client shapes against the
server's view types would have caught all three, and would be cheap.

### Verified

Both themes through the real control: card and footer grounds invert, `PUBLIC`
reads `rgb(17,153,106)` / `rgb(47,208,138)`, repo renders in JetBrains Mono,
three columns down to 1100px then two, then one.

## Review — PM, 2026-08-25

**Accepted.** Rendered with two real projects, one private and one public:
header on `--card` with its divider and a live count, `YOUR PROJECTS` section
rule, visibility chips in the right token pairs, key and slug in mono, Members
and Open board.

**You degraded it exactly as instructed rather than filling the gap.** No
progress bar, no `13/34 done`, no blocked count, no last-activity — those need
LAI-053 and are **absent, not zeroed or faked**. Grepped the rendered page for
`Mira`, `Kellner`, `13/34` and `kvelld.internal`: clean.

That restraint is the whole reason this board can be trusted. A card with a
progress bar reading `0/0` would have looked more finished and been a lie.

They come back as a follow-up when LAI-053 lands.
