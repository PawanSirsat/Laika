---
id: LAI-964
title: 'The web and CLI still offer a personal opt-out for local activity; after D-102 (amended) they must say the organisation collects it'
area: web
assignee: shell
priority: p1
depends-on: [LAI-963]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-22T14:16:30Z
started: 2026-10-22T14:00:51Z
---

## Goal

D-102 amendment, client half (SHELL owns `server/web/` and `cli/`).

## Acceptance criteria

- [x] Developer access and the Connect wizard: the *Share local activity*
      switch is replaced by a plain notice when the org switch is on — *"Your
      organisation collects your local activity: <what>. Owners and admins
      can see it, and you can see who looked."* — with links to the person's
      own data preview and to *Who looked at my time* (when LAI-959 lands; a
      link to My day until then). Org switch off: unchanged wording.
- [x] CLI: `laika activity on` / `status` / sync no longer require or check
      the personal switch; when the org switch is on they print the same
      notice once; when off, they say so as today. Tests in `cli/`.
- [x] Drift checks (view-type, endpoint coverage, CLI/server shapes) green.
- [x] Light/dark, 1440/390. Gate exit 0 on a branch with LAI-963 merged.

## Notes (SHELL, at review)

- **The notice, word for word** (web and CLI share it; each package's test
  asserts it): *"Your organisation collects your local activity: per-day
  counts of your prompts, agent sessions and commits, and your agents’ token
  counts. Owners and admins can see it, and you can see who looked."*
- Web, after it: *"See what the board holds for you"* (`#share-held`, the
  preview further down the same component), *"and your own time on My day"*
  (`/my-day`, standing in for LAI-959's *Who looked*). Owner/admin: *"You can
  turn Developer insights off in Organisation."* (linked); member: *"Only an
  owner or admin can turn it off."*
- CLI, after it: `What the board holds for you: <board>/developer · your own
  time: <board>/my-day`. `on` prints it after *Local activity is on*,
  `status` after the *Collection* line, `sync` after *Sent.* — once each, and
  only while the org switch is on. A mutation that printed it twice on `sync`
  turned that test red.
- The scope radios stay: the server still takes `{scope}`. `setActivitySharing`
  now accepts only `{ scope }`, so the client cannot send `enabled`.
- The CLI reads `org_enabled` alone and accepts an answer without `enabled`.
  A board without LAI-963 that still holds the personal switch off refuses the
  PUT with `local_activity_off`, which already stops collection.
- Not changed, deliberately: the `backfill` and token-usage messages that say
  *"the board says sharing is off"* (outside on/status/sync, and still true in
  meaning). Filed LAI-967 for the Organisation note and the profile lines
  that still describe the personal switch.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #59.
