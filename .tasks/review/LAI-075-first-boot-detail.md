---
id: LAI-075
title: First boot — match design 6a, the two-column layout
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-062]
discovered-from:
status: review
started: 2026-08-25T00:45:00+05:30
finished: 2026-08-25T01:30:00+05:30
---

## Goal

Match screen **`6a`** in `docs/design/Laika 05-07 - Auth, Setup, Projects.dc.html`.

**This is the screen the M1 exit test uses and the first thing a self-hoster
ever sees.** Today it is a single centred card; the design is a two-column page
whose left rail explains what is about to happen.

## Acceptance criteria

- [x] **Left rail, 420px, fixed**: ground `var(--tx)`, text `var(--page)` — an
      inverted panel, in both themes.
- [x] Rail carries the Laika mark and wordmark, then the headline **"This
      instance has no owner yet."** at 25px/800, `-.028em`, then the sub-line at
      13px/400 with `opacity:.72`.
- [x] **The numbered 1–2–3 list of what happens next**, each with a 19px circular
      badge on `rgba(255,255,255,.14)`:
      1. Owner account and org name — this page.
      2. Add an AI provider key when you want agents to run. Skippable.
      3. Invite people and set their roles from Org settings.
      **Check each line is still true before shipping it** — item 3 depends on
      invites existing (LAI-071).
- [x] **System status pinned to the rail's bottom**, above a
      `rgba(255,255,255,.14)` rule, mono 10.5px with a status dot each.
      **SQLite, never Postgres** (D-001) — the mockup's `postgres 16 · connected`
      is the headline artifact in `docs/design/README.md`.
- [x] Right column: `FIRST BOOT` eyebrow (9.5px/800, `.09em`) beside the real
      instance host in mono.
- [x] Sections **Owner account** and **Organisation**, each a 13px/800 heading
      with a `var(--bd)` rule running to the edge. Owner account carries a
      **`FULL CONTROL`** chip in `var(--pur)` on `var(--purs)`.
- [x] Fields sit in a **two-column grid**, 40px tall, radius 9px, ground
      `var(--card)`. Keep the existing password strength meter and Matches
      confirmation — both already exist and both appear in the design.
- [x] Footer: **Create instance** (42px, `var(--acc)`) beside the explainer
      *"Takes about two seconds. This page never appears again…"*.
- [x] Both themes.

## Not in this task

**The "Track presence" toggle.** The design shows it here, but presence is an org
setting with no endpoint (LAI-207 covers the server side) and presence itself is
M5. Leave it out rather than shipping a control that saves nowhere.

**`v0.4.2` and `migrations 41/41`** are fixtures — see the README. Show the real
migration state if LAI-206 has landed; otherwise omit those lines rather than
invent numbers.

## Notes at review — builder-b

### Three lines in the design are not true, and I did not ship them

**Step 3 — "Invite people and set their roles from Org settings."** There is no
invites API (LAI-071) and no Org settings screen. On the first screen a
self-hoster ever sees, that sentence instructs them to do something impossible.
Replaced with **"Create your first project and start tracking work."**, which is
true today. The original belongs here the moment LAI-071 lands — **please check
the wording is yours**, since this is copy and copy is not mine to invent.

The closing line still says new people arrive by invite. That one stays: it
describes how the instance works (D-004), rather than telling the reader to go
somewhere that does not exist.

**`migrations 41/41 applied` and `SMTP not configured`** — no endpoint reports
either (LAI-206 is still open), so both lines are absent rather than invented.

**`postgres 16 · connected`** — the panel reads `sqlite · wal`. The database line
is the one line shown unconditionally, and it needs no endpoint: `index.ts` opens
the database and runs migrations **before** it binds the port, so a process
serving this page has already done both. It reports something the page's own
existence proves.

**`v0.4.2`** is a fixture, but a real version does exist — `/health` — so the
chip shows `v0.1.0`. It is Laika's version, not the project's.

### AC7's premise was half wrong

"Keep the existing password strength meter and **Matches** confirmation — both
already exist." The strength meter did. **The Matches confirmation did not exist
anywhere in the codebase.** The confirm field only ever showed an error on
mismatch, never a positive confirmation. Built it: `Matches` appears under the
field once the two are non-empty and equal.

### Two things the design cannot do as drawn, and what I did instead

1. **The rail's white overlays only work while the rail is dark.** Design `6a`
   uses `rgba(255,255,255,.14)` for the step badges, the version chip's border
   and the status hairline. The rail is `background: var(--tx)`, which **inverts
   with the theme** — dark panel in light, light panel in dark. In dark theme
   every one of those overlays vanished: no badge circles, no chip border, no
   rule above the status. Mixed from `currentColor` instead, so it is the
   design's value in light and the mirror of it in dark. No new colour (D-020).
   `color-scheme` is flipped on the rail too, so the native theme radios paint
   for the ground they are actually on.
2. **The 30px mark is a tile with a glyph inside it.** `Brand` has no glyph, so
   scaled up and filled flat it read as a missing image. Kept the accent mark
   at its usual size; it is legible on both inverted grounds. A real glyph is a
   design asset decision, not something to improvise here.

### One structural change, and why it is not the mistake LAI-062 fixed

First boot is a **full-page** design: the rail runs the height of the page. The
shell's pre-auth header put a second Laika wordmark above it and a bar across the
top the design does not have. Added `ownsChrome` to the route table: a route that
draws its own mark, wordmark **and** theme control gets no shell header.

This is route-keyed, which LAI-062 argued against — but the objection there was
that a route *list* silently defaults new routes into the wrong state. This
defaults to **absent**, meaning a new route gets the shell's chrome rather than
losing it, and a test asserts that anything setting the flag renders both parts
itself. Failure mode is a duplicate header, not a screen with no way to change
theme. The nav gate is still keyed on the session and untouched.

### Verified live, end to end

On a throwaway instance with an empty database (`setup_required: true`), filled
and submitted: owner `Grace Hopper` created as `org_role: owner`, org created,
first project created with a derived prefix (`Laika Core` → `LC`),
`setup_required` now `false`, session established, landed on `/board` with the
sidebar — the rail gone. Strength meter goes weak → strong with its guidance;
`Matches` appears only when the two passwords agree.

Both themes driven through the real radios: rail ground and text invert, the
overlays mirror instead of disappearing, `color-scheme` flips with them.
