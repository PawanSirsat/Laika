---
id: LAI-074
title: Login screen — match design 5a
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-062]
discovered-from:
status: done
started: 2026-08-25T02:30:00+05:30
finished: 2026-08-25T03:05:00+05:30
reviewed: 2026-08-25T13:00:00+05:30
---

## Goal

Match screen **`5a`** in `docs/design/Laika 05-07 - Auth, Setup, Projects.dc.html`
— the detailed source for this screen, and the only one. The prototype
compresses login into a single nav entry.

## Acceptance criteria

- [x] One centred card on `var(--page)`: `var(--card)`, `1px solid var(--bd)`,
      radius **14px**, `var(--shadow)`, padding `26px 26px 22px`.
- [x] Laika mark — 30px, radius 9px, `var(--tx)` ground with the stroke in
      `var(--card)` — beside the wordmark at 17px/800, letter-spacing `-.02em`.
- [x] Headline **"Sign in to your instance"**, 19px/800, `-.022em`.
- [x] **The instance host is shown**, mono 10.5px in `var(--tx2)` with a green
      padlock. This is self-hosted software and people run several instances —
      the design calls it out for that reason. **Use the real host, not
      `laika.kvelld.internal`**, which is a fixture.
- [x] Fields 38px tall, radius 9px, `1px solid var(--bd2)`, ground `var(--page)`;
      labels 10.5px/700 in `var(--tx2)`.
- [x] Password has a **Show/Hide** toggle at 10.5px/700 in `var(--tx3)`, and the
      value renders in JetBrains Mono.
- [x] **"Keep me signed in on this device"** checkbox, 15px box, radius 4px.
- [x] Primary **Sign in**: 40px, radius 10px, `var(--acc)`, white, 13.5px/700.
- [x] Footer: *"No account? Only an Owner or Admin can invite you. Ask them for a
      link."* — 11px/500 `var(--tx3)`. It is the honest consequence of D-004.
- [x] Both themes.

## Do NOT reproduce

- **"Forgot?"** — no password-reset endpoint exists (SPEC §6.4).
- **"OR" divider and "Email me a sign-in link"** — magic-link auth is not
  specified and needs SMTP.

Both are already listed in `docs/design/README.md` as artifacts. They are the
most prominent things on the mockup's card, so leaving them out will look like an
omission — it is not.

## Notes / context

**Take the layout and the type scale, not the markup.** The mockup is inline-styled
output from a foreign runtime.

LAI-062 first: this screen must not render the app nav.

## Notes at review — builder-b

### Measured, not eyeballed

Every value in the criteria was read back from the built page with
`getComputedStyle`:

| | asked | measured |
| --- | --- | --- |
| card radius / padding | 14px, 26/26/22 | `14px`, `26px 26px 22px` |
| mark | 30px, radius 9px, `--tx` ground | `30px`, `9px`, `rgb(23,26,33)` |
| glyph stroke | `--card` | `rgb(255,255,255)` light, `rgb(27,27,32)` dark |
| headline | 19px/800, `-.022em` | `19px`, `800`, `-0.418px` |
| host | mono 10.5px, green padlock | JetBrains Mono, `rgb(17,153,106)` |
| fields | 38px, radius 9px, `--bd2`, `--page` | `38px`, `9px` |
| password value | JetBrains Mono | JetBrains Mono |
| checkbox | 15px, radius 4px | `15px`, `4px` |
| Sign in | 40px, radius 10px, `--acc`, 13.5px/700 | `40px`, `10px`, `rgb(47,107,255)`, `13.5px` |

`--radius-md` is 8px, so the 9px and 14px and 10px radii are written as literal
rems: the design's auth shapes are one-offs, not members of the radius scale.
Colour values are all tokens (D-020).

### The mark needed a real glyph, so `Brand` gained a variant

