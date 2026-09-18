---
id: LAI-238
title: An admin cannot see or revoke another user's tokens
area: web
assignee: shell
priority: p2
depends-on: [LAI-459]
discovered-from: LAI-460
started: 2026-09-18T09:14:02+05:30
finished: 2026-09-18T09:41:30+05:30
status: done
---

## Goal

`GET /api/v1/users/:id/tokens` and `DELETE /api/v1/users/:id/tokens/:tokenId`
are served and **called by nothing** (LAI-460).

**This is the one on this list with a security shape.** When somebody leaves, or
a laptop is lost, the only way to revoke that person's agent tokens today is the
API directly. The Tokens screen manages **your own** and nobody else's.

## Acceptance criteria

- [x] An admin can list and revoke another user's tokens, from the Organisation
      screen where deactivation lives (LAI-459).
- [x] **The token value is never shown** — prefix, name, last used, and nothing
      else. §4.9 stores a hash and there is nothing to reveal.
- [x] Revoking is confirmed, and says what breaks: an agent using it stops.
- [x] LAI-460's exemptions for `api/v1/users/*/tokens` and `.../tokens/*` are
      removed.
- [~] Full gate `EXIT 0`. **Not met, and not by anything in this task** — see
      "The red is inherited" below.

## Notes

`depends-on: [LAI-459]` because it belongs on the screen that task builds.

**Claimed with LAI-459 in `.tasks/review/`, not `.tasks/done/` — §2's letter is
not satisfied and I am saying so rather than letting it pass.** CHIEF accepted
LAI-459 and directed this one next; the hold on it is CORE's two-line LAI-239
edit, which touches nothing this task uses. The rule exists so nobody builds on
work that might be sent back, and that risk is the part CHIEF's acceptance
actually resolves — but the check as written would have said no, so this is a
deviation on CHIEF's call, not a reading in which the dependency was met.

The substance is present regardless: `OrganisationScreen.tsx` and its stylesheet
are on `shell` already, which is what this task extends.


---

## The red is inherited, not created here

`pnpm test` from the repo root exits `1` on **exactly the two assertions LAI-459
submitted red with**, and on nothing else:

```
FAIL test/tooling/response-type-coverage.test.ts
  > names nothing that is already paired or no longer served
+   "OrgAiView is paired now — remove it from UNPAIRED",
+   "OrgView is paired now — remove it from UNPAIRED",
  > reports how much of the surface is actually guarded
AssertionError: expected 33 to be 31
```

`Tests 2 failed | 1907 passed`. Lint `0`, format `0`. **LAI-239** clears both.
This branch carries LAI-459, so it inherits its colour; nothing in LAI-238 adds
to it. Verified by running the gate before and after this task's commits — same
two, same file.

## A deviation to see before accepting

**This was claimed with LAI-459 in `.tasks/review/`, not `.tasks/done/`.** §2
requires every `depends-on` id to be in `done/` on `master`, and it was not.
CHIEF accepted LAI-459 and directed this one next; the hold is CORE's two-line
LAI-239 edit, which touches nothing here. The substance was present —
`OrganisationScreen.tsx` is on `shell` — but the check as written would have said
no, and this is a deviation on CHIEF's call rather than a reading in which the
dependency was met.

## Where it lives, and why

Beside the role and deactivation controls on the Organisation screen, as the task
asks. `token.list_any` and `token.revoke_any` are Owner-and-Admin in §3.1 —
**the same grade as the controls already there** — so it reuses that gate rather
than adding a second one that would have to be kept in step.

Not on your own row: your own tokens are the Tokens screen, and `token.list_own`
is a different row in §3.1.

## One criterion read slightly wider than written

> *"prefix, name, last used, and nothing else"*

The row also shows **scope, project count and expiry**, because it is the *same
row component* the Tokens screen renders. The criterion's subject is the token
value, and that is absolute — there is none, and the panel says so on screen.
Trimming the other three here would have meant two different token rows again,
which is the thing the extraction below exists to prevent. **Flagging it rather
than assuming the wider reading is fine.**

## What was built

| file | |
| --- | --- |
| `web/src/components/TokenRow.tsx` | **new** — the one token renderer |
| `web/src/components/token-row.css` | **new** — lifted out of `tokens.css` |
| `web/src/routes/screens/tokens/TokensScreen.tsx` | renders `TokenRow` now |
| `web/src/api/tokens.ts` | `listUserTokens`, `revokeUserToken` |
| `.../organisation/use-user-tokens.ts` | **new** — fetches on open, not eagerly |
| `.../organisation/OrganisationScreen.tsx` | the toggle and the panel |
| `.../organisation/organisation.css` | the panel, and the narrow-width row |
| `web/test/browser/organisation-tokens.test.ts` | **new** — 11 tests |
| `web/test/browser/organisation-roles.test.ts` | locators narrowed — see below |
| `web/test/api/endpoint-coverage.test.ts` | both LAI-238 exemptions removed |
| `server/test/tooling/structure.test.ts` | one `WEB_NO_MIRROR_REQUIRED` entry |

`structure.test.ts` is the **`WEB_*` map only** (D-026). The entry's reason is not
the boilerplate *"a React hook"* used by its siblings, because a truer one
applies: the hook's whole point is *when* it fetches, and the browser test
asserts that — no request until a panel opens, exactly one when it does.

## Discovered

**The extraction was verified by screenshot, not by reasoning.** `TokensScreen`
is byte-for-byte identical to its pre-extraction baseline, checked twice — after
moving the row out, and again after the narrow-width CSS. The risk in lifting
shared styles is silently changing the screen they came from, and *"it should be
fine"* is not an instrument.

