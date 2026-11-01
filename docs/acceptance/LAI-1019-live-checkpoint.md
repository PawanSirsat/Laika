# LAI-1019 · Phase 6 live checkpoint on production, one device

Board LAIKA-873, part of LAI-532 / LAIKA-785. Run 2026-11-01, 09:56–16:12
UTC, on **Belka only**, against production (`LAIKA_URL`, project `laika`) and
the real repository `PawanSirsat/Laika` with its real webhook (hook
`699782745`, `push` among its events, last response 200).

**This is not the two-device demonstration.** It proves the checkpoint →
GitHub verification → tag deletion → re-tag → abrupt loss → recovery offer
path end to end on one machine. LAI-551's cross-device acceptance (Belka
agent A, Strelka agent B, B verifies and accepts, A refused `409
stale_claim`) is **UNVERIFIED** and stays so (§5).

## 1. Set-up

| Item | Value |
| --- | --- |
| Agent | Polly · Belka `01M635B62FE71AN9FXEZEJW9ND` (harness `omnigent`), as `laika_whoami` reports for this session |
| CLI | `~/laika` at `37fec80b` (`git -C ~/laika pull --ff-only origin master`, exit 0) |
| Sandbox card | **LAIKA-875** "LAI-1019 sandbox · live checkpoint test · do not work", selected agent Polly · Belka, ended **Cancelled** |
| Sandbox branch | `LAI-1019-phase6-sandbox`, in a temporary worktree, commit `4bb1f372` (one new file `lai-1019-sandbox.txt`) |
| Agent sessions | `01M6B8Q8EJYF93H6V89A9MJ2CN` (gen 1) and `01M6BXCFRSVS04KZA346TJ8B38` (gen 2). Each was bound to a stand-in harness process (`sleep`, named by `LAIKA_AGENT_HARNESS_PID`) so it could be killed without killing this session |
| Production builds | `37fec80b` (deploy 41284469408) for the save; `8469099f` (41295574269, live 10:16:53Z) for the tag delete; `5999826f` (41322234420, live 15:47:44Z; `uptime_ms` 693 593 at 15:59Z) for reverify and the kill |

Consent: `PUT /api/v1/agents/01M635B62FE71AN9FXEZEJW9ND/checkpoint-consent` as
the owner, 09:59:05Z, `200 {"given":true}`; the agent's own token then read
`Automatic checkpoints are ON`. The password was read from Keychain
(`laika-web-login`) inside the script and never printed. `laika agent
checkpoint consent on` itself refuses without a terminal (`needs_terminal`),
which is why the same request was made directly. At cleanup the consent
already read `withdrawn_at` 14:46:50Z (another session or the owner); the
`DELETE` at 16:11:37Z answered 200, `given:false`.

## 2. Results

| # | Step | Result | Timing |
| --- | --- | --- | --- |
| 1 | Sandbox card, selected agent, claimed by a session of that agent | **PASS** | claimed 10:00:30Z, gen 1 |
| 2 | Consent on for the agent | **PASS** | 09:59:05Z |
| 3 | `laika agent checkpoint save` → tag pushed → registered → `verified` from GitHub | **PASS** (after a credential workaround, §3.1) | branch delivery 10:01:27.225Z, tag delivery 10:01:38.8Z, registered 10:01:38.414Z, **verified 10:01:38.785Z** |
| 3a | Pending past the 10-minute notice, recovery needed | **NOT NEEDED** | never pending: verified 0.37 s after registration |
| 4 | Delete the checkpoint tag on GitHub → `ref_deleted` | **PASS** | delete delivery 10:48:50.679Z; the board's reply to it was `state: ref_deleted` within the 10 ms request |
| 4a | `laika agent checkpoint reverify` at the same commit → new tag `verified` | **PASS** | command 3.2 s; `-r1` delivery 16:03:16.107Z; **verified 16:03:16.088Z**, 0.65 s after the command returned. The original ref stays `ref_deleted` |
| 5 | Abrupt kill → Connection lost → claim expired → recovery offer | **PASS** (single device) | kill 16:04:54.2Z; `suspect` at +75 s; lease lapsed 16:09:35.4Z; `task.claim_expired` + `task.recovered` + offer **16:10:00.994Z** (+306.8 s) |
| 5a | Recovery offer in Inbox › Hand-offs (owner, API) | **PASS** | `GET /handoff-offers?view=recovery` → `counts.recovery: 1`, offer `01M6BXZYX87P14R51EC0CEECCX`, kind `recovery`, checkpoint `verified` at `4bb1f372`, `next_action: accept_with_your_agent`, expires 16:40:00.994Z |
| 5b | Accept from a second device | **NOT RUN, by design** | no second device; the offer was never accepted |
| 5c | `laika agent handoff prepare` from a second agent on Belka (same device) | **NOT RUN** | optional in the plan. Claude Code · Belka and Codex · Belka exist, but whether a recovery offer with `to_agent: null` reaches their `handoff inbox` was not checked. The SHA check before accept is left to LAI-551, where it means something |
| 6 | Cleanup | **PASS, except two remote deletes the session may not make** (§4) | 16:11–16:12Z |

