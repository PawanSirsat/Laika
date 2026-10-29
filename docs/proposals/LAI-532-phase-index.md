# Agent identities and safe hand-off — phase index (revised 2026-10-29)

Parent: LAIKA-785 / LAI-532. This index replaces the phase list in
`LAI-532-agent-identities-and-handoff.md` §7 for planning; that document stays
the design record. Owner direction 2026-10-29: identity is **harness × device**
(D-118), devices include this laptop, another laptop, anyone's laptop where a
credential was registered, and the cloud; UI bugs and simplification are
first-class work, not leftovers.

Status key: **Live** (in production) · **Review** (PR open) · **Building** ·
**Ready** (can start) · **Blocked** (named reason) · **Parked**.

## Phase 1 — Identity and visible delegation · P0 · **Live**

Registered agents, per-agent credentials, Agents tab, Agent field and card chip,
work requests, attribution, token-scope fixes. Shipped in #111 (fe49255c),
deployed 2026-10-28 (4bb4846c). Live acceptance: LAI-582, all 9 rows PASS
(`docs/acceptance/LAI-582-phase-1-2-live.md`, PR #120).

## Phase 2 — Exclusive sessions and connection state · P0 · **Live, two gaps**

Sessions, claims, fencing, expiry, explicit reclaim, session helper, claim-
expired state. Live. Open: *Working* / *Connection lost* on cards (LAI-568,
#112, Strelka); same-millisecond ordering (LAI-575, #114); write precondition
(LAI-571, #113); paired response types (LAI-564, #115).

## Phase 2.5 — Identity model, devices and UI quality · P0 · **Building** (new)

Why: the first live use showed that "which agent" must mean *the thing a person
points at* — polly on Belka, Claude Code on Strelka, a cloud runner — and that
the screens must say it in one short line.

| Slice | Area | Status |
|---|---|---|
| D-118 harness × device; D-119 selected agent owns the claim | docs | Review (#121) |
| D-119 claim rule + session harness / version / model fields | CORE | Building |
| One-line agent name; drawer/activity line with vendor + model; Details | SHELL | Filed by the CORE slice |
| Session helper reports harness, version, model | SHELL (cli) | Filed by the CORE slice |
| **Polly · Belka**: the manager and its workers act as one agent | Belka config | Building |
| **Devices view**: Agents grouped by device (Belka, Strelka, Cloud, other people's laptops), last seen per device, revoke everything on a device in one action, a device you do not recognise is flagged | CORE + SHELL | Ready after the D-119 slice |
| **Cloud and shared devices**: a cloud runner registers as `<harness> · Cloud` with a short-lived credential and a stated owner; another person's laptop is their agent under their owner (D-114), never yours | CORE + docs | Ready after the Devices view |
| UI bugs found in use: List scrolls sideways at 1440 px with agents (LAI-569); dashboard / org history say "an agent" without naming it (LAI-570); wizard copy and identical harness·device names (LAI-583); Inbox › Review caps at the oldest 200 (LAI-584, CORE); Agents-tab test flake (LAI-581) | SHELL / CORE | Ready |
| Flaky-test fixes and restore the blocking deploy gate (LAI-577 #119, LAI-578 #117, LAI-579 #118, LAI-580) | SHELL / ops | Review |

Usable outcome: on the board a person sees a handful of named agents per
device; a card says `Polly · Belka`; the drawer says which vendor and model ran;
a standalone harness cannot take work given to another agent.

## Phase 3 — Checkpoints and safe recovery · P0 · **Blocked: D-115, D-116 approval**

Checkpoint helper, push-verified checkpoints, manual hand-off, orphan recovery
offers, approval policy, acceptance, Inbox › Hand-offs, recovery history;
certify Claude Code and Codex. Cards LAI-545 – 551, handed to Strelka. The
device model above matters here: a recovery offer names the receiving
**agent and device**, and "Polly · Strelka" can recover "Polly · Belka".

## Phase 4 — Resource warnings, live notices, context revisions · P1 · Ready after Phase 3

Resource watcher, SSE helper with replay, versioned project context and
notices (LAI-552 – 556). Devices add one item: a device that goes quiet shows
as such on the Devices view.

## Phase 5 — Remaining adapters and optional launcher · P2

Cursor, Copilot, Gemini CLI, Antigravity adapters (LAI-557). Launcher LAI-558
**Parked** behind D-117 and the stop list (LAIKA-516).

## Phase 6 — Release qualification · P0 release gate

Failure matrix incl. the two-device experiment (Belka as device A, Strelka as
device B, plus one cloud run), accessibility and browser checks, migration and
rollback rehearsal, operator docs (LAI-559, LAI-560).

## Rules that apply to every phase

- One agent per harness per device (D-118); vendor and model live on the
  session.
- A human accepts work (Done) and approves decisions from their own browser
  session or GitHub account. Agents never do either, even when they hold the
  owner's login for setup tasks such as registering an agent.
- Every slice: its own task file and card, claimed with `start_working` and a
  branch, cross-vendor review, its own PR, the human merges.
