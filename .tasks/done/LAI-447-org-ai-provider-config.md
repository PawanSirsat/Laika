---
id: LAI-447
title: Setting the org's LLM provider, with the key encrypted at rest
area: server
assignee: core
priority: p2
depends-on: [LAI-222, LAI-161]
discovered-from:
status: done
started: 2026-09-01T20:50:00Z
finished: 2026-09-01T21:30:00Z
---

## Goal

**M6's other server piece that needs no AI decision** — configuring the provider
is not the same as calling it.

LAI-222 built the **read** side: `GET /api/v1/org` serves an `ai` block —
`configured`, `provider`, `key_last4` — **absent rather than null** for a caller
without `org.settings.edit`. §4.2's columns exist: `ai_provider`, `ai_base_url`,
`ai_api_key_enc`.

**Nothing writes them.** `PATCH /api/v1/org` is in §6.4 with the note
*"ai_api_key write-only"*, and that half is unbuilt.

## Acceptance criteria

- [x] `PATCH /api/v1/org` accepts `ai_provider`, `ai_base_url` and
      `ai_api_key`, gated on `org.settings.edit` (Owner and Admin — §3.1's row is
      `✓ ✓ — —`, checked rather than remembered).
- [x] **The key is encrypted at rest with AES-256-GCM, keyed from
      `LAIKA_SECRET`** (§4.2, §12), through **LAI-161's** module.
      ~~the same mechanism `smtp_json_enc` already uses~~ — **there is no such
      mechanism.** §12 is entirely unimplemented: no `encrypt`, no `decrypt`, no
      key derivation, and nothing has ever written any of the three `_enc`
      columns. CORE found it on claiming LAI-446 and filed **LAI-161**, which
      this now depends on. **I asserted a mechanism existed without opening the
      file** — seventh of that class this week and the one that would have cost
      most, because "reuse the existing crypto" is an instruction somebody
      follows.
- [x] **Write-only, and asserted at the serialisation boundary.** No response, at
      any grade, contains the plaintext key or the ciphertext. LAI-206's test is
      the model: store a recognisable value and require the body not to contain
      it, rather than checking the fields you remembered to exclude.
- [x] **`key_last4` is stored, not derived by decrypting.** `keyLast4` today
      deliberately does not decrypt — *"a serialiser that can reach plaintext is
      one refactor away from returning it"* (LAI-222). Setting the key is the
      moment the last four are known; store them then.
- [x] Clearing the provider is possible and distinguishable from not changing it.
      `null` versus absent, the distinction this repo has now made four times.
- [x] **A wrong `LAIKA_SECRET` on a later boot fails loudly rather than serving
      garbage.** Decryption failure is not "no provider configured" — that is
      the LAI-437 defect in a new place. Say what it answers.
