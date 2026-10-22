---
id: LAI-867
title: 'Agent minutes reach the board from every Claude Code on the laptop: `laika activity on` sets telemetry in settings.json, with no shell-profile line and no token written'
area: cli
assignee: strelka
priority: p1
depends-on: []
discovered-from:
status: backlog
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

- [ ] **`laika activity on` writes exactly the reference.**
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
- [ ] **`laika activity off` removes exactly what `on` added.** It removes
      each `env` key only while it still holds `on`'s value,
      `otelHeadersHelper` only while it points at the script, and the script.
      Tests: `on` then `off` restores the original file byte for byte. A key
      the person changed after `on` survives `off`.
- [ ] **`laika activity status` says whether telemetry reaches the board.**
      It no longer prints the fixed `laika activity otel` line. It tells
      apart, at least, these states:
      - not set up;
      - set up, but a key of the person's own disagrees, or the helper fails
        or finds no token;
      - set up, but the board refuses (`401`, or `403 local_activity_off`);
      - reaching the board.

      Any probe it sends carries no metric. There is a test for each state
      against the stub board.
- [ ] **D-088's exclusion of automated sessions still holds.**
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
- [ ] **No doc or help tells anyone to add the shell line.** `cli/README.md`,
      `cli/src/activity.ts` (usage `:176-177`, `otel`'s stderr `:393-400`,
      `status` `:483`), Connect's *OpenTelemetry (optional)* block
      (`server/web/src/routes/screens/connect/ShareActivity.tsx:278-305`,
      "In the shell you start Claude Code from"; `otelEnvBlock`,
      `server/web/src/api/local-activity.ts:83-93`) and SPEC name
      `laika activity on` instead. `laika activity otel` may stay for someone
      who wants it, but it no longer tells anyone to edit a shell profile.
      The task file records the census command and its full output, with no
      `head`.
- [ ] **The My day hint names the real step:** run `laika activity on` on
      each laptop. A web test asserts the new text, and asserts that
      "(Connect)" is gone.
- [ ] **Tests that change on purpose are named in the task file.** Each is
      changed for this reason only:
      - `cli/test/activity-command.test.ts:191`: `claude.env` unchanged after
        `on` (`:216`); `off` restores the file (`:291`);
      - `:423`: `otel`'s exact variables;
      - `cli/test/activity-usage-command.test.ts:222-274`: `on` without
        telemetry sends no `excluded`;
      - `server/web/test/api/local-activity.test.ts:91-97` and
        `server/web/test/browser/developer-insights.test.ts:233-242`: the
        export lines.
- [ ] **SPEC, a named edit (D-033/D-034), these passages only:**
      - §6.4's *The OpenTelemetry fallback* paragraph and its settings block
        (`docs/SPEC.md:2778-2827`);
      - §6.4's *Sessions, by one-way key* sentence on where the settings are
        read (`:2628`);
      - §11.4.2.1's Connect *OpenTelemetry (optional)* sentence
        (`:4177-4180`).
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

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

## Review notes (PR #32, round 1; CHIEF, 2026-10-22)

These notes were appended after the task was claimed, so the criteria above
were not edited (§2). **Where a note and the text above disagree, the note
wins.**

**The D-091 item 3 question is answered before building, not before
review.** In Notes, the line *"Ask the owner before review whether that
stands."* now reads:

> Ask the owner on the card **before building**, and record their answer
> here. Nothing is built until they answer.

The question: once settings.json carries the telemetry, the manager's own
tokens and agent minutes reach the board as the person's, though D-091 item
3 says they are *"left out for now"*.

**The token check counts, rather than looks for absence.** In the first
criterion's tests, the line *"a fake token from `~/.laika/env` appears in
neither file"* now reads:

> `laika activity on` adds no occurrence of the token: settings.json and the
> helper script hold the same number of occurrences of the fake token after
> `on` as before it.

The reason is that `laika init` may already have written `LAIKA_TOKEN` into
settings.json's `env` (`cli/src/config.ts:84`), so absence cannot be the
test. Run the check once with such an `env` already in place.
