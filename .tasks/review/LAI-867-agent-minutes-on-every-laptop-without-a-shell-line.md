---
id: LAI-867
title: 'Agent minutes reach the board from every Claude Code on the laptop: `laika activity on` sets telemetry in settings.json, with no shell-profile line and no token written'
area: cli
assignee: strelka
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-22T07:06:29Z
finished: 2026-10-22T07:18:12Z
---

## Goal

`laika activity on` sets Claude Code's telemetry up once, in
`~/.claude/settings.json`. After that, every Claude Code process on the laptop
sends its metrics to the board. That includes processes started from the Dock
and Omnigent's SDK sessions, and no shell-profile line is needed. The token is
read when it is needed and is never written into settings.json.
`laika activity off` takes out exactly what `on` put in, and
`laika activity status` says whether telemetry actually reaches the board.

## Why (read at `28cf1877`)

- **Today it lives in a shell profile.** `laika activity otel` prints seven
  `export` lines (`otelVariables`, `cli/src/activity.ts:372-382`), and tells
  the person to "Put the lines where Claude Code starts from (your shell
  profile)" (`:396`).
  - One line is `OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer
    $LAIKA_TOKEN"`. The token itself is not printed. After `eval`, though, the
    live token sits in that variable for every process the shell starts.
  - Only Claude Code started from a terminal opened after that line ever
    sends. Processes launched from the Dock never read `~/.zshrc`, so
    Omnigent sessions send nothing.
- **The owner's manual fix on Belka (2026-10-22) is the reference.**
  - `~/.claude/settings.json` `env` gets the six **non-secret** variables:
    `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`,
    `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`,
    `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` and
    `OTEL_LOGS_EXPORTER`.
  - A top-level `otelHeadersHelper` points at a mode-700 script. Each time it
    runs, the script reads the token from `~/.laika/env` and prints the
    `Authorization` header as JSON.
  - Verified: a clean-environment `claude -p` got a 2xx, and a negative
    control with no auth got `401`.
  - Omnigent's SDK sessions run with `--setting-sources=user,project`, so they
    read user settings (the hook's header says the same,
    `plugin/scripts/laika-activity-hook:72-74`).
- **What `on` and `off` do now.**
  - `on` merges only hooks into settings.json (`cli/src/activity-hooks.ts`).
    It leaves `<file>.bak` once, before the first change (`:185-191`). It
    replaces the file atomically and keeps its mode, because "settings.json
    may hold the token `laika init` wrote (0600)" (`:164-183`).
  - `off` removes only its hooks (`removeMerged`, `:308-342`), then deletes
    `~/.laika/activity` (`cli/src/activity.ts:404-407`).
  - Neither touches `env`.
- **What `status` says now.** It prints a fixed line,
  `OpenTelemetry   optional, for Claude Code’s background calls: `laika activity otel``
  (`cli/src/activity.ts:483`), and never checks anything.
  `telemetryToBoard` (`cli/src/activity-sync.ts:168-194`) reads
  settings.json's `env` first, then the environment. It checks only "on",
  "otlp" and an endpoint under the board's `/api/v1/otlp/`. It does not check
  headers or `otelHeadersHelper`, so an exporter with no auth still reads as
  `true`.
- **The My day hint.** When there are no agent minutes, it says: "None
  reported for this day. Agent minutes come from Claude Code’s own telemetry,
  when it is pointed at this board (Connect)."
  (`server/web/src/routes/screens/my-day/AgentStrip.tsx:72-76`). It is a plain
  `<p>` that names no step, and no test asserts it.

## Acceptance criteria

- [x] **`laika activity on` writes exactly the reference.**
      - It writes the six variables above into `~/.claude/settings.json`
        `env`, with this board's metrics endpoint, and a top-level
        `otelHeadersHelper`.
      - The helper is a script with mode 0700. Each time it runs, it reads
        `LAIKA_TOKEN` from `~/.laika/env` and prints
        `{"Authorization":"Bearer …"}`.
      - It **never writes the token**, into settings.json or into the script.
      - It backs up first, by the existing `.bak` rule. It keeps the file's
        mode, and leaves every other key and value unchanged.
      - If a key it would write already holds a different value, it leaves
        that value, says so, and `status` reports it.
      - A second `on` writes nothing.

      Tests (temp `HOME`) assert:
      - settings.json after `on` equals the file before plus exactly those
        keys;
      - a fake token from `~/.laika/env` appears in neither file;
      - the script's mode is 0700, and its output is the header JSON with
        that token;
      - the `.bak` matches the original;
      - the second `on` leaves the bytes identical.
- [x] **`laika activity off` removes exactly what `on` added.** It removes
      each `env` key only while it still holds `on`'s value,
      `otelHeadersHelper` only while it points at the script, and the script.
      Tests: `on` then `off` restores the original file byte for byte. A key
      the person changed after `on` survives `off`.
