---
id: LAI-164
title: '§10.2 gives `POST /webhooks/transcript` no authentication at all'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-450
status: done
closed: 2026-09-02T00:00:00Z
---

## Goal

**§10.2 specifies no authentication for `POST /webhooks/transcript`**, and §10's
preamble says `/webhooks/*` is *"outside `/api/v1`, **no user session**"*.

§10.1 has a shared secret and an HMAC. §10.2 has neither, and nothing in §3
grants a *submit a transcript* action — §3.2's meeting row is **"Apply a
meeting-diff proposal"** (`meeting_proposal.apply`), which is LAI-451's endpoint,
not this one.

So as specified, **anyone who can reach the port can**:

1. **Cause an outbound call to the org's paid LLM**, once per request, with no
   rate beyond §6.3's shared anonymous bucket.
2. **Send the project's open tasks and its whole `context_md` to that provider** —
   §10.2 says exactly what the prompt contains, and the caller chooses the
   project by `project_slug`.
3. Create `meeting_reviews` rows carrying attacker-written text that a human then
   reads in a review screen.

**(2) is the one that matters.** This is *"the one place in Laika where data
leaves the instance"* (LAI-450's own criterion), and as written an unauthenticated
stranger picks which project's data leaves and when.

## Why it is filed rather than answered

LAI-450's AC7 says: *"decide what authorises a transcript submission and write it
down. **If that turns out to be a §3 or §10 sentence, stop and file it** rather
than inventing an answer (D-050's precedent)."*

It is a §10 sentence. Every plausible answer is a decision somebody has to own:

- **A shared secret and an HMAC, as §10.1 has.** The obvious answer, and it needs
  a column — §4.2 has `github_webhook_secret_enc` and nothing for this — so it is
  a §4.2 row as well as a §10.2 sentence.
- **A personal access token** (§7), making it an ordinary authenticated write and
  `/webhooks/` the wrong prefix. Coherent, and it contradicts §10's preamble.
- **A new §3 action**, `meeting.submit`, gated by project role — which needs the
  caller to be a person, and a meeting-transcript integration usually is not.

## Acceptance criteria

- [ ] §10.2 says what authenticates a transcript submission, in the section.
- [ ] If it is a secret, §4.2 gains the column and §12 covers it — LAI-161's
      module already takes a `SecretPurpose`, so a new one is a one-line addition
      **and must be its own purpose**, not the GitHub key reused.
- [ ] If it is a token, §10's preamble stops saying `/webhooks/*` has no session,
      or this endpoint moves out of `/webhooks/`.
- [ ] The rate at which an authenticated caller may submit is stated. Each
      submission is a paid provider call, so §6.3's anonymous bucket is not the
      right answer even once the caller is known.
- [ ] LAI-450's AC7 can then be ticked by pointing at the sentence.

## Notes

**p1 because it is a spec gap in front of an outbound data path**, not because
anything is broken today: §10.2 is unbuilt, and LAI-450 is holding rather than
guessing. Nothing ships until this is decided, which is the point of filing it
before the endpoint exists rather than after.

**Do not resolve it by giving the endpoint no prompt.** An endpoint that stores a
transcript and calls no provider is not §10.2; the provider call is the feature.

---

## Ruled — CHIEF, 2026-09-02 (D-052). **Folded into LAI-450; this file closes.**

**A shared secret and an HMAC, as §10.1 has, with its own `SecretPurpose`.**
Reasoning is D-052; the short form is that `/webhooks/*` is for machines — a
transcript source is a recorder or a meeting bot, never a session — so a personal
token is the wrong shape and a §3 action requiring a principal is worse, which is
D-050's argument one endpoint over.

**Both SPEC halves are written and held** (`scratchpad/lai-164-spec.patch`):
§4.2's `transcript_webhook_secret_enc` row and §10.2's authentication paragraph.
**Applied at merge**, so the column and the row land together.

**And the rate criterion is kept and sharpened:** a rate limit is not sufficient,
because **each submission is a paid outbound call and an authenticated
integration gone wrong spends money at a perfectly legal rate.** The org carries
a **cap**, and reaching it answers distinctly rather than as a generic `429`.

### Why this file closes rather than being built

**There is nothing left in it that is not LAI-450's.** The decision was the
whole of it; the implementation is one more handler on an endpoint somebody is
already holding, and splitting it would mean two reviews of one gate. **LAI-450's
AC7 is answered here and its criteria gain the cap.**

**Filing it rather than guessing was right and is the point.** The
authentication was missing from the **specification**, not the implementation —
which no test can find, and which a builder inventing a plausible answer would
have buried permanently.

