---
id: LAI-447
title: Setting the org's LLM provider, with the key encrypted at rest
area: server
assignee: core
priority: p2
depends-on: [LAI-222, LAI-161]
discovered-from:
status: in-progress
started: 2026-09-01T20:50:00Z
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

- [ ] `PATCH /api/v1/org` accepts `ai_provider`, `ai_base_url` and
      `ai_api_key`, gated on `org.settings.edit` (Owner and Admin — §3.1's row is
      `✓ ✓ — —`, checked rather than remembered).
- [ ] **The key is encrypted at rest with AES-256-GCM, keyed from
      `LAIKA_SECRET`** (§4.2, §12), through **LAI-161's** module.
      ~~the same mechanism `smtp_json_enc` already uses~~ — **there is no such
      mechanism.** §12 is entirely unimplemented: no `encrypt`, no `decrypt`, no
      key derivation, and nothing has ever written any of the three `_enc`
      columns. CORE found it on claiming LAI-446 and filed **LAI-161**, which
      this now depends on. **I asserted a mechanism existed without opening the
      file** — seventh of that class this week and the one that would have cost
      most, because "reuse the existing crypto" is an instruction somebody
      follows.
- [ ] **Write-only, and asserted at the serialisation boundary.** No response, at
      any grade, contains the plaintext key or the ciphertext. LAI-206's test is
      the model: store a recognisable value and require the body not to contain
      it, rather than checking the fields you remembered to exclude.
- [ ] **`key_last4` is stored, not derived by decrypting.** `keyLast4` today
      deliberately does not decrypt — *"a serialiser that can reach plaintext is
      one refactor away from returning it"* (LAI-222). Setting the key is the
      moment the last four are known; store them then.
- [ ] Clearing the provider is possible and distinguishable from not changing it.
      `null` versus absent, the distinction this repo has now made four times.
- [ ] **A wrong `LAIKA_SECRET` on a later boot fails loudly rather than serving
      garbage.** Decryption failure is not "no provider configured" — that is
      the LAI-437 defect in a new place. Say what it answers.
- [ ] `ai_base_url` is validated as a URL and **`openai_compatible` requires
      it** while `anthropic` does not (§4.2's enum). A provider with no endpoint
      is a configuration that cannot work.
- [ ] **AC6's other two thirds, which LAI-161 could not assert.** It proved the
      stored value does not contain its plaintext and that neither error message
      leaks it — but it has no caller, so *"never reaches a log, a response or
      `activity`"* was untestable there. **This is where it becomes testable**:
      assert it of the response at every grade, of the `activity` row this write
      produces, and of the log line. CORE named the gap rather than ticking
      through it.
- [ ] Full gate green — **`EXIT 0`**.

## Notes / context

**Do not call the provider.** No request to Anthropic or Ollama belongs in this
task — configuring and using are separate, and the using half has an open
question (§14 q9) that this one does not.

**No new dependency.** `node:crypto` and whatever `smtp_json_enc` already uses.

**A "test the connection" button is tempting and is not this task.** It needs an
outbound call, a timeout policy and an error vocabulary; file it if you want it.
