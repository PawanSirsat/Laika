---
id: LAI-075
title: First boot — match design 6a, the two-column layout
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-062]
discovered-from:
status: in-progress
started: 2026-08-25T00:45:00+05:30
---

## Goal

Match screen **`6a`** in `docs/design/Laika 05-07 - Auth, Setup, Projects.dc.html`.

**This is the screen the M1 exit test uses and the first thing a self-hoster
ever sees.** Today it is a single centred card; the design is a two-column page
whose left rail explains what is about to happen.

## Acceptance criteria

- [ ] **Left rail, 420px, fixed**: ground `var(--tx)`, text `var(--page)` — an
      inverted panel, in both themes.
- [ ] Rail carries the Laika mark and wordmark, then the headline **"This
      instance has no owner yet."** at 25px/800, `-.028em`, then the sub-line at
      13px/400 with `opacity:.72`.
- [ ] **The numbered 1–2–3 list of what happens next**, each with a 19px circular
      badge on `rgba(255,255,255,.14)`:
      1. Owner account and org name — this page.
      2. Add an AI provider key when you want agents to run. Skippable.
      3. Invite people and set their roles from Org settings.
      **Check each line is still true before shipping it** — item 3 depends on
      invites existing (LAI-071).
- [ ] **System status pinned to the rail's bottom**, above a
      `rgba(255,255,255,.14)` rule, mono 10.5px with a status dot each.
      **SQLite, never Postgres** (D-001) — the mockup's `postgres 16 · connected`
      is the headline artifact in `docs/design/README.md`.
- [ ] Right column: `FIRST BOOT` eyebrow (9.5px/800, `.09em`) beside the real
      instance host in mono.
- [ ] Sections **Owner account** and **Organisation**, each a 13px/800 heading
      with a `var(--bd)` rule running to the edge. Owner account carries a
      **`FULL CONTROL`** chip in `var(--pur)` on `var(--purs)`.
- [ ] Fields sit in a **two-column grid**, 40px tall, radius 9px, ground
      `var(--card)`. Keep the existing password strength meter and Matches
      confirmation — both already exist and both appear in the design.
- [ ] Footer: **Create instance** (42px, `var(--acc)`) beside the explainer
      *"Takes about two seconds. This page never appears again…"*.
- [ ] Both themes.

## Not in this task

**The "Track presence" toggle.** The design shows it here, but presence is an org
setting with no endpoint (LAI-207 covers the server side) and presence itself is
M5. Leave it out rather than shipping a control that saves nowhere.

**`v0.4.2` and `migrations 41/41`** are fixtures — see the README. Show the real
migration state if LAI-206 has landed; otherwise omit those lines rather than
invent numbers.