AC2 names the mark's ground **and its stroke**, which only means something if
something is stroked. `Brand` had no glyph — in LAI-075 I kept the plain dot for
exactly that reason. It now takes `variant="tile"`: the sidebar keeps its accent
dot, the auth card gets the 30px tile with the glyph drawn inline. Inline SVG
rather than an asset, because the CSP is `script-src 'self'` with no external
hosts and a mark that needs a network request is a mark that can fail to appear.

**First boot's rail could now use the real mark too** — `6a` draws the same tile
— but LAI-075 is accepted and this is not its task. One line if you want it.

### The checkbox is a custom control, because the design's is

`5a` draws a 15px box with a 4px radius and a stroked tick. `accent-color` on a
native box cannot produce that, so this one is `appearance: none` with the tick
as a **mask** — a data-URI image would have to hardcode its stroke colour, which
is `--tx2` and therefore different per theme; masking paints it with
`background-color` so it follows the token. Verified in both.

**Scoped to this card**, not applied app-wide: restyling every checkbox is a
decision for whoever owns the form language, not a side effect of a login task.

### A silent no-op I nearly shipped

My first pass styled `.checkbox-box`. **No such class exists** — `Checkbox`
renders `checkbox-input` and `checkbox-label`. The rule matched nothing, so AC7
would have been unticked-in-fact while looking done. Found by listing the
components' real class names rather than assuming them. Worth the habit: CSS
that matches nothing fails silently and looks identical to CSS that works.

### The three prominent absences

No **Forgot?**, no **OR** divider, no **Email me a sign-in link** — asserted
absent from the rendered card, not just from the source. They are the most
visible things on the mockup, so their absence reads as an omission; it is not.
There is no password-reset endpoint and magic-link needs SMTP.

### Verified live

Wrong password → the failure state renders and the form stays on `/login`.
`Show` reveals the value in mono and the button reads `Hide password`. The
keep-signed-in box ticks, and it is a **real control** — `keepSignedIn` reaches
better-auth as `rememberMe` through `api/auth.ts`, so it is not the presence
toggle again. Correct credentials land on `/board` with `/me` answering 200.
Both themes driven through the real radios.

## Review — PM, 2026-08-25

**Accepted.** Verified against the built page, both themes, and the three screens
the owner sees first are now all done.

```
absent "Forgot?"                 true
absent "Email me a sign-in link" true
absent "OR"                      true
host line present                true
keep-signed-in present           true
wrong password -> stays on /login true
```

Asserting the excluded items absent **from the rendered card** rather than from
the source is the right test: a stylesheet can hide what a grep still finds.

**Your three points:**

**1. `variant="tile"` is right, and yes — take it to first boot.** AC2 names the
mark's ground *and its stroke*, which is meaningless without a glyph, and `6a`
draws the same tile. LAI-075 is accepted, so file a one-line follow-up rather
than reopening it.

**2. Custom checkbox, scoped to the card — correct.** `accent-color` cannot draw
a 15px box with a 4px radius and a stroked tick, and restyling every checkbox in
the app is a form-language decision. Not taking it unasked is the right instinct.

**3. The near-miss is the most useful thing in this message.** Styling
`.checkbox-box` when the component renders `checkbox-input` means the rule
matched nothing — AC7 unmet in fact while the screenshot looked correct.
**CSS that matches nothing fails silently and is indistinguishable from CSS that
works**, which is the same shape as the undefined-token bug. Your conclusion is
right and I have acted on it: `/review` already compares rendered values, and
that is exactly why it catches this class where reading the stylesheet cannot.

### On the LAI-082 defect you found and fixed

**You were right to push the fix and right to flag it, and I should have caught
it.** Hiding the unshipped routes emptied `SETTINGS` and the sidebar still drew
the heading — a smaller version of the lie the task existed to remove. I accepted
and merged LAI-082 without noticing, because I checked the *links* and not the
*group headings*.

Verified fixed: `WORK(4) REVIEW(1)`, no orphan heading. The guard fails if the
filter goes.

Telling me rather than hoping I would read the diff is what made this cheap. It
also says something about my review: I verified the thing the task named and not
the thing next to it.
