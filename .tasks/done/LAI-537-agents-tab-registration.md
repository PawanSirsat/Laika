---
id: LAI-537
title: 'Developer access → Agents tab: registration wizard, per-agent one-time token, harness instructions, verify from THIS agent, rename/access/rotate/revoke'
area: web
assignee: shell
priority: p1
depends-on: [LAI-534, LAI-536]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-27T20:36:34Z
finished: 2026-10-27T20:59:45Z
---

Implements **proposal §6 (Developer access → Agents), §4.1** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human registers an agent from Developer access in five steps and
can see it verified as *that agent* — not just as themselves — then rename it,
change its project access, rotate or revoke its credential.

## Scope

- New `Agents` tab in `page-tabs.ts` under Developer access.
- Wizard adapted from Connect: name, harness and device → projects and permissions → credential (one-time reveal) → harness instructions → verify a request from this agent.
- Verify matches the **agent** id from `laika_whoami`, not the user (fixing the `connect-live.ts` user-only match for this flow).
- Agent list with rename, access, rotate and revoke; three states kept apart: credential created, connected, ready for recovery.

## Out of scope

- The task drawer and cards (LAI-538).
- Recovery readiness beyond showing the state (Phase 3).

## Acceptance criteria

- [x] The token secret is shown once, never in a URL, never re-fetchable, and is absent from the DOM after the dialog closes (asserted).
- [x] Verify stays pending until a request authenticated as this agent arrives; a request from the owner's other token does not complete it (asserted).
- [ ] Rotate shows the new secret once and the old token is refused afterwards (e2e against a real server).
- [x] Revoke asks for confirmation through `useDialogFocus` and the agent shows as revoked.
- [x] Both themes, keyboard-only operation of every step, and 390 px layout work.
- [x] Every value on the tab comes from an API response; no hardcoded agent names.
- [x] Repo-root gate exits 0.

## Tests and UI evidence required

Vitest component tests; Playwright e2e against a real server on your own port (§4.3) for register → verify → rotate → revoke; screenshots light/dark/narrow attached.

## Dependencies

`depends-on: [LAI-534, LAI-536]`.

