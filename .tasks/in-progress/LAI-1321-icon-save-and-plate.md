---
id: LAI-1321
title: 'Space icon: held until Save changes, framed before upload, and a logo that stays visible in both themes'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-1311
status: in-progress
started: 2026-11-17T21:00:26Z
---

## Goal

The owner's feedback after icons went live on Ksage (2026-11-18), board card LAIKA-1090,
dispatched by CHIEF to builder session laika-c4:

- On `/spaces/rmb/settings` he uploaded a logo. It saved at once ("Image saved as the
  icon."), but **Save changes stayed disabled**, so he thought nothing had saved, and typed a
  repository name only to make Save work.
- His logo is a white figure on a black square, which **disappears on the dark theme**.
- He wants to **adjust the logo in its frame** before it is used.

## Contract

**1. Icon changes are held until Save changes**, like every other General field.
- Picking an image uploads it to the store straight away (ask + PUT) and previews it marked
  *Not saved yet*; Save changes becomes enabled. Choose emoji and Remove are held the same
  way.
- Save changes applies the held change — complete for an image, `PATCH icon_emoji` for an
  emoji, `DELETE` for Remove — together with the `PATCH` of any other changed fields.
  Discard drops it. Leaving with a held change warns, through the guard the other fields
  use.
- An asked-for icon upload has **no completion deadline** on the server (D-152: nothing is
  stored between ask and complete; only the presigned `PUT` is ten minutes long, and the
  `PUT` happens when the image is picked), so a held image stays completable until Save.
  An image uploaded then discarded stays in the store, the limit D-152 records.

**2. An adaptive plate for image marks**, in `ProjectMark`, every size, both themes.
- When an image loads it is drawn to a 32×32 canvas (same-origin, so readable): whether
  it has meaningful transparency, and the mean luminance of its visible pixels. Cached in
  memory per image URL (the URL carries `?v=`).
- Opaque dark → in dark theme, a light 1px ring. Opaque light → in light theme, a dark
  1px ring. Transparent with dark content → in dark theme, a light plate behind it.
  Transparent with light content → in light theme, a dark plate. Mid-tone or colourful →
  nothing. Tokens only, never a raw colour.
- The decision is a pure function, unit-tested over fixed pixel arrays for each case.
- No ring before the image is measured (no flash). No new dependency, no schema change.

**3. Adjust the logo in its frame.**
- Picking an image opens a square frame editor (canvas + pointer events, no dependency):
  drag to position; a zoom slider (and wheel or pinch) from fitting the whole image up to
  4×; Reset; a background where the logo does not fill the frame — transparent, white,
  black, or the space's colour.
- Keyboard: arrows move the image, `+`/`-` zoom, focus visible.
- A live preview of the mark at sidebar size and at settings size, in the current theme.
- *Use this* crops on the client to a square of at most 512×512, PNG or WebP whichever is
  smaller, at most 1 MiB, then uploads it and holds it until Save changes (item 1).
  *Cancel* leaves the current icon untouched. The plate (item 2) is measured on the
  cropped image.

**Docs.** D-152 and SPEC §11.4.2.1 stop saying the icon saves at once.

## Acceptance criteria

- [ ] Save changes is enabled after picking an image, choosing an emoji or pressing Remove;
      nothing changes on the server until it is pressed; Discard drops the change.
- [ ] Browser tests: a held image is not on the server before Save and is after; Discard;
      the leave-page warning.
- [ ] The ring/plate tone is a pure function with unit tests over fixed pixel arrays — the
      four cases and a mid-tone logo that gets nothing.
- [ ] Browser test: pick an image larger than the frame, zoom and drag, Use this, Save; the
      stored object is square and its corner pixel matches the chosen background.
- [ ] Keyboard-only adjustment tested.
- [ ] Screenshots at 1440 and 390, light and dark: the Icon row with a black-square logo, a
      white transparent logo and a colourful one; and the frame editor.
- [ ] D-152 and SPEC §11.4.2.1 wording updated.
- [ ] Web guards (loading-sweep, board-bands, structure mirror, view-type-drift) green as
      single files; CI green on the PR.

## Notes / context

- Belka: single test files only; CI runs the full gate.
- Release is CHIEF's: the builder stops at a green PR, this file in review and its log.
