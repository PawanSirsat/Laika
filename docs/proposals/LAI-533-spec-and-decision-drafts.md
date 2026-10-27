# LAI-533 — Decision drafts D-114, D-115, D-116 (agent identities and hand-off)

| | |
| --- | --- |
| Task | LAI-533 (board LAIKA-786), parent LAI-532 (LAIKA-785) |
| Author | CHIEF (polly, Belka), 2026-10-28 |
| Status | D-114 and D-115 approved **in substance**, with the owner's clarifications folded in below; D-116 **revised for approval** |
| Recording rule | Approval counts only when it reaches a record an agent cannot write (proposal §8): a comment from Pawan's signed-in web session on LAIKA-785, or an *Approved* GitHub review submitted on the web. A chat message is not that record. When the record exists, CHIEF copies these entries into `docs/DECISIONS.md` verbatim, changing only the status line. |

How this file came to exist: the owner gave his clarifications in the polly
session on 2026-10-28. D-114 and D-115 were approved in substance there, and
D-116 was sent back for the revisions made below. The SPEC text that D-114
needs is written by LAI-534 as a named crossing, so this file holds no SPEC
blocks.

---

## D-114 — A registered agent is a named identity owned by one person, acting through its own credential, never with more access than its owner

**Date:** 2026-10-28 · **Status:** approved in substance by the owner on
2026-10-28; the authorised-account record is pending (LAIKA-785)

**In one line:** an agent becomes something Laika can name, grant, revoke and
credit with its actions, and it stays its owner's agent throughout.

**Context.** D-010 makes an agent "that user's token". So two agents run by
one person cannot be told apart, scoped separately, revoked separately, or
fenced from each other. Hand-off (LAI-532) needs to know which agent holds a
task, so the agent has to be something the board can name.

**Decision.**

1. **What Laika records.** Laika keeps **registered agents**. Each one has:
   - exactly one owner, who is a human user;
   - a display name;
   - a harness and a device label, both self-reported and shown as
     self-reported;
   - grants per project, each `read_only` or `full`;
   - a status, `active` or `revoked`.
2. **Credentials.** Each agent signs in with **its own tokens**.
   - **Rotating** one token mints a new token and revokes the old one in one
     step. The agent stays the same agent, and its history is kept.
   - **Revoking the agent** disables all of its tokens and ends all of its
     sessions. Every open event stream it holds closes at once.
   - Neither action touches the owner or the owner's other agents.
3. **Effective access.** What an agent may do is the **intersection** of:
   - the owner's current permissions;
   - the agent's grant for the project;
   - the token's scope and project pin;
   - for **delegation and transfer actions only**, the project's hand-off
     policy.

   The hand-off policy governs who may be selected, offered work, or accept a
   transfer. It never narrows unrelated permitted actions such as reading a
   task or commenting on it. `can()` enforces all of this on every REST route
   and every MCP tool.
4. **Attribution.** Every action records **both** the owner's `user_id` and
   the `agent_id`. Laika gets the agent from the token's `agent_id` and nothing
   else. A request cannot name, claim or assert an agent identity through a
   header, a parameter or a body field.
5. **D-010 still holds.** An agent still acts as its owner, under its owner's
   role. This decision only makes the agent distinguishable, and lets its
   access be narrowed.
6. **Legacy tokens.** Tokens issued before this decision keep working, with no
   agent attached. Their past activity is never back-filled with an invented
   agent; the UI shows such rows as "agent (unregistered token)". A legacy
   token:
   - **cannot impersonate** a registered agent, because there is no field that
     would let it;
   - **cannot bypass a session claim**: when a registered agent's session holds
     a task's active claim, a legacy token's task change is refused exactly
     like any non-holder's (LAI-541).
7. **Three separate facts.** The **human assignee**, the **selected agent**
   and the **active claim** are kept apart.
   - Selecting an agent creates a work request. It does not claim the task, it
     does not start a process, and it does not change the human assignee.
   - Changing the human assignee is always a separate, explicit act.

**Consequences.**

- A stolen agent token can act as that agent, within that agent's grants. The
  containment is:
  - narrow grants;
  - storing the credential only on the device;
  - expiry and rotation;
  - immediate revocation, which also closes streams (LAI-539);
  - the activity log;
  - rate limits.
- `can()` grows an agent-grant step, inside the token-narrowing it already
  does (LAI-534).
- The SPEC changes this needs are made by LAI-534 as named crossings: the new
  §4 tables, §4.9, §4.8, §3 and §6.4.

