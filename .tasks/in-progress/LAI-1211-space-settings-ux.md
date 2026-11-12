---
id: LAI-1211
title: A deeper UX pass on Space settings, every tab
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1204]
status: in-progress
started: 2026-11-12T09:00:00Z
---

## Goal

The owner: "/spaces/mobile/settings — improve the UX." A per-tab critique
(`.polly/specs/space-settings-critique.md`) and the fixes it plans, on
`/spaces/:slug/settings` — General, Members, Access and Danger — stacked on
LAI-1204's Button/Field/Icon primitives (PR #331).

Scope is `server/web/` only, UI only: no API change, no new dependency, no
`theme.css` value change, the existing public API, permissions as the server
answers them (a reader sees every value, read-only, with the reason).

## Acceptance criteria

- [ ] Page: a clear header (name, key chip, colour), the existing tab component
      for section navigation, each tab as titled groups with one-line
      explanations and the #331 Field row alignment.
- [ ] General: live validation of name, key and repository; the consequences of
      a key change explained before saving; the colour picker named and
      keyboard-operable as a radio group; the repository field with a format
      hint and a visit link; Save with dirty state, SaveStatus and the
      unsaved-changes guard (LAI-1129).
- [ ] Members: searchable list (avatar, name, email, role), filtered and empty
      states, add from the organisation's people, inline role change and removal
      with result feedback, self protections explained.
- [ ] Access: visibility as radio cards saying who can see and join;
      hand-off policy explained; each change's effect said.
- [ ] Danger: separated; archive consequences and reversibility explained;
      typed confirmation with the space key; the result and where to restore.
- [ ] All: icon-only controls named, loading and error-with-Retry states,
      390 single column with a sticky save bar, 768/1440, keyboard and screen
      reader, both themes, reduced motion.
- [ ] Playwright per tab, each key behaviour mutated once and seen red;
      before/after screenshots in `.polly/screenshots/space-settings/`.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
fonts/CDNs, colours only in `theme.css`): `impeccable` (critique),
`emil-design-eng` (feedback, transitions, hit areas), `break-ui` (long names,
200 members, long repository values).

Builds on what the merge train already brought to the base: LAI-1129's
`SaveStatus`, `InlineConfirm` and unsaved-changes guard (#288), and the shared
tabs/tooltip (#318). Neither is duplicated.
