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
status: review
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
