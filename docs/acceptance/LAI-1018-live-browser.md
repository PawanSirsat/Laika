# LAI-1018 · Phase 6 live browser and keyboard qualification of the agent and hand-off screens

Board LAIKA-872, part of LAI-532 / LAIKA-785. Walked 2026-11-01, 09:56–10:37
UTC, against production (`LAIKA_URL`), project `laika`, as Pawan (owner),
from Belka. This closes the keyboard and accessibility rows left
**UNVERIFIED** in `LAI-559-failure-matrix.md` (row 26) and the LAI-560
evidence pack, except the two named in §6 (the checkpoints / recovery
panel and the hand-off review dialog).

The browser was headless Chromium (Playwright 1.62.1, already in
`server/web`), driven keyboard only: Tab / Shift-Tab / arrows / Home / End /
Enter / Escape. Configs: dark-1440, light-1440, dark-390, light-390. axe-core
is not a dependency, so there is no automated scan. Checks read the DOM and
the accessibility attributes directly.

Sandbox card: **LAIKA-876**. LAIKA-875, another test's sandbox, is not
touched. The password was read from Keychain inside the script and never
printed. Screenshots are in `.polly/evidence/LAI-phase6/` on Belka
(gitignored; the running copy of this record is `browser-a11y.md` there).
They mask every `lai_…` string and any run of 40+ token characters.

Builds:
- Screen 1 was walked on `37fec80b` (deploy 41284469408).
- Screens 2–6 were walked on `8469099f` (deploy 41295574269, live 10:16:53Z).
- #175 (`37fec80b..8469099f`) changes only ExecutionPanel, ExecutionStateLine,
  agent-states, TaskCard, TaskDetailPanel and api/tasks. No screen-1 file
  changed, so the screen-1 evidence stands.

Legend: PASS · FAIL (defect filed) · NOT LIVE (no instance of that state
exists on production; checked in production's `/design/states` gallery,
which renders the shipped component with fixture data).

## 1. Developer access › Agents + Your devices — 4/4 configs

| Check | dark-1440 | light-1440 | dark-390 | light-390 | Evidence |
| --- | --- | --- | --- | --- | --- |
| No horizontal scroll (scrollWidth = clientWidth) | PASS 1440 | PASS 1440 | PASS 390 | PASS 390 | `s1-agents-list-<cfg>.png` |
| Tab walk: 39 stops, every one with a visible focus ring (2px outline) | PASS | PASS | PASS | PASS | same |
| States in words ("Credential created — yes", "Connected — yes", "Revoked — its credentials no longer work") | PASS | PASS | PASS | PASS | same |
| Consent switch: `role=switch`, named "Save checkpoints automatically", `aria-checked` plus visible On/Off text, description gives state and who gave it. Inspected, not pressed | PASS | PASS | PASS | PASS | `s1-consent-switch-focus-<cfg>.png` |
| Rotate confirm: `alertdialog` with `aria-modal`, focus starts on Cancel, Tab ×5 / Shift-Tab ×5 stay inside, Escape closes, focus returns to "Rotate token" | PASS | PASS | PASS | PASS | `s1-rotate-confirm-<cfg>.png` |
| Revoke device: `alertdialog`, focus on Cancel, trap holds, Enter on Cancel closes, focus returns to "Revoke device: Belka" | PASS | PASS | PASS | PASS | `s1-revoke-device-dialog-<cfg>.png` |
| Wizard: opener puts focus on the step's h3, "Step N of 5" and `aria-current=step` advance 1→2→3, Back ×2 returns to step 1 with focus on h3 | PASS | PASS | PASS | PASS | `s1-wizard-step{1,2,3}-<cfg>.png` |
| Harness combobox: ArrowDown opens (`aria-expanded=true`, `aria-activedescendant` set), Enter picks, focus stays on trigger | PASS | PASS | PASS | PASS | `s1-wizard-step1-<cfg>.png` |
| Duplicate harness · device: `role=alert` "You already have Claude Code · Belka…", Continue disabled, "Go to Claude Code · Belka" reachable by Tab | PASS | PASS | PASS | PASS | `s1-wizard-duplicate-<cfg>.png` |
| Wizard Cancel: closes, focus returns to "+ Register an agent" | PASS | PASS | PASS | PASS | — |

Nothing was registered, rotated, revoked or toggled. "Omnigent · Belka"'s
consent read On ("given 1 Nov, 3:29 PM by you") on the first read-only load,
before any interaction, so it was not set by this walk.