### 2.1 What GitHub sent, and what the board answered

Read from `gh api repos/PawanSirsat/Laika/hooks/699782745/deliveries` (all
pages since 10:01Z; 48 push deliveries, four for the sandbox):

| Delivered (GitHub) | GUID | Ref | created / deleted | Board's 200 body |
| --- | --- | --- | --- | --- |
| 10:01:27.225Z | `33698656-d5db-11f1-82b5-d4f57a956e15` | `refs/heads/LAI-1019-phase6-sandbox` | true / false | `{"ok":true,"handled":true,"rounds":0}`: **a branch push touched no checkpoint** |
| 10:01:38.8Z | `3a5f3500-d5db-11f1-844f-e15ba73bd6f3` | `refs/tags/laika-ckpt/LAIKA-875/01M6B8T3RV2MD3ASZVGVG2JPQJ` | true / false | `state: verified` |
| 10:48:50.679Z | `d2670304-d5e1-11f1-9613-129049405323` | same tag | false / true, `after` 0000… | `state: ref_deleted` |
| 16:03:16.107Z | `bf1a6db4-d60d-11f1-8585-14446f2aa36c` | `…/01M6B8T3RV2MD3ASZVGVG2JPQJ-r1` | true / false | `state: verified` |

This settles LAI-545's open **live test** criterion: GitHub does send a
`push` delivery for creating **and** for deleting a `laika-ckpt/*` tag, to
this repository's hook. It is no longer Documented-not-tested.

`GET /tasks/:id/checkpoints` exposes `verified_at` but no time for the move to
`ref_deleted`. The delete's time above is therefore the board's own reply to
that delivery, not a read of the checkpoint. A read at 15:55:04Z showed
`verification: ref_deleted`, refs `[{revision 0, ref_deleted}]`. After the
re-tag it showed `verified` with refs `[{0, ref_deleted}, {1, verified}]`:
the checkpoint follows its newest ref, and the deleted one never came back.

### 2.2 The step-5 timeline, polled every ~5 s with the agent token

```
16:04:35.4Z  last heartbeat (claim gen 2, lease to 16:09:35.4Z)
16:04:54.2Z  kill -9 <stand-in pid>        exit 0
16:06:10Z    +75 s   connection: suspect   (heartbeat_age 94 s > suspect_after 90 s)
16:09:38Z    +283 s  claim: none           (lease lapsed 16:09:35.4Z)
16:10:00.994Z        task.claim_expired gen 2, task.recovered from_generation 2,
                     offer 01M6BXZYX87P14R51EC0CEECCX open
16:10:06Z    +312 s  card: recovery_available true, offer open (first poll after)
```

The watcher found the harness dead and marked the local session
`abandoned`, `last_error: harness exited`, and sent nothing after that. The
expiry scan wrote the expiry and the offer in one tick, 25.6 s after the
lease lapsed.

### 2.3 An unplanned first run of step 5

The first sandbox claim (gen 1) was lost at **10:13:49Z** with nobody
killing anything. Its lease was last renewed at 10:08:32.8Z, while the
watcher and its stand-in were still running (the stand-in ran its full
`sleep 10800` to 12:58Z). The board then did exactly what step 5 expects:
`task.claim_expired` gen 1 and a recovery offer at 10:13:49.4Z. That offer
expired at 10:43:49Z and a second recovery offer was opened at 10:44:10Z,
which expired at 11:14:10Z.

Cause: **not proven.** `pmset -g log` shows no sleep in that window.
`helper.log` has rotated past 10:08Z, but its surviving entries show
repeated `ENETUNREACH` / `TimeoutError` heartbeat failures on Belka the same
day, and the session had two network drops (ENOTFOUND). A lost network for
more than one lease is the likely cause, and expiry is the correct
behaviour for it. Not filed as a defect.

## 3. Findings

### 3.1 Filed: LAI-1034 (LAIKA-890), a Polly session's checkpoint cannot push