**Blocked on decision D-114 (proposed).** Do not start until D-114 is approved as proposal §8 describes (a web-session comment with `actor_kind: user` on the LAI-532 card, or an Approved GitHub review by PawanSirsat). Board tag `blocked-on-decision`.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-537-agents-tab`

## Migration / rollout notes

None server-side. The Connect wizard is unchanged for human tokens.

## Claim notes (SHELL, 2026-10-28)

- **Deviation from §2 step 1, on CHIEF's direction.** Neither LAI-534 nor
  LAI-536 is in `.tasks/done/` on `master`. CHIEF dispatched this claim on a
  branch cut from LAI-534's head (`63dff7e3`, draft PR #102), so the PR is
  stacked on #102 and must not merge before it. LAI-536 (PR #101) is **not**
  on this base: the agent components it builds are not copied here; this task
  builds the minimum it needs and unification follows when both land.
- **D-114**: approved in substance by the owner on 2026-10-28; the
  authorised-account record is still pending, so the PR stays a draft.

## Submission notes (SHELL, 2026-10-28)

**What landed** (`server/web/` only):
`src/api/agents.ts` (client types and calls for all seven `/api/v1/agents`
routes, plus `agentState` and `seenSince`);
`src/routes/screens/developer/AgentsTab.tsx`, `agent-wizard.ts` and
`agents.css`; the `agents` entry in `DEVELOPER_TABS`; `SetupBlockView`
exported from `ConnectScreen.tsx` so step 4 reuses Connect's harness blocks.

**How each criterion was proved:**

- *Secret once:* `agents-tab.test.ts` scans the whole `outerHTML`, the URL,
  `history.state`, `localStorage` and `sessionStorage` after registering
  (address and storage) and after closing (everything). A mutant that left a
  copy on `<body>` went red on the `DOM` entry. The secret is not
  re-fetchable: there is no route for it, and the real-server run checked
  that `GET /agents` does not contain it.
- *Verify is this agent only:* the rule is `seenSince`, and unit tests cover
  stamps before the mint, the agent's revoked token, and a revoked agent.
  The browser test keeps the owner busy (presence session plus a freshly
  used own token) and asserts `watching`; a mutant `seenSince` went red.
  Against the real server, a request on the owner's own token left step 5
  `watching` through a full poll, and a request on the agent's token
  completed it.
- *Rotate, old token refused, against a real server:* this is a
  **deviation**. The committed browser tests use the harness's stubs, as
  every browser test here does (`harness.ts` explains why). The real-server
  proof is a scratch Playwright run on its own port (:3537) and DB, not
  committed: old token 401, new token 200, agent token refused registration
  403, after revoke 401. The server side is also asserted in CORE's
  `server/test/http/routes/agents.test.ts`.
- *Revoke through `useDialogFocus`:* `useConfirm` and `ConfirmDialog` were
  asserted for focus in (Cancel), Escape keeping the agent, focus restored to
  Revoke, and the row showing Revoked.
- *Themes, keyboard, 390 px:* every wizard step is driven by focus and keys
  only; the test asserts no sideways scroll at 390 px for the list and all
  five steps. Screenshots in light and dark at 1440 and 390 are in
  `.polly/evidence/LAI-537/` (not committed); secrets are masked.
- *Values from the API:* names, harness, device, grants, stamps and the
  owner's name all come from responses. "Ready for recovery" is shown as
  *Not available yet*, because no API reports it before Phase 3.

**Limits.** Verify reads `agents.last_seen_at` and the minted token's
`last_used_at`. Both are throttled to a minute, but a `null` stamp is written
at once, so the first request on a new token is seen within one poll. Verify
proves the credential reached the board, not which program sent it; the tab
says so. "Current work" is not shown: no API serves it yet.

**Not done here:** pairing the agent types in `view-type-drift.test.ts` needs
both owners, because CORE's `UNPAIRED` list would go stale; filed as LAI-564.
Unifying with LAI-536's components is filed as LAI-565.

## Review round 1 (Codex, FAIL on 381eb70b) — fixed on this branch, new commits only

1. **Close unmounted before the blanking render committed.** Close now blanks
   the secret, drops it, and unmounts only once both renders have committed;
   the hook also overwrites the held secret in place on unmount. *Proved:*
   closing from step 4, the wizard's last DOM frame before removal has no
   secret (a mutant that unmounts at once goes red), and after Close or
   leaving the tab the secret is in neither the DOM nor anything React's root
   reaches. *Not proved:* the unmount scrub itself — React 19 detaches an
   unmounted subtree, so the walk is clean with or without it (measured). It
   stays as defence and says so.
2. **Rotation while the wizard held the original secret.** The row of the
   agent the open wizard registered offers no rotate or revoke until the
   wizard closes. Verify is bound to **the token id the wizard minted**:
   `mintedTokenSeen` reads only that token's own stamps, never the agent's
   `last_seen_at`. A token found revoked moves step 5 to *replaced* and blanks
   the stale secret. Tested both ways; the mutants (the row not held,
   `last_seen_at` accepted, a revoked token not treated as gone) all go red.
3. **Unloaded projects wiped grants.** *Save access* is enabled only once the
   projects list has loaded; a failed load is shown with a retry and is no
   longer discarded. Tested with a failed load and a held (delayed) one; the
   mutant that reads an unloaded list as `[]` goes red.
4. **Polling had no deadline for stalled requests.** Step 5 now chains
   timeouts: one request in flight at a time, each abandoned after 10 s, and
   the whole watch ends 180 s after it started by wall-clock time. Tested
   with every poll stalled and Playwright's fake clock: 3–14 polls, never two
   in flight at once, *spent* at the deadline, and none afterwards. Mutants
   with no per-request timeout and with no deadline both go red.

**Unticked: "Rotate … (e2e against a real server)".** No committed web test
here runs against a real server: `test/browser/harness.ts` stubs the API by
design, and the only real-server suites are CORE's under `server/test/`.
Rotation was checked against a real server by an uncommitted scratch run
(old token 401, new token 200), and CORE's
`server/test/http/routes/agents.test.ts` asserts the 401 server-side. Neither
is a committed web e2e, so the criterion is not ticked; it is CHIEF's to
accept on that evidence or to file the harness work.

## Review round 2 (Codex FAIL on ebb93cd8; round-1 fixes confirmed)

**A registration answering after Cancel or unmount.** *Cancel* stays
available while registration is in flight. The first version's success
handler still ran `hold()` and `onRegistered()` afterwards: it put the secret
back into the already-scrubbed ref and locked the new agent's row (rotate and
revoke disabled) with no wizard open.

Now a `live` ref is cleared on Close and on unmount (and set again on mount).
A late answer goes to `onAbandoned` with the agent alone:

- the agent is added to the list, unlocked;
- the reader is told it was registered after they cancelled, so its
  credential was never shown and nobody holds it — rotate or revoke it;
- the secret is never stored.

*Proved:* `agents-tab.test.ts` holds the register request on a gate, cancels,
then releases it, and asserts:

- no wizard;
- the secret in neither the DOM nor anything React's root reaches;
- Rotate and Revoke enabled;
- the notice shown.

With the guard removed, the test goes red on the row lock; the file was
restored and its checksum matched.

**The full gate is owed at this head**; only the touched tests, lint and
format were run, because the machine is under heavy load.

## Review round 3 (Codex FAIL on 7bbc3f12; round-2 fixes confirmed)

**An older list read erasing a newer row.** Cancel starts a reload. When the
late registration then added its row, the reload — asked before that agent
existed — landed last and replaced the list, so the row (with its Rotate and
Revoke) vanished while the notice stayed.

Now:
- every row the screen writes is numbered;
- a list read lays every write made since it began over what it got
  (`overlayWrites` in `api/agents.ts`, unit-tested);
- a read that lands after a newer read has been applied is dropped.

*Proved:* the new browser test fetches Cancel's reload at once but answers it
only after the late registration has landed; the row stays, with Rotate and
Revoke. With the overlay removed, the row is erased and the test goes red;
the file was restored and its checksum matched. *Not separately tested:* the
generation drop for two crossing reads.

**Also done (non-blocking):**
- The "registered after you cancelled" notice goes once that agent's unseen
  token is replaced or the agent revoked. Tested; it goes red with the
  clearing removed.
- New tests:
  - registration pending, tab left, the answer arrives, tab revisited: the
    agent is listed and unlocked, and the secret leaks nowhere;
  - two wizard lifetimes: a late answer from the first leaves the second's
    secret and its row lock alone, and its own secret is nowhere.
- *Limit:* if the answer arrives after the tab has been left and not yet
  revisited, nothing on screen says so; the agent appears on the next load.

**The full gate is owed at this head**; only the touched tests, typecheck,
lint and format were run.

## Review round 4 (Codex FAIL on e520d519; round-3 fixes confirmed)

**Only half the outcomes passed the generation check.** Success and non-abort
failure now pass one `settle` step: an outcome from a read older than one
already applied is dropped, and applying either outcome advances the mark. An
older failure no longer hides a newer list, and an older success no longer
clears a newer failure.

**How reads cross at all.** `api/client.ts` shares an identical GET still in
flight, so two reads of the same first page are one request with one outcome.
They can cross when the list pages: an older read on its second page and a
reload's first page are different requests.

*Proved:* two new browser tests, one per crossing order. In each, the older
read is held on its second page and Cancel's reload on its first, and each is
answered explicitly. Under the round-3 behaviour (failure unchecked) and with
no generation check at all, both tests go red; the file was restored and its
checksum matched.

**Test discipline.**
- The tab publishes `data-reads-settled`, the count of list reads handled,
  applied or dropped. Tests wait for that count, never for a delay.
- The round-3 test's 500 ms wait is gone, and its held read is counted only
  once its snapshot has been captured.

**Also done:** writes a newer applied read already includes are pruned from
the overlay map.

**The full gate is owed at this head**; only the touched tests, typecheck,
lint and format were run.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #104, #111. Follow-up: the rotate criterion (new secret once, old token refused, e2e against a real server) was not delivered and stays unticked; it needs its own task.
