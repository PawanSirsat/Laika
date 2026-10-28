# Agent identities, Phases 1 + 2 — live acceptance on production

LAI-582 (board LAIKA-835), part of LAI-532 / LAIKA-785. Walked on
**2026-10-28, 19:20–20:05 UTC** against production (`LAIKA_URL`), running
master **`4bb4846c`**, as Pawan, by Belka. Real APIs, the real MCP endpoint, the
real `laika` CLI, and a real Chrome driven by Playwright.

Everything that changes a card was done on one card made for it:
**LAIKA-836, "Acceptance sandbox · do not work"**. It ends in Done, accepted by
Pawan, with its agent withdrawn. No other card was touched except this task's own and the two findings
filed from it.

Screenshots are in `.polly/evidence/LAI-582/` on Belka (gitignored). The two
screens that show a one-time credential were blurred or masked before capture;
one unmasked capture of step 4 was deleted the moment it was noticed and
retaken masked. No token value appears in this document, the evidence, the
board or any log.

## The result

| # | Deliverable | Result |
| --- | --- | --- |
| 1 | Agents tab: list, rename, change access, rotate, revoke, wording | **PASS** (copy defect filed: LAI-583) |
| 2 | Agent token limits | **PASS** |
| 3 | Drawer Agent field, chip, List column and filter, withdraw | **PASS** |
| 4 | Work request reaches only the selected agent | **PASS** |
| 5 | Attribution: "Pawan via Claude Code · Belka" / "agent (unregistered token)" | **PASS** |
| 6 | Sessions and claims, live "Claim expired", explicit reclaim | **PASS** |
| 7 | Session helper tied to the real process | **PASS** |
| 8 | Live stream closes on revoke | **PASS** |
| 9 | Finish to Review; agent cannot mark Done; Pawan accepts | **PASS** (queue cap filed: LAI-584) |
| 10 | "Working" and "Connection lost" card states | **NOT-DELIVERED** (LAI-568, PR #112, still draft) |

No Phase 1 + 2 deliverable failed. Two things that are not right were found and
filed; neither stops a flow.

## Agents now registered (owned by Pawan)

| Agent | Harness | Device | Access | Credential kept in |
| --- | --- | --- | --- | --- |
| Claude Code · Belka | Claude Code | Belka | Laika, full | `~/.laika/agents/claude-code.json` (0600) |
| Codex · Belka | Codex | Belka | Laika, full | `~/.laika/agents/codex.json` (0600) |
| Acceptance · test renamed | No MCP (REST / CLI) | Belka | — | **revoked**; both of its tokens answer 401 |

Each credential went from the wizard's screen straight into
`laika agent login <harness>` on stdin, through a one-off listener on
`127.0.0.1`. It was never printed, never put on a command line, and the
temporary copies used for `curl` header files were deleted at the end.

---

## 1. Agents tab

**What you can do now.** Give each coding agent its own login to the board,
narrowed to the projects you pick, and see it, rename it, change what it can
reach, replace its credential, or switch it off — without touching your own
tokens.

**Try it in 3 clicks.** Developer access → **Agents** → **+ Register an agent**.

**What happened.**

- The five-step wizard (name / harness / device → projects → credential →
  harness instructions → verify) registered both agents. Step 3 says "Copy this
  now — it is not shown again" and shows the credential once.
- **Verify only accepts the agent's own credential.** With step 5 open, Pawan's
  personal token called `GET /api/v1/me` (200) at 19:25:58; two polls later the
  step still read "Waiting for a request authenticated as Claude Code · Belka…".
  `laika agent login claude-code` then made a request with the agent's token,
  and the step turned to "Connected — the board has seen a request from Claude
  Code · Belka's own credential". The same for Codex · Belka.
- The list shows the **owner** ("Pawan Sirsat (you)"), the **harness and
  device** marked *self-reported*, **last seen** ("Never seen", "Seen just
  now", "Seen 1m ago"), projects, the credential's non-secret prefix and a
  status badge.
- **Wording:** an agent whose credential has never been used reads **Credential
  created**; once it makes a request it reads **Connected**. **Ready for
  recovery** is Phase 3, and every row correctly says *Recovery: Not available
  yet*.
- **Rename** (keyboard only): typed a new name, Enter; the API and the row both
  changed and focus came back to the Rename button.
- **Manage access** (keyboard only): moved Laika from Full to Read only with the
  arrow keys and saved; the row read "Laika (read only)" and the API agreed.
- **Rotate:** a confirmation ("the current one stops working at once"), then a
  new credential shown once. The old token answered **401**, the new one
  **200**.
- **Revoke:** a confirmation ("Every token it holds stops working at once, and
  the agent cannot be restored"). The row reads **Revoked**, "Credential: None
  live", and both the original and the rotated token answer **401**.

**Found (LAI-583).** Step 4's badge says "carries your token" right under "These
carry Claude Code · Belka's token, not yours". And step 1 says the name "is how
it is named on cards, history and Capacity", but cards and the picker show
*harness · device*: the throwaway agent, named "Acceptance · test renamed",
appears as "another agent — Pawan Sirsat · Belka". Two Claude Code agents on
Belka would look the same.

**Evidence.** `01-agents-empty-{light,dark}-{1440,390}`,
`02-wizard-step1-light-1440`, `03-wizard-step2-light-1440`,
`04-wizard-step3-credential-blurred-light-1440`,
`05-wizard-step4-instructions-masked-light-1440`,
`06-wizard-step5-waiting-light-1440`,
`07-verify-still-waiting-after-pawan-token-light-1440`,
`08-verify-passed-agent-token-light-1440`, `09-codex-step1-light-1440`,
`10-codex-verify-passed-light-1440`,
`11-agents-list-3-{light,dark}-{1440,390}`, `12-rename-inline-light-1440`,
`13-manage-access-readonly-light-1440`, `14-rotate-confirm-light-1440`,
`15-rotated-new-credential-blurred-light-1440`,
`22-revoke-confirm-light-1440`, `23-revoked-row-light-1440`.

## 2. What an agent's token cannot do

**What you can do now.** Trust that an agent's credential is narrower than
yours and cannot make itself wider.

**Try it in 3 clicks.** Register an agent with one project; in a terminal,
call any other project with its token — it is refused.

**What happened** (each a real request to production):

| Request | Answer |
| --- | --- |
| Agent (Laika only) reads Sauce's tasks | `403 agent_not_granted` — "This agent has no access to this project" |
| Agent with Laika *read only* edits the sandbox / comments on it | `403 agent_read_only` |
| Agent mints a token (`POST /tokens`) | `403 agent_token` — "its owner can, signed in" |
| Agent registers an agent (`POST /agents`) | `403 session_required` — "needs a signed-in web session" |
| Personal token pinned to Laika mints an unpinned token | `403 project_pinned` |
| The same pinned token mints one for another project | `403 project_pinned` |

The pinned probe token was revoked straight after (204, then 401).

## 3. Choosing an agent for a card

**What you can do now.** On any card, next to Assignee, pick which of your
agents should do it. That sends the agent a work request; it does not assign
the card or start any work.

**Try it in 3 clicks.** Open a card → **Agent** → pick "Claude Code — Pawan
Sirsat · Belka".

**What happened.**

- The picker opens with ↓, and **Home / End / ↑ / ↓** move through it.
  **Escape** closes it and leaves focus on the field.
- **Typing searches**: "claude" narrowed the list to *No agent* and Claude
  Code; Enter picked it.
- An **unavailable agent is listed with its reason and cannot be picked**: the
  read-only throwaway showed "Read-only on this space", `aria-disabled`, and
  Enter on it changed nothing.
- **The human assignee did not change** — Pawan before, Pawan after, in the
  drawer and in the API.
- The drawer reads "A work request goes to this agent. The task changes only
  when it accepts." and **"Waiting for agent · Pawan Sirsat's Claude Code ·
  Belka"**.
- The board card carries the neutral chip **"Claude Code · Belka"** and
  "Waiting for agent".
- The List has an **Agent** column. `?selected_agent=<Claude Code's id>` showed
  the sandbox; Codex's id showed nothing; `any` showed the sandbox.

- **Withdraw**, after rows 6–9 had run (so the agent could claim and finish
  first): picker → Home → Enter on *No agent — Human only*. The field read "No
  agent", focus stayed on it, the API's `selected_agent` became `null`, and the
  assignee stayed Pawan. The agent's work-request list was empty afterwards —
  but its claim had already closed the request, so that read does not by itself
  prove the withdraw removed one.

**Evidence.** `16-agent-picker-open-light-1440`,
`17-agent-picker-search-light-1440`,
`18-drawer-agent-selected-{light,dark}-{1440,390}`,
`19-board-card-chip-{light,dark}-1440`,
`20-list-filter-selected-agent-{light,dark}-{1440,390}`,
`28-agent-withdrawn-light-1440`.

## 4. The agent sees the request; others do not

**What you can do now.** An agent asks the board "what has my person asked me
to do?" and gets exactly the cards you picked it for.

**Try it in 3 clicks.** Pick an agent on a card; in that agent's session, call
`list_ready_tasks`; the card is under `work_requests`.

**What happened.**

| Agent | `GET /api/v1/agents/me/work-requests?project=laika` | MCP `list_ready_tasks` → `work_requests` |
| --- | --- | --- |
| Claude Code · Belka | LAIKA-836, `state: open` | LAIKA-836 |
| Codex · Belka | empty | empty |

Pawan's personal token on the same endpoint: `403 not_an_agent`.

## 5. Who did it

**What you can do now.** Read a card's History and tell which of your agents
did each thing, and which came from an old personal token.

**Try it in 3 clicks.** Open the sandbox card → **Activity** → **History**.

**What happened.** The comment, the edit and the move to In progress made with
Claude Code · Belka's token read **"Pawan Sirsat via Claude Code · Belka"**.
Everything done with Pawan's personal token (the MCP server this session runs)
reads **"Pawan Sirsat via agent (unregistered token)"**. Pawan's own browser
actions read plain "Pawan Sirsat".

**Evidence.** `21-drawer-claimed-{light,dark}-1440`.

## 6. Sessions and claims

**What you can do now.** Only one agent session holds a card at a time. Every
change it makes carries the claim's number (its *generation*), so a stale or
rival session cannot overwrite it. A claim that runs out stays out until the
agent takes it back on purpose.

**Try it in 3 clicks.** Pick an agent on a card; let it `start_working`; watch
the card's drawer when its harness stops.

**What happened.**

- `laika agent session start --harness claude-code … --pid <harness>` opened a
  session; `start_working` with that session claimed the sandbox at
  **generation 1**, lease 300 s.
- The helper sent heartbeats every ~30 s (`laika agent session status`: 2, then
  4).
- Writes: generation 1 → **200/201**; generation 7 → **409 `stale_claim`**; no
  generation → **409 `stale_claim`** ("send the claim generation with every
  change").
- **Codex · Belka** trying to claim, or to edit → **409 `claim_held`** ("Another
  agent session holds this task").
- **Pawan could still read and comment** — from the browser and with his
  personal token — while the agent held the card.
- **"Waiting for agent"** showed in the drawer and on the card before the claim.
- **Expiry, waited out at the production default (300 s), settings untouched.**
  Harness killed at 19:36:30, last heartbeat 19:36:08; the server wrote
  `task.claim_expired` at **19:41:30**.
- **"Claim expired" appears live, without stealing focus.** On the second run
  (19:50–19:56) the drawer was open with a half-typed comment and focus in the
  comment box. At **19:56:01** the drawer showed "Claim expired — The agent
  must reclaim explicitly; nothing was restored automatically" (a polite
  `role="status"` region), the drawer stayed open, the draft was intact, and
  focus never left the comment box (recorded every 500 ms in the page).
- After expiry: an edit with the expired generation → **409 `stale_claim`**
  ("Your claim on this task lapsed; reclaim it before changing the task").
  A plain `start_working` → refused ("expired; reclaim it explicitly").
  `start_working` with **`reclaim: true`** → **generation 2**. Generation 1
  stayed invalid (409); generation 2 worked (200).

**Note — by design, not a failure.** A comment with an expired generation was
accepted (201). SPEC §6.3 says "Reads and comments are never fenced".

**Observation — did not reproduce.** On the first expiry run the task drawer
was found closed, and focus on the page, some time between 19:38 and 19:42.
The second run, instrumented, kept the drawer open and focus in place through
the expiry. The first run had nothing recording, and the Chrome window was the
owner's to touch, so the cause is unknown. Not filed; worth watching.

**Evidence.** `21-drawer-claimed-*`, `24-drawer-after-expiry-light-1440`,
`25-claim-expired-live-{light,dark}-{1440,390}`.

## 7. The session follows the real process

**What you can do now.** A session lives exactly as long as the program running
the agent. Close the program and the board finds out on its own; nothing
silently takes the card back.

**Try it in 3 clicks.** Start a session bound to a running process; end the
process; read `~/.laika/agent-sessions/helper.log`.

**What happened.** Twice. The helper's watcher logged "abandon … harness
exited" and "stopped: harness_gone" within 8 s and 23 s of the kill, sent no
more heartbeats, and the claim then expired on the server's own clock. No
reclaim happened until one was asked for.

The bound process was a stand-in (`sleep`, named `lai582-harness`), passed with
`--pid`. The helper binds by PID and start time, which is the same for a real
`claude`; only the name differs.

## 8. A revoked agent's open stream is cut

**What you can do now.** Revoking an agent closes its live connections too, not
just its next request.

**Try it in 3 clicks.** Open `GET /api/v1/events?project=laika` with an agent's
token; revoke the agent in the Agents tab; watch the stream.

**What happened.** The stream opened at 19:36:47 with `event: ready`. The
throwaway agent was revoked in the UI at 19:37:06.7. The stream received exactly
one frame — `event: error`, `{"error":{"code":"unauthorized",…}}` — and closed
at 19:37:07.

## 9. Review still decides

**What you can do now.** An agent can hand work back for review with its proof,
but only a person can call it done.

**Try it in 3 clicks.** Let an agent `finish_task`; open the card; set Status to
Done yourself.

**What happened.** Claude Code · Belka reclaimed (generation 3) and tried to move
the card to Done → **403 `agent_cannot_mark_done`** ("Call finish_task to hand
it back for review"). `finish_task` moved it to **Review**. Trying Done again
afterwards → **403 `agent_cannot_mark_done`**. Pawan then moved it to **Done**
in the browser; History records that move as Pawan's (`actor_kind: user`).

**Found (LAI-584).** Inbox › Review shows only the oldest 200 of the 200+ tasks
waiting ("first 200", even with Project = Laika), so the sandbox could not be
reached there. It was accepted from the drawer's Status control instead.

**Evidence.** `26-review-before-accept-light-1440`,
`27-accepted-done-light-1440`.

## 10. Not delivered yet

**"Working"** and **"Connection lost"** on the card are LAI-568, PR #112 —
open and still a draft. While the agent held the sandbox, the drawer showed no
working or connection state, as expected.

---

## Making Belka's sub-agents act as these agents

Nothing below was changed; it needs the owner's go-ahead.

Today every Claude Code session in this repo talks to Laika through the
project-scoped `laika` MCP server in `~/.claude.json` (also defined for
On-Route and SkynetSALogistics), whose `Authorization` header carries **Pawan's
personal token**. That is why everything this session did reads "via agent
(unregistered token)". Codex has no `laika` server configured. Omnigent's
`~/.laika/omnigent.env` also carries the personal token.

To make them act as the registered agents:

1. **Claude Code.** Point the `laika` MCP server's bearer at Claude Code ·
   Belka's credential (the one in `~/.laika/agents/claude-code.json`) instead
   of the personal token — for the Laika project entry in `~/.claude.json`, or
   one user-scope entry. Then `laika agent hooks on --harness claude-code`, so
   each session opens its own agent session bound to its `claude` process and
   is told its `session_id` for `start_working`.
2. **Codex.** Add a `laika` MCP server to `~/.codex/config.toml` whose bearer
   is Codex · Belka's credential, then `laika agent hooks on --harness codex`.
3. **Omnigent sub-agents** run Claude Code, so they follow (1) if they read the
   same config. If they use `~/.laika/omnigent.env`, its `LAIKA_TOKEN` becomes
   Claude Code · Belka's credential.
4. **Keep the personal token for CHIEF.** Accepting into Done, registering
   agents and minting tokens are refused to agent credentials, by design. The
   session that reviews and accepts keeps Pawan's own.

Step 4 of the wizard's own instructions do (1) by running
`plugin/scripts/install.sh` with the **agent's** credential — which rewrites
`~/.laika/env` and replaces the personal token on that machine. On Belka, where
CHIEF needs the personal token, wire the MCP header by hand rather than
re-running the installer.

## What was run

All against production, from Belka:

- Playwright (the browser plugin's Chrome, signed in by Pawan) for every UI
  step. The Agents list, the drawer's Agent field, the List filter and Claim
  expired are captured light and dark at 1440 × 900 and 390 × 844; the board
  chip and the claimed drawer light and dark at 1440; the wizard steps, rename,
  access, rotate, revoke and accept screens light at 1440 only. Themes were set
  through `data-theme` for the capture.
- `curl` with header files (`-H @file`, 0600) for REST, so no token reached a
  command line; a small JSON-RPC script for MCP `tools/call`.
- `laika agent login claude-code|codex` (exit 0, 0), `laika agent session
  start` (exit 0, twice), `laika agent session status`.