- [x] `ai_base_url` is validated as a URL and **`openai_compatible` requires
      it** while `anthropic` does not (§4.2's enum). A provider with no endpoint
      is a configuration that cannot work.
- [x] **AC6's other two thirds, which LAI-161 could not assert.** It proved the
      stored value does not contain its plaintext and that neither error message
      leaks it — but it has no caller, so *"never reaches a log, a response or
      `activity`"* was untestable there. **This is where it becomes testable**:
      assert it of the response at every grade, of the `activity` row this write
      produces, and of the log line. CORE named the gap rather than ticking
      through it.
- [x] Full gate green — **`EXIT 0`**.

## Notes / context

**Do not call the provider.** No request to Anthropic or Ollama belongs in this
task — configuring and using are separate, and the using half has an open
question (§14 q9) that this one does not.

**No new dependency.** `node:crypto` and whatever `smtp_json_enc` already uses.

**A "test the connection" button is tempting and is not this task.** It needs an
outbound call, a timeout policy and an error vocabulary; file it if you want it.

## Outcome

`PATCH /api/v1/org` takes the three fields. **One in-flight exemption**:
`orgs.ai_key_last4` in `COLUMNS_NOT_IN_SPEC`, awaiting §4.2's row.

### `key_last4` is a new column, and that is the interesting decision

AC4 says stored, not derived, and the reason is `keyLast4`'s own docblock from
LAI-222 — *"a serialiser that can reach plaintext is one refactor away from
returning it"*. Deriving it means decrypting the key **to build a response**,
which is the one place §12 should never be able to reach.

**Setting the key is the one moment the tail is known without decrypting
anything**, so it is written down then. §4.2 has no row for it, so this is the
§4.4 shape and the exemption names §4.2 and the merge that retires it.

### The settings are computed as a whole

`nextAiSettings` builds the resulting state and validates *that*, rather than
validating each field as it arrives. **Otherwise three independent requests reach
a configuration no single request would have been allowed to ask for** — set
`openai_compatible` with a URL, then clear the URL, and you have a provider with
nowhere to send anything, each step individually legal.

There is a test for exactly that sequence, and a mutation confirming it: gating
`assertUsable` on `ai_provider !== undefined` — the natural way to write it — goes
red on `validates the resulting state, not the request` and nothing else.

**Clearing the provider clears everything.** A base URL and a key belonging to no
provider are residue, and residue that `configured` would still report as a
working setup.

### Write-only, asserted the way LAI-206 does it

Against the **whole response body** rather than the fields somebody remembered to
exclude — on the write, on every later read, in every `activity` row, and in the
log. AC8's three thirds, which LAI-161 could not assert because it had no caller.

The `activity` one is stated as a property rather than an absence: `updateOrg`
writes no activity row today — §4.8 has no verb for an org settings change — so
the test sweeps every row and requires none to contain the key. **If one is ever
added, it must not carry it**, and this is what will say so.

### AC6, answered by measurement rather than by design

**Nothing in this task decrypts the key.** `configured` comes from `ai_provider`
and `key_last4` is now a stored column, so after a `LAIKA_SECRET` rotation
`GET /org` answers exactly as before and the failure waits for the first *use*,
in §10.2.

That is LAI-161's rotation finding one layer up — *"the instance still looks
configured"* — and it is **pinned rather than papered over**: a test asserts the
misleading answer *and* that the key genuinely cannot be recovered, so the state
is unusable rather than merely mislabelled. **LAI-162 owns the fix.** What this
task owed was to say what it answers, and it now says it in an assertion instead
of a comment.

### One guard the option's own comment promised

`serverSecret` is optional on `createApp` so the LAI-002 HTTP tests can build an
app without one. I wrote *"a route that needs it and does not get it fails at the
boundary rather than encrypting under an empty key"* — and then did not implement
it. It is implemented now, with a test that stands up a harness with `''` and
requires the write to be refused **and the column to stay null**.

### Verification

| mutation | result |
| --- | --- |
| store the key in plaintext | red — 2 tests |
| return the ciphertext in the view | red — 3 tests |
| absent clears the key | red |
| validate the request rather than the resulting state | red |

The second is the one worth having: it leaks through a field nobody added to
`OrgAiView`, and the assertion catches it because it reads the body rather than
the type.

### Gate

Root `pnpm test` **EXIT=0**, zero unhandled errors. `server` **1816/1816**,
`web` 604/604, `cli` 49/49, `pnpm lint` EXIT=0, `pnpm format` EXIT=0.

### Not done, deliberately

No call to any provider (Notes), and no "test the connection" button — it needs
an outbound call, a timeout policy and an error vocabulary, and it is not this.

---

## Accepted — CHIEF, 2026-09-02

**Accepted**, with §4.2's `ai_key_last4` row applied — which makes your in-flight
`COLUMNS_NOT_IN_SPEC` entry stale, exactly as its reason said it would. **Drop it
and I push.** 1816 server.

### The stored tail, and the reason that is not convenience

> *"Deriving `key_last4` means **decrypting the key to build a response**, which
> is the one place §12 must never be able to reach. Setting the key is the single
> moment the tail is known without decrypting anything."*

**That is LAI-222's own docblock cashed in** — *"a serialiser that can reach
plaintext is one refactor away from returning it"* — and the criterion said
stored without saying that clearly. **You gave it the argument it was missing.**

### Validating the resulting state rather than the request

*"Three individually-legal requests reach a configuration no single request could
ask for — set `openai_compatible` with a URL, then clear the URL, and you have a
provider with nowhere to send anything."*

**And the mutation is the proof**: gating the check on `ai_provider !== undefined`
— **the natural implementation** — fails that sequence and nothing else. A test
for a three-request sequence is not something a criterion would have asked for
and is the only thing that finds this.

### A guard written into a comment and not implemented

> *"I documented *'a route that needs it and does not get it fails at the
> boundary rather than encrypting under an empty key'* — then wrote `?? ''` and
> moved on."*

**D-037's check pointed at yourself, and caught by re-reading your own comment
against the code.** That is the fourth instance this week of a comment claiming
more than the code beneath it, and **the first found by its own author before
anybody else read it.** The test that stands up a harness with `''` and requires
the write refused **and the column left null** is the right shape — refusing and
half-writing are different failures.

### AC6's answer is uncomfortable and you pinned it rather than smoothing it

> *"Nothing in this task decrypts the key, so after a `LAIKA_SECRET` rotation
> `GET /org` answers exactly as before — configured, provider, last four — and
> the failure waits for the first use in §10.2."*

**That is LAI-161's rotation finding one layer up**, and asserting **both** the
misleading answer *and* that the key genuinely cannot be recovered is what makes
it *recorded as unusable* rather than *merely mislabelled*. **A test that
documents a bad answer is worth more than a comment promising to fix it** —
LAI-162 owns the fix and this task owed only an honest statement of what it
answers.

### And the leak mutation

Adding `key_enc` to the view **leaks through a field nobody put in
`OrgAiView`**, and three tests fire — *"and they only do because the assertions
read the **response body** rather than the type."* **LAI-206's shape earning its
keep in a second place**, and the reason a type-level assertion would have been
worthless here.

---

### Moved late — CHIEF, 2026-09-02

This sat in  for an hour after its acceptance note was written.
I merged the exemption drop, pushed, and **never moved the file** — so 
carried an accepted task in , and the builder had one fewer thing to
see as finished.

Caught by the out-of-work monitor rather than by me. **LAI-415 could not see
it**:  with  is internally consistent, and the
disagreement was between the file and a note inside it.

---

### Moved late — CHIEF, 2026-09-02

This sat in `.tasks/review/` for an hour after its acceptance note was written.
I merged the exemption drop, pushed, and **never moved the file** — so `master`
carried an accepted task in `review/`, and the builder had one fewer thing to
see as finished.

Caught by the out-of-work monitor rather than by me. **LAI-415 could not see
it**: `review/` with `status: review` is internally consistent, and the
disagreement was between the file and a note inside it.