## 2. Task drawer — 4/4 configs, build 8469099f

| Check | dark-1440 | light-1440 | dark-390 | light-390 | Evidence |
| --- | --- | --- | --- | --- | --- |
| Drawer (LAIKA-876 by URL) opens with focus on the panel (`role=dialog`, named "LAIKA-876 — …"); Escape closes it; no horizontal scroll | PASS | PASS | PASS | PASS | — |
| Agent picker trigger: `role=combobox`, labelled "Agent" (`aria-labelledby`), `aria-haspopup=listbox`, `aria-expanded=false`, visible ring | PASS | PASS | PASS | PASS | `s2-agent-picker-open-<cfg>.png` |
| ArrowDown opens: `aria-expanded=true`, `aria-controls` → the `role=listbox` "agents", `aria-activedescendant` → an option in it; ArrowDown walks o0→o3 and stops at the last; Home / End jump | PASS | PASS | PASS | PASS | same |
| Availability announced in the option text, not colour: "No agent / Human only", "Omnigent · Belka — Pawan Sirsat / Available", "Codex · Belka … / Offline", "Claude Code · Belka … / Offline" | PASS | PASS | PASS | PASS | same |
| Unavailable (`aria-disabled`) option: Enter does nothing | NOT LIVE | NOT LIVE | NOT LIVE | NOT LIVE | No agent on production is unavailable to this owner (the revoked one is not listed). See §6 gallery |
| Escape closes the list only: listbox gone, focus back on trigger, drawer stays open | PASS | PASS | PASS | PASS | — |
| Execution panel (LAIKA-872, this task's own live claim, view only): state line `role=status` "Working — An agent session holds the task and is checking in."; rows in words; panel "Details" toggles `aria-expanded` by Enter, focus stays | PASS | PASS | PASS | PASS | `s2-execution-panel-details-<cfg>.png` |
| Checkpoints / recovery panel | NOT LIVE | NOT LIVE | NOT LIVE | NOT LIVE | **UNVERIFIED** (no gallery specimen either). The only card with a checkpoint is LAIKA-875, excluded by instruction. Making one needs a claim and a pushed `laika-ckpt/` tag, outside the sandbox |
| Hand-off offer dialog focus trap | NOT LIVE | NOT LIVE | NOT LIVE | NOT LIVE | No offer exists on production (Inbox counts 0/0/0/0 including closed). Checked at component level in the §6 gallery |

No agent was committed on the sandbox: selecting one sends a work request to
a real registered agent, which is outside the sandbox. Afterwards LAIKA-876
still reads `selected_agent: null`, `status: backlog`, and its only activity is
`task.created`. One run had a mis-aimed Tab search open the Status list; it was
closed with Escape, and the status is unchanged.

## 3. Board cards — 4/4 configs, build 8469099f (`/board?project=laika&sprint=none`)

| Check | dark-1440 | light-1440 | dark-390 | light-390 | Evidence |
| --- | --- | --- | --- | --- | --- |
| No page-level horizontal scroll (lanes scroll inside the board) | PASS | PASS | PASS | PASS | `s3-board-<cfg>.png` |
| Agent chip in words ("Omnigent · Belka", with a `title`), not colour | PASS | PASS | PASS | PASS | `s3-card-LAIKA-875-<cfg>.png` (photographed only) |
| Working: LAIKA-872 shows "▷ Working · Belka", also in the card's `aria-describedby` | PASS | PASS | PASS | PASS | `s3-card-LAIKA-872-<cfg>.png` |
| Save state (#175): LAIKA-872 shows "⚠ No save in the last 5 minutes", visible and in `aria-describedby` | PASS | PASS | PASS | PASS | same |
| Recovery: LAIKA-875 shows "Recovery available. The claim expired. Another agent can continue from the last verified save." Not touched: no focus, click or key | PASS | PASS | PASS | PASS | `s3-card-LAIKA-875-<cfg>.png` |
| Connection lost, Save needs attention | NOT LIVE | NOT LIVE | NOT LIVE | NOT LIVE | No card on production in either state. See §6 gallery |
| Card open: focus on "LAIKA-876 — open details" (visible ring), Enter opens the drawer (`?task=` set, focus on panel) | PASS | PASS | PASS | PASS | — |
| **Focus restored when the drawer closes (Escape or ×)** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | Focus lands on `<body>`, still after 2.5 s. `TaskDrawer.tsx` focuses the panel on open and never returns focus to the opener. Filed: see Defects |
| Keyboard move: Alt+ArrowUp moves the sandbox 177→176 in Backlog, Alt+ArrowDown back to 177. Focus stays on the card, and the live region says "Moved LAIKA-876 to position N of 177 in Backlog" (and "already at the bottom" at the edge) | PASS | PASS | PASS | PASS | `s3-keyboard-move-<cfg>.png` |
| Mouse drag (native HTML5) onto the card above reorders it; restored by keyboard, and the final reload shows the sandbox at 177 of 177 | PASS | PASS | PASS | PASS* | *the first light-390 run's drag did not register; a rerun reordered as expected (timing, not reproduced) |

The cursor was placed on the sandbox's card with `locator.focus()` (one
programmatic start point, so the walk skipped ~200 cards of Tab stops).
Every action after that was a key press, except the drag row.

## 4. Inbox › Hand-offs and Settings › Access hand-off policy — 4/4 configs, build 8469099f

| Check | dark-1440 | light-1440 | dark-390 | light-390 | Evidence |
| --- | --- | --- | --- | --- | --- |
| No horizontal scroll on `/inbox?tab=handoffs` or `/spaces/laika/settings?tab=access` | PASS | PASS | PASS | PASS | `s4-inbox-handoffs-<cfg>.png`, `s4-policy-<cfg>.png` |
| `role=tablist` "Show hand-offs": one Tab stop (roving `tabindex`), focus = selection, ring visible | PASS | PASS | PASS | PASS | same |
| ArrowRight walks Received → Sent → Needs approval → Recovery and wraps to Received; ArrowLeft wraps to Recovery; End → Recovery; Home → Received | PASS | PASS | PASS | PASS | same |
| Selected tab `aria-controls` its `role=tabpanel`, which is labelled by the tab; counts in words ("Recovery 1 open") | PASS | PASS | PASS | PASS | same |
| "Show closed and expired" checkbox: labelled, Space toggles on and off (a view filter, nothing saved) | PASS | PASS | PASS | PASS | — |
| Policy: switch "Agents other people own can take over this space's tasks" (`role=switch`, `aria-checked=false`, "Off: …" in words) | PASS | PASS | PASS | PASS | `s4-policy-<cfg>.png` |
| Policy: "A person approves…" says "Does not apply…" in words while the first switch is Off, and is not a Tab stop | PASS | PASS | PASS | PASS | same |
| Policy: number input labelled "Hand-offs per task" (value 3, range in words) | PASS | PASS | PASS | PASS | same |
| Policy: "An offer expires after" combobox: ArrowDown opens it with `aria-activedescendant` on "30 minutes"; Escape closes it, focus stays, value unchanged | PASS | PASS | PASS | PASS | `s4-policy-expiry-open-<cfg>.png` |

No policy control was changed: the section text is identical before and
after ("This space has not set a policy, so these are Laika's defaults").
The Recovery tab lists one open recovery offer, for LAIKA-875 (another
test's sandbox). Its row was not opened and its dialog was not used, per
instruction.

## 5. Project context: History / Compare / Delivered to — Laika space, 4/4 configs, build 8469099f

| Check | dark-1440 | light-1440 | dark-390 | light-390 | Evidence |
| --- | --- | --- | --- | --- | --- |
| No horizontal scroll with the panel open | PASS | PASS | PASS | PASS | `s5-context-panel-<cfg>.png` |
| Panel `aside` "Context document for Laika" with h2 "Project context"; reached by Tab (Close → editor textarea → History), every stop with a ring | PASS | PASS | PASS | PASS | same |
| History: "View r1" by keyboard; Enter moves focus to the viewer's h4 "r1"; the selected row carries `aria-current` | PASS | PASS | PASS | PASS | `s5-delivered-to-<cfg>.png` |
| Delivered to (h5) in words: "Omnigent · Belka session …EDJDW4 received 30 Oct, 12:51 PM, session ended", plus what "received" means | PASS | PASS | PASS | PASS | same |
| Hide closes the viewer and returns focus to "View r1" | PASS | PASS | PASS | PASS | — |
| Compare: "From revision" (r0 (empty)) / "To revision" (r1) comboboxes; ArrowDown opens with `aria-activedescendant`; Escape closes, focus stays, panel stays | PASS | PASS | PASS | PASS | `s5-compare-<cfg>.png` |
| **Focus restored when the panel closes (Close button)** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | Focus lands on `<body>`, not on the space's "Context" button that opened it. Filed: see Defects |

Notes, not defects:
- Opening the panel leaves focus on its opener. It is a non-modal side panel,
  and its first Tab stop comes after the rest of the space list (19 stops).
- All five spaces' openers are named just "Context". The space name is in
  the row, so the purpose is clear in context (WCAG 2.4.4), but a
  screen-reader user's button list reads "Context" five times. Logged as an
  observation and filed as LAI-1023.
- Nothing was typed or saved. The editor text length (4425) and the disabled
  Save button are unchanged after the walk.

## 6. States with no live instance — production `/design/states` gallery, 4/4 configs, build 8469099f

The gallery is served by production and renders the shipped components with
fixture data. It proves component behaviour, not a live flow.

| Check | dark-1440 | light-1440 | dark-390 | light-390 | Evidence |
| --- | --- | --- | --- | --- | --- |
| Hand-off **offer** dialog (`HandoffDialog`), both openers ("Offer to Codex · desktop-2", "Offer to another owner's agent"): `role=dialog`, `aria-modal`, labelled "Offer LAI-142 to another agent"; focus starts on the note field | PASS | PASS | PASS | PASS | `s6-handoff-dialog-{0,1}-<cfg>.png` |
| Same: Tab ×10 and Shift-Tab ×10 stay inside (Note → Offer / Ask for approval → Cancel), every stop has a ring; Escape closes and focus returns to the opener | PASS | PASS | PASS | PASS | same |
| Agent picker unavailable options: "Gemini CLI · ci-runner — Not granted on this space" and "OpenCode · old-laptop — Revoked" carry `aria-disabled`, are reachable by arrows with the reason in text; Enter does nothing (list stays open, value unchanged); Escape closes and focus stays on the trigger | PASS | PASS | PASS | PASS | `s6-agent-unavailable-option-<cfg>.png` |
| "Connection lost" (×3), "Save needs attention" (×1), "Recovery available" (×2), "Verification pending" (×3) shown as words with a shape, not colour alone | PASS | PASS | PASS | PASS | `s6-connection-lost-<cfg>.png`, `s6-save-needs-attention-<cfg>.png` |
| No horizontal scroll | PASS | PASS | PASS | PASS | — |

Still **unverified anywhere**:

- the drawer's **checkpoints / recovery panel** (keyboard order, labels,
  focus). It renders only for a task with a checkpoint; the only one is
  LAIKA-875, excluded by instruction, and the gallery has no specimen. The
  "Recovery available" words above are the card status label, not this panel.
- the drawer's hand-off **review** dialog
(`HandoffOfferDialog`, opened by "Review recovery offer" / "Review
hand-off"). It renders only for a live offer. The only live offer is
LAIKA-875's recovery offer, which is excluded by instruction. The gallery has
no specimen of it. It closes once a sandbox of its own carries an offer
(the LAI-660 two-device run, or a later sandbox).

## Defects filed (none fixed here)

| Task | Card | Priority | Defect |
| --- | --- | --- | --- |
| LAI-1021 | LAIKA-877 | p2 | Closing the task drawer (Escape, × or scrim) drops focus to `<body>` instead of the card that opened it (§3) |
| LAI-1022 | LAIKA-878 | p2 | Closing the Project context panel drops focus to `<body>` instead of the space's "Context" button (§5) |
| LAI-1023 | LAIKA-879 | p3 | Every space's "Context" (and "Members") button has the same accessible name (§5 note) |

## Summary

| Screen | Configs | Result |
| --- | --- | --- |
| 1. Agents tab + Your devices (list, wizard 1–3, duplicate notice, rotate confirm, consent switch, revoke-device → Cancel) | 4/4 | **PASS** |
| 2. Drawer: Agent picker (APG), execution panel | 4/4 | **PASS**; checkpoints/recovery panel and review dialog NOT LIVE |
| 3. Board cards: chip, Working, No save in 5 min, Recovery available, open, keyboard move, drag | 4/4 | **PASS** except drawer close focus: **FAIL** (LAI-1021) |
| 4. Inbox › Hand-offs tabs, Access hand-off policy | 4/4 | **PASS** |
| 5. Project context History / Compare / Delivered to | 4/4 | **PASS** except panel close focus: **FAIL** (LAI-1022) |
| 6. Gallery: offer dialog trap, unavailable options, Connection lost / Save needs attention | 4/4 | **PASS** (component level, fixture data) |

Production data changed by this walk: LAIKA-876 (sandbox) only, moved
177→176→177 in Backlog by keyboard and by drag, and ending where it started.
No agent, token, device, consent, policy or context was changed. LAIKA-875
was photographed on the board and not otherwise touched.
