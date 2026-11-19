---
name: laika-show-your-work
description: Use when finishing, commenting on or reporting a blocker on a task tracked on a Laika board, and whenever your work produced something a person should see — a UI change, a generated spreadsheet or document, a report, an incident. Says when to attach outputs, how (laika attach, finish_task outputs), how to caption them, how to mask secrets, and how to split a feature into a parent task and child tasks.
---

# Show your work

The repo block's rule, word for word:

> **Show the result.** When a person needs to see what you did — a UI
> change, a generated file — attach screenshots or outputs with
> `laika attach` or `request_upload`, each with a caption, and pass them to
> `finish_task` as `outputs`. Skip it when tests are the whole proof. Never
> upload a secret: attach a masked copy, and say where the real file is kept.

A reviewer should see the result before reading the code. Nothing is attached
for you: you choose what to show, and you show it on purpose.

## When to attach, and when not

**Attach** when a person needs to see the result:

- **A UI change**: screenshots, always.
- **A generated file**: the spreadsheet, CSV, PDF or document itself.
- **A run or test report** a reviewer would otherwise ask for.
- **An incident or a blocker**: the error screenshot, the failing log.

**Skip it** when the tests are the whole proof — pure backend work, a
refactor, a fix whose test shows it. Then the test commands and their exit
codes in `finish_task` are the evidence, and an attachment adds nothing.

## How

One command uploads the files and links them on the task in one comment:

```
laika attach LAI-42 before.png after.png --caption "Before, light, laptop" \
  --caption "After, light, laptop" --comment "The new empty state."
```

It checks every file for secrets first, uploads each one, and either links
all of them or none. It exits 0 only when every file is on the task. To put
them on a finish instead, upload with `request_upload` and `complete_upload`
and pass them as `outputs` on `finish_task` — the same files, captioned, shown
on that review round.

For a finding outside any task, `laika attach --unlisted <repo> --project
<slug> <file…> --comment "what you noticed"` logs **a new** unlisted finding
holding the files — it cannot add files to a finding already logged. Or pass
`attachments` to `log_unlisted_work` when you log it. An error screenshot on a blocker goes in
`attachments` on `add_comment`; a mockup for a new task in `attachments` on
`create_task`.

## Screenshots

- **Before and after** for anything that changed how a screen looks.
- **Light and dark** — both themes, every time.
- **Laptop and phone** — a wide window and a phone-width one (about 390 px).
- Crop to what changed, but keep enough around it to show where it is.
- No real customer data, tokens or personal details on screen. Use demo or
  test data, or blur it before you attach.

## Captions

Every file gets a caption that says what it shows — the screen, the state,
the theme, the width:

- `After — empty board, dark, phone`
- `Export of the 12 accounts created — passwords masked`
- `Test report: 1,204 passed, 0 failed`

Not `screenshot.png`. A caption is one line, at most 200 characters.

## Spreadsheets and documents

Attach **a masked copy** of the file, plus **a PDF or screenshot rendition**
so a reviewer can see it without opening a spreadsheet program. Say in the
comment where the real file lives (a shared drive, the vault, the server path)
— the board never holds the real one if it has secrets in it.

## Recordings

A short screen recording (mp4 or webm, under a minute) shows a flow better
than six screenshots: a drag and drop, an animation, a multi-step form. Keep it
short and under the board's size limit; `laika doctor` says what that is.

## Blockers and incidents

When you are stuck or something broke, `add_comment` on the task with the
evidence attached: the error on screen, the failing log, the report. Say what
you tried. A person can unblock you faster from a screenshot than from a
paraphrase.

## Secrets are never attached

There is no override. `laika attach` refuses a file that holds a recognisable
secret before anything is sent, and the board refuses it again when the upload
completes. Both catch known shapes only — **masking is your job**:

| Instead of | Attach |
| --- | --- |
| `password,Welcome-2026!` | `password,********` |
| `DATABASE_URL=postgres://app:s3cret@db/app` | `DATABASE_URL=postgres://app:****@db/app` |
| `GITHUB_TOKEN=ghp_…` | `GITHUB_TOKEN=<redacted>` |
| a credentials sheet | the list of accounts made, without their passwords |
| a `.env` file | the variable names, with `${VAR}` for every value |

Never attach a private key, a `.pem`, an `id_rsa` or a keystore. Say where the
real credentials are kept instead.

## One parent per feature

The repo block's rule, word for word:

> **One parent per feature.** A new feature with several parts gets one
> parent task, with each part as a child task (`create_task` with
> `parent`). Work on an existing feature becomes a new child of its parent.
> A genuinely small one-off may stand alone. The main outputs go on the
> parent, a child's own outputs on the child.

So the parent shows how the feature looks as a whole — the screenshots a
person would demo — and each child carries the evidence for its own part.