- [x] **`laika activity status` says whether telemetry reaches the board.**
      It no longer prints the fixed `laika activity otel` line. It tells
      apart, at least, these states:
      - not set up;
      - set up, but a key of the person's own disagrees, or the helper fails
        or finds no token;
      - set up, but the board refuses (`401`, or `403 local_activity_off`);
      - reaching the board.

      Any probe it sends carries no metric. There is a test for each state
      against the stub board.
- [x] **D-088's exclusion of automated sessions still holds.**
      - After `on`, `telemetryToBoard` (`cli/src/activity-sync.ts:168-194`)
        is `true` from settings.json alone, with no shell variable. The next
        usage report then carries `excluded`
        (`cli/src/activity-usage.ts:2415-2426`) with every skipped session's
        key. A CLI test asserts this; with today's `on` it sends no
        `excluded`.
      - On the server, `storeExcluded`
        (`server/src/services/token-telemetry.ts:435-473`) deletes those
        sessions' telemetry rows and agent minutes. `recordTelemetry` drops
        their points (`:778-795`). Note that this is a silent filter, not a
        refusal. Both are unchanged. `server/test/services/token-telemetry.test.ts:561`
        and `:576` pass unedited.
      - The task file records, measured, how long a sub-agent's telemetry
        counts before the next sync sends its key and `storeExcluded` takes
        it back. Automated sessions start no sync of their own
        (`laika-activity-hook:45-47`).
- [x] **No doc or help tells anyone to add the shell line.** `cli/README.md`,
      `cli/src/activity.ts` (usage `:176-177`, `otel`'s stderr `:393-400`,
      `status` `:483`), Connect's *OpenTelemetry (optional)* block
      (`server/web/src/routes/screens/connect/ShareActivity.tsx:278-305`,
      "In the shell you start Claude Code from"; `otelEnvBlock`,
      `server/web/src/api/local-activity.ts:83-93`) and SPEC name
      `laika activity on` instead. `laika activity otel` may stay for someone
      who wants it, but it no longer tells anyone to edit a shell profile.
      The task file records the census command and its full output, with no
      `head`.
- [x] **The My day hint names the real step:** run `laika activity on` on
      each laptop. A web test asserts the new text, and asserts that
      "(Connect)" is gone.
- [x] **Tests that change on purpose are named in the task file.** Each is
      changed for this reason only:
      - `cli/test/activity-command.test.ts:191`: `claude.env` unchanged after
        `on` (`:216`); `off` restores the file (`:291`);
      - `:423`: `otel`'s exact variables;
      - `cli/test/activity-usage-command.test.ts:222-274`: `on` without
        telemetry sends no `excluded`;
      - `server/web/test/api/local-activity.test.ts:91-97` and
        `server/web/test/browser/developer-insights.test.ts:233-242`: the
        export lines.
- [x] **SPEC, a named edit (D-033/D-034), these passages only:**
      - §6.4's *The OpenTelemetry fallback* paragraph and its settings block
        (`docs/SPEC.md:2778-2827`);
      - §6.4's *Sessions, by one-way key* sentence on where the settings are
        read (`:2628`);
      - §11.4.2.1's Connect *OpenTelemetry (optional)* sentence
        (`:4177-4180`).
