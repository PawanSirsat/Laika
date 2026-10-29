---
id: LAI-312
title: 'An imported repo task opens as Markdown, "The rich editor could not read it" (LAI-624 / LAIKA-439)'
area: shell
assignee: strelka
priority: p1
depends-on: []
discovered-from: owner report 2026-10-21
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-21T17:54:43Z
finished: 2026-10-21T18:10:33Z
---

## Goal

The owner opened card LAIKA-439 (`LAI-624 · The docs describe a CLI
invocation and a setup path that do not exist`) and the editor said *"Opened
as Markdown, so nothing you do not touch changes. The rich editor could not
read it."* Every card imported from `.tasks/` carries the same constructs, so
every one of them opens the same way.

The body is ordinary markdown. The rich editor should open it, and an
untouched save must still be the source byte for byte (LAI-827). That
guarantee is not weakened to get there.

## What was measured (2026-10-21, on `66cec001`, built on Strelka)

The real `description_md` was fed to `openDocument` in
`server/web/src/routes/screens/task/editor/markdown-bridge.ts`. Four separate
constructs refuse it:

| # | Construct in the body | What happens |
| --- | --- | --- |
| A | inline code inside italic, bold or a link: `` _from the `.tasks/` folder._ ``, `` [`path`](url) ``, `` *"written by `/laika:setup`"* `` | `parseMarkdown` returns `null`: TipTap's `code` mark excludes every other mark, so the parsed JSON is invalid for the schema (`Invalid collection of marks for node text: code,italic`). **This is the notice the owner saw.** |
| B | `### 1. \`npx laika init\` cannot work` | the faithful escaper treats `1.` as an ordered-list marker inside a heading and writes `### 1\.` |
| C | a bullet wrapped onto a 2-space continuation line | the editor drops the indent. **PR #13 (LAI-853) fixes this.** |
| D | a task-list item wrapped onto a 6-space line | TipTap reads the second line as a code block. **Filed as LAI-302** on LAI-853's branch. |

Underneath A is a second refusal: once the code mark may combine, `_…_` is
rewritten `*…*`, because the italic mark does not remember its delimiter.
Every imported card opens with `_Imported … from the repo's `.tasks/` folder._`.

A, B and the `_` delimiter are this task. C and D are not, and are owned
where named above.

## Acceptance criteria

- [x] A failing test, using the real body as a fixture, is committed before
      the fix.
- [x] Inline code inside italic, bold, strikethrough and a link opens in the
      rich editor and round-trips byte-exact.
- [x] `_italic_` round-trips as `_italic_`, and `*italic*` as `*italic*`; an
      italic made in the editor is still written `*…*`.
- [x] A heading whose text starts `1.`, `-`, `>` or `+` round-trips without an
      escape, and a heading of only `#` is still escaped.
- [x] The real body with its wrapped list items unwrapped (C and D) opens
      rich and writes back byte-exact; the real body as it is now gets a
      notice naming a line, not *"could not read it"*.
- [x] The fix is broken once, and a named test goes red.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- No new dependency: the `code` and `italic` marks are reached through
  `StarterKit.extend` and `this.parent()`, not `@tiptap/extension-code`.
- PRs #13 and #20 touch the same file; the PR records a trial merge with both.

## Result

The body now gets past parsing. On this branch alone it is refused at line 25,
a bullet wrapped onto an indented line (C, LAI-853). With LAI-853 merged as
well, the body with its task items unwrapped **opens rich, and an untouched
save is byte-exact** (`toMarkdown(…, opening) === source`, measured on a
trial merge). The body as stored then waits only on LAI-302 (D).

- `server/web/src/routes/screens/task/editor/extensions.ts` builds the kit
  with `StarterKit.extend` + `this.parent()`: `code` gets `excludes: ''`, and
  `italic` gets a `delimiter` attribute (`rendered: false`), its parser
  reads it from `token.raw`, and its writer writes `_` only in the faithful
  form.
- `server/web/src/routes/screens/task/editor/markdown-bridge.ts`:
  `canonical` drops `delimiter` from marks when comparing (`unspelled`), so
  an edited block that cannot keep `_` falls back to `*` rather than
  becoming unwritable. `Around.inHeading`: in a heading's words, only a
  leading `#` run is escaped.

**The gate criterion is left unticked.** `pnpm test` exited 1 on one test
outside this change (LAI-304); see Evidence.

## Evidence

- Red: `node --test test/routes/screens/task/editor/markdown-bridge.test.ts`
  (in `server/web`) on `b134fd25` (tests only) → exit 1, 113 tests, 16 fail,
  all of them new LAI-312 tests. On `0c1047bf` → exit 0, 113/113. With
  `extensions.test.ts`: 117/117. `pnpm run typecheck` exit 0.
- Three existing examples of a refused rewrite moved from `_x_` to `__x__`,
  which is still refused (`:128`, `:423`, `:467` on the base). They used
  `_x_` because it was refused, and it no longer is.
- Mutations, each anchored and checked to have changed the file, then
  restored:
  | Mutation | Red |
  | --- | --- |
  | `code` keeps `excludes: '_'` | 9: both body tests and every code-in-a-mark case |
  | `inHeading: false` | 6: both body tests and the four heading cases |
  | `inHeading` never escapes | 1: `## \#` |
  | `unspelled` keeps the delimiter | 1: the edited underscore italic |
  | `_` written in the library form too | 1: the edited underscore italic |
- Root gate, under `/tmp/laika-root-gate.lock`, after the last code edit
  (`0c1047bf`): `TEST 1`, `LINT 0`, `FMT 0`. server/web 2708/2708, cli
  533 pass / 0 fail. The one failure is
  `server/test/services/sprints.test.ts › is exact past the page size`,
  `Test timed out in 5000ms`, which is LAI-304. Run alone it failed twice
  more (5726 ms, 7315 ms) at load averages of 40 and 52, with 21 other test
  processes running. With `--testTimeout=60000` it passed 43/43, exit 0.
  This branch touches nothing under `server/src` or `server/test`.
- Trial merges, aborted:
  - PR #20 (LAI-854): clean, editor tests 123/123, `tsc` 0.
  - PR #13 (LAI-853): conflicts in the test file only, because both append
    at the end. Resolve by keeping ours and then theirs. There is also **one
    semantic conflict**: #13's *"a rewrite on the wrapped line still opens
    as Markdown"* uses `_here_` as its rewrite, which now round-trips. Change
    it to `__here__`. With that, 131/131 and `tsc` 0.
- Filed LAI-313: with LAI-853 merged, the notice for this body names a
  forgiven bullet line, not the task item that actually refuses it.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #24.