---

## D-115 — A checkpoint is work an agent registers on purpose, not a heartbeat; D-005 stands unchanged

**Date:** 2026-10-28 · **Status:** approved in substance by the owner on
2026-10-28; the authorised-account record is pending (LAIKA-785)

**In one line:** heartbeats stay `{repo, branch, timestamp}`. A checkpoint is
a deliberate save, and it carries only what the person taking over the work
needs.

**Decision.**

1. **Created on purpose.** A checkpoint exists only because an agent or its
   helper took an explicit action, inside a task the agent has claimed.
2. **Consent for automatic saves.** **Automatic** checkpointing, where a hook
   saves after tool activity or at a session boundary, needs **explicit consent
   at setup**. That consent is recorded on the agent, with who gave it and
   when. Once given, hooks save without asking each time. Withdrawing it stops
   the automatic saves; manual checkpoints keep working.
3. **What a checkpoint holds.**
   - the repo, the branch and the durable checkpoint ref;
   - the full commit SHA;
   - the files changed, with line counts;
   - a structured continuation note: work done, next step, decisions, open
     questions, and known failing tests or builds;
   - the commit that note describes;
   - the context revision;
   - the session it came from and its claim generation;
   - when it was created.
4. **What it never holds.** The schema has **no field** for source contents,
   diffs, prompts or transcripts.
5. **The continuation note is free text, so it is the risk.**
   - Agents are told not to put secrets or copied sensitive content in it.
   - The helper checks the note against the same secret patterns it uses for
     staging, and refuses a note that matches.
   - This is a **mitigation, not a guarantee**: no automatic check can prove
     that free text holds nothing sensitive. The note is shown only to people
     who can read the task.
6. **Kept apart, and labelled.** The mechanical manifest and the written note
   are stored separately. A note that describes an older commit is labelled
   **stale**, and a missing note is labelled **missing**.
7. **Untrusted data.** Notes, branch names and repo content are never executed,
   and never promoted into instructions.
8. **Failed tests are allowed.** A failing test does not invalidate a
   work-in-progress checkpoint. Its test status is shown as it is.
9. **Retention.** Two separate things are cleaned up in two separate ways:

   | | **Laika's checkpoint records** | **Git checkpoint tags** |
   | --- | --- | --- |
   | What they are | Rows on the server | Refs in the repository |
   | When they go | A server retention job deletes them 90 days (configurable) after their task reaches Done or Cancelled | **Laika never deletes them** |
   | What remains | Append-only activity rows that name a checkpoint keep its id and SHA | — |
   | How they are cleaned up | Automatically, by that job | `laika agent checkpoints prune --dry-run` **lists** the tags past retention. It deletes nothing, in Laika or in Git. An operator deletes them deliberately (D-116). |

**Consequences.** D-005's promise about presence does not change. The new
data exists only because of a deliberate action or a consent the owner gave.
It is scoped to one task, and anyone who can read that task can see it.

---

## D-116 — A checkpoint is proved by signed push deliveries, ordered by the ref's own history, and acknowledged by the receiver; Laika still never calls GitHub (D-083)

**Date:** 2026-10-28 · **Status:** revised for approval (owner review of
2026-10-28)

**In one line:** the server learns, from signed deliveries, that a commit
*was* pushed. The supported helper confirms that it is *still* there before it
accepts. When the server cannot establish order, it says so and stops the
transfer until the order is reconciled.

**Context.** D-083 keeps Laika from calling GitHub. Checkpoints have to be
trustworthy anyway: a receiver must not continue from a commit that never
reached the remote.

**Decision.**

1. **Push, then register.** The helper pushes the work branch and then a
   lightweight tag, `laika-ckpt/<LAI-NNN>/<checkpoint-id>`, at the checkpoint
   SHA. Only after that does it register the checkpoint. Registration is
   idempotent by key, so a push that succeeded followed by a registration that
   failed is simply retried.
2. **Protecting the tags.** Operators protect `refs/tags/laika-ckpt/*` with a
   repository ruleset that blocks **both update and deletion**, so no one can
   move or remove a checkpoint tag while it is retained. Deleting a tag after
   retention is a deliberate act by an operator, under the ruleset's bypass. It
   is never done by Laika. Whether this works on GitHub is Documented, not
   tested: LAI-545 tests it on the configured repo.
3. **What counts as proof.** A checkpoint is `verified` only by signed `push`
   deliveries for the project's configured repo. Laika never marks a
   checkpoint verified because an agent says so.
