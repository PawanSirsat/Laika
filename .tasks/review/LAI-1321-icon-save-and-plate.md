---
id: LAI-1321
title: 'Space icon: held until Save changes, framed before upload, and a logo that stays visible in both themes'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-1311
status: review
started: 2026-11-17T21:00:26Z
finished: 2026-11-17T21:33:22Z
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

- [x] Save changes is enabled after picking an image, choosing an emoji or pressing Remove;
      nothing changes on the server until it is pressed; Discard drops the change.
- [x] Browser tests: a held image is not on the server before Save and is after; Discard;
      the leave-page warning.
- [x] The ring/plate tone is a pure function with unit tests over fixed pixel arrays — the
      four cases and a mid-tone logo that gets nothing.
- [x] Browser test: pick an image larger than the frame, zoom and drag, Use this, Save; the
      stored object is square and its corner pixel matches the chosen background.
- [x] Keyboard-only adjustment tested.
- [x] Screenshots at 1440 and 390, light and dark: the Icon row with a black-square logo, a
      white transparent logo and a colourful one; and the frame editor.
- [x] D-152 and SPEC §11.4.2.1 wording updated.
- [x] Web guards (loading-sweep, board-bands, structure mirror, view-type-drift) green as
      single files; CI green on the PR.

## Notes / context

- Belka: single test files only; CI runs the full gate.
- Release is CHIEF's: the builder stops at a green PR, this file in review and its log.

## Build notes (LAI-1321, CHIEF builder laika-c4, Belka)

PR #368, branch `LAI-1321-icon-save-and-plate`, CI green at `ac3c34c64` (every job).
Every criterion above holds. Choices, each also in the PR body and the log:

- **The emoji is `PATCH icon_emoji`**, not a `PUT` (the brief's word): that is the route
  D-152 built, and it lets Save send the emoji and the changed fields as one request.
- **No completion deadline exists**, so none is handled: icon ask/complete is stateless and
  the presigned `PUT` is spent when *Use this* is pressed.
- **The preview is a `data:` URL**: `img-src` has no `blob:`.
- **The Icon row needs the right to edit settings too**: Save, and the emoji's `PATCH`, are
  `project.settings.edit`'s.
- **D-152 is unchanged**: it never said "saves at once"; SPEC §11.4.2.1 did, and is rewritten.
- **Opaque images are judged at their edge**, transparent ones over their visible pixels,
  each over the square `object-fit: cover` shows — the owner's black-square logo is a dark
  tile at its edge whatever its figure.
- **"In dark" covers the black theme too**: `:root:not([data-theme='light'])`.

## Review round 1 (CHIEF, 2026-11-18) — response

All ten items made; the task stays in review. Each must-fix test was checked by removing
its fix: both go red.

1. **A part-saved form is reported as saved** (`GeneralTab.tsx`): the `PATCH`'s answer
   is handed to the screen the moment it lands, so a refused complete or removal leaves the
   fields saved; only the icon stays held, said as *Saved. The icon was not saved: … Try
   Save again.* Browser tests for a refused complete and a refused `DELETE`: the server
   and the form both have the new name, the icon is still held, and Discard drops only it.
2. **Save waits for an image to finish uploading**: `staging` is lifted to General, Save
   (and Discard) are off meanwhile with the reason given; only what was sent is cleared
   (`setHeldIcon(h => h === held ? null : h)`); `onHold` never resets the status while a
   save runs. Browser test: Save pressed during a 1.5 s upload sends nothing; afterwards
   the image completed is the one staged.
3. **No `data:` URL in the plate cache**: a preview's measure lives in its mark's state.
4. **40-megapixel cap, read from the header before decoding** (`imageSize`: PNG IHDR,
   JPEG frame header, WebP VP8/VP8L/VP8X); unit tests per format, a browser test with a
   10 000 × 5 000 PNG header.
5. **Colour exempts nothing**: exempting colourful images only in the mid band is the same
   as no exemption (the mid band gets nothing anyway), so `colourful` is gone and luminance
   alone decides. Navy `#001f5b` → ring in dark; pastel `#ffe5f1` → ring in light; red,
   blue, yellow ringed; orange and teal mid-tones nothing.
6. **A save answer for another space is ignored** by the screen (`currentSlug` ref).
7. **Drag scaled** by `FRAME_PX / clientWidth`; browser test with the box at half size.
8. **The board's limit**: `maxBytes = min(1 MiB, attachments.max_bytes)`; `exportPlan`
   tiers — PNG and WebP 0.92, then WebP 0.8, 0.6, then three-quarters the size, down to
   64 — first tier that fits wins; *Made smaller to fit this board's file limit* when it
   had to. Browser test with a 12 000-byte limit and an image of noise.
9. **Server comment** (`project-icons.ts`): staged-and-never-completed images are normal
   now; the sweep is CHIEF's to file.
10. **Black theme ring asserted**; **a polite live region** says the zoom and offset as
    the frame moves (`describePlacement`, unit-tested and asserted in the keyboard test).

Also: SPEC §11.4.2.1 rewritten to match (header check, board limit, the save order).
