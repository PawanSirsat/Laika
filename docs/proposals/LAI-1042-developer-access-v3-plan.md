# Laika Developer Access V3 — implementation plan

**Status:** plan only. Nothing in the repo was edited.
**Base:** `origin/master` `cea011d6`, read from a `git archive` export.
**Written:** 2026-11-02 by an EXPLORE agent on Belka.

**Paths.**
- `S/` = `server/src/`
- `W/` = `server/web/src/`
- `C/` = `cli/src/`
- `P/` = `plugin/`

Line numbers are from `cea011d6`.

**Labels on claims.**
- **Verified**: read in the code at that line.
- **Inference**: deduced from what was read, not run.

**Inputs that were read.**
- The V3 prototype (`~/Downloads/laika-developer-access-v3.html`), read in full, scripts included.
- The earlier inventory (`~/Desktop/laika-developer-access-redesign-prompt.md`, from `19f85875`). It was re-checked; differences are in §A.
- `CLAUDE.md`.
- SPEC §3.1, §4.9, §4.63–§4.67, §6.1–§6.3.
- DECISIONS D-111, D-114 – D-121 (and D-117).
- `docs/AGENTS-ROLLOUT.md`, `docs/CONVENTIONS.md`, `docs/design/README.md`.
- Three parallel read-only sweeps covering server, web and CLI/plugin. Their key claims were then spot-checked by hand.

**Ids.**
- The next free Belka id is **LAI-1042**: the git sweep over every local and remote branch reaches LAI-1041, and `get_task_context LAI-1042` / `LAI-1043` answer `not_found` on the board.
- The slices below are numbered from LAI-1042 as a **proposal only**. Re-run the §3 sweep and the board check immediately before each filing.

---

## A. Repo vs brief: differences found

Each row gives what the brief or prototype assumes, what the repo actually has, and the smallest safe resolution.

**A1. Developer access shape** — Verified.
- **Brief / prototype:** Overview / Project setup / Devices / Activity / Advanced.
- **Repo:** five tabs, `connect, agents, projects, activity, tokens`, with **Connect the default** (`W/routes/page-tabs.ts:70-76, 107-115`). An unknown `?tab=` falls back to Connect silently.
- **Resolution:** add a new tab set behind a flag (§I). Old tab ids become **aliases**, never 404s (§C).

**A2. Feature flags** — Verified.
- **Brief:** "Feature flag(s) & rollback".
- **Repo:** **there are no feature flags anywhere** in `S/` or `W/`. `S/env.ts:20-58` holds only process settings. The only web build switch is `W/demo/enabled.ts:18`. AGENTS-ROLLOUT §3 says "There is no global feature switch".
- **Resolution:** introduce one per-deployment env flag, `LAIKA_DEVELOPER_ACCESS` = `classic|preview|v3`, served to the web through the compatibility endpoint (§E.6). No DB column, so rollback is an env change plus a restart.

**A3. Device identity** — Verified.
- **Brief:** a device has a "server opaque ID + proof of possession".
- **Repo:** a device is **only a normalised label**, `label?.trim().toLowerCase() ?? ''` (`S/db/device-label.ts:1-4`). It is grouped from `agents.device_label` (`S/services/agents.ts:453-490`). `recognised_agent_devices` is a statement per label (SPEC §4.67: "not device identities or fingerprints").
- **Resolution:** an additive `devices` table, plus a nullable `agents.device_id`. `agents.device_label` stays the authority for the D-120/D-121 rules (§D).

**A4. Cloud devices** — Verified, and it conflicts.
- **Brief:** "local vs cloud + friendly name".
- **Repo:** D-121 item 2 says a cloud runner is **the device labelled `Cloud`**, with "No new field". The 24 h rule keys on the label `Cloud` (`S/services/agents.ts:91, 691-708`).
- **Conflict:** a `kind` field contradicts D-121 item 2. Two cloud runners named freely would also each need the 24 h rule.
- **Resolution:** this needs an owner decision (L1). Proposed default: `devices.kind` is added, **and the 24 h rule applies when kind = cloud OR label key = `cloud`**. That is strictly tighter than today, so nothing loosens.

**A5. Agent identity per pair** — Verified.
- **Brief:** "one active agent per (owner, normalized device, harness), grandfathering duplicates".
- **Repo:** already enforced by `assertHarnessDeviceFree`, which answers `409 agent_exists_for_harness_device` (`S/services/agents.ts:715-747`). Duplicates are kept (D-120 item 3).
- **Resolution:** keep the existing check. Add **create-or-reuse** semantics in the new add-tool endpoint (§E.2) rather than changing `POST /agents`.

**A6. Separate "Register agent" wizard** — Verified.
- **Brief:** no separate Register agent wizard.
- **Repo:** there are two wizards. Connect has 4 steps and mints a **personal** 90-day token. Agents has 5 steps (`AgentsTab.tsx` 1743 lines; `W/components/agent/agent-states.ts:167-173`).
- **Resolution:** V3 replaces both with **Add device → Add tool**. The classic tabs remain under the flag until Slice F.

**A7. Credential delivery to the helper** — Verified.
- **Brief:** "short-lived one-time bound exchange; credential never in argv/prompt/transcript".
- **Repo:** today the secret is **shown in the browser and embedded in a machine prompt pasted into Claude** (`W/routes/screens/connect/connect-copy.ts:131-192`). It goes to `curl` on argv (step 3 of that prompt), and then the person pastes it again into `laika agent login`.
- **Resolution:** a new tool-setup exchange redeemed by device signature (§E.2). The token is minted at redemption and lands only in `~/.laika/agents/<harness>.json`.

**A8. `~/.laika/env` must not be overwritten** — Verified.
- **Brief:** "don't overwrite ~/.laika/env".
- **Repo:**
  - `P/scripts/install.sh:78` does `cat > "$CONFIG"` with no backup.
  - `C/connect.ts:527-544` replaces it atomically, also with no `.bak`.
  - Agent credentials are already isolated per harness at `~/.laika/agents/<harness>.json`, 0600 (`C/agent-session.ts:68-70, 160-190`).
- **Resolution:**
  - V3 never writes `~/.laika/env`.
  - `install.sh` gains `--no-credential` and backs up before any rewrite (C3).

**A9. Distribution** — Verified.
- **Brief / prototype:** `npx laika`.
- **Repo:**
  - `cli/package.json` is `"private": true`, version `0.1.0`.
  - `cli/bin/laika:4-12` explains why `npx` cannot work.
  - **The GitHub repo is PUBLIC** (`gh repo view` → `PUBLIC`; LAI-627).
  - There are no release tags.
  - The Docker image excludes `cli` and `plugin` (`docker/Dockerfile.dockerignore`).
  - The server serves no downloads.
- **Resolution:** bootstrap with `git clone` at the **board's own build commit**, served by the compatibility manifest. `laika update` fetches that pinned commit (§F.5).

**A10. Version info** — Verified.
- **Brief:** "build + supported client protocol range".
- **Repo:**
  - Server, CLI and plugin are all `0.1.0`, never bumped.
  - `/api/v1/health` returns `{status, version, uptime_ms}` (`S/http/routes/health.ts:17-29`).
  - The image carries **no git SHA**.
- **Resolution:**
  - Add `LAIKA_BUILD_COMMIT`: a Docker `ARG`/`ENV` plus a `deploy.yml` build-arg.
  - Add `PROTOCOL` constants.
  - Add a compatibility endpoint.

**A11. Client version and capability reporting** — Verified.
- **Brief:** "record version/capabilities reported by authenticated tool".
- **Repo:**
  - `agent_sessions` already stores `client_version`, `harness`, `harness_version`, `model` (SPEC §4.65; `S/http/routes/agent-sessions.ts:32-60`, strict).
  - The CLI sends `client_version = "laika-agent/<harness>"`, which is **not a version** (`C/agent.ts:624`).
  - The MCP `clientInfo.version` is discarded (`S/mcp/server.ts:303-308`).
- **Resolution:**
  - A new latest-report table.
  - The CLI sends the real version and commit **only when the manifest says the server accepts them**. The bodies are strict, so an old server would answer 422.

**A12. Token kind in views** — Verified.
- **Brief:** "add kind/agent_id to token views".
- **Repo:**
  - `TokenView` has neither field (`S/services/tokens.ts:50-71, 94-109`; client `W/api/tokens.ts:25-52`).
  - `selectTokens` filters on `user_id` only (`S/services/tokens.ts:312-333`).
  - So agent credentials appear unlabelled in Tokens, Org Security and the profile's "Their tokens".
- **Resolution:** a three-owner change under §4.4 — SPEC §6.4, server, and client `view-type-drift`.

**A13. Revoking an agent's token on Tokens** — Verified.
- **Repo:** `revokeOwnToken` → `revokeTokenRow` never touches `agents` (`S/services/tokens.ts:269-279, 373-384`). The agent stays active with no live credential.
- **Resolution:** keep the behaviour (old clients depend on it). V3 never offers it outside the tool row, and the admin confirmation names the exact impact (§B).

**A14. An agent token sees its owner's credentials** — Verified.
- **Brief:** "others' agents/devices 404" (cross-owner).
- **Repo:** `AGENT_TOKEN_ORG_ACTIONS` keeps `token.read_own` and `agent.read_own` (`S/policy/actions.ts:232-250, 354-358`). So an agent's token can `GET /tokens` (the owner's tokens' metadata) and `GET /agents` (all sibling agents and their grants). Cross-owner behaviour is correct.
- **Resolution:** not in the brief. Filed as a **risk** (L6). Proposed: an agent token's `GET /tokens` and `GET /agents` return only itself. This is a separate task, because `laika agent` calls `GET /agents/me/*` and not the lists — Inference, to be verified before narrowing.

**A15. Audit verbs** — Verified.
- **Brief:** "audit/activity verbs" for new actions.
- **Repo:**
  - **By design no verb** is written for register, grant, device, consent or session (`S/services/agents.ts:46-51`; SPEC §4.63 "No new §4.8 verb").
  - Adding a verb rebuilds `activity` and is three-owner (CLAUDE.md §4.4).
- **Resolution:** follow the D-114 convention. The new tables are the record, and `token.created` / `token.revoked` still fire on mint and revoke. New verbs are only on owner request (L4).

**A16. Rate limits** — Verified.
- **Brief:** rate limits on pairing.
- **Repo:**
  - An in-process bucket exists (`S/http/rate-limit.ts:36-57`; middleware `S/http/middleware/rate-limit.ts:67-68, 114-164`).
  - **Anonymous requests share one bucket** (SPEC §6.3).
  - A sign-in style backoff with a shared key for unmatched links exists (`S/auth/sign-in-throttle.ts`; the password-reset pattern, SPEC §6.1).
- **Resolution:** add a `pairing` bucket class, plus a reset-link-style backoff on a shared key for unmatched codes (§E.1).

**A17. Project prompt** — Verified.
- **Brief:** update only the Laika block.
- **Repo:**
  - `projectPrompt()` stops if `BLOCK_MARKER` is present. **It cannot update a stale block.**
  - The block has **no end delimiter and no revision** (`W/routes/screens/connect/connect-copy.ts:62-100, 204, 211-229`).
  - `instructionsTarget()` lives in `connect-agents.ts:1242-1326`, not in `connect-copy.ts`.
- **Resolution:**
  - Block revision 2 with begin/end comment markers.
  - Keep `BLOCK_MARKER` verbatim, because the activity scope detection depends on it (Inference: CLI repo detection — verify in `C/activity*.ts` before changing anything near it).

