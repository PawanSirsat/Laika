---
id: LAI-156
title: A read-only database could still serve reads
area: server
assignee: core
priority: p3
depends-on: [LAI-437]
discovered-from: LAI-437
status: in-progress
started: 2026-09-01T18:25:00Z
---

## Goal

LAI-437 made an unwritable database report itself honestly — `500 internal`
instead of `401 "Not signed in"`. **It is still a total outage**, and it need not
be: almost nothing a read request does actually requires a write.

The one write on the token read path is `touchTokenUsage`, stamping
`tokens.last_used_at`. LAI-437's Notes asked whether the read path could avoid it
when the throttle says the timestamp is fresh. **It already does** —
`tokens.ts:179` returns early inside `LAST_USED_THROTTLE_MS` (60s). So a token
used within the last minute serves reads normally on a read-only database today,
and one used an hour ago does not. **The failure is not "read-only databases do
not work"; it is "they work for a minute after each token's last use."**

That is a worse property than either alternative, because it makes the outage
look intermittent.

## The decision

Whether a **failed bookkeeping write** should fail the request.

Arguments both ways, and this is why it is a task rather than a patch:

- **For continuing:** `last_used_at` is observability (§4.9), not authorisation.
  Nothing decides access on it. A degraded instance that serves reads while the
  operator fixes the disk is a much better failure mode than one that refuses
  everything, and read-only is a real state — a restored backup, a full volume,
  a wrong owner, a container mount.
- **Against:** it converts a loud failure into a silent one, which is the exact
  antipattern LAI-231 rejected for `poll()`. A write that vanishes without a
  trace is how a database quietly stops recording things. Any version of this
  must log at least once per process, not per request, and must not extend to
  writes the caller actually asked for.

**A write request must still fail.** The scope is the auth layer's own
bookkeeping, not the request's work.

## Acceptance criteria

- [ ] A decision recorded either way, with the reasoning — "leave it failing" is
      a legitimate outcome and should be written down so it is not rediscovered.
- [ ] If it changes: a `GET` on a read-only database succeeds with a valid token
      whose `last_used_at` is **stale**, which is the case that fails today.
- [ ] A `POST` on a read-only database still fails. The relaxation is the
      bookkeeping write, nothing else.
- [ ] The failure is visible — logged, and not once per request.
- [ ] LAI-437's tests still pass unchanged: a resolver failure that is *not* the
      `last_used_at` write is still `internal`, and an invalid token is still
      `unauthorized`.

## Notes

Split from LAI-437 as its Notes instructed: *"That is a second, larger change; if
it is more than a few lines, file it rather than folding it in."* It is — the
code is small but the decision is not, and it reaches into what a write failure
is allowed to mean.

`PRAGMA query_only = ON` reproduces this deterministically without `chmod` or a
particular filesystem owner; LAI-437's tests use it.
