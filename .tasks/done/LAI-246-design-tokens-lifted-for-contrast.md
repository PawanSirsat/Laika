---
id: LAI-246
title: 'Take the design''s 9 contrast-lifted tokens'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-244
started: 2026-09-18T13:02:18+05:30
finished: 2026-09-18T13:41:07+05:30
status: done
---

## Goal

The owner redirected the whole queue: **the shipped app should follow the Claude
Design prototype's flow and philosophy**, keeping every feature we have.

First and smallest piece: **the palette moved.** Reading the design through the
MCP (project `a931b00e…`) against `src/theme/tokens.css`, **9** values changed,
all contrast lifts:

| token | from | to |
| --- | --- | --- |
| `--tx3` | `#8d94a4` | `#606775` |
| `--acc` | `#2f6bff` | `#2158e0` |
| `--accs` | `rgba(47,107,255,.09)` | `rgba(33,88,224,.09)` |
| `--accb` | `rgba(47,107,255,.34)` | `rgba(33,88,224,.34)` |
| `--pur` | `#8b5cf6` | `#6d3ddb` |
| `--grn` | `#11996a` | `#0d7d56` |
| `--amb` | `#b6740b` | `#8f5a08` |
| `--red` | `#d93a45` | `#c42630` |
| `.dk --tx3` | `#71717d` | `#9a9aa4` |

**It was 13 in the first draft of this task, and that was wrong.** `--mk`,
`--ta`, `--sv`, `--jd` and `--rb` are **design-only** — the prototype's avatar
colours, which we derive in `theme/avatar-color.ts` instead of storing. They are
not ours to change and were never in `tokens.css`.

**My own AC3 caught it**: *"checked against the design by name, not by count."*
The count was taken from the design's changed-token list, not from the
intersection with ours — which is the exact failure that criterion names, in the
task that names it.

A further 24 declarations differ only in **formatting** — `rgba(15, 23, 42,
0.09)` against `rgba(15,23,42,.09)`, because Prettier expands ours. Normalised
before comparing; none is a value change.

**This answers LAI-041.** That task asks the owner to decide `--tx3`'s contrast;
they decided it in the design. LAI-041 should close against this rather than be
worked.

## Acceptance criteria

- [x] All **9** values match the design **exactly**, light and dark. Taken from the
      MCP copy, not from `docs/design/`, which is 94 hunks stale — and say so.
- [x] `token-list.ts` and `tokens.css` still agree (`test/tokens.test.ts`).
- [x] **Every token is checked against the design by name, not by count.** A
      count agrees with the wrong list whenever two things change at once.
- [x] **Contrast is measured, not assumed.** `--tx3` on `--page` and on `--card`,
      both themes, reported as a ratio. It is the reason the owner changed them.
- [x] Screenshots of at least the Board and one dense screen, both themes, so the
      lift is seen rather than trusted.
- [x] Full gate — **all three `EXIT 0`**: test (1938 passed), lint, format.
      CORE's `restore-drill` lint break is fixed, so nothing is inherited.

## Notes / context

**`docs/design/` is stale and is CHIEF's to refresh** (§1). Until it does, the
MCP copy is the source of truth and this task names that.

**Do not restyle anything else.** Later tasks judge the design against the new
palette; a screen tweaked now is a screen tweaked twice.


---

## Measured contrast, which is the point of the change

Every pair moves to **AA (≥ 4.5)**. `--tx3` on `--page` was below even AA-large.

| | on `--page` | on `--card` |
| --- | --- | --- |
| `--tx3` light | 2.67 → **4.99** | 3.04 → **5.68** |
| `--acc` | 3.95 → **5.21** | 4.50 → **5.94** |
| `--red` | 3.97 → **5.03** | 4.52 → **5.73** |
| `--grn` | 3.18 → **4.51** | 3.63 → **5.14** |
| `--amb` | 3.36 → **5.07** | 3.82 → **5.78** |
| `--pur` | 3.72 → **5.52** | 4.23 → **6.29** |
| `--tx3` dark | 4.06 → **7.01** | 3.56 → **6.15** |

Read back out of the browser, not the file: light resolves `--tx3=#606775
--acc=#2158e0 --red=#c42630 --grn=#0d7d56 --amb=#8f5a08 --pur=#6d3ddb`, dark
`--tx3=#9a9aa4`.

## Only one design file actually moved

I told CHIEF *"docs/design is stale"*. **That was broader than the evidence.**
Fetched all but one file from the MCP and hashed them against the repo:

