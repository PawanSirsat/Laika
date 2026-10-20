---
id: LAI-828
title: 'Text is too small across the web app: raise the type scale to Jira''s (body 14px, reading text 16px, nothing under 12px)'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-827
status: in-progress
started: 2026-10-20T21:30:56Z
---

## Goal

Text across Laika is as easy to read as Jira's. Owner, 2026-10-21:

> *"the text size is also very small, we need to increase it everywhere …
> find where the text size is small all over the web app and increase that; I
> want the same as the Jira board"*

Today `server/web/src/styles/type.css` sets body text at 13px
(0.8125rem) and many labels at 9.5–12px (0.59375–0.75rem).

Made on the owner's direct instruction.

## Target scale (Atlassian Design System's published sizes, which Jira uses)

| Role | Size / line-height |
|---|---|
| Body (default UI text, table cells, card titles, form fields) | 14px / 20px |
| Reading text (description, acceptance, comments, docs-like content) | 16px / 24px |
| Small (secondary lines, meta, timestamps, chips) | 12px / 16px |
| Smallest allowed (tiny badges, counters) | 11px, and only where 12px truly cannot fit |
| Headings | page title 24px / 28px; section 20px / 24px; card/panel heading 16px / 20px |
| Task panel title | 24px / 28px |

## Acceptance criteria

- [ ] **Census first.** List every `font-size` in `server/web/src` (no `head`
      on the grep) with what it is used for, and the new value. Commit the
      census in the task file. Map them onto the roles above.
- [ ] **Tokens, not one-offs.** Sizes come from type tokens in
      `server/web/src/styles/type.css`; component CSS uses the tokens. Remove
      hard-coded sizes where a token fits.
- [ ] **Nothing below 12px** except the listed tiny badges/counters at 11px;
      no 9.5–10.5px text remains anywhere.
- [ ] **Layouts still fit.** Board columns, the Board toolbar (search box
      stays usable at 920px and 1024px with the sidebar folded or open), the
      List table, Timeline, Dashboard, Capacity, Insights, My day, the task
      panel, Organisation, Developer access and Connect: no overflow, no
      clipped text, no horizontal page scroll at 1440, 1024, 920 and 390 in
      light and dark. Existing layout tests stay green; adjust a measured
      width in a test only when the new size makes the old number wrong, and
      say why in the commit.
- [ ] **Both themes, both sidebar states,** screenshots before and after of
      every screen above at 1440 and 390.
- [ ] **`docs/design/` is not touched** (D-020); the owner's instruction here
      overrides the mockup's sizes in the app only. Record the new scale in
      SPEC's design-tokens section and as a decision.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Do this after LAI-817 and LAI-818 merge (they are editing Dashboard and
  Capacity now), so their screens are measured as shipped.
- LAI-827's reading view uses the "reading text" token defined here.
