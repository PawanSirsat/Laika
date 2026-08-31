---
id: LAI-229
title: Four assertions pinned a spelling rather than the property they protect
area: web
assignee: shell
priority: p3
depends-on: []
discovered-from: LAI-413
status: review
started: 2026-08-31T22:03:48Z
finished: 2026-09-01T04:25:00Z
---

## Goal

**Two assertions blocked correct changes this week without ever having caught a
defect**, both by matching one *spelling* of a call rather than the behaviour
they exist to protect:

- **LAI-423** — `routes.test.ts` "nav items are real links" matched
  `href={route.path}` **verbatim**. That expression *was* the defect, so the
  test asserted the presence of the bug and would have blocked its fix.
- **LAI-413** — `nav-truth.test.ts` "a group with nothing in it is not
  rendered" matched `routesInGroup(group)` verbatim, so adding a permission
  argument failed it with the behaviour unchanged.

Two in the same family is a pattern, so the rest of the suite was swept for it.

## The test applied to each candidate

> **Can a correct change that preserves the behaviour break this assertion?**

Yes for four. No for everything else.

## What was found — four, all real

| where | pinned | property it protects |
| --- | --- | --- |
| `forms.test.ts:202` | `htmlFor={inputId}` | the label is linked to its control |
| `forms.test.ts:224` | `aria-pressed={revealed}` | the toggle reports its state |
| `shell-chrome.test.ts:68` | `showsAppNav(session)` | the shell asks the rule |
| `shell-chrome.test.ts:69` | `{signedIn && (<Sidebar` | the sidebar is behind the rule |

Each fails if a local is renamed or an argument reshaped, while the behaviour
stays correct.

## Acceptance criteria

- [x] Each widened to the property: `htmlFor={`, `aria-pressed={`,
      `showsAppNav(`, `&& (<Sidebar`.
- [x] **Nothing is weakened.** The originals could not catch a *wrong*
      `inputId` either — only a missing one — so the strength is unchanged and
      only the brittleness is gone.
- [x] **Each mutation-proven against the real defect it exists for**, because a
      widened assertion that can no longer fail is worse than a brittle one:
      brittleness costs a false failure, which is loud; a hollow assertion costs
      a real one, which is silent.
- [x] Full gate green.

## What was deliberately left alone

**`nav-truth.test.ts`'s `deepEqual` on the nav label list stays exactly as it
is.** It looks strict and it is not brittle: it pins the *property* — which
destinations the nav offers, in what order — and it has caught **two** reorders
this week (LAI-425's Timeline/Sprints swap and LAI-410's Tokens entry). It is a
property assertion that is earning, not a lucky one.

**And the rest of the suite does not match**, which is a finding rather than an
absence. The structural tests assert the presence of a class, a design token, or
a file — those *cannot* pin a spelling, because there the spelling **is** the
property. That distinction is why this sweep is four and not forty.

## Mutations — four, four reds

| mutation | result |
| --- | --- |
| label loses `htmlFor` | 1 fail |
| toggle stops reporting state | 1 fail |
| shell stops asking the rule | 1 fail |
| sidebar rendered unconditionally | 1 fail |

Baseline confirmed green first; each anchor asserted to match before mutating.
