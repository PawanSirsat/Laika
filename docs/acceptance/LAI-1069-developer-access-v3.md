# LAI-1069 · Developer access V3, a local walkthrough

Board LAIKA-923. Slice F of `docs/proposals/LAI-1042-developer-access-v3-plan.md`:
F4 needs *"a live walkthrough recorded in `docs/acceptance/`"* before
production gets `LAIKA_DEVELOPER_ACCESS=v3`. This is that walkthrough, run
2026-11-02 between 01:58 and 02:09 UTC on **Belka**, against a **local**
instance. Production, `localhost:3000` and the real `~/.laika` were not
touched.

**What this proves and what it does not.** Every step that a browser, the
real helper CLI and plain HTTP can perform was performed. No real coding tool
was started: the "tool itself connected" check was satisfied by one MCP
`initialize` that names itself `claude-code` (step 9), and hook-driven
sessions and claims were never produced. §4 lists everything left
UNVERIFIED.

## 1. Set-up

| Item | Value |
| --- | --- |
| Code | branch `LAI-1069-v3-walkthrough` at `3ac0fac4` (= `origin/master` `4254bff0` + this task's board-build line). Built with `pnpm run build` in `server/web` (exit 0), `server` (exit 0) and `cli` (exit 0) |
| Server | `node dist/index.js` on `127.0.0.1:3469`, `NODE_ENV=production`, `LAIKA_DEVELOPER_ACCESS=v3`, `LAIKA_PUBLIC_URL=http://127.0.0.1:3469`, `LAIKA_BUILD_COMMIT=3ac0fac4…`, its own fresh DB file in a scratch directory |
| Port check | `lsof -ti tcp:3469` empty before start. First `GET /api/v1/health`: `uptime_ms` 4733, started 4 s earlier, `build_commit` `3ac0fac4…`; LISTEN pid 70310 |
| Helper | `node cli/dist/index.js` from this checkout, every run as `env -i PATH="$PATH" HOME=<throwaway>` so no real `~/.laika`, `LAIKA_*` variable or `~/.claude` was read or written. `laika --version` → `laika 0.1.0 (cli) · commit 3ac0fac · protocol 2`, exit 0 |
| Browser | Playwright (Chromium). Screenshots: each state at 1440 × 900 and 390 × 844, light and dark (theme switched with the `data-theme` attribute the theme store writes), full page. Every capture measured `scrollWidth − clientWidth = 0` |
| Evidence | `.polly/evidence/V3-walkthrough/` in the main checkout (not committed): 44 PNGs named `NN-state-<width>-<theme>.png`, and `text/` with the CLI outputs and the before/after probes |

## 2. A new developer

| # | Step | Result | Evidence |
| --- | --- | --- | --- |
| 1 | First boot at `/setup`: owner *Nova Developer*, org *Walkthrough Org*, project *Rocket*; *Create instance* | **PASS** — lands on `/board?project=rocket` | — |
| 2 | Developer access → **Overview**, first run: *Get started*, three steps, step 1 *Add a device* active, 2 and 3 disabled, *How this works* | **PASS** | `01-overview-first-run-*` |
| 3 | *Continue* → **Add a device**: Local, name `Walkbook`, *Yes — there is a checkout at ~/laika*, *Get a pairing code* | **PASS** — step 2 shows `git -C ~/laika fetch && laika update` and `laika device pair --board http://127.0.0.1:3469 --code Y948-3XBQ-N4MZ-AQ6N`, *"Waiting for the device · Code expires in about 10 min"* | `02-pairing-wait-*` |
| 4 | Real pairing on the "device": `laika device pair --board http://127.0.0.1:3469 --code Y948-3XBQ-N4MZ-AQ6N` (throwaway HOME) | **PASS** — prints fingerprint `2d5b684dd80c3753`, waits; the CLI polls `POST /device-pairing/…/complete` → `202` until approved | `text/pair.out` |
| 5 | Browser moves by itself to **Check the key**: `2d5b 684d d80c 3753`, *System darwin 27.2.0*, *Helper 0.1.0*. Compared character by character with the terminal: identical. *Approve Walkbook* | **PASS** | `03-fingerprint-approve-*` |
| 6 | **Paired**: *"Walkbook is paired with this board"*, fingerprint shown. CLI: `Paired as Walkbook.`, **exit 0**. HOME now holds only `~/.laika/device/key.pem` and `device.json`; `grep -r lai_` over HOME: nothing | **PASS** | `04-paired-*`, `text/pair.out` |
| 7 | *Add a tool to Walkbook* → Claude Code → *Get the command*: `laika tool add claude-code --exchange 01M6CZT4HP296NJPV8XNEMKC1D`, *"No secret is in this command"*, checks all Missing but *Device paired* | **PASS** | `05-add-tool-command-*` |
| 8 | Real `laika tool add claude-code --exchange 01M6CZT4HP296NJPV8XNEMKC1D` (throwaway HOME) | **PASS**, **exit 0** — credential in `~/.laika/agents/claude-code.json` mode `0600` (the only file containing `lai_`), hooks added to `~/.claude/settings.json`, *"reported this helper's version"*; `~/.laika/env` never created | `text/tooladd.out` |
| 9 | *Credential installed* → **Done** in the browser by polling. Then **one MCP request with the tool's credential**: `POST /mcp`, `Authorization: Bearer <the token from claude-code.json>`, body `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-code","version":"2.1.280"}}}` → `200`, `serverInfo.name` `laika` | **PASS** — *Claude Code connected* **Done**: *"It called the board on its own credential just now, naming itself claude-code 2.1.280"*; *Sessions and claims* stays **Missing**; header *Connected · no session from its hooks yet* | `06-checks-partial-*` |
| 10 | *Finish for now* → Finish: consent switch **Off — never given**; *Set up a project* | **PASS** | — |
| 11 | **Project setup**: Rocket, *Claude Code · Walkbook*, access *No access* by default → **Read only** → *Save access* → *Saved.*, *In effect: Read only*. Checked with the tool's credential: `GET /projects/rocket/tasks` **200**; `POST /projects/rocket/tasks` **403** `agent_read_only` | **PASS** | `07-project-prompt-*` |
| 12 | The prompt (revision 2, `project=rocket`, *carries no token*; `lai_` absent from its text) followed **by hand** in a scratch git repo whose `CLAUDE.md` already had *"# Rocket … Our own notes. Keep these."*: step 1 read the file; no Laika block, so step 4 — appended the block exactly (34 lines, `<!-- laika:begin revision=2 project=rocket -->` … `<!-- laika:end -->`); existing text kept. One-line report: *appended the block*. Then *I've added it* (self-reported) | **PASS** | `text/prompt.txt` |
| 12b | `laika project check --dir <scratch repo>` | **NOT AVAILABLE** — `laika: unknown command "project"`, **exit 1**. #221 (LAI-1066) is not merged; the page itself says *"Coming later: laika project check … It is not available yet."* | — |
| 13 | **Devices** → tool ⋯ → *Reconnect (new credential)…* | **PASS** — opens *Reconnect a tool* with a new exchange `01M6CZYVXVC9D5KA13S7NYAD2S` and the inline warning *"This replaces Claude Code's current credential. When the command runs, the credential it uses now stops working at once"*. No modal: nothing is rotated until the device redeems | — |
| 13b | Real `laika tool add claude-code --exchange 01M6CZYVXVC9D5KA13S7NYAD2S` | **PASS**, **exit 0** — same agent id `01M6CZT4HNSHMBHBZ3HKQETNMK`, token prefix `lai_QLCU` → `lai_Vkon`; old token `GET /me` **401**, new **200**; hooks *"already installed"*, `settings.json` byte-identical | `text/reconnect.out` |
| 13c | tool ⋯ → *Disconnect tool…* — the exact confirmation: **"Disconnect Claude Code · Walkbook?"** / *"Its credential lai_Vkon… stops working at once. It has no running session. Any task it holds stays claimed until its claim lapses, then it can be recovered. It cannot be restored. Your other tools and your own tokens are not touched."* [Cancel] [Disconnect tool] → *Disconnect tool* | **PASS** — *"Claude Code · Walkbook disconnected."*; its token `GET /me` **401** | `08-disconnect-confirm-*` |
| 13d | The Devices list after that disconnect | **FAIL** → **LAI-1070** — *"0 devices · 0 tools"* and *"Every device and tool of yours is revoked."*, while `GET /devices` still returns Walkbook `status: active`, paired. Persists after reload | — |

## 3. An existing developer, `classic` → `v3`

A second fresh instance on the same port and its own DB file, started with
`LAIKA_DEVELOPER_ACCESS=classic` (pid 88367, `uptime_ms` 6360 at 6 s).
`POST /api/v1/setup` → **201** (owner *Old Hand*, project *Comet*). Seeded
through the signed-in browser session's own API calls:

| Seed | Call | Result |
| --- | --- | --- |
| Agent A | `POST /agents` `{harness:"claude-code", device_label:"Strelka", grants:[Comet full]}` | **201** `01M6D038TTTYAX4T218EXHND57` |
| Agent B | `POST /agents` `{harness:"codex", device_label:"Strelka", grants:[Comet read_only]}` | **201** `01M6D038V1JEHC0WNF76JA61W0` |
| Legacy duplicate | `POST /agents` `{harness:"claude-code", device_label:"Strelka", …}` | **409** `conflict` — D-120 refuses it, as it should. Made instead as `device_label:"strelka-legacy-dup"` (**201** `01M6D038VBQJHP2JBWZFHS2BP2`), then, **with the server stopped**, relabelled in the SQLite file to `Strelka` on Strelka's device id, and the leftover one-agent device marked revoked. **This is a fixture**: an API cannot produce a pre-D-120 duplicate any more |
| Personal token | `POST /tokens` `{name:"deploy script", scope:"full"}` | **201** `01M6D03G1VQXDJMVS7RZJKKR88` (`lai_n9So…`); used over MCP: `initialize` **200** as `deploy-script`, `tools/call laika_whoami` → *Old Hand*, agent `null`, scope `full` |

Old `POST /agents` linked A, B and the duplicate to one **imported** device
*Strelka* (`01M6D038TV4TM5D87WVWV5KCWD`, `origin imported`, unconfirmed).

Then a probe (`text/probe-<mode>.txt.db|.http`): the `agents`,
`agent_project_grants`, `tokens` and `devices` rows, and for each of the four
tokens `GET /me` and MCP `laika_whoami`. Run under `classic` (pid 25063),
the server stopped, restarted on the **same DB and secret** with `v3` (pid
29927, `uptime_ms` 5823 at 6 s, compatibility `developer_access: "v3"`), run
again.

| # | Step | Result | Evidence |
| --- | --- | --- | --- |
| 14 | `diff probe-classic.txt.db probe-v3.txt.db` and `diff probe-classic.txt.http probe-v3.txt.http` | **PASS** — both identical: same agent ids, harnesses, labels, device ids, statuses; same grants (A full, B and dup read_only on Comet); same tokens, none revoked; every token `/me` **200**, every agent token's `laika_whoami` names its own agent, the personal one names none | `text/probe-*` |
| 15 | v3 **Devices**: *Strelka · Local · Imported*, *"Imported device — confirm it's yours…"* with *Confirm it's mine*; *Codex · Strelka* as a tool row; *"Needs your attention: 1 conflict"* expanded: *"These were registered before one agent per tool per device. Each keeps working and nothing here revokes either…"*, *Claude Code · Strelka: 2 active*, each with its private name to tell them apart | **PASS** | `09-devices-imported-conflict-*` |
| 16 | v3 **Advanced**: *deploy script · PERSONAL (LEGACY) · lai_n9So · full · Used just now · All projects · No expiry*, *"One of these is used by a coding tool. That is the old way…"*, *Upgrade connection* | **PASS** | `10-advanced-legacy-token-*` |
| 17 | **Update status** on device and tool rows | **UNVERIFIED** — E3 (LAI-1065, #218) is not merged; on `master` every row shows the deliberate placeholder *Version unknown* (`devices-view.ts:94`), visible in `09-…`. CLI side: `laika update --check` → *"Up to date: this checkout is the board's own commit"*, **exit 0**; `laika doctor` **exit 1** with `OK update` and an `ACTION` for the disconnected tool credential (correct) | `text/update-check.out`, `text/doctor.out` |
| 18 | **Organisation → Overview**, owner: *"Board build 0.1.0 · 3ac0fac4e283 · helper protocol 2 (accepts 1+)"* as a muted line (this task's change, §5) | **PASS** | `11-org-overview-board-build-*` |

## 4. Not verified here

| What | Why | Status |
| --- | --- | --- |
| Claude Code itself (`laika-claude`) connecting and its **hooks opening a session** — *Sessions and claims* → Done, *Ready* | No real harness was started; the hooks file was written to a throwaway HOME nothing reads | **UNVERIFIED** |
| A hook-driven `start_working` claim and its heartbeat on the walkthrough board | as above | **UNVERIFIED** |
| Codex, Cursor, Gemini CLI, VS Code / Copilot, Omnigent, Antigravity, and the *Unverified* group (OpenCode … Claude Desktop) through `tool add` or by hand | Only Claude Code was exercised; the picker lists them | **UNVERIFIED** |
| Cloud device (24 h token) path | Local only | **UNVERIFIED** |
| `laika project check` and server-recorded project evidence | #221 not merged | **UNVERIFIED** |
| Update status words, *What's new*, *Copy update command* in the web | #218 not merged | **UNVERIFIED** |
| `git -C ~/laika fetch && laika update` from the pairing command | The throwaway HOME has no `~/laika`; the helper ran from this checkout | **UNVERIFIED** |
| Whether Claude Code gets the Laika MCP server: the *Automatic* tile says *"Credential, MCP entry and session hooks"*, `tool add` wrote none, `laika doctor` says *"no tool on this machine has a laika MCP entry"* | Depends on `laika-claude` supplying it at launch, which needs a real run | **UNVERIFIED** — asked in **LAI-1072** |
| Keyboard-only paths, focus return, screen-reader announcements | Mouse-driven run; the live-region texts were read from the accessibility tree only | **UNVERIFIED** |
| Production behaviour with the flag on | F4 is the operator's step after this record | not in scope |

## 5. The small UI change in this PR

Organisation → Overview ends with one muted line naming the board's build —
`server.version`, `server.build_commit` (first 12 hex, full SHA in the
`title`), and the helper protocol with its minimum when it differs — from
`GET /developer/compatibility`. Owners and admins only; absent when the
answer cannot be read, *"commit not recorded"* when the build did not say.

- `server/web/src/api/developer-compat.ts` — `boardBuildOf()`, `loadBoardBuild()`
- `server/web/src/routes/screens/organisation/BoardBuildLine.tsx` (new)
- `server/web/src/routes/screens/organisation/OrganisationScreen.tsx` — rendered for `owner` / `admin`
- `server/web/src/routes/screens/organisation/organisation.css` — `.org-board-build`
- Tests: `server/web/test/api/developer-compat.test.ts` (3 new cases),
  `server/web/test/browser/organisation-board-build.test.ts` (new, 10 cases:
  owner and admin see the server's figures, member and viewer do not though
  the page has the answer, null commit, failed read, 1440/390 × light/dark
  with no sideways scroll and a muted colour). Mutation: rendering the line
  for every role turns the member and viewer cases red (2 fail); restored.

## 6. Defects found, filed, not fixed here

| Task | Board | What |
| --- | --- | --- |
| **LAI-1070** (p2, web) | LAIKA-924 | A paired device disappears from Devices once its only tool is disconnected, and the tab says every device is revoked (`deviceLive()`, `devices-view.ts:139`) |
| **LAI-1071** (p3, web) | LAIKA-925 | Reconnect's rail draws `✓` beside *"Not yet"* for step 1; Overview's *Add a device* body speaks of registering a tool |
| **LAI-1072** (p3, cli) | LAIKA-926 | `tool add` tells you the browser ticks *"Tool request seen"* (it shows *Claude Code connected*); `doctor` sends a refused `tool add` credential to *"log the agent in again"* rather than Reconnect; the MCP-entry question above |

**Observed, not filed:** before first boot `GET /developer/compatibility`
answers `409 setup_required`, so the first-boot page logs one console error.
That is the setup gate working as SPEC §6.4 and LAI-009 specify (only
`/health` and `/setup` answer before an org exists); the shell treats the
failure as `classic`, which is harmless there.

## 7. Clean-up

Each server stopped by its own LISTEN pid (70310, 88367, 25063, 29927; port
3469 free after each). Both DB files with their `backups/`, the throwaway
HOME (device key, tool credential, hooks file) and the scratch repository
deleted. The seeded secrets were kept only in a `0600` scratch file, never
printed in full, and deleted with it.
