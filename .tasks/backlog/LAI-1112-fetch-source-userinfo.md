---
id: LAI-1112
title: 'fetchSourceFor carries a token used as an https user name into git''s argv'
area: cli
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1111
status: backlog
---

## Goal

A remote URL may carry a token where the user name goes:
`https://ghp_…@github.com/owner/name.git` is the common GitHub form. The
launcher must never pass such a token to git on a command line, where any
process list on the machine shows it.

## Acceptance criteria

- [ ] No URL `fetchSourceFor` returns carries userinfo that could be a
      credential. Either it drops the userinfo (git's credential helper still
      supplies one for github.com) or it refuses any userinfo; the choice is
      written in the README.
- [ ] A plain user name, as in this repo's own `https://PawanSirsat@github.com/…`
      origin, keeps working. Under the dropping choice, the remote is still
      accepted.
- [ ] A test with a sentinel token as the user name shows the token is in no
      git argv the launcher runs (`agent-workspace.ts`, `agent-handoff.ts`).

## Notes / context

Found during PR #259's review fixes (LAI-1111, B1). `fetchSourceFor` in
`cli/src/agent-handoff.ts` accepts `https://<user>@github.com/owner/name.git`
for the right repo and returns a URL that keeps `<user>@`. That URL then goes
into git's argv as an `insteadOf` value, a fetch source and an `ls-remote`
argument: `agent-workspace.ts:203-260`, `agent-handoff.ts:958-1077` at
`7039ba68`. `enable` itself prints only `redactedUrl` (LAI-1111).
`user:secret@` URLs are already refused, because the https pattern allows no
`:` in the user.
