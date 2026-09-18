---
id: LAI-459
title: 'Org settings and org-role management have no UI — `GET/PATCH /org` and `PATCH /users/:id` are never called'
area: web
assignee: shell
priority: p2
depends-on: [LAI-222, LAI-442]
discovered-from: LAI-441
started: 2026-09-16T15:26:54+05:30
finished: 2026-09-18T08:52:11+05:30
status: review
---

## Goal

**§11.4.2's Organisation row lists four endpoints. The client calls two.**

| endpoint | called? |
| --- | --- |
| `GET /users`, `GET/POST /invites`, `DELETE /invites/:id` | ✅ |
| **`GET /org`, `PATCH /org`** | ❌ never |
| **`PATCH /users/:id`** | ❌ never |

The Organisation screen shipped in LAI-086 and renders members and invites. **It
cannot show the org's own settings, cannot change anybody's org role, and cannot
deactivate anybody** — all three are served, by LAI-222 and LAI-442, both closed,
both `area: server`, neither with a UI counterpart filed.

**This is the third gap of exactly this shape found in one sweep** — LAI-457
(Dashboard/`metrics`) and LAI-458 (watching) are the others.

## Acceptance criteria

- [x] **`GET /org` renders the org.** Its name and its settings, from the
      response — **not from `/me`'s embedded copy**, if one exists. One source.
- [x] **`PATCH /users/:id` changes an org role**, and the control is absent —
      **not disabled** — for an actor who may not use it, matching how the rest of
      this app hides what `can()` refuses.
- [x] **You cannot demote or deactivate yourself into a room with no owner.** If
      the server refuses it, **show the server's refusal**; if it does not,
      **stop and file** rather than adding a client-side rule the server does not
      have. The client is not the place a last-owner invariant lives.
- [x] **Deactivation renders as the `DEACTIVATED` chip** the design specifies, and
      a deactivated member stays visible in the list. **Deactivation is not
      deletion** — the row is the record that they were here.
- [x] **Read D-048 first: there are two deactivation verbs.** Whichever this
      screen performs, the copy must say which one, because *"deactivate"* meaning
      two different things on one screen is worse than either.
- [~] Both themes. No demo module. Full gate green — **`EXIT 0`**, repo root.
      **Themes and demo: yes. `EXIT 0`: no — see "Submitted red" below.**

## Notes / context

**`PATCH /org`'s presence toggle belongs to LAI-149**, not here. If both are in
flight, whoever is second merges rather than reimplements — **one `PATCH /org`
call site.**

**Do not add an endpoint.** Everything needed is served, and the point of this
task is that it has been for some time.


---

## Submitted red — §4.4 step 1

**Two assertions fail, both in CORE's file, and `LAI-239` turns them green.**

```
FAIL test/tooling/response-type-coverage.test.ts
  > every served response type is paired or named
  > names nothing that is already paired or no longer served
AssertionError: expected [ …(2) ] to deeply equal []
+   "OrgAiView is paired now — remove it from UNPAIRED",
+   "OrgView is paired now — remove it from UNPAIRED",

FAIL test/tooling/response-type-coverage.test.ts
  > every served response type is paired or named
  > reports how much of the surface is actually guarded
AssertionError: expected 33 to be 31
```

Nothing else fails: `Tests 2 failed | 1907 passed (1909)`, `Test Files 1 failed |
102 passed`. `pnpm lint` and `pnpm format` both exit `0`.

**Why it is red rather than avoided.** Creating `web/src/api/org.ts` is what
made the census's reason — `'no client type exists'` — false. Pairing `Org` with
`OrgView` in `view-type-drift.test.ts` is what made that *visible*; not pairing
would have left a false claim in CORE's list that no check could see, and left
the org's client/server drift unguarded on the one endpoint carrying §12's
settings. The census's staleness guard caught it in the same run and printed the
fix. **That is the check working.**

`response-type-coverage.test.ts` is CORE's — only the `WEB_*` maps in
`structure.test.ts` are SHELL's (D-026) — so this is §4.4's named case where the
list lives in the other owner's area and there is no entry to take that is not a
crossing. Nothing was reached across and no guard was weakened.

## What was built

| file | |
| --- | --- |
| `web/src/api/org.ts` | **new** — `Org`, `OrgAi`, `OrgPatch`, `getOrg`, `updateOrg` |
| `web/src/api/users.ts` | `updateUser(id, {org_role?, is_active?})` |
| `.../organisation/OrganisationScreen.tsx` | the org card, role select, deactivate/reactivate, the refusal |
| `.../organisation/organisation.css` | the card, the controls, the error |
| `web/test/browser/organisation-roles.test.ts` | **new** — 14 tests against the real built SPA |
| `web/test/api/org.test.ts` | **new** — the mirror CONVENTIONS §4 requires |
| `web/test/browser/harness.ts` | records requests; `reply`/`refuse` for non-200 |
| `web/test/api/view-type-drift.test.ts` | `Org`↔`OrgView`, `OrgAi`↔`OrgAiView` |
| `web/test/api/endpoint-coverage.test.ts` | both LAI-459 exemptions removed |
| `.../organisation/organisation-screen.test.ts` | rewritten — see below |

## Decisions

**The old source test asserted the absence of these controls, and had to go.**
It read the screen's own source for *no `<select>`, no `<button>`* because
`PATCH /users/:id` answered `404` when LAI-086 shipped. It went red for the
change that satisfied its own task — the LAI-158 shape. What replaced it is a
browser test, because *what a person is offered* is a property of the rendered
page. What stayed in the source test is what source is genuinely the right
instrument for, including one new assertion: **no client-side last-owner rule.**
A browser test can only prove the client agreed with the server on the cases it
was handed; the *absence* of a re-implementation is a claim about the file.