- [x] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`). It is one of
  three collector tasks kept on one machine (LAI-864, LAI-866, LAI-867).
- Files: `cli/src/activity.ts`, `cli/src/activity-hooks.ts` (or a new
  `cli/src/activity-otel.ts`), `cli/src/activity-sync.ts` (`status`'s check),
  `cli/README.md`, `cli/test/activity-*.test.ts`,
  `server/web/src/routes/screens/my-day/AgentStrip.tsx`,
  `server/web/src/routes/screens/connect/ShareActivity.tsx`,
  `server/web/src/api/local-activity.ts`, their tests, and the SPEC passages
  above. No server code. No new dependencies.
- **Out of scope; recorded, not built:**
  - **The board runs on plain http**, so the token travels unencrypted. HTTPS
    is parked by the owner (see LAI-813).
  - **An SDK-harness child running without a terminal counts as the
    person's.** The hook cannot tell it from the orchestrator
    (`laika-activity-hook:97-99`, "looks the same, and counts the same").
  - **The manager's automatic turns count as the person's agent minutes.**
    These are runtime notices nobody typed. This is an open owner question.
    It reaches further than minutes: polly is not an automated session
    (`laika-activity-hook:165-177`), and once settings.json carries the
    telemetry, its own tokens reach the board for the first time. D-091 item
    3 says *"polly's own tokens are left out for now … counting them needs
    telemetry"*. So this task makes D-091 item 3 stop being true in practice.
    Ask the owner before review whether that stands.
  - **`laika init` already writes `LAIKA_TOKEN` into settings.json `env`**
    (`cli/src/config.ts:81-86`, `cli/src/init.ts:100`). This task must not
    add to that, and must not remove it either. If it matters, it gets its
    own task.

## Deviation: claimed before PR #32 merged

The owner (Pawan) told Strelka to start now, in parallel, before Belka's PR
#32 (`chief-ops-tasks-1022`, which files this task) merges. So the claim is
made on `LAI-867-agent-minutes-every-laptop`, a branch based on #32 rather than
on `master`. This PR must merge after #32.

## Review notes from the builder (Strelka)

### What was built

- `cli/src/activity-otel.ts` (new): `installOtel`, `removeOtel`, `checkOtel`
  and `describeOtel`. The helper is `~/.laika/otel-headers`, mode 0700, and
  carries no token. Each run reads the last `LAIKA_URL` and `LAIKA_TOKEN`
  lines of `~/.laika/env`. It answers only for the board it was written for,
  so a token for another board is never sent here, and it prints
  `{"Authorization":"Bearer …"}`.
- `~/.laika/otel.json` records which keys `on` added (keys and board only, no
  values, no token). `off` therefore removes exactly what `on` added. A key
  the person already held with the same value before `on`, as on Belka after
  the manual fix, was theirs and stays after `off`. Each added key goes only
  while it still holds `on`'s value.
- `on` runs this after the hooks. The `.bak` is taken only when
  settings.json existed before this `on` began, so it is always the person's
  original and never the hooks-only file the step before just wrote.
- `status` replaces the fixed `laika activity otel` line with a check. It
  reports not set up, a key of the person's own disagrees, the helper fails
  or finds no token, the board refuses (401, or 403 `local_activity_off`),
  no answer, or reaching. The helper runs only when `otelHeadersHelper` is
  ours. The probe is one `POST /api/v1/otlp/v1/metrics` with
  `{"resourceMetrics":[]}`, which carries no metric.
- `activity-hooks.ts`: five private helpers are now exported for reuse
  (`asJson`, `isObject`, `replaceFile`, `backupOnce`, `parseConfig`). None
  changed.
- `telemetryToBoard` is unchanged apart from its comment. It still does not
  look at headers; `status`'s check does.

### Tests that changed on purpose

- `cli/test/activity-command.test.ts:216`: `claude.env` after `on` is the
  original plus `otelEnv(board)`; the `off` round trip at `:291` is unedited
  and passes. `:423`: the `otel` variables are unedited, and `status` now
  names `laika activity otel` 0 times instead of 1.
- `cli/test/activity-usage-command.test.ts:222-274`: "with telemetry" is now
  `on` alone, with no settings written by hand and no shell variable.
  "Without" is `on` followed by removing `env` and `otelHeadersHelper` from
  settings.json. This is the D-088 criterion's test: with today's `on` the
  "with" case sends no `excluded` (red until `on` writes the env; see the
  mutation below).
- `server/web/test/api/local-activity.test.ts:91-97` and
  `server/web/test/browser/developer-insights.test.ts:233-242`: the export
  lines become the settings.json fragment `on` writes, with no
  `LAIKA_TOKEN`, no `Bearer`, no `export`.
- New: `cli/test/activity-otel.test.ts` (12 tests), a stub OTLP endpoint in
  `cli/test/support/stub-board.ts` (`otlp: 'ok' | 'off'`), and in
  `server/web/test/browser/my-day.test.ts` *"no agent minutes: the hint says
  to run laika activity on on each laptop"*.

### Shown red first, and each fix broken once

- Before the wiring in `activity.ts`: `node --test test/activity-otel.test.ts`
  EXIT 1, 10 failed and 2 passed.
- Mutation 1: `installOtel` stopped writing the env values (anchor checked,
  `grep -c` 0, checksum changed). `activity-otel` plus
  `activity-usage-command` gave EXIT 1 with 8 failed. The 8 include both
  D-088 tests (*"a sync: named with telemetry to this board"*, *"`backfill
  --yes` and `status`"*). Restored; checksum `44e2d4a2…` matches.
- Mutation 2: `off` deleted a key regardless of its value. 1 failed, *"a key
  the person changed after on survives off"*. Restored, same checksum.
- My day hint: against the old text (`data-agent-hint` added only so the
  locator finds it), the new browser test gave EXIT 1. Restored.

### D-088: how long a sub-agent's telemetry counts (measured)

Measured on 2026-10-22 with the real `plugin/scripts/laika-activity-hook`,
copied beside a fake `cli/bin/laika` that records each launch, under a temp
HOME, `/bin/zsh -f`, 3 s settle per case:

| case | sync launched |
| --- | --- |
| person `turn-end`, `next_sync_at` = now + 599 | 0 |
| person `turn-end`, `next_sync_at` = now − 1 | 1 |
| person `turn-end`, `next_sync_at` = now + 1, run 2 s later | 1 |
| Omnigent sub-agent `turn-end`, due | 0 |
| Omnigent sub-agent `session-start`, due | 0, and its id appended to `skip-sessions` at once |

The server sets `next_sync_at` to the last sync plus `MIN_SYNC_INTERVAL_S`
= **600 s** (`server/src/services/local-activity.ts:71`). So a sub-agent's
telemetry counts from its first export until the first *person's* hook
event (turn end, session start or end) at or after `next_sync_at`. That is
at most **600 s** after the previous sync while the person keeps working. It
is **unbounded while the person is idle**, because no hook of theirs fires
and the sub-agent's own events start no sync. That sync's usage report
carries the key in `excluded`, and `storeExcluded` takes the rows back. The
first export comes about a minute after the session starts:
`OTEL_METRIC_EXPORT_INTERVAL` defaults to 60 s per Claude Code's monitoring
docs. That figure is quoted from the docs, not measured here.

### Census, after the change (no `head`)

```
git grep -n -E "shell profile|In the shell you start|laika activity otel|OTEL_EXPORTER_OTLP_METRICS_HEADERS" -- ':!.tasks' ':!logs' ':!docs/DECISIONS.md'
```

```
cli/README.md:78:laika activity otel               # the same telemetry as variables, for one shell by hand (LAI-773)
cli/README.md:281:metric. `laika activity otel` still prints the same settings as `export`
cli/src/activity.ts:185:  '  laika activity otel            the same telemetry as variables, for one shell by hand;',
cli/src/activity.ts:390:    'export OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer $LAIKA_TOKEN"',
cli/test/activity-command.test.ts:436:      'export OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer $LAIKA_TOKEN"',
cli/test/activity-command.test.ts:447:      h.out.filter((line) => line.includes('laika activity otel')).length,
docs/SPEC.md:2692:  rather than at its end. `laika activity otel` prints the OpenTelemetry
docs/SPEC.md:2846:`laika activity otel` still prints them as `export` lines, with
docs/SPEC.md:2847:`OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer $LAIKA_TOKEN"`, for
server/src/http/routes/otlp.ts:18: *   (`OTEL_EXPORTER_OTLP_METRICS_HEADERS`); a web session works too. Who is
server/web/src/routes/screens/connect/ConnectScreen.tsx:658:                          paste them only into your own terminal, shell profile or agent. Every
server/web/src/routes/screens/connect/connect-agents.ts:32: * - `secret` — a terminal command or a shell profile line whose whole job is to
server/web/src/routes/screens/connect/connect-agents.ts:307: * the shell profile only **sources** that file. It used to be two `export`
server/web/src/routes/screens/connect/connect-agents.ts:328:    note: 'Your shell profile only sources ~/.laika/env, so it never holds the token. Open a new terminal afterwards. An app started from the Dock or Start menu does not read your shell profile — start it from that terminal so it sees LAIKA_TOKEN.',
server/web/src/routes/screens/connect/connect-agents.ts:1112:  'The app was started from the Dock or Start menu, so it never read your shell profile. Quit it and start it from a terminal.';
server/web/test/browser/developer-insights.test.ts:233:      // LAI-867: `laika activity on` writes it; no one is sent to a shell profile.
server/web/test/browser/developer-insights.test.ts:235:      assert.doesNotMatch(await block.innerText(), /laika activity otel|In the shell/);
server/web/test/routes/screens/connect/connect-agents.test.ts:369:      assert.ok(!rc.includes(SECRET), 'the token is in the shell profile');
```

None of these tells anyone to put the telemetry in a shell profile.

- The `otel` lines are the command itself, which stays by choice, and its
  stderr now says `on` already sets this up.
- SPEC `:2692` sits outside the named passages and only says `otel` prints
  the settings, which is still true. Left alone.
- `otlp.ts:18` is server code naming the variable. No server code is changed.
- `connect-agents.ts` and `ConnectScreen.tsx` are about `LAIKA_TOKEN` for the
  MCP server, not telemetry.

### Open, for the owner (asked on the card before review)

- **D-091 item 3.** Once settings.json carries the telemetry, polly's own
  tokens reach the board, so *"polly's own tokens are left out for now"* stops
  being true in practice. This task does nothing to keep them out. Asked
  @belka and Pawan on LAIKA-678 whether that stands.

### Deviations

- Claimed on a branch based on PR #32, as recorded above.
- The branch is `LAI-867-agent-minutes-every-laptop`, not the hand-off's
  `LAI-867-agent-minutes-on-every-laptop-without-a-shell-line`. The
  orchestrator created this worktree with that name, and it still carries
  the id.
