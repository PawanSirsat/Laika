---
id: LAI-628
title: The repository is public, the licence says nobody may use it, and the owner believes it is private
area: docs
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-627
status: backlog
---

## The fact that has to be established first

**`PawanSirsat/Laika` is a public repository.**

```
$ gh repo view PawanSirsat/Laika --json visibility,isPrivate,licenseInfo
{"isPrivate":false,"licenseInfo":null,"visibility":"PUBLIC"}
```

The owner directed LAI-627 with the words *"this repo is not open source we
dont expose somthgin that is secret"*. **Both halves of that are worth
separating**, because they are not the same claim and only one of them is true:

- *"not open source"* — **true, and deliberate.** `package.json` says
  `UNLICENSED` and there is no `LICENSE` file. Under copyright, that is *all
  rights reserved*: nobody may legally copy, use or deploy it.
- *"we don't expose something secret"* — **the repository is readable by
  anyone, today.** Not open source does not mean not public. A public repo
  with no licence is **source-available**: everyone can read every line, and
  nobody may use it.

**Nothing has leaked.** A sweep was run before this was filed and is clean: no
`AKIA*`, no private keys, no tracked `.env`, and the three `lai_*` strings in
the tree are obvious test fixtures (`lai_Sandbo…`, `lai_ThisIs…`) whose two
commits are the ones that introduced them. **No credential needs rotating.**
What was exposed was a production address, removed in LAI-627.

## The decision, which is the owner's and nobody else's

A reviewer advised *"Add MIT (this is critical) and change package.json to
`license: MIT`"*, on the reasoning that `UNLICENSED` means nobody can use it
and serious developers will not touch it.

**That reasoning is correct and its conclusion may be exactly backwards here.**
It assumes the goal is adoption. The owner has said the opposite. MIT is an
**irrevocable grant to everyone, for ever** — you cannot un-license code that
has been published under it. Applying MIT to a repository because a checklist
said so, when the stated intent is "not open source", would be the actual
exposure event, and it is not reversible the way deleting a file is.

So it must not be actioned blind. The two coherent positions:

| | Open it | Close it |
| --- | --- | --- |
| **Repo** | stays public | **make it private** |
| **Licence** | MIT, or Apache-2.0 for its patent grant | keep `UNLICENSED`, no `LICENSE` file |
| **The reviewer's other advice** | applies — the GIF, the README polish, all of it is adoption work | does not apply |
| **What it costs** | anyone may fork, host and sell it | no contributors, no stars, no inbound |

**`UNLICENSED` + public is the one combination that gets neither benefit**: it
is readable by competitors and usable by nobody, which is where the repository
sits right now.

**Making it private later does not retract what is already public** — forks,
clones and caches persist. That is an argument for deciding soon, not for
panicking: nothing secret is in there.

## Acceptance criteria

- [ ] The owner is asked the question above and answers it. **This task is not
      done by a builder choosing.**
- [ ] If open: a `LICENSE` file is added, `package.json`'s `license` field
      matches it exactly, and the choice between MIT and Apache-2.0 is recorded
      as a decision in `DECISIONS.md` with its reason.
- [ ] If closed: the repository is set private, and `UNLICENSED` stays with a
      one-line comment in `package.json` saying it is deliberate — so the next
      reviewer does not re-raise it as an oversight.
- [ ] `docker/aws/laika-ec2.yaml` carries the AWS account id `926583575159` in
      its default `ImageUri`. Low severity — an account id is not a credential
      and grants nothing on its own — but it is a free detail about the
      deployment. Parameterise it, or decide explicitly that it stays.
- [ ] Whichever way it goes, `docs/ROADMAP.md` and `docs/FEATURES.md` stop
      describing the CLI as `npx laika init` (LAI-624 covers this and should
      land in the same pass).

## Notes / context

- Filed by SHELL from LAI-627. Repo-root config (`LICENSE`, `package.json`) is
  CHIEF's by LAI-001, and the licensing decision is the owner's regardless of
  who holds the file.
- **The reviewer's adoption advice is good advice for an open-source project.**
  Nothing here says it is wrong — only that it answers a question the owner has
  not yet been asked.
