---
id: LAI-411
title: Badge agent-authored actions in the UI
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-31T07:35:23Z
---

## Goal

SPEC §7 says an agent's work is badged so a human can tell it apart: "same
`activity` row (with `actor_kind: agent`, **which is how the UI badges it**)".
Nothing in the UI does.

This is buildable **now**, before any MCP tool exists — `ActivityView` already
carries `actor_kind: 'user' | 'agent' | 'system'`
(`server/web/src/api/activity.ts:24`). Seed a row and render against it.

## Acceptance criteria

- [ ] Wherever activity is rendered — the feed, the task detail, the dashboard —
      an `actor_kind: 'agent'` row is visually distinguishable from a `'user'`
      row, and `'system'` from both.
- [ ] The badge is built from **design tokens in `docs/design/README.md`**,
      verbatim. Do not introduce a new colour. If no existing token fits, stop
      and file a task for the owner — you may not decide a token, and neither
      may CHIEF (D-020).
- [ ] The distinction survives in **both themes** and is not carried by colour
      alone — a shape, an icon or a label as well, so it is legible to someone
      who cannot separate the two hues.
- [ ] The badge says **which** agent where the data allows it. `actor_id` is the
      person the token belongs to; the token is what distinguishes the agent.
      If `ActivityView` does not carry enough to name it, **do not guess and do
      not invent a label** — render the honest "agent" and file a task against
      `server` for the field. LAI-093 (backlog) is the closely related one; check
      it before filing a duplicate.
- [ ] `CommentView` carries no `actor_kind` — `server/web/src/api/comments.ts:48`
      records this and LAI-056 AC4 names it. **Comments are out of scope here**;
      say so on the task rather than half-solving it.
- [ ] Rendered in a real browser, both themes, against seeded agent rows.
- [ ] Full gate green.

## Notes

No new dependencies. No demo module — the endpoint exists, and a demo module
beside a real endpoint is a defect (D-032).

Verify against a seeded row before you conclude anything is missing. If a probe
says a field is absent, first prove it can see a field that is present.