| file | verdict |
| --- | --- |
| `Laika - All Screens.dc.html` | same |
| `Laika 01 - Kanban Board.dc.html` | same |
| `Laika 02-04 - Task, Capacity, Dashboard.dc.html` | same |
| `Laika 08-10 - Meeting, Tokens, Org.dc.html` | same |
| `support.js` | same |
| **`Laika Prototype.dc.html`** | **differs — 94 hunks, +16.5 KB** |
| `Laika 05-07 - Auth, Setup, Projects.dc.html` | **not verified** — returned inline rather than persisting, so it was never hashed |

**Five of six identical.** The repo is not "working from August"; one file moved
ahead and the rest are current. The correction matters because CHIEF wrote the
broader claim into `docs/design/README.md` on my word.

Six files exported for CHIEF to place: `<scratchpad>/design-live/`.

## The count was wrong in this task's own first draft

Filed as **13**; it is **9**. `--mk`, `--ta`, `--sv`, `--jd`, `--rb` are
design-only — the prototype's avatar colours, which `theme/avatar-color.ts`
derives and `tokens.css` has never held. I had counted the design's changed list
rather than its **intersection** with ours.

**AC3 in this very task — *by name, not by count* — is what caught it.** A
further 24 declarations differ only in formatting, Prettier expanding
`rgba(15,23,42,.09)`; normalised before comparing, none is a value change.

## One thing deliberately not done

`--purs/--purb`, `--grns/--grnb`, `--ambs/--ambb`, `--reds/--redb` still carry
the **old** rgb in the design — only `--accs/--accb` moved with their base. So
the design's tints are built from the previous colours while the solids are new.
**Applied exactly as the design has it**, because "match the design" was the
instruction, but it looks like an oversight in the design rather than intent and
is worth the owner's eye.

## A note on how this task ran

It was written in a worktree another session was also writing to — the previous
SHELL, mid-LAI-242. **Only `tokens.css` was staged, by explicit path, after
checking the diff was exactly these nine lines**, and none of their work was
touched, reverted or stashed. The gate was not run until they stood down and
`git status` was empty, because a gate result covering two sessions is evidence
about neither.

---

## Accepted — CHIEF, 2026-09-03

All three gates green — `TEST 0  LINT 0  FMT 0`, 1938 passed. **D-059 and
LAI-041 landing in the code.**

### Your correction to my `docs/` edit, and I have fixed it

I wrote *"the directory is 24 August"* and *"a builder working from that directory
is working from August"* from your *"docs/design/ is stale"*. **Hashed here rather
than taken on report:**

| | |
| --- | --- |
| All Screens, Kanban Board, Task/Capacity/Dashboard, Meeting/Tokens/Org, `support.js` | **identical** |
| **`Laika Prototype.dc.html`** | **the only one behind — now refreshed** |
| `Laika 05-07` | **not verified**, and the README says so rather than assuming |

**The claim was one file's and I wrote it as six.** As written it told a builder to
distrust four files that were current. **Corrected, with the evidence in the
README.**

**And you were right to push back on a document rather than let it stand** — it is
the one place a wrong claim compounds, because the next person reads it as
established.

### 13 → 9, caught by your own AC3

`--mk/--ta/--sv/--jd/--rb` are avatar colours we derive in `avatar-color.ts` and
have never stored. *"I counted the design's changed list instead of its
intersection with ours."* **`checked by name, not by count` catching it in the
task that wrote the criterion** is the third instance of that rule paying for
itself today.

### The contrast numbers, and one thing they do not cover — `LAI-247`

`--tx3` on `--page` **2.67 → 4.99**, on `--card` 3.04 → 5.68, dark 4.06 → 7.01;
accent/red/green/amber/purple **3.18–4.52 → 4.51–6.29**.

**But `CONTRAST_PAIRS` does not include `--tx3`.** I reverted light `--tx3` to the
old failing value and **nothing went red.** The guard covers `--tx` and `--tx2`
only.

**It was almost certainly excluded because it failed** — you cannot add a pair to
a `>= 4.5` assertion at 3.04 — **and when that reason expired, nothing said so.**
That is the `OrgView` shape, and worse in one respect: **there is no exemption
list, so the omission is invisible.** `CONTRAST_PAIRS` reads like a complete list.

**`LAI-247`, p2.** Not a mark against this task — **the lift is right and the gap
predates it** — but the token LAI-041 spent two weeks on is the one the guard does
not watch.

### The tints did not move with their solids

**Confirmed here**: `--purs` is `rgba(139, 92, 246, …)` — the **old** `--pur`
`#8b5cf6` — while `--pur` is now `#6d3ddb`. Same for `--grns`, `--ambs`, `--reds`.
Only `--accs`/`--accb` followed their solid.

**Applying it exactly as the design has it was correct** — matching the design was
the instruction, and D-020 makes the palette the owner's. **Flagging it as reading
like an oversight rather than intent is exactly the right handling**: you did not
decide it, and you did not let it pass unremarked. **It is going to the owner.**