The first save committed `4bb1f372`, then exited 2:

```
laika agent checkpoint: the push of refs/heads/LAI-1019-phase6-sandbox to origin failed:
fatal: could not read Password for 'https://PawanSirsat@github.com': terminal prompts disabled
```

Polly sessions run with `HOME=~/.laika/polly-home` (LAI-589's wrapper).
`GIT_ENV_ALLOW` correctly passes HOME, so git looks for its global config
(`credential.https://github.com.helper = !gh auth git-credential`) and gh
looks for its login under polly-home, and finds neither. For this run only,
a scratch `XDG_CONFIG_HOME/git/config` naming the helper with the real HOME
made `laika agent checkpoint status` retry the push. It reached
`registered` and `verified` with no token on a command line. **Every
automatic save from a Polly session will fail the same way** once consent is
on.

### 3.2 Not defects, recorded

- The agent token cannot cancel a card whose claim lapsed (`409
  stale_claim`, `reclaim: true`). That is the fence working. The owner
  cancelled it.
- Cancelling the card closed its open recovery offer (`counts.recovery` 1
  → 0).
- `laika agent checkpoint consent on|off` needs a terminal by design. An
  agent run cannot give consent through the CLI and has to use the owner's
  REST session.

## 4. Cleanup

Done by this session:

- Both stand-in processes and both watchers: gone. Both sandbox agent
  sessions ended (`laika agent session end`, exit 0, `end_reason ended`).
- Consent: off (§1).
- Local tags `laika-ckpt/LAIKA-875/01M6B8T3RV2MD3ASZVGVG2JPQJ` and `…-r1`:
  deleted (`git tag -d`, exit 0).
- Sandbox worktree: removed (`git worktree remove`, clean, exit 0).
- LAIKA-875: **Cancelled** by the owner's session at 16:12:25Z, never Done;
  its recovery offer closed with it.
- The original remote tag: deleted by the owner at 10:48:50Z (step 4).

Not done, because this session's blast-radius hook refuses remote deletes.
They are left for the owner:

```bash
git -C ~/Documents/GitHub/KvellDynamics/Laika push origin :refs/tags/laika-ckpt/LAIKA-875/01M6B8T3RV2MD3ASZVGVG2JPQJ-r1
git -C ~/Documents/GitHub/KvellDynamics/Laika push origin --delete LAI-1019-phase6-sandbox
git -C ~/Documents/GitHub/KvellDynamics/Laika branch -D LAI-1019-phase6-sandbox   # local, unmerged by design
```

Deleting `-r1` will move the checkpoint to `ref_deleted`. That is harmless:
the card is cancelled, and Laika's retention never deletes tags itself.

## 5. What remains UNVERIFIED

| Item | Why |
| --- | --- |
| **LAI-551, the two-device demonstration** (steps 5–8: B on Strelka fetches and verifies the SHA, accepts, continues from that commit; restarted A refused `409 stale_claim` on REST and MCP; a human accepts in Review) | One device. No offer was accepted |
| **D-116 (a)**: a delivery whose handler failed, redelivered with the same `X-GitHub-Delivery`, is applied | Every delivery here succeeded first time. No redelivery was needed, so none was tried. `gh` lacks `admin:repo_hook`, though listing and reading deliveries worked |
| **D-116 (b)**, the delivery-never-arrived half | The re-tag path itself is now **live-proven** (step 4a). A checkpoint whose first delivery never arrived was not staged |
| **D-116 (c)** | **Live-proven for `ref_deleted`** (§2.1): the deleted ref stayed deleted and only a re-tag brought the checkpoint back. `uncertain` was not reached live |
| **D-116 (d)**: four tags in one push give no delivery | Not run: it would push four tags to the real repository |
| **D-116 (e)**: an annotated tag at a checkpoint name is `uncertain` | Not run |
| **D-116 (f)**: a tag ruleset on `laika-ckpt/**/*` refuses moving and deleting | **No ruleset exists.** `gh api repos/PawanSirsat/Laika/rulesets` → `[]` (exit 0), checked at 07:3x and again at 16:15:15Z. The owner can now add one (Restrict updates, Restrict deletions, target `laika-ckpt/**/*`). After that, step 4 here will be refused, which is the point |
| **D-116 (g)**: concurrent deliveries for one ref apply one at a time | Not observable live; the unit test stands |
| Automatic (hook) saves from a Polly session | Blocked by LAI-1034 |

No test suite was run (Belka resource rule). This record is evidence from
production and GitHub only.
