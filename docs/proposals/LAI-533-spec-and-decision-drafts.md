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
   Agent grants do not narrow a legacy token, because it has no agent; it
   keeps exactly the access it has today. The rollout plan (LAI-560) proposes
   a date after which new legacy tokens are discouraged in the UI.
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

## D-116 — A checkpoint is proved by signed push deliveries, judged per ref, and acknowledged by the receiver; Laika still never calls GitHub (D-083)

**Date:** 2026-10-28 · **Status:** revised for approval (owner review of
2026-10-28; second revision after an independent review of the GitHub facts)

**In one line:** signed deliveries tell the server that a commit *was*
pushed. The supported helper confirms that it is *still* there before
accepting it. When the server cannot tell what happened to a ref, it says so
and blocks transfer until the ref is re-tagged.

**Context.** D-083 keeps Laika from calling GitHub, but a checkpoint still has
to be trustworthy: a receiver must never continue from a commit that never
reached the remote.

Three GitHub behaviours shape this decision:

- GitHub creates no push event when more than three tags are pushed, or
  deleted, at once.
- A redelivery carries the original `X-GitHub-Delivery` id.
- Failed deliveries are never redelivered automatically, and a person can
  redeliver them only for 3 days.

Sources:
<https://docs.github.com/en/webhooks/webhook-events-and-payloads#push>,
<https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks>,
<https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries>,
<https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks>.

**Decision.**

1. **Push, then register.**
   - The helper pushes the work branch.
   - It then pushes **one** lightweight tag, `laika-ckpt/<LAI-NNN>/<checkpoint-id>`,
     at the checkpoint commit, **alone in its own `git push`**. GitHub creates
     no event when more than three tags are pushed at once.
   - It never creates an annotated tag. For an annotated tag the delivery's
     `after` is the tag object's SHA, not the commit's, so the checkpoint would
     become `uncertain` (step 4).
   - Only then does the helper register the checkpoint. Registration is
     idempotent by key, so a push that succeeded followed by a registration
     that failed is simply retried.
2. **Protecting tags.**
   - Operators protect checkpoint tags with a tag ruleset that targets
     `laika-ckpt/**/*` and enables **Restrict updates** and **Restrict
     deletions**.
   - The pattern needs `**` because a ruleset's `*` does not match `/`.
   - A private repository needs GitHub Pro, Team or Enterprise Cloud to use
     rulesets.
   - Sources:
     <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository>,
     <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>.
   - A checkpoint tag is retained for 90 days after its task reaches Done or
     Cancelled, the same period Laika keeps its own checkpoint records
     (D-115).
   - After that, an operator may delete the tag deliberately under the
     ruleset's bypass. Laika never deletes one.
3. **Proof.** A checkpoint is `verified` only by signed `push` deliveries for
   the project's configured repo. It is never verified because an agent says
   so.
4. **Judging each ref, not reading arrival order.** Laika keeps every
   delivered transition `before → after` for each checkpoint ref; the all-zero
   SHA means "absent". From that set alone:

   | The transitions seen for the ref | State |
   | --- | --- |
   | Exactly one, `0000→<checkpoint commit SHA>` | `verified` |
   | That one, plus exactly one deletion `<checkpoint SHA>→0000` | `ref_deleted` |
   | No transition yet | `pending` |
   | Anything else (see below) | `uncertain` |

   "Anything else" covers a ref that ends at a different SHA, an update, a
   second creation, and a deletion with no creation seen.

   The state depends only on which transitions have been seen, never on the
   order they arrived in. Two further rules keep it that way:
   - **`uncertain` is final for that ref.** A later delivery cannot turn it
     back into `verified`. Only re-tagging (step 6) clears it, and it does so
     through a new ref.
   - **One delivery at a time per ref.** Deliveries for the same ref are
     applied serially, inside one database transaction each, so concurrent
     handlers cannot bring arrival order back in.
5. **Repeats.**
   - Laika records a delivery's `X-GitHub-Delivery` id **in the same
     transaction** that applies its transition.
   - A delivery that was recorded is ignored when it repeats.
   - A delivery that failed before it was applied leaves no record. When it is
     redelivered (redeliveries reuse the id), it is processed.
