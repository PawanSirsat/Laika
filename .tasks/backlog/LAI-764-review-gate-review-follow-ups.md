---
id: LAI-764
title: 'Review gate follow-ups: a long commit subject rejects a whole finish, stale send-backs reappear, the review badge stops at 200 (server/ + server/web/)'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-758]
discovered-from: LAI-758
status: backlog
---

## Goal

The non-blocking findings from the 17 Oct review of the review gate (LAI-758)
are fixed, so an agent's finish is never refused over a commit subject, a
send-back only shows while it is current, and the Review badge is correct and
cheap. Filed by CHIEF (Omnigent) on the owner's direct instruction.

## Acceptance criteria

- [ ] A commit `message` whose first line is over 200 characters, or contains
      a tab or a zero-width-joiner emoji, no longer fails the whole finish with
      422 (`server/src/services/rounds.ts:181`, regex at `:107`): for `message`
      only, cut to 200 characters and replace unprintable characters; other
      fields keep their limits.
- [ ] A send-back stops being active once the task reaches done by any path,
      so reopening a task never shows an old send-back (`activeSendBacks`,
      around `rounds.ts:337-370`). A person moving review to done by board drag
      records the same "accepted" decision row as the Review page.
- [ ] Editing or deleting the send-back comment either updates the stored
      reason or the UI says the reason is the original text; pick one and
      record it in the SPEC.
- [ ] The sidebar Review badge shows the true count past 200 and does not
      download the full queue every 60 s per tab
      (`server/web/src/api/use-review-count.ts:35`); a count-only endpoint is
      fine.
- [ ] The idempotency replay refusal for tokens (`idempotency.ts:50`) only
      covers decisions and done moves, as its comment says.
- [ ] Release notes / SPEC say plainly that a plain member who is not the
      assignee can no longer move a task into done (`tasks.ts:1194`).
- [ ] Each behaviour change has a test that fails without it; full gate green.

## Notes / context

Source: the review of branch `build-review-gate` (head acab12bb), merged to
master on 17 Oct. Board card to be created alongside this file.
