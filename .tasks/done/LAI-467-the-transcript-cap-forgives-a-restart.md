---
id: LAI-467
title: 'The transcript spend cap lives in memory, so a restart forgives the count'
area: server
assignee: core
priority: p3
depends-on: [LAI-450]
discovered-from: LAI-450
status: done
started: 2026-09-10T00:05:00Z
finished: 2026-09-10T00:40:00Z
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

- [x] **The count survives a restart.** Where it lives is the decision — a column,
      a table, or derived from `meeting_reviews` rows in the window — and
      **deriving it is worth trying first**, because a count you can recompute
      cannot drift from the thing it counts.
- [x] **A restart mid-window does not reset it**, asserted by a test that
      actually restarts the app rather than clearing a variable. **Clearing the
      variable tests the variable.**
- [x] **Reaching the cap still answers distinctly** from the rate limit, which
      LAI-450 already got right: *"an authenticated integration gone wrong spends
      money at a perfectly legal rate"*, and a generic `429` hides that.
- [x] **The window's boundary is stated and tested.** Calendar month or rolling
      30 days — **either is fine and the test must pin which**, because a caller
      at the boundary gets a different answer from each and *"monthly"* does not
      say.
- [x] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**p3 because nothing here guards real money yet.** §12's provider config exists
and no deployment has a key in it. **Raise this to p1 the day one does** — and
that is the trigger to watch for, not elapsed time.

**Do not add a per-org configurable limit in this task.** That is a settings
surface, an endpoint, a screen, and a `can()` action, and none of it is needed to
make the existing constant durable.

---

## Submission note — CORE, 2026-09-10

**Root gate `EXIT 0`** — server 1926, `server/web` and `cli` zero failures.

### AC1 — derived, as you suggested trying first

`submissionsInWindow(db, now)` counts `meeting_reviews` inside the window. A
count you can recompute cannot drift from what it counts: no column to migrate,
no counter to reconcile after a manual delete, and — having just written
LAI-466 — **a restored snapshot carries the right number by construction**,
because it carries the rows. A stored counter would be one more thing a restore
could get silently wrong.

### AC2 — a real restart, and the probe that proves it

The test closes the connection and **opens the same file again**, then reads the
count back with no migrations and nothing carried in a variable.

**The probe that matters is reverting the design, not breaking the code.**
Putting the count back into a module-level array reddens it **by name**:

```
× is read from the file, so a new process sees the same number
```

A probe that makes the function return `0` proves the tests bite; it does not
prove they bite *this*.

### AC3 — and it had no test at all

`grep MONTHLY_SUBMISSION_CAP test/` returned **nothing** before this task. The
constant was wired into a route and **nothing asserted that reaching it did
anything**, including answering distinctly — which is the whole of D-052's
argument. There is now a route test asserting `reason: 'monthly_cap'` and the
`cap` value, and it goes red both when the refusal becomes a generic `429` and
when the check is removed.

**That gap was larger than the in-memory one**, and nobody had filed it.

### AC4 — rolling 30 days, exclusive at the far end

A review created exactly `CAP_WINDOW_MS` ago has **left** the window. Pinned by a
test with three rows either side of the edge, and by a second that rolls the
clock forward and watches a full window empty. *"Monthly"* does not say which;
this does.

`>=` replaces `>` because the count is now of rows that already exist and the
submission being served is not one yet. 200 served, 201st refused — the same
boundary, checked rather than assumed.

### The path the derived count cannot see — LAI-171

`storeTranscriptReview` calls the provider and **then** inserts, so **a response
`parseProposals` refuses has cost money and left no row**. A malformed request
body is correctly uncounted — it never reaches the provider. A bad model response
is not.

Filed as **LAI-171** (p3, same trigger as this one: raise it the day a deployment
has a provider key). Named in `submissionsInWindow`'s own docblock, so a reader
of the cap meets the limitation beside the mechanism rather than in a task file
they may never open.

**I did not close it by moving the insert before the provider call.** That makes
the count right and leaves a proposal-less `meeting_reviews` row that §11.4.2's
screen, `getMeetingReview` and the expiry sweep do not expect — a decision, not a
tidy-up, and LAI-171 says so.

### Not done, per your Notes

No per-org configurable limit. That is a settings surface, an endpoint, a screen
and a `can()` action, and none of it is needed to make the existing constant
durable.

---

## Accepted — CHIEF, 2026-09-03

**Accepted**, and you took the option the criterion said to try first: the count
is **derived** from `meeting_reviews` rows inside the window, not stored.

```ts
count(*) from meeting_reviews where created_at > now - CAP_WINDOW_MS
```

**A count you can recompute cannot drift from the thing it counts**, which is why
deriving beats a column, and it means the window boundary is a property of the
query rather than a second piece of state to keep honest.

**Mutation run here**: `submissionsInWindow` forced to `0` — a restart forgiving
the count, permanently. **Red on three assertions**, including *"is read from the
file, so a new process sees the same number"*, which is the criterion's *"restart
the app rather than clearing a variable"* made concrete.

**p3 was right and it is now moot** — it cost one task, and the trigger I named
(a deployment with a provider key) never had to arrive.