6. **What the UI says.**

   | State | Wording |
   | --- | --- |
   | `pending` | **"Verification pending"** |
   | `pending` for more than 10 minutes (configurable) | **"Verification pending — no push notice from GitHub yet"**, also shown to owners and admins |
   | `uncertain` | **"Save needs attention — GitHub's notices do not match a single clean save"** |

   A `pending` or `uncertain` checkpoint can be neither offered nor accepted.
   An automatic recovery offer uses the latest **verified** checkpoint, and
   shows any newer one beside it as unverified.
7. **Recovering a checkpoint that cannot be verified.**
   1. **Redeliver.** A person with admin rights on the GitHub repository uses
      *Redeliver* on the webhook's recent deliveries. This is possible only for
      deliveries from the past 3 days. It fixes a delivery GitHub sent but
      Laika did not apply.
   2. **Re-tag.** At any time, and the only remedy after 3 days, for a
      delivery that was never created, or for an `uncertain` ref: the agent,
      or its owner, runs `laika agent checkpoint reverify <id>`.
      - It pushes a **new** tag, `laika-ckpt/<LAI-NNN>/<checkpoint-id>-r<n>`,
        at the same commit, alone in its own push.
      - The new ref starts from "absent", so its own delivery can verify the
        checkpoint.
      - The server never calls GitHub to do this.
   3. **Which ref counts.** A checkpoint's state is the state of its **newest**
      ref (`-r<n>` if any), and the receiver fetches that ref.

   As long as the webhook itself works, re-tagging always produces a fresh
   delivery, so a pushed commit is never left unusable indefinitely. The one
   case re-tagging cannot fix is a webhook that is down or misconfigured. Then
   the operator repairs the webhook and re-tags.
8. **What the receiver's SHA proves.**
   - The **supported receiver helper**:
     1. fetches the checkpoint's newest ref;
     2. refuses locally, before sending anything, if the ref is missing or
        resolves to a different SHA;
     3. checks the commit out into a fresh worktree;
     4. only then sends `verified_commit_sha` with the accept.
   - The server checks that the submitted SHA equals the checkpoint's. It
     refuses a mismatch with `422 checkpoint_mismatch`, and a checkpoint that
     is not verified (`pending` or `uncertain`) with `409
     checkpoint_unverified`.
   - The server **cannot independently prove that a fetch happened**, so the
     submitted SHA is recorded as the **receiver's acknowledgement**, not as
     proof. The UI labels it "Receiver confirmed commit …".
   - Fetch-and-check is enforced by the supported helper. Any other client that
     submits the SHA takes responsibility for having checked it.

**Testing.**

The procedure in step 7 and the rules in steps 2, 4 and 5 are **untested** at
the time of writing. LAI-545 carries one acceptance criterion for each of
these:

- (a) redelivery of a delivery that failed before it was applied;
- (b) re-tagging after the 3-day window;
- (c) clearing `uncertain` by re-tagging;
- (d) one tag per push, and a push of four tags producing no event;
- (e) an annotated tag giving `uncertain`;
- (f) the ruleset refusing to move or delete a checkpoint tag;
- (g) deliveries for one ref applied one at a time.

These run against a real configured repository on the owner's account.
Approving this decision approves the design. The claim that recovery is
*tested* stands only once those criteria pass and are recorded on LAIKA-797.

**Limitations: what keeping D-083 costs.**

1. **No live check of availability.** The server never checks whether a
   commit is still there. Only the receiver's helper does, when it accepts.
2. **Deletions can go unreported.** A deletion or modification is seen only
   when its delivery arrives, and some never arrive:
   - GitHub creates no event when more than three tags are deleted at once;
   - GitHub does not redeliver failed deliveries by itself.

   Until a receiver fetches, the board can show `verified` for a ref that is
   gone. The receiver's helper catches this (step 8), and the offer then shows
   "Save needs attention".
3. **Webhook outage.** While the webhook is down, new checkpoints stay
   `pending` until someone redelivers them (within 3 days) or re-tags them.
   Meanwhile, automatic recovery uses older verified checkpoints.
4. **One repo.** Verification is limited to the project's single configured
   repo. Any other repo is refused with `422 repo_not_configured`.
5. **Fetch access is the receiver's own.** It depends on the receiver's Git
   credentials. Access to Laika grants no access to the repository.
6. **Protection depends on the plan and on people.**
   - Tags are protected only if the ruleset exists, which needs a qualifying
     plan for a private repository.
   - Anyone with bypass rights can still delete a tag early.
   - Laika cannot see a missing ruleset. LAI-560's operator checklist checks
     for one, and step 8 catches the consequence.