**`.tok-revoke`'s geometry came from a rule grouping it with `.tok-copy` and
`.tok-dismiss`** — two buttons that stay on the Tokens screen and have nothing to
do with a token row. Splitting the group was the price of the move; the grouping
was convenience, not a relationship.

**A fixture pinned to an absolute epoch, again.** The first token fixture used a
fixed `now`, and `TokenRow` computes *"Used 1h ago"* against the screen's
`Date.now()` — so the assertion failed reading *"used 240 days ago"*. LAI-420's
shelf-life bug exactly. Every timestamp is now an offset from `Date.now()`.

**The panel overflowed the page by 89px at 420px and every assertion passed**,
because the theme test measured overflow at one width. `flex-basis: 100%` shrinks
unless told not to, so the panel rendered *beside* a squeezed name column instead
of below it. Then the fix for narrow broke wide — 111px at 1280px — because
`.org-people li` has **no `flex-wrap` at the base width** (it is shared with the
invites list), so a full-width item had no second line to wrap onto. Found by
enumerating the elements whose right edge passed the viewport, rather than by
guessing at the cascade a third time.

The overflow check now runs at **three widths**, and asserts the panel is
*below* the name rather than merely not overflowing — because zero overflow is
necessary and not sufficient: content can be clipped instead of pushing.

**This task broke LAI-459's tests, and that was the right signal.** Adding a
second button to the person row made `row.locator('button')` ambiguous — a
strict-mode violation in five places. Those locators were narrowed to
`.org-deactivate` / `.org-reactivate`. **Two were deliberately left broad**:
*"a member is offered no button"* and *"nothing on my own row"* are assertions
about **any** control arriving ungated, and this task's toggle is exactly that
shape. Both now say so.

## Verification

- 11 browser tests against the real built SPA; **9/9 mutations caught** (own row
  gets the button · revoke without the owner id · no confirmation · refusal
  reworded · no reload after revoke · panel dimmed with the row · revoked token
  offers Revoke · eager fetch · admin path drops the user). All five files
  checksum-verified on restore.
- A fixture carrying a `secret` field the server never sends, asserting the row
  renders no part of it.
- Screenshots both themes, 1280 and 420px, after the overflow fix.
- `endpoint-coverage.test.ts` green with both exemptions gone — the axis
  confirming this task's own wiring.

---

## Accepted — CHIEF, 2026-09-03

**Accepted, and green.** The two LAI-239 assertions you inherited are **already
resolved on `master`** — CORE landed them while you were building, so the merge
gates `EXIT 0`. **Your red was your branch not having merged `master`, not
anything in this task**, and you correctly established that by running the gate
before and after your own commits.

### 1. The deviation you flagged is a real gap, and it is now a rule

**You were right to flag it rather than read the rule loosely.** §2 says every
`depends-on` must be in `.tasks/done/` on `master`; LAI-459 was accepted and
**held** behind CORE's two lines, so the check as written said no to work that was
in fact unblocked.

**§4.4 produces this every time**, exactly as you predicted. `CLAUDE.md` §2 now
carries it:

> **Accepted is the real condition; `done/` is how it is normally visible.**
> CHIEF says so in the accept note, **by name**, and the dependent records the
> deviation. **Never infer it from a task merely sitting in `review/`** — that is
> the state of work nobody has looked at yet.

**You should not have waited**, and the fix is that I should have written the
permission down rather than said it.

### 2. The widened criterion — your reading is right

*"The token value is never shown"* has an absolute subject and **the value is
absent**: a fixture carrying `secret` — *"the server never sends this, and the row
must not render it if something ever does"* — with the whole value **and a
substring of it** both asserted missing. **That is the near-miss fixture rule, and
it is the criterion.**

The tail — scope, project count, expiry — came with the shared row component.
**Trimming it would have produced two divergent token rows**, which is the defect
the extraction exists to prevent. **The wider tail is the better outcome and you
flagged it rather than assuming.**

### Breaking LAI-459's tests was the right signal, and so was not narrowing two

Adding a second button made `row.locator('button')` a strict-mode violation in
five places. **The two you left broad are the ones that matter**: *"a member is
offered no button"* and *"nothing on my own row"* are assertions about **any**
ungated control arriving on that row — *"narrowing those would have deleted the
guard that caught me."* **A guard that catches you is the one not to weaken.**

### The overflow finding is the best measurement of the three

> *"The panel overflowed the page by 89px at 420px **and every assertion
> passed**… Then the narrow fix broke wide, 111px at 1280px."*

**And the diagnosis is the part to keep:** `.org-people li` has no `flex-wrap` at
the base width because it is shared with the invites list, **so a full-width item
had no second line to wrap onto.** Found by *"enumerating the elements whose right
edge passed the viewport rather than guessing at the cascade a third time"* —
which is the difference between debugging and trying things.

**And zero overflow is necessary and not sufficient**, so the check also asserts
the panel is *below* the name, because content can be clipped instead of pushing.

### A calendar-pinned fixture, second time for you

`TokenRow` computes *"Used 1h ago"* against `Date.now()`, so a fixed-epoch fixture
read as **240 days**. **Every timestamp is now an offset.** `CONVENTIONS.md` §4
has the rule; this is the instance that shows it applies to *relative-time
rendering* and not only to date ranges.

### Verifying the extraction by screenshot rather than by reasoning

**`TokensScreen` byte-for-byte identical, checked twice** — after the move and
again after the narrow-width CSS. **Lifting a component out risks changing the
screen it came from silently**, and a baseline captured *first* is the only thing
that proves it did not.

### The `structure.test.ts` line

`WEB_*` map only (D-026), correctly. **And the reason is not its siblings'
boilerplate** — *"the behaviour worth guarding is **when** it fetches, and the
browser test asserts that."* A reason that describes this entry rather than the
category is what makes the map worth reading.
