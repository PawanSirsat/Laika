---
id: LAI-791
title: 'Draft my time works only while local activity sharing is on; D-088 item 5 gives it switches of its own'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-787]
discovered-from: LAI-787
status: backlog
---

## Goal

A person can turn on *Draft my time* without also sharing local activity
counts, as D-088 item 5's two switches mean.

## What LAI-787 found

The drafter reads what the collector already holds (`events.log`, the token
reader's `usage-days/`, marks, the hook's `sessions`), and the collector holds
nothing unless D-079's sharing is on: the hook writes only while
`state.json` says `"collect":true`, and a sync that finds sharing off rotates
everything away (`stopCollecting`). So today drafting needs the
organisation's Developer insights, the person's Share local activity, the
organisation's Time = drafts and the person's Draft my time — four switches
where D-088 named two. My day says the drafts come from `laika activity on`.

## Acceptance criteria

- [ ] The hook and the token reader collect locally while either consent is
      on; the snapshot and usage reports still send only under D-079's two,
      and a later opt-in to sharing counts nothing from before it (`since`).
- [ ] Turning sharing off no longer deletes what drafting still needs, and
      turning drafting off deletes nothing sharing needs.
- [ ] `laika activity status` says which consent is collecting.
- [ ] Gate: test, lint, format exit 0.