4. **Ordering.** Webhook **arrival order is not event order**, so Laika never
   uses arrival order. Each delivery for a checkpoint ref is treated as a
   transition `before → after`, using the payload's `before` and `after` SHAs.
   The all-zero SHA means the ref is absent. The ref's state is the end of the
   **chain** these transitions form, starting from "absent".
   - **The chain links up.** The checkpoint is `verified` if the end of the
     chain is the checkpoint SHA, and `ref_deleted` if the end is "absent"
     after a deletion.
   - **A delivery that is already part of the chain** is a delayed duplicate.
     It is ignored, so a late, older delivery can never overwrite a newer
     state.
   - **The chain cannot be linked.** If a transition starts from a SHA the
     chain never reached, the ref was modified at all, or a ref was deleted and
     then created again, the checkpoint becomes `uncertain`. An `uncertain`
     checkpoint **cannot be offered or accepted**, and the transfer stays
     blocked until it is reconciled (step 6).
   - Exact repeats of the same delivery are discarded by their
     `X-GitHub-Delivery` id.
5. **What the UI says.**
   - `pending` → **"Verification pending"**.
   - Still `pending` after 10 minutes (configurable) → **"Verification pending
     — no push notice from GitHub yet"**. This message is also shown to owners
     and admins.
   - `uncertain` → **"Save needs attention — GitHub's notices disagree"**.
   - A `pending` or `uncertain` checkpoint cannot be offered or accepted. An
     automatic recovery offer uses the latest **verified** checkpoint and shows
     any newer one beside it as unverified.
6. **Recovering when the webhook missed** — the procedure is tested in LAI-545,
   on a real repo.
   1. **Redeliver.** An owner or admin opens the webhook's recent deliveries in
      GitHub and uses *Redeliver*. Redelivered payloads are processed exactly
      like originals: their id is new, but their transition is already in the
      chain or extends it, so they are safe to replay.
   2. **Re-tag.** If the delivery is not available to redeliver, the agent or
      its owner runs `laika agent checkpoint reverify <id>`. That pushes a
      **fresh** tag, `laika-ckpt/<LAI-NNN>/<checkpoint-id>-r<n>`, at the same
      SHA. The new ref has a clean chain from "absent", so its own delivery can
      verify the checkpoint. The server never calls GitHub to do this.
   3. **Reconcile.** Re-tagging is also how an `uncertain` checkpoint is
      reconciled. A checkpoint that cannot be reconciled stays unusable for
      transfer, and the task falls back to the human recovery path (§4.4: no
      checkpoint).
7. **What the receiver's SHA proves.**
   - The **supported receiver helper** fetches the checkpoint ref, checks that
     it resolves to exactly the recorded SHA, and checks that commit out into a
     fresh worktree. Only then does it send `verified_commit_sha` with the
     accept.
   - The server checks that the submitted SHA equals the checkpoint's. It
     refuses a mismatch with `422 checkpoint_mismatch`, and an unverified or
     uncertain checkpoint with `409 checkpoint_unverified`.
   - The server **cannot independently prove that a fetch happened**. The
     submitted SHA is recorded as the **receiver's acknowledgement**, not as
     proof, and the UI labels it that way: "Receiver confirmed commit …".
     Fetch-and-check is enforced by the supported helper. Any other client
     that submits the SHA is taking responsibility for having checked it.

**Limitations — what keeping D-083 costs.**

1. **No live check of availability.** The server never checks whether a
   commit is still available. Only the receiver's helper does that, at the
   moment it accepts.
2. **Late or missing deliveries.** A deletion or a modification is seen only
   when its delivery arrives. Until then the board can show `verified` for a
   ref that is gone. The receiver's fetch catches it (`checkpoint_mismatch`, or
   a fetch error), and the offer then shows "Save needs attention".
3. **Webhook outage.** While the webhook is down, new checkpoints stay
   `pending` until someone redelivers or re-tags them (step 6). Automatic
   recovery quietly uses older verified checkpoints in the meantime.
4. **One repo.** Verification is limited to the project's single configured
   repo. Any other repo is refused with `422 repo_not_configured`.
5. **Repo access.** Being able to fetch depends on the receiver's own Git
   credentials. Access to Laika grants no access to the repo.
6. **Retention.** Tags stay only as long as the ruleset protects them, and
   only if no one with bypass rights deletes them early. Laika cannot see a
   ruleset that is missing; LAI-560's operator checklist checks for it.
