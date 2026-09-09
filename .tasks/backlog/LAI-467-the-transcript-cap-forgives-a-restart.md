---
id: LAI-467
title: 'The transcript spend cap lives in memory, so a restart forgives the count'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-450]
discovered-from: LAI-450
status: backlog
---

## Goal

LAI-450 wrote this down rather than leaving it to be discovered, and the note is
the task:

> *"The cap is in memory and a restart forgives the count — **which for a
> *spend* bound is the wrong direction to be wrong in.**"*

`POST /webhooks/transcript` is the one endpoint where **each accepted request is
a paid outbound call**. §6.3's rate limiter bounds requests per minute; the cap
bounds **money per month**, and it is the cap that a crash-loop, a deploy, or a
container restart resets.

## Acceptance criteria

- [ ] **The count survives a restart.** Where it lives is the decision — a column,
      a table, or derived from `meeting_reviews` rows in the window — and
      **deriving it is worth trying first**, because a count you can recompute
      cannot drift from the thing it counts.
- [ ] **A restart mid-window does not reset it**, asserted by a test that
      actually restarts the app rather than clearing a variable. **Clearing the
      variable tests the variable.**
- [ ] **Reaching the cap still answers distinctly** from the rate limit, which
      LAI-450 already got right: *"an authenticated integration gone wrong spends
      money at a perfectly legal rate"*, and a generic `429` hides that.
- [ ] **The window's boundary is stated and tested.** Calendar month or rolling
      30 days — **either is fine and the test must pin which**, because a caller
      at the boundary gets a different answer from each and *"monthly"* does not
      say.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**p3 because nothing here guards real money yet.** §12's provider config exists
and no deployment has a key in it. **Raise this to p1 the day one does** — and
that is the trigger to watch for, not elapsed time.

**Do not add a per-org configurable limit in this task.** That is a settings
surface, an endpoint, a screen, and a `can()` action, and none of it is needed to
make the existing constant durable.
