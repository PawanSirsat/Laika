---
id: LAI-1341
title: 'Notification mail when an agent acts for its owner: should the owner be mailed about what their own agent did, and in what words?'
area: server
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-1313
status: review
started: 2026-11-18T06:30:57Z
finished: 2026-11-18T06:37:24Z
---

## Goal

A product question from CHIEF's review of LAI-1313 (PR #365), for the owner to decide before
anyone builds it. Board card LAIKA-1094.

**Today (LAI-1313):** notification mail is never sent to the actor. An agent's token acts as
its owner, so the owner is the activity row's `actor_id` with `actor_kind` `agent`. When an
agent assigns a task to its owner, or @mentions them in a comment, nothing is mailed.

For the same reason, the owner's digest leaves out everything their agent did on the tasks
they watch.

## The question

1. **Instant mail:** should the owner be mailed when their own agent assigns them a task or
   @mentions them?
2. **Digest:** should their agent's work appear in the owner's digest?
3. **Wording:** if yes to either, how should the mail say who did it? For example, *"Your
   agent (Claude Code) assigned you LAI-42"*, rather than the owner's own name as if they had
   done it.

## Notes

- **The decision comes first.** Nothing here is built until the owner answers. CHIEF raises
  it.
- **What the rows record.** Each row carries `agent_id` and the session snapshot
  (`session_harness`, `session_model`), so the wording can name the agent without a new
  column.
- **Where the change would land.** The actor rule is `row.actorId` in
  `services/email-notify.ts` (`activityRow`), together with the digest's "done by someone
  else" rule in SPEC §4.99.

## Decision (the owner, relayed by CHIEF, 2026-11-18)

**Email them, and name the agent.**

- When a person's own agent assigns or @mentions them, they get the mail. "Never the actor"
  applies to the human acting in person, not to their agent.
- When an agent acts on anyone, the mail and the digest line say "Pawan's agent", or the
  agent's display name followed by "(Pawan's agent)". Never just "Pawan".

## Acceptance criteria

- [x] An owner's own agent assigning them a task mails them. The subject names the agent:
      `<display name> (<owner>'s agent) assigned you …`.
- [x] An owner's own agent @mentioning them mails them. A token with no registered agent reads
      as `<owner>'s agent`.
- [x] Nobody is mailed for what they did in person: self-assignment, a claim, a self-mention.
- [x] An agent's work reaches the digests of the people who watch the task, the owner's own
      included, worded as its owner's agent.
- [x] SPEC §4.93, §4.99 and §11.6 say so. CI is green.

