---
id: LAI-439
title: The Capacity screen — who is on what, and what is stuck with nobody
area: web
assignee: shell
priority: p2
depends-on: [LAI-432]
discovered-from:
started: 2026-09-01T19:00:00+05:30
finished: 2026-09-01T20:30:00+05:30
status: done
---

## Goal

**M5's exit criterion is this screen**: *"the capacity screen answers 'who takes
the next task' without asking."* The server side is complete — LAI-430, LAI-431,
LAI-432 — and `GET /api/v1/capacity` and `GET /api/v1/presence` both exist and
are green.

The route is not in the nav today. §11.4.2 specifies it.

## What it shows (§11.4.2, verbatim)

> **Capacity** — who is active now with repo, branch and resolved task; **agent
> sessions distinct from humans**; in-progress work across projects; last seen;
> **unlisted work with one-click promote to a task**; disabled state when
> `presence_enabled = 0`.

## Four shapes the server already decided — read them before building

**`enabled` is a field, not something you infer.** `{ enabled: false }` and an
empty list are **opposite facts**: *"this org does not record who is working"*
versus *"nobody is working"*. Since LAI-150 a disabled org stores nothing, so an
empty list is the only thing left and inferring is permanently wrong.

**`unlisted` is absent, not empty**, for a reader without `audit_log.export`. An
empty array says *"this person has logged nothing"*, which is a different claim.
Render the section only when the key is present — **never `?? []`**.

**Capacity keeps the person and filters their tasks.** A reader who cannot see a
project gets that person with a shorter list, not a missing person: *the person
is not the secret, and dropping them would make the headcount depend on who is
asking.*

**Presence says where only to a reader who can see it** (LAI-438, §9.3) — **and
the representation differs by field, which the first version of this note got
wrong.** Verified against `services/presence.ts` and a live response:

| field | when the reader cannot see where |
| --- | --- |
| `repo`, `branch` | **absent** — the key is not there |
| `matched_task_id` | **present and `null`** |
| `project_ids` | **present and `[]`** |

**So "somebody is working, elsewhere" is `repo === undefined`.** Testing
`matched_task_id === undefined` **would never fire**, and the row would render as
located with no location. And the client type declares `matched_task_id` and
`project_ids` **required**, `repo?` and `branch?` optional — backwards fails the
drift check, or worse passes while the runtime disagrees.

The service's comment is what makes it easy to misread: *"the task and the
project list follow the same gate"* — they follow the same **gate**, with a
different **representation**.

An entry with no `repo` is normal and means *somebody is working, elsewhere* —
**not** a loading state, not an error, and not a row to hide.

## Acceptance criteria

- [x] The screen renders from `GET /capacity` and `GET /presence`, in the
      **REVIEW** sidebar group, in both themes.
- [x] **An agent session is visually distinct from a human**, using
      `is_agent` — not by guessing from the name. §11.4.2 requires it and
      LAI-411 already established how agent-authored work is badged; **reuse
      that treatment** rather than inventing a second one.
- [x] **A person with no visible repo renders as a person**, with whatever is
      known — name, last seen, agent-or-not — and no empty label, no dash, no
      "unknown". Test it: it is the case LAI-438 created and it is the one most
      likely to render as a broken row.
- [x] **Disabled shows a disabled state**, distinct from empty, saying the org
      has presence off — and **not** offering a control, because turning it on is
      Admin+ on the Organisation screen (LAI-149).
- [x] **Unlisted work promotes in one click** — `POST /unlisted/:id/promote`
      needs a project and a title; the click may open a small form, but it must
      not send the user to another screen and back.
- [x] `DELETE /unlisted/:id` dismisses, with the row leaving the list.
- [x] **Every number comes from a response.** No client-side "active sessions"
      count derived by grouping something else.
- [x] Live via `GET /events` if that is cheap; **a stale capacity screen is worse
      than a slow one** — if SSE does not carry what this needs, poll and say so
      in the log rather than showing a snapshot that silently ages.
- [x] Full gate green — repo-root `pnpm test` (D-045).

## Notes / context

**No new endpoint.** If the screen needs something the API does not return, that
is a task with `area: server`, not a client-side derivation.

**The Board's "WORKING NOW" strip and the agent-sessions rail card are
LAI-440**, not this task — they consume the same `GET /presence` and are worth
landing separately so this screen is not held up by board layout.

**`initials()` exists three times already** (LAI-215). Do not make it four.

---

## Corrections — CHIEF, 2026-09-02

**Two of the four shapes above were wrong when I wrote them**, and SHELL found it
by trusting the endpoint over the task file, which is what I asked for. Verified
independently: `presence.ts:159-161` spreads `repo`/`branch` conditionally and
sets the other two unconditionally, and a live heartbeat on an untracked repo
returns keys `is_agent, last_seen, matched_task_id, name, project_ids, user_id`.

**I wrote those Notes from CORE's reports rather than from the responses.**
Eighth of that class this week.

### Two decisions asked for rather than assumed

**Resolving task ids to keys and titles is in scope.** `in_progress_tasks` and
`tasks_in_review` are arrays of ULIDs, and a screen answering *"who takes the
next task"* cannot show `01M1EN3K…`. **"Every number comes from a response" is
about not deriving figures the API did not give you** — resolving a reference is
not deriving. `GET /tasks/:id` per id, deduped, is fine at this size; **if it is
visibly slow, file the bulk endpoint rather than caching client-side.**

**Pairing `CapacityView` and `PresenceView` is in scope.** Their `UNPAIRED`
reason is *"no client type exists"*, and creating the mirror **makes that reason
false** — leaving the rows would be an exemption stating something untrue, which
is the mistake CORE refused on LAI-415. Same crossing LAI-160 authorised; do it
here rather than in a follow-up, and the drift check then guards the exact shapes
in the table above.


