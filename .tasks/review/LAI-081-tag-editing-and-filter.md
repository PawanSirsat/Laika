---
id: LAI-081
title: Applying tags, and filtering the board by one
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-079, LAI-056, LAI-066]
discovered-from: LAI-073
status: review
started: 2026-08-25T06:51:45Z
finished: 2026-08-25T07:41:50Z
---

## Goal

LAI-066 renders tag chips. This makes them usable: apply and remove them on a
task, and filter the board by one.

## Acceptance criteria

- [x] Tags are editable in the task detail panel (LAI-056), saved through
      `PATCH /api/v1/tasks/:id`.
- [x] The picker offers the project's existing tags from
      `GET /api/v1/projects/:slug/tags`, **with their usage counts** — a count is
      what stops someone minting `frontend` when `ui` is already on forty tasks.
- [x] A new tag can be typed and applied in one action; the server creates it.
- [x] **The client does not pre-validate the name beyond trimming and
      lower-casing.** The rule lives in the server (D-027) and the server owns it;
      surface its 422 rather than reimplementing the pattern in two places where
      they can drift.
- [x] Filter the board with `?tag=`, in the URL so it survives a reload — the same
      mechanism `?project=` and the sprint filter use.
- [x] A Viewer sees tags and can filter by them, but gets no editing affordance.
- [x] Both themes.

## Notes / context

**Not in scope: renaming and deleting a tag project-wide.** Those are `lead+`
(D-027) and belong on a project settings screen that does not exist yet. The
endpoints will be there from LAI-079 — leave them for that screen rather than
hiding a destructive project-wide action inside a task panel.

---

## Verified on a running instance (builder-b, 2026-08-25T07:41:50Z)

Every criterion driven through the real UI against real data, not reasoned about.

| | |
| --- | --- |
| **Edit in the panel** | Picker sits above Description — tags are what someone opens a task to change. Saves through `PATCH /tasks/:id`. |
| **Existing tags with counts** | Filter reads `Any tag / agent (1) / core (1)`; suggestions are the project's tags this task lacks, **busiest first** — the count is the reason the list exists, so it orders it. |
| **New tag in one action** | Typed `"  Presence  "` → shaped to `presence`, created server-side, applied. One action, padding and capitals absorbed. |
| **No client-side rule** | Typed `"has space"`. The client **sent it** and showed the server's own words back. |
| **`?tag=` filter** | `?tag=core` → exactly `LC-4`, matching `GET /tasks?tag=core`. Survives a fresh load and the control reflects the URL. |
| **Viewer** | A project Viewer sees `agent`, `core`, filters fine, and has **no** add field, add button, remove control or suggestion. |
| **Both themes** | Chip on `--tub` / `--bd` / `--tx2` in both — identical to the card's chip, per D-027. |

## AC4 is the one worth reading

*"The client does not pre-validate the name beyond trimming and lower-casing."*

`normaliseTagInput` trims and lower-cases and does nothing else — it **shapes
what was typed, it does not judge it**. `"has space"` goes to the server, and
what comes back is shown verbatim:

> "has space" is not a valid tag: lowercase letters, digits and hyphens,
> starting with a letter or digit, up to 24 characters

That message is better than anything the client would have written, and it
cannot drift from the rule because it *is* the rule speaking.

**One wrinkle worth knowing:** the server sends **two** shapes of 422. Its own
refusal is the sentence above, written for a person. A schema rejection is
`"Invalid request body"` with the detail in `issues[]` — and showing *that*
headline to someone who typed one word explains nothing. `readableRefusal`
prefers the issue in that case. Both shapes are copied into the test from a live
instance.

## Filed while working

**LAI-224** — a `403` on the event stream renders as *"Can't reach
localhost:3370"*, beside a board correctly saying it is a permission problem.
The two states contradict each other on one screen and the alarming one is
wrong; it also retries for ever against an endpoint that will never succeed.
That is a defect in **LAI-078, which I wrote**, found while setting up a Viewer
for AC6.

## A note on where `readableRefusal` lives

It started inside `TagPicker.tsx` and moved to `api/tags.ts` — not for tidiness,
but because **the test runner cannot import a `.tsx`**: `node --test` strips
types but does not handle JSX, which is why every other test here reads
components as text. Pure logic in a component is therefore logic that cannot be
unit-tested in this repo. Same reasoning that pulled `nextGap` out in LAI-070.
