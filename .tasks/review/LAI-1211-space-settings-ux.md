---
id: LAI-1211
title: A deeper UX pass on Space settings, every tab
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1204]
status: review
started: 2026-11-12T09:00:00Z
finished: 2026-11-12T14:45:00Z
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

- [x] Page: a clear header (name, key chip, colour), the existing tab component
      for section navigation, each tab as titled groups with one-line
      explanations and the #331 Field row alignment.
- [x] General: live validation of name, key and repository; the consequences of
      a key change explained before saving; the colour picker named and
      keyboard-operable as a radio group; the repository field with a format
      hint (a visit link is **not** drawn: the API stores `owner/name` with no
      host — see Delivered); Save with dirty state, SaveStatus and the
      unsaved-changes guard (LAI-1129).
- [x] Members: searchable list (avatar, name, email, role), filtered and empty
      states, add from the organisation's people, inline role change and removal
      with result feedback, self protections explained.
- [x] Access: visibility as radio cards saying who can see and join;
      hand-off policy explained; each change's effect said.
- [x] Danger: separated; archive consequences and reversibility explained;
      typed confirmation with the space key; the result and where to restore.
- [x] All: icon-only controls named, loading and error-with-Retry states,
      390 single column with a sticky save bar, 768/1440, keyboard and screen
      reader, both themes, reduced motion.
- [x] Playwright per tab, each key behaviour mutated once and seen red;
      before/after screenshots in `.polly/screenshots/space-settings/`.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
fonts/CDNs, colours only in `theme.css`): `impeccable` (critique),
`emil-design-eng` (feedback, transitions, hit areas), `break-ui` (long names,
200 members, long repository values).

Builds on what the merge train already brought to the base: LAI-1129's
`SaveStatus`, `InlineConfirm` and unsaved-changes guard (#288), and the shared
tabs/tooltip (#318). Neither is duplicated.

## Delivered (LAI-1211)

Critique: `.polly/specs/space-settings-critique.md` (28/40 before; single-context
— the brief forbids helper agents and the `impeccable` detector binary is not
installed). Screenshots: `.polly/screenshots/space-settings/{before,after}/`,
admin × dark/light × 1440/390 per tab, a reader per tab, and a `break-ui` worst
case (82-character name, 72-character repository, 200 members).

- **Page**: key chip + truncated repository; name clamped to two lines; Retry on
  a failed load; *Open board* in the back bar at ≤640px.
- **General**: `generalIssues` mirrors the server's rules (name 1–120, Prefix
  `^[A-Za-z][A-Za-z0-9]{1,7}$`, `assertRepoShape`) from the first blur; Save
  refuses with focus on the first problem; key-change note before saving;
  *Use owner/name* for a pasted link; named colours with arrow keys; sticky save
  bar with *Unsaved changes* / *Fix N fields*.
- **Members**: filter + no-match state, role counts, toast on every role
  change, confirm before demoting yourself, own row offers Leave, ellipsis.
- **Access**: radio dot and keys on visibility; *Right now: …* effect; hand-off
  policy summary.
- **Danger**: consequences, typed key, Escape backs out, result + *Spaces ›
  Archived* link.

Not done, needs the server: a repository visit/test link (no host on
`Project`); join requests (LAI-980); typed delete (LAI-979). Not this task: B13
`/members` retirement.

Outside the brief's file list, flagged: `api/use-members.ts` (`setRole` returns
whether it saved) and `test/components/state-kit.test.ts:111` (one-line lint
fix; red on the base `946f9c4e`).
