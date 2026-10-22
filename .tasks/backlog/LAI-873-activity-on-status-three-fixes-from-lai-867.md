---
id: LAI-873
title: '`laika activity on` / `status`: three fixes from LAI-867''s review'
area: cli
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-867
status: backlog
---

## Goal

`laika activity on` and `laika activity status` tell the truth about Claude
Code telemetry when the person already has a header helper of their own, and
when Laika's own helper cannot produce a token. A person's own helper is never
overwritten, and `off` gives their file back as it was.

## What is there today (read at `9250fc3e`)

- `checkOtel` adds `otelHeadersHelper` to the disagreeing keys whenever it is
  not Laika's command (`cli/src/activity-otel.ts:330`). `describeOtel` then
  prints *"set up, but your own settings disagree: … — not sent to <board>"*
  (`:365`). With the six telemetry `env` keys right and only the helper
  different, that is a guess: the person's helper may well send.
- `installOtel` keeps a different helper (`:183-186`), so settings.json does
  not change. It still writes `~/.laika/otel-headers` when that file is
  missing or stale (`:197-200`), and reports `installed` with *"telemetry set
  up in …"* (`:210-215`). Nothing runs the helper it wrote.
- `printOtel` prints `✓` for every status but `refused`
  (`cli/src/activity.ts:419`). On a machine set up by `laika init` alone, `on`
  installs Laika's helper and prints `✓` without ever running it.
- The review found that a mutation in which `on` overwrites a different
  helper passes all 44 tests it ran.

## Acceptance criteria

- [ ] **`status`, a helper of the person's own.** With this board's six
      telemetry `env` keys and a different `otelHeadersHelper`, `status` does
      not say "not sent". It says *"not checked: Laika runs only its own
      helper"*, or uses a separate state that says the same. A test, red
      first.
- [ ] **`on`, a helper of the person's own.** When settings.json is unchanged
      because the helper is the person's, `on` does not print *"telemetry set
      up"* and does not write an unused `~/.laika/otel-headers`. A test, red
      first.
- [ ] **`on`, a machine set up by `laika init` only.** After installing
      Laika's own helper, `on` runs it once. If it fails, `on` prints `!` and
      *"run `laika connect`"*, never `✓`. A test with a failing helper, red
      first, beside one where the helper works and `✓` stays.
- [ ] **Test: a person's own helper survives.** A settings.json with the six
      telemetry `env` keys plus
      `otelHeadersHelper: '<home>/.laika/otel-headers.sh'`:
      - `on` leaves it;
      - a second `on` leaves it byte-identical;
      - `off` restores it byte-identical to the original.
- [ ] **Mutation.** Make `on` overwrite a different helper. The test above
      goes red with an assertion error. Prove the mutation landed (a unique
      anchor and a `grep`), restore the file in a trap, and record the run
      here.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **Files:** `cli/src/activity-otel.ts`, `cli/src/activity.ts`,
  `cli/test/activity-otel.test.ts`, `cli/test/activity-command.test.ts`.
- **Running the helper** happens only for Laika's own command, as `checkOtel`
  does today (`:311-317`): a command of someone else's is never run.
- **Optional, not a criterion.** Connect and the SPEC show
  `"otelHeadersHelper": "~/.laika/otel-headers"`
  (`server/web/src/api/local-activity.ts:95`, `docs/SPEC.md:2848`), while
  `on` writes an absolute, shell-quoted path (`activity-otel.ts:55`). If you
  align them, these two lines only; the SPEC line is a named edit
  (D-033/D-034).
