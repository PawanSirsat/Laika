---
id: LAI-145
title: The heartbeat hook should send `owner/name`, not a raw git remote
area: plugin
assignee: unclaimed
priority: p3
depends-on: [LAI-144]
discovered-from: LAI-144
status: backlog
---

## Goal

`plugin/hooks/README.md` says the heartbeat hooks send *"metadata only — git
remote"*. A git remote is a URL; §4.3 stores `owner/name`.

**LAI-144 already fixed this on the server**, which is where it had to be fixed:
the server now accepts `git@host:owner/name.git`, both `https://` forms, with or
without `.git`, and normalises to `owner/name`. Presence works today with a hook
that sends whatever `git remote get-url origin` printed.

So this is **tidying, not a fix**, and it is p3 for that reason.

## Why it is still worth doing

Sending `owner/name` is what §4.3 and §9.1 describe, and a hook that sends the
documented shape is one fewer thing for a reader to reconcile. It also keeps the
`repo` column readable if anything ever writes it from the heartbeat side.

**It must not become a requirement.** The server normalises because an old
plugin has to keep working against a new server — that is the direction that can
be relied on when nobody controls plugin updates. If this task ever tempts anyone
to remove the server-side normalisation, the answer is no.

## Acceptance criteria

- [ ] The heartbeat hook derives `owner/name` from the remote before sending.
- [ ] `plugin/hooks/README.md` says `owner/name` rather than "git remote".
- [ ] A hook that cannot parse the remote sends what it has rather than sending
      nothing — the server degrades, and a heartbeat with an odd `repo` is worth
      more than no heartbeat.
- [ ] **The server-side normalisation is not touched.** LAI-144's tests must
      still pass unchanged, including the ones that send raw remotes.

## Notes / context

The shapes and the edge cases are already enumerated and tested in
`server/test/services/heartbeats.test.ts` under `normalising a repo (LAI-144)` —
including the two that are easy to get wrong: `.git` must be stripped only as a
**suffix** (`owner/owner.github.io` is a real repository name, and every GitHub
account has one), and a scheme must be detected before the scp form (`https` is
otherwise read as the host).

Reuse that list rather than deriving it again. No new dependencies.
