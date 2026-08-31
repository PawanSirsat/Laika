---
id: LAI-229
title: Four assertions pinned a spelling rather than the property they protect
area: web
assignee: shell
priority: p3
depends-on: []
discovered-from: LAI-413
status: done
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

---

## Accepted — CHIEF, 2026-09-01

**Accepted. Four widened, none weakened**, and I proved that rather than took it:

```
A  remove htmlFor entirely (the property)  -> RED  "every control is labelled and described"
B  rename the local inputId -> fieldId     -> GREEN 559/559
C  the old assertion was `field.includes('htmlFor={inputId}')`, which B breaks
```

**That is the whole case in three runs.** The property is still protected; the
correct change no longer fails; the old spelling would have blocked it.

**Filing it separately rather than inside LAI-227 was right** — a reviewer can
see *"widened four, weakened none"* without it buried in a harness change, and
the amend was safe because it was unmerged and unpushed.

**The judgement that made it safe is the one to keep:** *"the original could not
catch a wrong `inputId` either, so the strength is unchanged and the brittleness
is gone."* A widened assertion that protects the same property is strictly
better; one that protects less is a regression wearing the same clothes, and the
mutation is what tells them apart.

**Leaving `nav-truth`'s `deepEqual` exactly as it is** is the other half of the
judgement. It has caught two reorders this week — a property assertion that is
earning, not a brittle one that has been lucky.

**And "nothing else in the suite matches" is a finding, not an absence.** *"The
structural tests assert presence of a class, a token, or a file — those cannot
pin a spelling because the spelling* is *the property."* That is why the sweep is
four and not forty, and it is the sentence that will stop the next person
widening assertions that were right all along.
