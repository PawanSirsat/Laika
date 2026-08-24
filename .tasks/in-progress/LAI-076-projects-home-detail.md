---
id: LAI-076
title: Projects home — match design 7a, the full card anatomy
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-058, LAI-060]
discovered-from:
status: in-progress
started: 2026-08-25T06:20:00+05:30
---

## Goal

Match screen **`7a`** in `docs/design/Laika 05-07 - Auth, Setup, Projects.dc.html`.

LAI-058 shipped the working screen — list, create, switch, tombstones. This is
the visual and informational build-out: today a project card carries a name, a
visibility badge and a button; the design's carries the shape of the work.

## Acceptance criteria

- [ ] **Three-column grid**, 13px gap, cards radius 12px with `var(--shadow)`.
- [ ] **Sections**: `YOUR PROJECTS` and `PUBLIC IN THIS ORG`, each a 9.5px/800
      `.09em` eyebrow in `var(--tx3)` with a `var(--bd)` rule running to the edge.
- [ ] Card head: name 14.5px/800 `-.016em`, then the **visibility chip** —
      `PUBLIC` in `var(--grn)`/`var(--grns)`/`var(--grnb)`, `PRIVATE` in
      `var(--tx3)`/`var(--tub)`/`var(--bd)`.
- [ ] **Repo in mono** 10px `var(--tx3)` beneath the name, from `projects.repo`
      (LAI-108 added the column). Omit the line when it is null.
- [ ] Description at 11.5px/500 `var(--tx2)`.
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
- [ ] Both themes.

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