**A18. Harness id lists disagree** — Verified.
- **Prototype:** Claude Code / Codex / Omnigent with `laika agent login omnigent`.
- **Repo:**
  - The CLI `HARNESSES` are `claude-code, codex, cursor, copilot-cli, copilot-vscode, copilot-cloud, gemini-cli, antigravity` (`C/agent-adapters.ts:29-38`).
  - **Omnigent is not one**, so `laika agent login omnigent` fails today.
  - The server `AGENT_CLIENTS` has `omnigent` and `vscode`, but no copilot-* ids (`S/auth/agent-clients.ts:42+`).
  - The web has 21 guides (`W/routes/screens/connect/connect-agents.ts:93-222`).
- **Resolution:** a single **tool capability manifest** (§E.6/§M) that maps web guide → server harness → CLI harness. Omnigent becomes a CLI login target with credential-only support in C3.

**A19. Design tokens** — Verified.
- **Brief:** "existing tokens; no raw hex".
- **Repo:**
  - The code tokens are in `W/styles/theme.css`: dark `:root` at :40, light `[data-theme='light']` at :191.
  - **There are no `--ok/--warn/--danger`.** Statuses use `--chip-green*`, `--chip-orange*`, `--overdue*`, `--blocked-bg`, `--accent*`.
  - `docs/design/README.md:92-112` uses design-tool names (`--grn`, `--amb`, …) that the code does not use.
- **Resolution:** reuse `--chip-*` and `--accent*`. **No new token is needed.** If a "Version unknown" neutral chip is wanted, reuse the `--tx3`-equivalent text token rather than a new colour. Flag any addition per D-020.

**A20. Shared UI components** — Verified.
- **Brief:** reuse "step rail, wizard card, tool tiles, code blocks, copy".
- **Repo:**
  - **The step rail, tool tiles and code block are private to `ConnectScreen.tsx`**: `.conn-rail` :503-533, `AgentPicker`/`AgentTile` :931/1016, `SetupBlockView` exported at :1057.
  - `RegistrationSteps.tsx` is a second rail.
  - There is no shared ⋯ menu (four ad-hoc `role="menu"`).
  - `CopyButton` has no live region.
  - There is a focus trap: `W/components/use-dialog-focus.ts` (used by `ConfirmDialog`).
- **Resolution:** Slice D0 extracts `components/wizard/` (StepRail, WizardCard), `components/ToolTile`, `components/CodeBlock` (from `SetupBlockView`), `components/OverflowMenu` and a throttled `components/live-region`. This is pure refactoring with golden tests before V3 screens use them.

**A21. Four-digit ids in SPEC Planned marks** — Verified.
- **Repo:** `PLANNED_MARK` is `/(LAI-\d{3})/` (`server/test/tooling/schema-spec-drift.test.ts:183`). It reads `LAI-1045` as `LAI-104`. LAI-1002 (filed) is still in **backlog**.
- **Resolution:** **LAI-1002 is a prerequisite** of any SPEC §4 "Planned — LAI-10xx" mark used by Slice B/C.

**A22. Stale strings** — Verified.
- **Repo:**
  - The installer and `connect` say "sidebar SETTINGS → Tokens … Use YOUR OWN".
  - The production IP is the default in `install.sh:36` and in `W/components/CopyButton.tsx:9` (LAI-627, in progress).
  - `install.sh` appends the PATH line non-idempotently (:162).
- **Resolution:** C3 fixes the installer strings and makes the PATH line idempotent. The IP is left to LAI-627 (do not collide).

**A23. People "Agents" column and Space "Agent sessions"** — Verified.
- **Repo:**
  - The People "Agents" column counts **presence** entries (`PeopleTab.tsx:560, 680-686`).
  - The Space switch is `agents_allowed` (`space-settings/AccessTab.tsx:197-221`).
  - Profile "Agents used" is built from tokens and presence (`ProfileScreen.tsx:1332-1364`).
- **Resolution:** copy and terminology fixes only (Slice F).

**A24. Security link target** — Verified.
- **Repo:** Org Security's own-row "On Developer access" links to `/developer` with no tab, so it lands on Connect (`OrganisationScreen.tsx:656-668`).
- **Resolution:** point it at `?tab=advanced` once v3 is live. In classic mode, `?tab=tokens`.

---

## B. Existing vs target: keep / merge / move / rename / remove

**What V3 is.** One destination, `/developer`, titled "Developer access". It has five tabs: **Overview · Project setup · Devices · Activity · Advanced**. The mental model is a **Device** that holds **Tools**; a **Tool · Device** pair is a registered agent. **Project access** is separate, and so are **repo instructions**.

### B.1 Developer access shell
| Component (where) | Decision | Reason / target |
| --- | --- | --- |
| Page header copy "A token lets a tool act as you…" (`DeveloperScreen.tsx:57-70`) | **Rename** | It describes the legacy model only. New: "Connect your devices and coding tools to this board, then set up each project repository." |
| Header Board-URL chip (Connect only) | **Move** | To the Overview header and the Add-device wizard. |
| Header "+ New token" (Tokens only) | **Move** | Into Advanced. |
| Tab bar `connect·agents·projects·activity·tokens` | **Replace** (flag) | `overview·projects·devices·activity·advanced`. Old ids become aliases (§C). |
| `localStorage['laika.connect.agent']` | **Keep, rename semantics** | It remembers the last tool chosen in Add tool and Project setup. Read with try/catch. |

### B.2 Connect tab (`W/routes/screens/connect/*`)
| Component | Decision | Reason |
| --- | --- | --- |
| 4-step wizard (personal-token mint) | **Remove from default path; keep in Advanced** as "Connect a script or a tool as yourself (legacy)" until Slice F, then **remove** the AI-tool framing | It mints a personal token for an AI tool, which the brief forbids for tools. Personal tokens stay, for scripts. |
| Step 1 agent picker (`AgentPicker/AgentTile`, groups, search, 21 guides) | **Merge → Add tool step 1** | The same tiles, driven by the tool capability manifest. No hard-coded count: the "Search 21 agents" placeholder reads `AGENT_GUIDES.length`, or better, no number at all. |
| Step 2 mint and one-time secret box | **Remove** for tools; **keep** in Advanced (personal tokens) | Tools receive credentials by exchange (§E.2). |
| Step 3 setup blocks (`setupBlocks`, `SetupBlockView`, Automatic/By hand, chips) | **Merge → Add tool step "Configure on this device"** | The "Automatic" block becomes one `laika tool add …` command with no secret. "By hand" keeps the per-tool snippets with `${LAIKA_AGENT_TOKEN_<TOOL>}`-style references, never values. |
| Claude Code **machine prompt** (`connect-copy.ts:131-192`) | **Remove** (after Slice F) | It carries the secret into a transcript and onto `curl` argv. It is replaced by the bootstrap command (§F.6) plus pairing. Kept only in the classic flag mode. |
| Step 4 live check (`connect-live.ts`, presence fallback) | **Replace** with per-tool verification (§E.3) | Today it is satisfied by any use, and in presence mode by any agent. |
| "What agents can do" (hard-coded "Eighteen tools") | **Move → Overview "How this works" help**, with the count read from the server | Read the tool list length from MCP `tools/list` metadata, or drop the number. |
| "After connect" buttons | **Merge** | Into the Add-tool done state: "Set up a project →" (primary) and "Add another tool". |
| Deep links `?agent=`, `?step=` | **Keep** as aliases | §C. |

### B.3 Agents tab, including "Your devices"
| Component | Decision | Reason |
| --- | --- | --- |
| "Registered agents" list (`AgentsTab.tsx` `AgentRow`) | **Merge → Devices tab, tool rows nested under each device** | Devices hold tools. |
| "+ Register an agent" 5-step wizard | **Remove** (V3) | Replaced by Add tool, which creates or reuses the agent automatically. |
| Wizard step 1 harness + device text input | **Remove** | The device is chosen from paired or imported devices. Free text is gone. |
| Wizard step 2 grants | **Move → Project setup** (per project) and **tool ⋯ → "Project access"** | Least privilege: a new tool starts with no grants. |
| Wizard step 3 credential secret panel | **Remove** for V3 | Exchange. It stays only in the "Set up by hand" fallback (§F.4), shown once with today's rules. |
| Wizard step 4 harness instructions | **Merge → Add tool configure step** | — |
| Wizard step 5 verify | **Replace** by the per-tool evidence checklist | §E.3. |
| `DevicesSection` grouping, "Not recognised", "This is mine" | **Rename/merge** | It becomes the Devices tab list. "Not recognised" becomes **"Imported device — confirm it's yours"** with "Confirm" (same `POST /agents/devices/confirm`) and optional "Pair this device". |
| "Revoke device" (danger button) | **Move under ⋯** as "Disconnect device…" | The confirmation names every tool and its live sessions. |
| Duplicate pill / "Duplicate: {n} active" / twin mark | **Move → expandable "Needs your attention: {n} conflicts"** section on the device | Duplicates stay intact. Owner-mediated: "Keep this one" revokes the others after confirmation. |
| Readiness block (Credential created / Connected / **Ready for recovery — always "not yet"**) | **Replace** with one status word + reason (§H) | A placeholder line is removed. |
| Facts: Owner / Last seen / Projects / Credential prefix / **"Recovery: Not available yet"** | **Keep** Owner, Last seen, Projects, Credential prefix; **remove** Recovery placeholder | No fake states. |
| `CheckpointConsentSwitch` | **Keep** (tool row ⋯ → Settings, and visible on the expanded row) | Default off. Session only. |
| Rename (duplicates only) | **Keep** under ⋯ on duplicate rows | D-120 note field. |
| Manage access | **Move → tool ⋯ "Project access"** + Project setup | — |
| Rotate token | **Keep** under ⋯ as "Reconnect (new credential)…" | Atomic rotate. In V3 it creates a **rotation exchange**, so the secret is never in the browser (§E.2). |
| Revoke | **Keep** under ⋯ as "Disconnect tool…" | The confirmation names the sessions and claims that end. |
| Cloud-expired hint | **Keep** | Reworded: "Cloud credentials last a day. Reconnect to give the runner a fresh one." |
| Cancelled-register notice | **Remove** | The exchange model cannot leave an unseen secret. |
| `RegistrationStep.tsx` (gallery only) | **Remove** with the gallery entry in Slice F | Dead in live UI (Verified: used only by `AgentStateGallery.tsx:7`). |

