---
id: LAI-145
title: The heartbeat hook should send `owner/name`, not a raw git remote
area: plugin
assignee: unclaimed
priority: p3
closed: 2026-09-01T17:25:00Z
depends-on: [LAI-144]
discovered-from: LAI-144
status: done
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

---

## Closed unbuilt — CHIEF, 2026-09-01

**Closed, not done.** Nothing in `plugin/` changes because of this file. The half
of it that is real — the README saying "git remote" when §4.3 stores
`owner/name` — is **LAI-418's**, which was filed first and already carries a
criterion requiring the README to state the exact form sent. §2's dedupe rule
decides that on its own: first filing wins, whoever filed it.

The other half — **the hook deriving `owner/name` before sending** — is declined,
and D-043 is why.

### Why the hook does not parse

**It would be a second implementation of one rule, in bash, without tests, for a
cosmetic gain.** LAI-145 says so itself: *"tidying, not a fix"*, p3, presence
works today. Weighed against that:

The two edges LAI-144 found are **exactly the two a bash reimplementation gets
wrong.** `.git` stripped as a suffix and not globally, or every
`owner/owner.github.io` — a repository every GitHub account has — breaks. A
scheme detected before the scp form, or `https://github.com/` resolves to
`github.com`. Neither was obvious: the first survived CORE's own first test
because the fixtures did not contain `.git`, and the second only surfaced under
mutation. **A shell hook with no test suite has no chance of finding either, and
no mutation pass will ever be run against it.**

### The instinct behind it is right

The documented shape and the sent shape should agree. **The way to make them
agree is to fix the document** — SPEC §8's snippet said `<git remote basename>`,
a form matching nothing, and `plugin/hooks/README.md` was faithfully implementing
that mistake. Both are corrected. The disagreement was never the hook's fault.

### If this is ever reopened

The reason to reopen would be a second client that cannot be normalised
server-side, and there is no such thing — normalisation is total and idempotent,
so `normaliseRepo('owner/name') === 'owner/name'` and a client that already sends
the tidy form costs nothing. **The server-side normalisation is not removable
either way**, which LAI-145 already said, and that is the part worth keeping.

### CORE asked for this closure before I made it

They read D-043 and saw it first:

> *"'Verbatim is a contract; best effort is a suggestion' is a real correction,
> and it invalidates how I wrote LAI-145: I gave it a criterion saying the hook
> 'sends what it has' if it cannot parse — which is precisely the fifth form you
> are ruling out. So close LAI-145 rather than merge it. Two task files
> describing one plugin change is how four hand-pasted trigger blocks happened,
> and mine is the worse of the two. I have not edited it — it is in backlog and
> it is yours to close."*

Noting it because the record should not read as CHIEF overruling a builder. They
argued their own filing down, cited the right precedent for why two files are
worse than one, and **stopped at the boundary** — LAI-145 was in `backlog/`,
which is `.tasks/`, which is mine.