---

## Submitted — SHELL, 2026-09-01

**M5's exit criterion renders.** Root gate `EXIT 0` — **1775** server, **632**
web, 49 cli, zero `Unhandled|Errors|Failed|not ok`. Seven mutations, all red
after two of them found gaps in my own tests.

`/capacity` is in **REVIEW** and offered, by the rule `nav-truth.test.ts` already
states: *"`/tokens` left this list when LAI-410 built the screen — the rule
working, not an exception to it."* It has an API and a screen now, so it leaves
too.

### The LAI-438 row, built first

`working elsewhere`, in quiet italic beside the name — no dash, no "unknown", no
skeleton. The person, the time and the agent badge are all still there.

**`repo === undefined` is the discriminator, and that is not a detail.** The
other two candidates arrive `null` and `[]` whether the location was withheld or
simply resolved to nothing, so a predicate on either cannot tell the cases apart
— and `=== undefined` on them never fires at all. A test asserts exactly that,
and a mutation swapping the predicate turns it red.

### The two mutations that caught my tests, not my code

**Disabled inferred from an empty list passed everything**, because my
disabled fixture had `enabled: false` *and* `people: []`. There is now a fixture
with **presence on and nobody working**, which is the only shape that separates
them.

**`unlisted ?? []` passed too** — nothing asserted on the count line. There is
now a person with the key **absent** and one with it **empty**, and neither may
render a count.

Both gaps were invisible to a green suite and to review. Only the mutation showed
them.

### Polling, and saying so as AC8 asks

**`GET /events` carries activity, not heartbeats.** Nothing on that stream fires
when presence changes, so a screen driven by it would sit still while going
stale. This polls every 20s and the header says `updated every 20s` rather than
implying live.

### Reuse rather than a fourth copy

- **`UnlistedList` extracted** from `UnlistedScreen`, so promote and dismiss are
  one implementation on both screens. A second promote form can drift in *what
  it sends*, not only in how it looks.
- **`markers.css` extracted** so `.marker-agent` — LAI-411's treatment, which AC2
  says to reuse — is reachable outside the board. It lived in
  `board/task-detail.css`.
- **`UnlistedList` takes a name map, not `Member`.** It only ever reads `.name`,
  and Capacity knows names but not emails or roles — a `Member` prop could only
  have been satisfied by inventing three fields. Narrowing it is what let the
  notes say *Ada Lovelace* instead of *Someone*.
- **And I removed my own duplicate**: `locationHidden` in `api/presence.ts` was a
  second copy of `hasLocation`, unused. The structure check is what led me to it.

### What was measured live, and what was not

Both endpoints were exercised on my own instance on **:3371** — the presence
shapes in this file were corrected from that. **`unlisted`'s absence is verified
from source only**: it needs a reader without `audit_log.export`, and I did not
build a second user for it. Saying so rather than implying otherwise.

---

## Accepted — CHIEF, 2026-09-02. **M5's exit criterion renders.**

Root gate `EXIT 0` — 1831 server, **632** web, 49 cli, zero
`Unhandled|Errors|Failed|not ok`.

**Built LAI-438's row first, so the rest decorates a shape that already handles
its hardest case.** `working elsewhere` in quiet italic beside the name — **no
dash, no "unknown", no skeleton**, and the person, the time and the agent badge
all still there.

### The two mutations that caught your tests are the review

> *"Inferring `disabled` from an empty list passed everything. My disabled
> fixture had `enabled: false` **and** `people: []` — one fixture, both
> conditions true, and **no way to tell which was doing the work.**"*

**That is `CONVENTIONS.md` §4's boolean rule in its hardest form** — not a
boolean asserted in one direction, but **two conditions true in the same
fixture**, so the assertion cannot say which it is reading. **A fixture with
presence on and nobody working is the only shape that separates them**, and
nothing but a mutation asks for it.

**And `unlisted ?? []` passing because nothing asserted the count line at all.**
Both protect the exact distinctions their criteria exist for, and **both would
have survived a green suite and a review — including mine.**

### Three calls I would not have made

**`/capacity` leaving the hidden list by the rule already written**, quoting
`nav-truth.test.ts` back at itself: *"it now has an API and a screen, so by this
file's own rule it is offered rather than hidden."* **The right way to make a
change that looks like an exception obviously not one.**

**Polling, with the reason in the log.** *"`GET /events` carries activity, not
heartbeats. Nothing on that stream fires when somebody's presence changes, so a
screen driven by it would sit still while going stale — the failure AC8 names."*
And **`updated every 20s` in the header rather than implying live**, which is the
honest half.

**Narrowing the list's prop from `Member` to a name map** — *"a `Member` prop
could only have been satisfied by inventing three fields, and narrowing it is
what let the notes say **Ada Lovelace** instead of **Someone**."* **A prop shape
that forces invented data is an argument, not a preference.**

### And a duplicate found through a guard firing for another reason

The structure check refused the test file's **name**, and following that led to
`locationHidden` — a second, unused copy of `hasLocation`. **Fourth instance this
week of a check surfacing something adjacent to what it was asked, and the first
where the adjacent thing was the more useful one.**

### What was not verified live, stated twice rather than implied

`unlisted`'s absence is from source only, *"and I did not take you up on the demo
instance — it is the owner's board, and a second user on my own would have been
the honest way to do it if it were worth the round trip. **It was not**, for one
optional key whose conditional I could read."*

**Declining a verification and saying why is worth more than performing one that
proves nothing.**

### It was held on one line that was not yours

LAI-445 used `CapacityView` as its negative example and you paired it, with my
authorisation, in the same hour. **A negative example naming a real unpaired type
decays the moment somebody does the work the census exists to prompt** — CORE
replaced it with a synthetic pair.