### B.4 Projects tab (`ProjectsTab.tsx`)
| Component | Decision | Reason |
| --- | --- | --- |
| "Add this project" card | **Promote → "Project setup" tab and the Overview primary CTA** | The brief's most important flow. |
| Agent dropdown (21 guides) | **Replace** with "Connected tool" (the person's agents) | It names a real Tool·Device and shows its server-checked access. |
| Project dropdown | **Keep** (`useProjects`) | — |
| `projectBlock` / `projectPrompt` / `instructionsTarget` | **Keep + revise** (revision 2, update-in-place prompt) | §G. |
| `laika connect <id> --project` note (vscode/omnigent) | **Keep as a separate explicit step** "Repo MCP config (optional)" | Brief requirement. |

### B.5 Activity tab
| Component | Decision | Reason |
| --- | --- | --- |
| `ShareActivity` + `HeldDays` + Delete history | **Keep, move into the V3 Activity tab unchanged** | The org-controlled rules (D-102, D-111) are unchanged. |
| "Count work in: Only repos set up for Laika" | **Keep**; the copy links to "Project setup" instead of "Projects tab" | — |
| "Once per machine" chip | **Rename** "Once per device" | Vocabulary. |

### B.6 Tokens tab (`TokensScreen.tsx`)
| Component | Decision | Reason |
| --- | --- | --- |
| Token list | **Move → Advanced, filtered `kind=personal`** | Agent credentials are never listed as anonymous personal tokens. |
| "+ New token" form (name, scope; no expiry field) | **Keep in Advanced**; **add an expiry select** (default 90 days, "Never" still allowed per D-121 clarification) | Matches Connect's 90 days. Never-expiring stays possible but is not the default. |
| Name hint "Only you see this." | **Fix** | It is false (SPEC §4.9). New: "Shown to you, and to anyone who can read a task this token creates." |
| Secret panel, Revoke confirm, Scope reference, CLI quick start | **Keep in Advanced** | The CLI quick start is labelled "For scripts and the API". |
| Legacy personal tokens used by AI tools | **Label "Personal (legacy)"** plus an optional **"Upgrade connection"** (opens Add tool for the detected client from `last_client`) | It never forces anything. |
| Revoke failure only shown when form open (inferred bug) | **Fix** in the Advanced move | — |

### B.7 Outside `/developer`
| Place | Decision | Reason |
| --- | --- | --- |
| Org → Security "Tokens by person" (`OrganisationScreen.tsx:629-700`) | **Keep**, **group by kind**: "Personal tokens" / "Tool credentials (Tool · Device)". The own-row link goes to `?tab=advanced` | Agent credentials named. `token.revoke_any` is kept, and its confirmation states the exact impact. |
| Org → People "Agents" column (presence) | **Rename** "Tools running" | It is presence, not registered agents. |
| Org → People "Tokens" button | **Keep** (→ Security) | Admin path. |
| Org → Overview Developer insights switch | **Keep**; add a link "What developers see → Developer access · Activity" | — |
| Profile Admin "Their tokens" (`AdminPanel.tsx:521-589`) | **Keep**, show kind + Tool·Device, **active only stays** | Same kind grouping as Security. |
| Profile "Agents used" (`ProfileScreen.tsx:1332-1364`) | **Rename** "Tools used" | Vocabulary. |
| Profile UsageCard "Tokens" (LLM counts) | **Rename** "LLM tokens" | The word collides with credentials. |
| Space settings → Access "Agent sessions" (`AccessTab.tsx:197-221`) | **Rename** "Coding tools may work here"; add help: "Each tool also needs its own project access — set in Developer access · Project setup." | Separates the project switch from per-tool grants. |
| `/tokens`, `/connect`, `/developer/connect` | **Keep redirects** | §C. |
| Sidebar user-menu "Developer access" (`SidebarFooter.tsx:153-158`) | **Keep** | — |
| `screen-copy.ts:96-101`, `route-table.ts:280-284` stale comments | **Fix** | — |
| Docs: `cli/README.md`, root `README.md:100-104`, `docs/FEATURES.md:107`, `docs/ROADMAP.md` npx lines (LAI-624) | **Update** in Slice F (SHELL: cli README; CHIEF: docs) | — |

---

## C. Route / IA map

**Canonical route.** `/developer?tab=<id>`. The V3 tab ids are `overview`, `projects`, `devices`, `activity`, `advanced`.

**Default tab:**
- `v3`: `overview`.
- `preview` and `classic`: `connect`.

**Wizards are in the query, so they are deep-linkable and resumable:**
- `?tab=devices&add=device[&pairing=<id>]`
- `?tab=devices&add=tool[&device=<id>][&tool=<harness>][&exchange=<id>]`
- `?tab=projects&setup=1[&project=<slug>][&agent=<id>]`
- `?tab=devices&agent=<id>` scrolls to and expands that tool row.

**Legacy aliases.** These are implemented in `W/routes/page-tabs.ts` as a `TAB_ALIASES` map applied in `currentTab()` with `replace` navigation. Path redirects stay in `W/routes/redirects.ts:30-38`, which already keeps every other query parameter.

| Incoming | Mode `v3` | Mode `preview` / `classic` |
| --- | --- | --- |
| `/connect`, `/developer/connect` | → `/developer?tab=connect…` (existing) → alias below | unchanged |
| `/tokens` | → `?tab=tokens` → `?tab=advanced` | unchanged |
| `?tab=connect` | → `?tab=overview` | Connect |
| `?tab=connect&agent=X` | → `?tab=devices&add=tool&tool=<harnessFor(X)>` (no device paired → `add=device` first, tool remembered) | Connect, X preselected |
| `?tab=connect&step=2` | → `?tab=devices&add=tool` (step 2 = "Authorize") | Connect step 2 |
| `?tab=agents` | → `?tab=devices` | Agents |
| `?tab=agents&agent=<id>` | → `?tab=devices&agent=<id>` | Agents, row |
| `?tab=projects` | `projects` (same id) | Projects (old card) |
| `?tab=activity` | `activity` | Activity |
| `?tab=tokens` | → `?tab=advanced` | Tokens |
| unknown `?tab=` | default tab (existing behaviour) | default |

**Preview mode.**
- The V3 tabs are reachable by id. A "Try the new Developer access" banner sits on Connect.
- The old tabs stay in the bar.
- The `?tab=` space is shared (`projects` and `activity` render their V3 versions only in `v3`).

**Tests.**
- Extend `browser/developer-tabs.test.ts`, `browser/nav-redirects.test.ts`, `routes/page-tabs.test.ts` and `routes/redirects.test.ts` with every row above, in both modes.
- Assert that the full query string survives, the redirect is a `replace`, and there is no loop.

---

## D. Data model and migration plan

### D.1 Current tables touched (Verified, `S/db/schema.ts`)
- **`agents`** (925-949).
  - FKs: `org_id` → orgs (cascade), `owner_user_id` → users (cascade).
  - `harness` has no CHECK. `device_label` is nullable. `status` CHECK `active|revoked`.
  - `last_seen_at`.
- **`agent_project_grants`** (974-991): PK `(agent_id, project_id)`, scope CHECK.
- **`tokens`** (853-911): `agent_id` → agents, **cascade, never set null** (892-903).
- **`agent_sessions`** (1139-1177): `client_version`, `harness`, `harness_version`, `model`.
- **`task_claims`** (1191-1222).
- **`recognised_agent_devices`** (954-965): PK `(owner_user_id, label_key)`.
- **`agent_checkpoint_consents`** (1425-1439).
- **`agent_events` / `agent_event_deliveries`**.
- **`activity`**: append-only, triggers. **Not touched.**
- **Local activity**: `local_activity_days` (1976-2008) and `pushed_commit_keys`. **Not touched.**

### D.2 New tables (additive)

**Migration `0070_devices_and_pairing`.**
- It adds one nullable column, `agents.device_id`.
- **It rebuilds no table**: `ALTER TABLE ADD COLUMN` with a nullable FK works in SQLite without a rebuild, provided it has no non-null default. Verify the Drizzle output does not rebuild, as the 0061 note does. If Drizzle insists on a rebuild, **split the FK out**: keep the column plain and enforce it in the service, recorded as an exemption with a reason. The `foreign_keys=OFF` cascade hazard is in `S/db/migrate.ts:633-646` (memory: Drizzle migrator).

1. **`devices`** — one row per device the owner has.

   | field | notes |
   | --- | --- |
   | `id` | ULID — the server's opaque device id |
   | `org_id` | FK `orgs`, cascade |
   | `owner_user_id` | FK `users`, cascade |
   | `display_name` | 1–80, trimmed (matches `agents.device_label` max 80) |
   | `label_key` | normalised as §4.63 (`laika_device_label_key`) |
   | `kind` | `local` \| `cloud` (CHECK). Backfill: `cloud` iff `label_key = 'cloud'` |
   | `origin` | `imported` \| `paired` (CHECK) |
   | `public_key` | nullable. SPKI DER, base64url, Ed25519 only. **Not secret** |
   | `key_fingerprint` | nullable. sha256 of the SPKI, first 16 hex characters, shown to people |
   | `confirmed_at` | nullable. The owner said "this is mine" (backfilled from `recognised_agent_devices.created_at`) |
   | `paired_at` | nullable |
   | `status` | `active` \| `revoked` (CHECK). `revoked` is terminal |
   | `revoked_at` | nullable |
   | `last_seen_at` | nullable. The newest of its agents' `last_seen_at` and device-signed requests |
   | `last_cli_version`, `last_cli_commit`, `last_protocol` | nullable, self-reported, ≤64 characters |
   | `created_at` | — |

   - Index `(owner_user_id)`.
   - **Partial unique `(owner_user_id, label_key) WHERE status = 'active'`.** This is the device-level twin of D-121's normalisation, so two active devices of one owner never share a name. A revoked device frees its name.
   - Rename is allowed. It must keep the key unique, and it rewrites `agents.device_label` of the device's agents in the same transaction. Re-running `assertHarnessDeviceFree` there is **never refused**, because the pairs are unchanged relative to each other.

2. **`agents.device_id`** — nullable FK `devices`, **`restrict`**. Devices are revoked, never deleted, and a cascade would delete credentials silently. Indexed.
   - Null means "not yet linked". The boot backfill closes it.
   - **`agents.device_label` stays** and stays authoritative for `assertHarnessDeviceFree` and `assertCloudExpiry`. The service keeps the two in sync.

3. **`device_pairing_requests`**

   | field | notes |
   | --- | --- |
   | `id` | ULID |
   | `org_id`, `owner_user_id` | FKs, cascade. The binding |
   | `device_id` | nullable FK `devices`, set when "pair an existing (imported) device", else the device is created at approval |
   | `kind`, `display_name` | the browser's input |
   | `code_hash` | sha256 of the user code. **The code itself is never stored** |
   | `state` | `open` \| `claimed` \| `approved` \| `completed` \| `denied` \| `expired` \| `cancelled` (CHECK) |
   | `public_key`, `key_fingerprint` | set at claim |
   | `claim_nonce` | random, set at claim, signed at complete |
   | `claimed_os`, `claimed_cli_version` | self-reported, at most 64 printable characters |
   | `failed_attempts` | int |
   | `created_at`, `expires_at` | 10 minutes |
   | `claimed_at`, `decided_at`, `completed_at` | — |

   Index `(owner_user_id, state)` and unique `(code_hash)` where `state IN ('open','claimed','approved')`.

4. **`tool_setup_exchanges`**

   | field | notes |
   | --- | --- |
   | `id` | ULID. **Not secret**: possession is proved by the device signature |
   | `owner_user_id`, `org_id` | FKs, cascade |
   | `device_id` | FK `devices`, cascade |
   | `agent_id` | FK `agents`, cascade. The created or reused agent |
   | `purpose` | `install` \| `rotate` (CHECK) |
   | `rotate_token_id` | nullable FK `tokens`, set null |
   | `expires_at_for_token` | nullable. Cloud: ≤ now + 24 h, re-checked at redeem |
   | `state` | `open` \| `redeemed` \| `expired` \| `cancelled` (CHECK) |
   | `minted_token_id` | nullable FK `tokens`, set null |
   | `created_at`, `expires_at` | 10 minutes |
   | `redeemed_at` | — |

   **No secret column.** The token is minted *at redeem*, inside the transaction.

5. **`agent_client_reports`** — the latest report per agent and source.

   | field | notes |
   | --- | --- |
   | `agent_id` | FK `agents`, cascade |
   | `source` | `cli` \| `mcp_initialize` \| `session` (CHECK). With `agent_id`, the PK |
   | `cli_version`, `cli_commit`, `protocol` | protocol is an int |
   | `capabilities_json` | a closed vocabulary, ≤32 entries |
   | `client_name`, `client_slug`, `client_version` | — |
   | `reported_at` | — |

   Everything is self-reported. This is **evidence for status, never an authorisation input**, by the same rule as SPEC §4.9 `last_client`.

6. **`project_repo_setups`** — a record of setups. It is **not** an access grant.

   | field | notes |
   | --- | --- |
   | `id` | ULID |
   | `owner_user_id` | FK, cascade |
   | `agent_id` | FK agents, cascade |
   | `project_id` | FK projects, cascade |
   | `repo_label` | 1–90, self-reported |
   | `instructions_path` | — |
   | `block_revision` | int |
   | `source` | `self_report` \| `local_check` (CHECK) |
   | `found` | bool, for `local_check` |
   | `recorded_at` | — |

   Unique `(agent_id, project_id, repo_label)`, upserted.

**Not added:**
- A token `kind` column. Kind is **derived** from `tokens.agent_id IS NULL`, so no backfill is possible to get wrong.
- Activity verbs (A15).

### D.3 Deterministic backfill (in the 0070 SQL, using the registered SQL functions as 0065/0066 do)

**Step 1 — one device per key.**
```
INSERT INTO devices (id, org_id, owner_user_id, display_name, label_key, kind, origin,
                     confirmed_at, status, created_at, last_seen_at)
SELECT laika_new_id(), a.org_id, a.owner_user_id,
       <display: trimmed device_label of the newest agent on that key, or 'Unnamed device'>,
       k.key, CASE WHEN k.key = 'cloud' THEN 'cloud' ELSE 'local' END, 'imported',
       r.created_at,
       CASE WHEN SUM(a.status='active') > 0 THEN 'active' ELSE 'revoked' END, MIN(a.created_at), MAX(a.last_seen_at)
FROM agents a, (laika_device_label_key(a.device_label)) k
LEFT JOIN recognised_agent_devices r ON (r.owner_user_id, r.label_key) = (a.owner_user_id, k.key)
GROUP BY a.owner_user_id, k.key
```
- One row per `(owner, key)`.
- A key with only revoked agents gets a **revoked** device, so it stays out of the partial unique index and history still links.
- `display_name` uses exactly the rule the devices list uses today (`S/services/agents.ts:470`), so **the visible name does not change**.

**Step 2 — link the agents.**
```
UPDATE agents SET device_id = (SELECT d.id FROM devices d
  WHERE d.owner_user_id = agents.owner_user_id
    AND d.label_key = laika_device_label_key(agents.device_label)
  ORDER BY d.status = 'active' DESC LIMIT 1)
```
- This is deterministic because there is at most one device per `(owner, key)` after step 1.

**Step 3 — the same logic as an idempotent boot backfill.**
- `backfillAgentDevices` in `S/db/backfill.ts`, with the same rules and **only for `device_id IS NULL`**.
- It exists for agents registered by **old web clients during a mixed rollout** (`POST /agents` with only `device_label`), and as a safety net.
- `registerAgent` and `updateAgent` also set `device_id` (find-or-create the active device for that key). A relabel moves the agent to another device; the old device keeps its row.

**Properties.**
- **Idempotency.** Step 3 fills only nulls, mirroring `backfillTaskTimestamps` (`S/db/backfill.ts:126`). The migration runs once by journal.
- **Duplicates.**
  - Nothing is merged or revoked. Several agents of the same harness on one device all link to that device.
  - The Devices UI shows them in a conflict section.
  - Aliases ("Belka" vs "Belka laptop") stay **separate devices**. A **reviewed merge** endpoint moves all agents of device B onto device A. That is refused if it would create a second **active** pair, and the UI then shows the conflict first. It relabels `agents.device_label` to A's name and revokes device B.
- **Grandfathering.** No token, grant, consent, claim, session or history row changes. `agents.id` / `owner_user_id` / `device_label` / grants / token hashes are untouched (the rehearsal asserts this byte-for-byte).
- **No agents are created on page load.** Every create is in an explicit POST.
- **Rollback.**
  - The migration is forward-only (README:3-4).
  - Rolling the **image** back to pre-0070 code is refused by `refuseSchemaAhead` (`S/db/migrate.ts:470-533`), so the documented path is AGENTS-ROLLOUT §7: restore the `pre-migration-*` snapshot.
  - Because 0070 is purely additive, **a code-only rollback of the V3 feature is the flag** (§I), not the DB.
  - The new tables can sit unused indefinitely.

**Rehearsal tests (CORE, `server/test/db/`):**
1. `migrate.test.ts` populated-database upgrade for 0070, in the style of the 0061/0064/0065 tests at 1942/2336/2443. The fixture covers:
   - two owners sharing a label;
   - mixed case and whitespace;
   - null and blank labels;
   - `Cloud` / `cloud`;
   - a duplicate active pair;
   - a key with only revoked agents;
   - a recognised and an unrecognised label;
   - look-alike Unicode (`Ｃloud`) staying separate (D-121 item 2).

   It asserts the device count per owner, the links, the names, `confirmed_at`, and that every other table is byte-identical. Raw SQL is needed for the cut-back fixtures (memory: a new column breaks cut-back fixtures).
2. `backfill.test.ts`: "changes nothing the second time", and an agent inserted with a null `device_id` after migration gets linked.
3. `schema-ahead.test.ts` still passes (the new migration is known).
4. A `foreign_key_check` passes after migration (already part of boot).
5. A rehearsal on a **copy of production-shaped data** is recorded in `docs/acceptance/LAI-10xx-devices-migration-rehearsal.md` (CHIEF), as LAI-560 did.

---

## E. API contracts

These follow the existing conventions:
- Error shape `{ "error": { "code", "message", "details": { reason, … } } }` with the closed codes (`S/errors.ts:14-31`).
- Strict zod bodies, so unknown fields answer `422 unprocessable`.
- Pagination `{data, next_cursor}`.
- `markOneTimeSecret` for any secret.
- Session-only actions via `SESSION_ONLY_ACTIONS`.

Policy reuses the existing actions: devices are owner records under **`agent.read_own` / `agent.manage_own`**, as SPEC §4.63 already puts device list/confirm/revoke. So **no new §3.1 row** is needed. If the owner prefers explicit `device.*` actions, that is a three-owner change; see L5.

Every resource route answers a foreign or nonexistent id with an identical `404 not_found`.

### E.1 Device pairing

**`POST /api/v1/devices/pairing-requests`** — session only (`agent.manage_own`).
- **Body:** `{ kind: 'local'|'cloud', display_name: string(1..80), device_id?: ULID }`. `device_id` is for "Pair an imported device".
- **201:**
  ```
  { pairing: { id, state:'open', expires_at, kind, display_name },
    user_code: "LK-7W4X-K2P8",
    command: "laika device pair --board <origin> --code LK-7W4X-K2P8" }
  ```
  - `user_code` is 40 bits, Crockford base32. It is shown once; only `code_hash` is stored.
  - The response is `markOneTimeSecret`'d. The code is short-lived, but keep it out of the idempotency store.
- **Errors:**
  - `409 conflict`, `reason: device_name_taken`, `device_id` of yours.
  - `422 unprocessable`, `reason: invalid_device_name`.
  - `429`.
  - At most **5 open requests per owner** → `409 reason: too_many_open_pairings`.

**`GET /api/v1/devices/pairing-requests/:id`** — session (`agent.read_own`).
- Returns state, plus `claimed: { key_fingerprint, os, cli_version, claimed_at } | null`.
- The browser polls every 3 s while open. **No code is returned.**

**`POST /api/v1/device-pairing/claim`** — **anonymous**. The code is a one-time *binding* token, never a credential.
- **Body:** `{ code, public_key: base64url SPKI Ed25519, os?: string≤64, cli_version?: string≤64 }`.
- **200:** `{ pairing_id, nonce, key_fingerprint, expires_at }`.
- **Rules:**
  - The code must be `open` and unexpired.
  - Claim is **once**: `open → claimed`. A second claim with the same code → `409 reason: pairing_already_claimed`. The real device's terminal then tells the user to cancel and start again, and the browser shows the claimed fingerprint, so a racing attacker is visible.
- **Unknown or expired codes:**
  - They answer `404 not_found` with an identical body.
  - They count on **one shared backoff key**, with the password-reset-link semantics of SPEC §6.1.
- **Rate limit:** a new `LIMITS.pairing` class, 10 a minute burst, refill 1 every 10 s, keyed per code-hash bucket plus a shared anonymous key.

**`POST /api/v1/devices/pairing-requests/:id/approve`** and **`…/deny`** — session (`agent.manage_own`).
- **Body:** `{ key_fingerprint }`. The browser echoes what it displayed; a mismatch → `409 reason: pairing_key_changed`.
- **Approve:**
  - Allowed only from `claimed`.
  - It creates or updates the device: `origin='paired'`, `public_key`, `paired_at`. For an imported device, it sets the key on that row.
  - **It mints no credential.**
- **200:** `{ device: DeviceView }`.

**`POST /api/v1/device-pairing/:id/complete`** — authenticated by **proof of possession**.
- **Body:** `{ signature }`, Ed25519 over `"laika-pair-v1\n" + pairing_id + "\n" + nonce + "\n" + board_origin`.
- **200 once:** `{ device_id, display_name, kind, board_origin }`.
  - A second call → `409 reason: pairing_completed`.
  - Before approval → `202 { state: 'claimed' }`. The CLI polls at 2 s for up to the expiry.
- **Errors:** bad signature → `401 unauthorized`, `reason: device_signature_invalid`, counting toward the backoff.

**`DELETE /api/v1/devices/pairing-requests/:id`** — cancel, session.

**Device views.**
- `GET /api/v1/devices` (`agent.read_own`) supersedes `GET /agents/devices`, which stays as is for old clients.
- It returns:
  ```
  { data: [ { id, display_name, kind, origin, status, confirmed, paired,
              key_fingerprint, last_seen_at, cli: { version, commit, protocol }|null,
              tools: [ AgentView + status ], conflicts: [ … ] } ] }
  ```
- An agent token reads only devices that hold that agent. Narrowing per A14 is optional.

**Device management** — session (`agent.manage_own`):
- `PATCH /devices/:id {display_name}`.
- `POST /devices/:id/confirm` (the same effect as today's confirm-by-label).
- `POST /devices/:id/merge {into_device_id}`.
- `POST /devices/:id/revoke`: it revokes every active agent on it (reusing `revokeOwnAgentDevice` semantics) and sets device `revoked`.
  - **The confirmation copy names the tools and their live sessions, with counts from the server.**

**Device-signed requests (general).**
- Header `Authorization: LaikaDevice <device_id>.<ts>.<sig>`, where `sig` is Ed25519 over `method\npath\nts\nsha256(body)`.
- ±120 s skew, and a replay cache of `(device_id, sig)` for 5 minutes.
- **Accepted only on** `/device-pairing/*/complete`, `/tool-setup/*/redeem`, `/devices/me/report`.
- **It is not an `Actor` for anything else**, so SPEC §6.1's "There is no third path" stays true for all other routes. This needs a named SPEC §6.1 paragraph from CHIEF.

### E.2 Tool setup exchange (Add tool, Reconnect)

**`POST /api/v1/devices/:id/tools`** — session (`agent.manage_own`).
- **Body:** `{ harness: AGENT_CLIENT slug, grants?: [{project_id, scope}] }`. The default is no grants (least privilege).
- **Semantics — create or reuse:**
  - If the owner has an **active** agent for `(device.label_key, harness)`, reuse it.
  - Otherwise register one through `registerAgent` with `device_label = device.display_name` and `device_id`. The display name is derived; D-120 makes the label `Harness · Device` anyway.
  - **Legacy duplicates.** If more than one active agent exists, answer `409 conflict`, `reason: agent_duplicates_need_resolution`, listing the agent ids. The UI routes to the conflict section. **It never picks one silently.**
  - Then it creates an exchange with `purpose = install` (or `rotate` if the reused agent already has a live token, which becomes the `rotate_token_id`).
- **201:**
  ```
  { agent: AgentView, exchange: { id, expires_at, purpose },
    command: "laika tool add <cli-harness> --exchange <id>" }
  ```
- **No secret** is in the response.
- **Cloud** (`kind=cloud` or `label_key='cloud'`): the exchange records `expires_at_for_token = now + 24 h − 5 min`. `assertCloudExpiry` runs at redeem against the redeem time.
- **Errors:** `404` (device not yours or revoked), `409 agent_duplicates_need_resolution`, `422 unsupported_harness`, `429`.

**`POST /api/v1/agents/:id/reconnect`** — session.
- Creates a `rotate` exchange on the agent's own device.
- A browser-shown-secret rotate stays available as `POST /agents/:id/rotate-token`, unchanged, for "Set up by hand".

**`POST /api/v1/tool-setup/:id/redeem`** — **device-signed** (E.1), with `device_id` equal to the exchange's.
- **Body:** `{ cli_version?, cli_commit?, protocol? }`.
- **In one transaction:**
  - `state` must be `open`, unexpired, and not cancelled.
  - The agent must be active.
  - Mint the token (reusing `insertToken`; writes `token.created`). For `rotate`, revoke `rotate_token_id` in the **same transaction**, exactly as `rotateAgentToken` (`S/services/agents.ts:353`).
  - Mark the exchange redeemed.
- **200, once, `markOneTimeSecret`:**
  ```
  { agent: { id, harness, label }, token: { id, prefix, expires_at }, secret: "lai_…", board_origin }
  ```
- **Errors:**
  - A second redeem → `409 reason: exchange_redeemed`.
  - Expired → `410`? **No: 410 is not in the closed vocabulary.** Use `409 reason: exchange_expired`.
  - Wrong device → `404`.
  - Agent revoked → `409 reason: agent_revoked`.
- **Where the credential travels:** browser → nothing secret; device ← secret over TLS, straight into `~/.laika/agents/<harness>.json` (0600). Never argv, never a prompt, never a transcript.

**`DELETE /api/v1/tool-setup/:id`** — session, cancel.

### E.3 Verification evidence per tool

**`GET /api/v1/agents/:id/verification`** — `agent.read_own`.
```
{ checks: [
   { id:'device_paired',        state:'pass'|'fail'|'not_applicable', at, detail },
   { id:'credential_installed', state, at },   // pass: a token minted by an exchange redeemed by this device, or a token used since mint
   { id:'tool_request',         state, at, detail:{ client_slug, client_name } },
        // pass ONLY if an MCP initialize on THIS agent's token named a client whose
        // normalised slug == agent.harness (stored from clientInfo by recordMcpUse
        // into agent_client_reports source='mcp_initialize'; today recordMcpUse
        // substitutes agents.harness for registered agents — S/auth/tokens.ts:352 —
        // so it must store the raw normalised clientInfo slug separately)
   { id:'session_hooks',        state:'pass'|'fail'|'unsupported', at },  // an agent_session opened by this agent with harness == agent.harness
   { id:'claims_supported',     state:'pass'|'unsupported' },             // from the capability manifest, never inferred
 ],
  status: 'ready'|'connected'|'needs_setup'|…, reason }
```
- **Never Ready from:** a `curl` (no MCP initialize), any token use, a config file, another tool's request (a slug mismatch), or a checkbox.
- **Honest limit.** `clientInfo` is self-reported. "Ready" means "this tool's own credential, announcing itself as this tool". The UI help says so (§M).

### E.4 Token kind on views

The `TokenView` server and client both gain:
- `kind: 'personal'|'agent'`, derived from `agent_id`;
- `agent_id`;
- `agent_label` (`Harness · Device`).

Rules:
- `agent_label` is null for readers other than the owner and `profile.read`/`token.list_any` holders, consistent with SPEC §4.9 D-120.
- **`GET /api/v1/tokens?kind=personal|agent`.** The filter is optional. Absent, it returns everything, as today, so old clients are unchanged.
- **`GET /users/:id/tokens`** gets the same fields and filter.
- **`DELETE /users/:id/tokens/:tokenId`** is unchanged (`token.revoke_any`).
  - New UI copy for an agent credential: "This is **Claude Code · Belka**'s credential. Revoking it stops that tool at once and ends nothing else; the tool stays registered with no live credential until its owner reconnects it. To remove the tool, its owner disconnects it."
- **`DELETE /tokens/:id`** on one's own agent token is unchanged (A13).
- This is a three-owner change: SPEC §6.4/§4.9 (CHIEF), `S/services/tokens.ts` (CORE), `W/api/tokens.ts` (SHELL; `view-type-drift.test.ts` reads both directions).

### E.5 Project-setup access check

**`GET /api/v1/agents/:id/project-access?project=<slug>`** — `agent.read_own`, session or that agent's own token.
```
{ project: {id, slug, name, prefix, agents_allowed},
  member: { can_read, can_write, role },             // can(withProject(owner-as-session-actor, p), 'project.read'|'task.update')
  grant:  { scope: 'read_only'|'full'|null },        // agent_project_grants row
  effective: 'none'|'read_only'|'full',              // intersection incl. agents_allowed and token scope
  can_grant: { max: 'read_only'|'full'|null, reason } } // viewer → read_only; not member → null
```
- It uses the separation the handoff code already does (`S/services/handoffs.ts:624, 667-690`) and `loadAgent(...).grants` (`S/auth/resolve-actor.ts:258`).
- A project the owner cannot read → `404`.

**`PUT /api/v1/agents/:id/grants/:project_id`** — session.
- **Body:** `{ scope: 'read_only'|'full'|null }`. `null` deletes the row.
- It is a per-project upsert, so the Project setup flow cannot lose a concurrent grant.
- It validates against `can_grant` and keeps the existing `PUT /agents/:id/grants` whole-set route.
- `403 forbidden reason: grant_exceeds_owner` for viewers asking `full`.

**`POST /api/v1/project-setups`**:
- **Session (self-report):** `{agent_id, project_slug, repo_label, instructions_path, block_revision}`.
- **Agent token (`laika project check`):** `{project_slug, repo_label, instructions_path, block_revision|null, found}`.
- `agent_id` is taken from the token, never from the body.
- `GET /api/v1/project-setups?agent_id=` (own).

### E.6 Compatibility manifest

**`GET /api/v1/developer/compatibility`**
- **Auth:** none required. It is readable anonymously on the anonymous bucket and contains nothing secret. Authenticated callers get the same body.
- **200:**
  ```
  { server: { version: "0.1.0", build_commit: "cea011d6…"|null },
    protocol: { current: 2, min_client: 1 },
    features: { developer_access: "classic"|"preview"|"v3",
                device_pairing: true, tool_setup_exchange: true,
                client_reports: true, project_setups: true },
    cli: { source: { type:"git", url:"<LAIKA_CLI_SOURCE_URL or https://github.com/PawanSirsat/Laika.git>",
                     commit: <build_commit>, path: "cli" },
           min_version_for: { tool_setup_exchange: 2, device_pairing: 2 },  // protocol numbers
           whats_new: [ { protocol: 2, summary: "…" } ] },
    project_block: { revision: 2, marker: "This project is tracked on a Laika board." },
    tools: [ { harness, cli_harness|null, name, mcp: "verified"|"documented"|"unverified",
               hooks: "verified"|"documented"|"unsupported", sessions: …, checkpoints: …,
               credential: "file"|"env"|"inline"|"unsupported", instructions_path } ] }
```
- `tools` is the single capability source the web reads instead of hard-coding (§M). Its truth is the CLI matrices; a drift test (SHELL) compares `cli/README.md:822-861` and `cli/agent-adapters/CAPABILITIES.md` rows against it **by name** (CONVENTIONS: assert names, never counts).
- **Problem:** the manifest's tool data would live in `S/` (CORE) but mirror `cli/` (SHELL). **Smallest fix:** keep the tool table in a JSON file under `cli/agent-adapters/capabilities.json` (SHELL). The server reads it at build time. That is cross-area: the server image excludes `cli/` today. **Alternative, recommended:** keep the tool table **in the web** (`W/routes/screens/developer/tool-capabilities.ts`, SHELL), with the drift test against `cli/`, and serve only protocol and features from the server. **Choose the alternative.**

**Build commit.**
- `S/version.ts` gains `readBuildCommit()` from `LAIKA_BUILD_COMMIT`, `^[0-9a-f]{7,40}$`, else null.
- Docker `ARG LAIKA_BUILD_COMMIT` / `ENV` (SHELL, `docker/`).
- `deploy.yml` passes `--build-arg LAIKA_BUILD_COMMIT=${{ github.sha }}`. `.github/` ownership is not in the CLAUDE.md table, so this is a CHIEF `[ops]` change or a named edit in the task.

### E.7 Client capability and version reporting
- **`POST /api/v1/agents/me/client-report`** — agent token only (`requireAgent`, 403 `not_an_agent`).
  - **Body:** `{ cli_version, cli_commit?, protocol, capabilities: string[] (closed vocabulary), harness_version? }`.
  - It upserts `agent_client_reports(source='cli')`. Bucket: the heartbeat class.
- **`POST /devices/me/report`** — device-signed. Same fields, onto the `devices.last_cli_*` columns.
- **MCP initialize:** `recordMcpUse` also upserts `source='mcp_initialize'` with the normalised `clientInfo.name` → slug, plus `clientInfo.version`. This is **one write a minute at most**, the existing throttle.
- **`POST /agent-sessions`** body is unchanged. New CLIs send real data through `client-report`. This avoids widening a strict body that old servers would reject.

### E.8 Rate limits summary
| Route | Bucket |
| --- | --- |
| pairing claim/complete | new `pairing` + shared backoff |
| redeem | per device 10/min |
| create pairing / add tool | session 600/min, plus max 5 open per owner |
| client-report | heartbeat 30/min |
| compatibility | anonymous / token default |

---

## F. CLI contracts (SHELL, `cli/`, `plugin/`)

Existing behaviour to reuse:
- `C/agent-setup.ts` (login, hooks);
- `C/agent-session.ts` (credential store `writeCredential`/`readCredential` :160-190, atomic 0600);
- `C/connect.ts` (conservative merge, `.bak` once, refuse-invalid, :379-513);
- `C/agent-hooks.ts` (marker-based merge, Codex refusal :152-166).

### F.1 `laika --version` / `laika version`
- **Prints:** `laika 0.2.0 (cli) · commit <sha7>[+dirty] · protocol 2 · node 22.x · checkout ~/laika`.
- **Flag:** `--json`.
- **Source:**
  - `cli/package.json` version.
  - `git -C <checkout> rev-parse HEAD` and `git status --porcelain -- cli plugin`.
  - A `PROTOCOL` const in `C/protocol.ts`.
- **Exit 0.** It makes no network calls.

### F.2 `laika doctor` (alias `laika status`) — read-only
- **Flags:** `[--board <url>] [--json] [--offline]`.
- **Checks, each with a status word and a reason:**
  - node ≥ 22.18 when running from source;
  - checkout is clean or dirty;
  - commit vs the board manifest's `cli.source.commit` → **Up to date / Update available / Update required for <feature> / Version unknown / Could not check**;
  - device paired (`~/.laika/device/device.json` + key present, perms 0600/0700);
  - per tool: a credential file present (**name only, never the value**), `/agents/me/*` reachable (200 vs 401), hooks installed (marker grep), Codex hook-trust reminder;
  - `~/.laika/env` present (legacy personal token) and **which tools still read it**;
  - MCP config entries present per tool.
- **Exit codes:** 0 all good, 1 something needs action, 2 cannot check.
- **It writes nothing.** It reports to the board (`client-report`) only with `--report`.

### F.3 `laika device pair --board <url> --code <code> [--name <override>]`
1. Fetch the manifest. If it is missing (404) or `features.device_pairing` is false, stop with "This board does not support pairing yet; use Set up by hand".
2. Generate an Ed25519 keypair (`node:crypto` `generateKeyPairSync('ed25519')`, **no new dependency**). Write `~/.laika/device/key.pem` (0600, dir 0700) and `device.json` `{board, device_id:null, fingerprint}` atomically.
   - **Refuse** if a paired `device.json` exists for the same board, unless `--replace` (which backs up to `device.json.bak-<ts>`).
3. `POST /device-pairing/claim`, then print:
   ```
   Pairing code accepted. In your browser, check this fingerprint and approve:
     7F3A-91C2-0B5E-44D1
   ```
4. Poll `complete` with a signature until approved, denied or expired.
5. Save `device_id`, and print "Paired as **Belka**. Next: add a tool in your browser."
- **The code is argv.** That is acceptable: it is single-use, 10 minutes, and grants nothing until a human approves a matching fingerprint. The brief bans *credentials* in argv, and this is not one.

### F.4 `laika tool add <harness> --exchange <id> [--no-hooks] [--dry-run]`
1. Requires a paired device for the board.
2. Redeem (device-signed) and write `~/.laika/agents/<cli-harness>.json` `{url, token, agent_id, device_id}` via the existing `writeCredential`. Backup-once if replacing.
3. **Configure MCP per tool**, with the conservative merge and `.bak` once. **Never a token value in a config file**, except tools that can only take inline values (Antigravity), which are **refused here** and printed as manual steps with a warning.
   - **Claude Code:** `laika-claude` changes to export `LAIKA_TOKEN` from `~/.laika/agents/claude-code.json` when present, otherwise from `~/.laika/env` (legacy).
     - This is the one behaviour change for existing users. MCP calls from Claude Code then run **as the agent**. Verified-path reasoning: the plugin `.mcp.json` uses `${LAIKA_TOKEN}`; Inference, to be tested.
     - Gate it on the credential file existing, so a user who never adds a tool is unchanged.
   - **Codex:** `[mcp_servers.laika] bearer_token_env_var = "LAIKA_AGENT_TOKEN_CODEX"` (new var) via the existing TOML logic.
     - The variable is exported by a new idempotent rc block that reads **only** `~/.laika/agents/codex.json` through a tiny `laika agent print-env codex` helper. The secret appears in no file other than the 0600 JSON.
     - **Existing `[mcp_servers.laika]` with `LAIKA_TOKEN` is reported `kept`**, and the CLI prints the one-line edit (conservative; never rewrites).
   - **Omnigent:** writes `<agentDir>/tools/mcp/laika.yaml` (existing `--dir`) with `${LAIKA_AGENT_TOKEN_OMNIGENT}`. Login support needs `omnigent` added to `HARNESSES` as **credential-only** (no hooks, no sessions).
   - **Cursor, Gemini, OpenCode, VS Code:** env-var forms with a per-tool variable. **Documented-not-tested** (§M).
4. **Hooks:** `laika agent hooks on --harness <h>` is run automatically for claude-code and codex unless `--no-hooks`.
   - It prints the known limits: Claude must be restarted with `laika-claude`; Codex needs `/hooks` trust, and it refuses when `config.toml` defines hooks.
   - Other tools print "MCP only — no sessions, claims or automatic checkpoints".
5. Send a `client-report`. Print the verification next step: "Start Claude Code with `laika-claude`, then ask it to call `laika_whoami`. The browser will tick 'Tool request seen'."
- **Never touches** `~/.laika/env`, other tools' credential files, consent, grants or repo files.
- `--dry-run` prints the plan and writes nothing.

### F.5 `laika update [--check] [--yes]`
- **Source:** the board manifest's `cli.source` (url + commit).
- **Verification:** the commit hash *is* the pin. After `git fetch <url> <commit>`, `git cat-file -e <commit>^{commit}` and `rev-parse` must equal it exactly. Branch names are not trusted. Signed tags are a later hardening (L3).
- **Steps:**
  1. **Dirty-checkout safety:** refuse when `git status --porcelain` is non-empty anywhere in the checkout, or HEAD is on a branch with commits not on `origin` ("You have local changes in ~/laika; commit or stash them, then run again"). **Never auto-stash.**
  2. **Backup:** write `~/.laika/update/<ts>/`: the previous HEAD, and copies of every file the post-update refresh may touch (`~/.claude/settings.json`, `~/.codex/hooks.json`, rc file) via the existing backup helpers.
  3. **Stage:** `git worktree add --detach ~/.laika/update/staging <commit>`. Run `node <staging>/cli/bin/laika version --json` and `doctor --offline --json` from the staging tree. A failure aborts with nothing changed.
  4. **Switch:** `git -C ~/laika checkout --detach <commit>`. Then re-run the **idempotent** hook and MCP refresh (marker-based; an identical config is a no-op; other MCP servers are never touched).
  5. **Verify:** `laika doctor --report`. If it fails, **roll back**: check out the previous HEAD and restore the backed-up files. Print exactly what was restored.
  6. Remove the staging worktree (never `--force`).
- **Never touches:** `~/.laika/agents/*`, `~/.laika/device/*`, `~/.laika/env`, consent, grants, repo instruction files.
- **Idempotent:** at the target commit already → "Up to date", exit 0.
- `--check` = doctor's update line only.

### F.6 Fresh-install bootstrap (truthful, self-hosted)

**Shown by Add device, step 2**, filled with the manifest's url and commit:
```
git clone <cli.source.url> ~/laika && git -C ~/laika checkout --detach <commit>
~/laika/plugin/scripts/install.sh --no-credential
~/laika/cli/bin/laika device pair --board <origin> --code <CODE>
```
- **`install.sh --no-credential`** links `laika` and `laika-claude`, adds the PATH line idempotently (marker-guarded; fixes :162), and **does not prompt for or write any token**.
- **Without the flag**, `install.sh` keeps its old behaviour for old pages, but **backs up `~/.laika/env` to `env.bak-<ts>` before rewriting** (fixes A8). Its prompts say "Developer access → Advanced".
- **Existing checkout:** the first line becomes `git -C ~/laika fetch && laika update`. The UI asks "Is Laika already installed on this device?" and does not detect it.
- A board whose `build_commit` is null (a local dev build) shows "Version unknown — use `git -C ~/laika pull`".

### F.7 `laika project check [--dir .] [--harness h] [--report]`
- Reads the instructions file from `instructionsTarget` (mirrored in the CLI), finds `BLOCK_MARKER` and the revision marker, and extracts the slug.
- Prints whether the block is found, its revision and slug, and the expected revision from the manifest.
- `--report` posts `{project_slug, repo_label: basename of dir, path, revision, found}` with that tool's **agent** token. **No content, no absolute path.**

### F.8 Mixed old and new
- New CLI commands degrade on an old board (manifest 404 → "not supported by this board").
- Old CLIs keep working: `agent login`, hooks and `connect` are unchanged.

---

## G. Project setup flow

**Location:** the **Project setup** tab (Overview CTA: "Set up a project repository").

**Steps** (repeatable; resumable via the query):

1. **Choose project and connected tool.**
   - Project: `useProjects`.
   - Tool: the person's active agents, labelled `Tool · Device`, with the status word.
   - No tools → empty state with "Add a tool".
2. **Access.** The server check is `GET /agents/:id/project-access`. It shows two separate facts:
   - "You: member (role)";
   - "Claude Code · Belka: No access / Read only / Full".
   - **Selector rules:**
     - It shows `can_grant.max`. Viewers see Full disabled, with the reason.
     - The default selection is the current grant, else **No access**. Continuing with No access is allowed only with a warning: "The tool will not see this project."
   - **Save** = `PUT /agents/:id/grants/:project_id`.
   - **`agents_allowed = false` on the space** shows "Coding tools are turned off for this space (Space settings → Access)" with a link, and grants nothing.
   - **No token is regenerated.**
3. **Copy the prompt.**
   - The target file comes from `instructionsTarget(guideFor(agent.harness))` (`connect-agents.ts:1268-1326`).
   - The prompt is `projectPrompt()` v2. It never contains a token. Asserted by test: `/lai_[A-Za-z0-9]/` must not match, and neither may the origin's secret placeholder.
4. **Optional, separate: repo MCP config** — only for tools that read it from the repo (vscode, omnigent, claude-code `.mcp.json`). It shows `laika connect <id> --project` (writes no token).
5. **Record.**
   - "I ran it" posts a `self_report` setup. It is shown as **"Recorded by you"**, never "Verified".
   - An optional "Check from this device" shows `laika project check --report`. The row then shows "Checked on Belka, revision 2" from `source='local_check'`.
   - **The web never claims to have inspected the repo.**

**Block revision 2** (`connect-copy.ts`):
- `export const PROJECT_BLOCK_REVISION = 2`.
- `projectBlock()` keeps line 1 `## Laika` and line 3 `BLOCK_MARKER` **verbatim**, and wraps the body:
  ```
  <!-- laika:begin revision=2 project=<slug> -->
  ## Laika
  This project is tracked on a Laika board. …
  <!-- laika:end -->
  ```
- For Cursor `.mdc`, the markers sit inside the body after the frontmatter `wrap`.

**`projectPrompt()` v2 rules:**
1. Inspect `./<path>`.
2. If a `laika:begin` marker exists with `revision ≥ N`: report "already up to date" and stop.
3. If a Laika block exists (`laika:begin…laika:end`, or for revision 1 the `## Laika` section whose first paragraph contains BLOCK_MARKER, up to the next heading of the same or higher level or end of file): **show the exact old and new text as a diff and ask me to confirm** before replacing **only that block**.
4. If there is no block: append, keeping everything. Create the file only if it is missing.
5. **Never** change anything else, add a token, install, pair, touch MCP config, or commit.
6. Report: created / appended / updated from revision X / already current.
- **Golden tests:**
  - revision-1 file → updated, the rest byte-identical (simulated by a pure function `replaceLaikaBlock(text, block)` in `connect-copy.ts` that the prompt describes, unit-tested on fixtures);
  - no-block → appended;
  - current → untouched;
  - marker preserved for the activity scope;
  - zero secrets.

**Template revision vs `context_revision`.**
- `projects.context_revision` is the **server's project brief version** (SPEC §4.68; `S/services/context-revisions.ts`). It is delivered over MCP.
- `PROJECT_BLOCK_REVISION` is the **repo-file template version**.
- They never share a name, a field or a UI line. The UI calls the latter "Instructions template revision".

**Update prompts are grounded only in evidence:**
- "Update available" shows only when a recorded setup (`self_report` or `local_check`) has `block_revision < current`.
- No record → "Not recorded — run `laika project check` to find out".

---

## H. Updates and compatibility statuses

**Tool status word** (on the Devices tab tool row and in the Project setup picker), computed client-side from `verification` plus the reports. **The word and a short reason are always shown; colour is never the only signal.**

| Status | Rule |
| --- | --- |
| **Needs setup** | No live token, or the exchange was never redeemed. Reason: "No credential on this device yet". |
| **Connected** | A live token has been used, but there is no matching tool request. Reason: "The credential reached the board; Claude Code itself has not called it yet". |
| **Ready** | `tool_request` pass, and `session_hooks` pass or unsupported, and seen within 15 min. |
| **Idle** | Ready, last seen 15 min – 7 days. "Last seen 3 h ago". |
| **Offline** | Ready earlier, last seen more than 7 days ago. |
| **Version unknown** | A secondary badge when there is no `cli` or `mcp_initialize` report. |
| **Revoked** | Hidden behind a "Show revoked ({n})" toggle. **Counts exclude revoked.** |

**"Working on LAIKA-123"** shows only from a live `task_claims` row of a live session of that agent (`S/services/claims.ts` views). **Model and version come from session data only.**

**Omnigent is the tool.** Worker harnesses from `agent_sessions.harness` show as secondary metadata: "Omnigent · Belka — running Claude Code · claude-opus-5-5".

**Update status:**
- **Local integration update** (per device and tool row; Project setup shows it only when it blocks a feature):

  | Status | Rule |
  | --- | --- |
  | Up to date | `report.cli_commit == manifest.cli.source.commit`, or protocol current |
  | Update available | protocol ≥ `min_client` but < `current` |
  | Update required for <feature> | protocol < `min_version_for[feature]`. The feature's button is disabled with that reason |
  | Version unknown | no report |
  | Could not check | manifest fetch failed |

  - The actions are **"Copy update command"** (`laika update`) and "What's new" (manifest `whats_new` entries > reported protocol).
  - Post-update verification is `laika doctor --report`, after which the row refreshes.
- **Board update** (admin):
  - In Organisation → Overview, `org.*` admins see "Board build `<sha7>`, protocol N" read from the manifest.
  - The board updates by deploy (push to master). **There is no "update board" button.**
  - The copy distinguishes it: "The board is updated by whoever runs this instance; your devices update themselves with `laika update`."
- **Old helpers:**
  - No report means Version unknown, never broken.
  - Legacy personal tokens keep working (D-114 item 6).
  - Features are gated precisely. For example, "Reconnect without showing the secret" needs `tool_setup_exchange`; with an old CLI, the UI offers the browser-secret rotate instead.

---

## I. Feature flag and rollback

**Flag: `LAIKA_DEVELOPER_ACCESS` = `classic` | `preview` | `v3`.**
- It lives in `S/env.ts`, documented in SPEC §11.7 (CHIEF) and `docker/` env (SHELL). The default is `classic` until Slice F.
- It is exposed as `features.developer_access` in the manifest. The web reads it with the existing `api/client.ts`. An unreadable manifest falls back to **classic**.

| Mode | Behaviour |
| --- | --- |
| `classic` | Today's five tabs, unchanged. New APIs live but unused by the UI (the CLI can use them). |
| `preview` | Classic default tab, plus V3 tabs reachable by id and a banner "Try the new Developer access". Classic stays fully working. |
| `v3` | Overview default, V3 tabs, legacy aliases. "Set up by hand" (browser-secret path) inside Add tool for old CLIs and imported devices. |

**Rollback.**
- Set `classic` or `preview` and restart. No DB change is needed: everything V3 wrote is additive and ignored by classic.
- Records written in v3 (devices, exchanges, setups) are inert in classic. Agents created through Add tool are ordinary agents and show in classic Agents. Tokens minted by redeem are ordinary agent tokens.

**Mixed clients.**
- **Old web (cached SPA)** posting `POST /agents` without `device_id` still works; the boot backfill and `registerAgent` link it.
- **Old CLI:** `agent login` and hooks are unchanged.
- **New CLI on an old board:** manifest 404 → refuse new commands with a clear message.
- **Old board, new web:** impossible, since they ship as one image.

---

## J. Dependency-ordered slices and PRs

**Notes for every slice.**
- **Ownership:** CORE owns `server/**` except `server/web/`. SHELL owns `server/web/`, `cli/`, `plugin/`, `docker/`. CHIEF owns `docs/`, `.tasks/`, `CLAUDE.md`.
- **`.github/` is not in the ownership table.** Flag for CHIEF (`[ops]` or a named edit).
- Each PR has its own task file, from the LAI-1042+ range (proposal).
- **Gate:** CI runs the full gate. **Belka rule:** one test file at a time, single worker.
- **Parallel** = no shared files.

### Slice A — inventory, tests, schemas, compat metadata

**A0 (CHIEF, docs). Prerequisite: LAI-1002** (four-digit `PLANNED_MARK`).
- File or confirm it as p1. It is CORE's (`server/test/tooling/`).
- Owner: CORE.
- Files: `server/test/tooling/schema-spec-drift.test.ts:183` and `closedTaskIds`.
- Test: the parser reads `LAI-1045` whole.
- **Blocks B1 / C1 SPEC marks.**

**A1 (CHIEF). Decision and SPEC.**
- D-122 *Devices are paired; tools are added by exchange; Developer access V3*, covering L1–L5.
- SPEC §4.9 (kind on view), new §4.78–§4.83 tables marked *Planned — LAI-…*, §6.1 (device signature, a named paragraph), §6.3 (pairing bucket), §6.4 endpoints, §11.4.2 screen map, §11.7 env flag.
- **Must merge before CORE's halves** (SPEC drift guards).

**A2 (CORE). Compatibility endpoint and build commit.**
- Files: `S/version.ts`, `S/env.ts` (flag), `S/http/routes/developer.ts` (new), `S/app.ts` mount, `S/services/developer-compat.ts`.
- Tests: route body shape, anonymous allowed, null commit, flag values.
- AC: no secrets; the closed `features` keys asserted by name.
- **Parallel** with A3 and A4.

**A2b (SHELL docker + CHIEF ops).**
- `docker/Dockerfile` `ARG/ENV LAIKA_BUILD_COMMIT`.
- `.github/workflows/deploy.yml` build-arg.
- AC: a deployed health/manifest shows the SHA.

**A3 (SHELL web). Characterisation and shared components.**
- Golden tests for `projectPrompt` / `projectBlock` / `instructionsTarget` / redirects / tab parsing in both future modes.
- Extract `components/wizard/StepRail.tsx`, `WizardCard.tsx`, `ToolTile.tsx`, `CodeBlock.tsx` (from `SetupBlockView`), `OverflowMenu.tsx`, `live-region.ts` (throttled `aria-live`).
- Add `W/routes/screens/developer/tool-capabilities.ts`, plus a drift test against `cli/README.md` and `CAPABILITIES.md` by name.
- AC: Connect and Agents render pixel-identically (existing browser tests green). `structure.test.ts` mirrors are added; `WEB_*` maps are SHELL's.
- **Parallel** with A2.

**A4 (SHELL cli). `laika version` and `laika doctor` (read-only).**
- Files: `C/index.ts`, `C/version.ts`, `C/doctor.ts`, `C/protocol.ts`.
- Tests: `cli/test/version.test.ts`, `doctor.test.ts` (sandbox HOME; no secret printed; exit codes).
- **Parallel.**

### Slice B — non-breaking migration and token classification

**B1 (CORE). Migration 0070 and devices service.**
- Files: `S/db/schema.ts`, `S/db/migrations/0070_*`, `S/db/backfill.ts` (`backfillAgentDevices`), `S/services/devices.ts`, `S/services/agents.ts` (set `device_id` on register/update), `GET /devices`, `PATCH`, `confirm`, `merge`, `revoke`.
- Tests: §D.3 rehearsal list, plus 404 for others' devices and a merge refused on active-pair conflict.
- AC: existing `/agents/devices` responses byte-identical; no agent field changed.
- Depends on A1 and A0.

**B2 (§4.4 three owners: CHIEF SPEC + CORE + SHELL). Token kind.**
- CORE: `S/services/tokens.ts` view and `?kind=` filter, `S/http/routes/tokens.ts`.
- SHELL: `W/api/tokens.ts` type, `TokenRow`, Org Security grouping, `AdminPanel` grouping, impact copy.
- Tests: `view-type-drift` green; `token.revoke_any` still works on agent tokens; admin lists show the label; `?kind=personal` excludes agent tokens.
- Merge procedure: CORE half to local master unpushed, then SHELL, then push (§4.4).
- Can run **parallel to B1** (different files).

**B3 (SHELL web, client mirror).** `W/api/agent-devices.ts` and the new `W/api/devices.ts` types for `DeviceView`. This is the `view-type-drift` half of B1, so it follows the §4.4 procedure with B1.

**B4 (CHIEF docs).** `docs/acceptance/LAI-10xx-devices-migration-rehearsal.md` and an `AGENTS-ROLLOUT.md` 0070 row.

### Slice C — onboarding APIs and CLI

**C1 (CORE). Pairing.**
- Tables 3 (`device_pairing_requests`); routes E.1; device-signature verifier `S/auth/device-signature.ts`; `LIMITS.pairing`; backoff.
- Tests:
  - expiry;
  - single claim;
  - wrong fingerprint → 409;
  - replay rejected;
  - an unapproved complete is 202;
  - the code alone never yields any credential (assert no `tokens` row is created through the whole pairing);
  - others' requests → 404;
  - token actors refused (`session_required`);
  - 429 paths with `Retry-After`.
- Depends on B1.

**C2 (CORE). Exchange, reuse, reports, access check.**
- Tables 4–6; routes E.2, E.3, E.5, E.7; `recordMcpUse` raw slug; per-project grant PUT.
- Tests:
  - one active agent per pair (reuse);
  - duplicates → 409;
  - redeem once;
  - rotate atomic (old token dead in the same txn);
  - cloud expiry at redeem;
  - secret only in the redeem 201 and never in an exchange GET;
  - a verification curl `/me` never makes `tool_request` pass;
  - another tool's clientInfo does not pass;
  - consent untouched;
  - viewer `full` refused;
  - `effective` = intersection.
- Depends on C1.

**C3 (SHELL cli + plugin). Pairing and add-tool.**
- Files: `C/device.ts`, `C/tool-add.ts`, `C/agent-adapters.ts` (omnigent credential-only), `C/agent-session.ts` (store `agent_id`/`device_id`), `P/scripts/laika-claude` (agent-credential preference), `P/scripts/install.sh` (`--no-credential`, env backup, PATH idempotence, strings).
- Tests:
  - stub-board e2e for pair and add;
  - `~/.laika/env` byte-identical after `tool add`;
  - other MCP servers preserved;
  - `.bak` once;
  - no secret in stdout, argv or config files (grep sandbox HOME for `lai_` outside `agents/*.json`);
  - Codex existing entry `kept`;
  - hooks limits printed.
- Depends on C2 (contract), but can build against a stub board in parallel once A1 is merged.

**C4 (SHELL cli).** `laika project check`. Tests: revision detection fixtures and no content sent.

### Slice D — V3 UI, project-first (SHELL, all behind `preview`)

**D1.** Shell, flag read, `TAB_ALIASES`, Overview (resumable from `GET /devices` + setups; "Set up a project" primary when a tool exists).
- Files: `DeveloperScreen.tsx`, `page-tabs.ts`, `routes/screens/developer/v3/OverviewTab.tsx`, `overview-state.ts`.

**D2.** Project setup (§G).
- Files: `v3/ProjectSetupTab.tsx`, `project-setup.ts`, `connect-copy.ts` (revision 2, `replaceLaikaBlock`), `W/api/project-access.ts`, `W/api/project-setups.ts`.
- **Parallel** with D3 and D4 (no shared files except `DeveloperScreen.tsx`, which D1 owns).

**D3.** Devices tab (nested tools, imported confirm, conflicts, ⋯ menus, disconnect/reconnect confirms naming sessions, consent switch reuse, revoked toggle).

**D4.** Add device and Add tool wizards (pairing approval with fingerprint compare, exchange command, verification checklist polling `GET /agents/:id/verification` with throttled live region, "Set up by hand" fallback reusing the old secret panel).

**D5.** Activity (move) and Advanced (`kind=personal`, expiry select, legacy label, "Upgrade connection").
- Every D PR covers: light and dark, 390 px, keyboard, focus return, and the states empty / loading / error / offline / 403 / session-expired / 409 / cloud-expired / revoked / migration-needed / update-failure.

### Slice E — updates

**E1 (CORE).** `whats_new` source in `S/services/developer-compat.ts` and the protocol bump. This could fold into A2 if it lands later.

**E2 (SHELL cli).** `laika update` (§F.5).
- Tests in a temp git repo: dirty refused; non-ff refused; staged failure leaves HEAD unchanged; rollback restores files; idempotent re-run; creds, device and env files byte-identical; other MCP servers untouched.

**E3 (SHELL web).** Status words on rows, Copy update command, What's new, the project-block "Update available" from recorded evidence, the board-build line in Org Overview.

### Slice F — legacy and admin links, QA, switch

**F1 (SHELL web).** Org Security / People / Profile / Space settings copy and links (§B.7), stale comments, remove the `RegistrationStep` gallery entry.

**F2 (SHELL cli).** `cli/README.md` new commands, capability tables, removal of "sidebar SETTINGS → Tokens".

**F3 (CHIEF docs).** README, FEATURES, ROADMAP npx lines (closes LAI-624 overlap), AGENTS-ROLLOUT §3 new order, D-114 item 6 discouragement date (LAI-560).

**F4 (CHIEF + operator).** Flip `LAIKA_DEVELOPER_ACCESS=v3` on production after a live walkthrough is recorded in `docs/acceptance/`. Rollback = env.

**F5 (SHELL).** After a soak period: remove classic Connect/Agents code paths (a separate PR, owner-approved).

### Parallel lanes (no shared files)

| Lane | PRs |
| --- | --- |
| CORE | A2 → B1 → C1 → C2 → E1 (B2's CORE half in parallel with B1) |
| SHELL web | A3 → (B2/B3 halves) → D1 → {D2, D3, D4, D5} → E3 → F1 |
| SHELL cli | A4 → C3 → C4 → E2 → F2 |
| CHIEF | A0 (ensure LAI-1002 is scheduled), A1, B4, F3, F4 |

---

## K. Test matrix

| Area | Tests (owner) |
| --- | --- |
| Migration | 0070 populated upgrade, idempotent backfill, schema-ahead, FK check, unchanged agents/tokens/grants/consent/claims/history, look-alike labels, duplicates kept (CORE `server/test/db/`) |
| Permissions | every new route: session-only enforced (`session_required`); agent token refused for management; viewer `full` refused; effective = intersection; `agents_allowed` off (CORE) |
| 404s | others' devices, pairing requests, exchanges, agents, setups → identical 404 bodies (CORE) |
| Token kinds | `kind`/`agent_id` on own and admin views; `?kind` filter; `revoke_any` impact; agent creds never in the Advanced list, Security "personal" group, or profile personal group (CORE + SHELL browser) |
| Legacy compat | personal token REST + MCP unchanged; old `POST /agents` links a device; old CLI login/hooks; manifest 404 handling in the new CLI (CORE + SHELL cli) |
| 24 h TTL | cloud via kind and via label; redeem-time re-check; rotate; exactly 24 h allowed (CORE) |
| One-time secret | the secret appears only in the redeem/rotate/register 201; `markOneTimeSecret` keeps it out of the idempotency store; no GET returns it; the browser never receives it in V3 (CORE + SHELL) |
| Pairing security | code ≠ credential; single claim; fingerprint mismatch; replay; skew; expiry; backoff 429 (CORE) |
| Per-tool verification isolation | curl `/me` ≠ Ready; Codex's request doesn't tick Claude's row; config file presence ≠ Ready; checkbox absent (CORE + SHELL) |
| Hooks and consent | `tool add` installs hooks only for claude-code/codex; Codex refusal path; consent untouched by add/rotate/update; default off (SHELL cli + CORE) |
| Config backup / no leak | `.bak` once; other MCP servers preserved; `~/.laika/env` byte-identical; no `lai_` outside `agents/*.json` (SHELL cli) |
| Redirects | every §C row in classic/preview/v3; query preserved; replace; no loop (SHELL) |
| Prompt | revision-2 golden; `replaceLaikaBlock` fixtures; zero secrets; marker kept; no commit instruction present (SHELL) |
| Update | dirty refused, staging failure, rollback, idempotent, protected files untouched (SHELL cli) |
| UI | light/dark per screen; 390 px no horizontal scroll; keyboard-only paths; focus trap and return; live region throttled; status words present without colour (SHELL browser) |
| Regression | existing `browser/developer-tabs`, `connect`, `agents-tab`, `devices-tab`, `checkpoint-consent`, `organisation-tokens` green in classic (SHELL) |

---

## L. Risks and unresolved decisions (each with a proposed default)

**L1. Device kind vs D-121 item 2.**
- **Default:** add `kind`, and apply the 24 h rule to `kind=cloud` **or** label `Cloud`. Cloud devices may then be named freely ("CI runner").
- This needs D-122 to amend D-121 item 2.

**L2. The Claude Code MCP identity switch.**
- When a Claude Code agent credential exists, `laika-claude` uses it instead of the personal token, so MCP actions become the agent's (narrowed by its grants).
- **Default:** yes, only after an explicit `tool add`. Never retroactive.

**L3. Update source trust.**
- A commit pin from the board, over TLS.
- **Default:** accept for now. Signed release tags are a follow-up.
- `LAIKA_CLI_SOURCE_URL` lets self-hosters point at their fork.

**L4. Audit verbs.**
- **Default:** none, per D-114/§4.63. The pairing and exchange tables are the record.
- New verbs would rebuild `activity` and need three owners.

**L5. Policy actions.**
- **Default:** reuse `agent.read_own` / `agent.manage_own` for devices, pairing and exchanges. No §3.1 rows are added.

**L6. Agent tokens reading the owner's token and agent lists (A14).**
- **Default:** file a separate CORE task to narrow them to self. Not part of V3.

**L7. Personal token default expiry in Advanced.**
- **Default:** 90 days, with "Never" still allowed (D-121 clarification).

**Other risks:**
- **Codex and other tools' env-var isolation.** An exported variable is visible to every child of that shell, so per-tool isolation is per-file, not per-process. This is stated in the UI help.
- **Pairing on headless cloud runners.** A human must approve within 10 minutes. Cloud runners with ephemeral HOME cannot keep a device key. **For Copilot cloud, fall back to "Set up by hand" with a 24 h token in the runner's secret store.** Documented, not automated.
- **Concurrent sessions.** LAI-627 is in progress on `install.sh`, `CopyButton.tsx` and `connect-agents.ts`. C3 and D4 must merge after it, or coordinate.

---

## M. Honest capability gaps per tool

**Sources:**
- `cli/README.md:822-861`.
- `cli/agent-adapters/CAPABILITIES.md` (line 29: "No harness in this file has a Verified-and-tested cell" for the six non-hook harnesses; enforced by `cli/test/agent-adapters.test.ts:426-455`).
- `C/agent-adapters.ts:29-125`.
- `C/agents.ts:55-365`.

| Tool | Automatable by `tool add` | Manual | Unverified / unsupported |
| --- | --- | --- | --- |
| **Claude Code** | Credential file; `laika-claude` env; hooks (SessionStart … SessionEnd); sessions, claims, auto-checkpoints with consent. **Verified-and-tested** for credential and sessions | Quit and restart with `laika-claude`; plain `claude` gets no Laika tools | UserPromptSubmit/PostToolUse inject: Documented-not-tested. Hand-off: Documented-not-tested |
| **Codex** | Credential file; `config.toml` MCP entry (env-var name); `hooks.json` | **Trust hooks in `/hooks`**; a project `.codex/config.toml` only in trusted projects; refused when `config.toml` defines hooks | Everything **Documented-not-tested**; headless `codex exec` needs hook trust (**Unverified**) |
| **Cursor** (IDE/CLI) | Credential file; `~/.cursor/mcp.json` env reference | Launch from a terminal to inherit env; `cursor-agent mcp enable laika` | Sessions explicit `--pid` only, Documented-not-tested; inject Unsupported; `cursor-agent` answered "Authentication required" on Belka (README :811-820). **MCP-only: no claims or checkpoints advertised** |
| **Copilot CLI** | Credential file (`copilot-cli`, registers as `other`) | MCP config by hand | Inject Unsupported (output dropped); not installed on Belka. MCP-only |
| **Copilot in VS Code** | Credential file; `.vscode/mcp.json` via `--project` | `code --add-mcp`; launch from a terminal | Inject Unverified; headless Unsupported. MCP-only |
| **Copilot cloud** | — | Token in the runner secret store, ≤24 h (Cloud) | Credential file Unsupported (ephemeral `/root`); sessions Unsupported (behind the cloud firewall) |
| **Gemini CLI** | Credential file; `~/.gemini/settings.json` | Browser sign-in to Gemini itself | `BeforeAgent` inject Documented-not-tested; stopped at sign-in on Belka. MCP-only |
| **Antigravity** | Credential file only | Config requires an **inline token** — refused by `tool add`, shown as a manual step with a warning | **Beta** (`connect-agents.ts:116`); no session-end hook; remote headers reported Unauthorized (antigravity-cli issue 233). MCP-only |
| **Omnigent** | Credential file once added to CLI `HARNESSES` as credential-only (C3); `<agentDir>/tools/mcp/laika.yaml` via `--dir` | Pick the agent folder; per-agent config | **No sessions, hooks or checkpoints** (not in `HARNESSES` today). Worker harness/model come only from sessions opened by workers' own hooks, so "Ready" relies on the MCP initialize `clientInfo`. The identity is Omnigent; workers are metadata |
| Others (OpenCode, Windsurf, Zed, Cline/Roo, Continue, Kiro, Goose, Amp, Junie, Warp, Hermes, Claude Desktop) | Credential file where a CLI harness id exists (**none today**), else "Set up by hand" | Printed snippets; several use the `mcp-remote@0.14.3` bridge with an inline token | No row in either capability matrix: **Unverified** |

**UI rules that follow:**
- Only claude-code and codex rows may show "Sessions & claims" and "Automatic checkpoints".
- Every other tool shows "MCP only — reads and writes tasks; no session claims or automatic checkpoints".
- "Unverified" tools say so on the tile.
- No tool count is ever hard-coded.