**An Admin is not offered `Owner`** — §3.1's *"(not to Owner)"* caveat, which
`can()` evaluates from `targetOrgRole`. That is mirroring a rule the server
states, not inventing one; the last-owner invariant is the other kind (it
depends on how many active Owners exist, which the client cannot know) and is
left to the server and shown verbatim. **Their current role is always an option
anyway**, or a `<select>` whose value matches no option renders blank and an
Owner's row would show no role at all.

**`'ai' in org`, never `org.ai === null`.** The server omits the key for a caller
without `org.settings.edit`. A client asking for `null` renders *"AI provider —
none"* to a Viewer, which states the one thing the gate exists to withhold.

## Discovered

**Two visual defects that every assertion passed, both caught by looking.**

1. The key tail rendered on its own line, indented, reading as a separate fact —
   `dd` is `flex-direction: column`, so the tail span was a flex *item*. And the
   fix is **the wrapper element, not the CSS rule**: deleting `.org-ai`'s rule
   leaves them correctly on one line. Measured by mutation, and the comment was
   corrected to stop claiming the credit (§5's rule about comments).
2. `.org-person-inactive { opacity: 0.55 }` dimmed the whole row, so
   **`Reactivate` — the one control that is somebody's way back — read as
   greyed-out.** The exact present-and-disabled confusion this screen argues
   against, arriving through CSS instead of a `disabled` attribute. The dimming
   now stops at the identity.

**My own mirror test was aimed at the wrong file, and said so as if about the
server.** It grepped `services/orgs.ts` for `AI_PROVIDERS` and failed with *"the
server no longer declares AI_PROVIDERS as a literal array"* — the service
**re-exports** it from `db/enums.ts`. A sentence that reads as a finding about
the server and was a finding about where the test was looking. It now reads
`db/enums.ts` **and** asserts the service really re-exports that list, so the
client is not compared against a constant the endpoint never sees.

**And it reported the doc comment explaining a rule as a breach of it** — the
`OrgAiView` scan for `plaintext` hit *"nothing decrypts it… plaintext tail"* in
the comment above the field. `code()` first, which is what that helper exists
for (LAI-019, LAI-020).

## Verification

- 14 browser tests against the real built SPA. **8/8 mutations of the screen
  caught** (own row editable · admin may grant Owner · AI row shown to a viewer ·
  refusal reworded · confirmation removed · one verb for both · wrong field
  patched · org name hardcoded), harness checksum-verified on restore.
- **One mutation came back GREEN and was kept visible rather than re-aimed**:
  deleting `.org-ai`'s rule. That is what proved the wrapper is load-bearing and
  the rule is not, and the comment was rewritten to match.
- Screenshots, both themes, at 1280 / 760 / 420px. Horizontal overflow `0px` at
  every width.
- `pnpm lint` `0`, `pnpm format` `0`, root `pnpm test` red **only** as quoted.

---

## Accepted — CHIEF, 2026-09-03. **Held for LAI-239, then landing.**

**Red verified from my own merge**, not from the report: the two `UNPAIRED`
entries and the count, `Tests 2 failed | 1907 passed`, **nothing else.** Both
quoted in your submission, which is §4.4 step 1 exactly as written.

### You were right to take this ahead of LAI-238, and I was wrong to ask

**LAI-238's `depends-on` names LAI-459**, because token revocation's surface
belongs on the screen this builds. **The priority raise was right; the sequencing
was mine and it was wrong.** A `depends-on` is not something I get to skip by
asking, and honouring it over an instruction is the correct call.

### The red was avoidable and you chose it — this is the part worth keeping

> *"Creating `web/src/api/org.ts` is what made the census's reason — `'no client
> type exists'` — **false**. Pairing `Org`↔`OrgView` is what made that
> **visible**. **Not pairing would have been green**, and would have left a false
> claim in CORE's list that no check could see, plus the org's client/server drift
> unguarded on the one endpoint carrying §12's settings."*

**A green branch was available and it was the worse outcome.** That is the whole
argument for D-045, arrived at from the builder's side rather than quoted from the
file — and it is the first time the staleness guard has fired on a **reason**
going false rather than an entry becoming unnecessary.

### Deleting the old absence-assertions was right, and the reason generalises

> *"They read the screen's source for **no `<select>`, no `<button>`** because
> `PATCH /users/:id` 404'd when LAI-086 shipped — so **they went red for the change
> that satisfied their own task.**"*

**An assertion that encodes a temporary absence becomes a guard against the fix.**
That is the LAI-158 shape and it deserves the name you gave it. **And keeping the
one source assertion that source is genuinely better at** — *no client-side
last-owner rule* — is the distinction that makes the deletion a judgement rather
than a convenience: **a browser test can only prove the client agreed on the cases
you handed it.**

### A green mutation kept visible, and the comment rewritten instead

> *"Deleting `.org-ai`'s CSS rule leaves the provider and key tail correctly on
> one line — **the wrapper element is what fixes it, not the rule.** My comment
> had claimed the rule's credit. **I rewrote the comment rather than re-aiming the
> mutation.**"*

**Third time today you have reported a green mutation instead of quietly
re-aiming**, and this one found a false comment. That is `CONVENTIONS.md`'s *a
comment may not claim more than the assertion under it proves*, caught by the
person who wrote the comment.

### Verified against the running instance, and the tell is the good kind

`GET /api/v1/org` returning **`"Kvell Dynamics"`** — the real database value —
**where the prototype says *"Kvelld Dynamics"***. **A value that differs from the
mockup is the proof it came from the API**, and noticing that the discrepancy is
the evidence rather than a defect is the observation I would have missed.

8/8 screen mutations caught; both themes at 1280/760/420; 0px horizontal overflow.
