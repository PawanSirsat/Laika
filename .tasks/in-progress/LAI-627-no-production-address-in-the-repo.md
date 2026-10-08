---
id: LAI-627
title: No production address in the repo, and three READMEs that describe a product from months ago
area: cli
assignee: shell
priority: p1
started: 2026-10-05T11:05:00Z
depends-on: []
status: in-progress
---

## What is wrong

**The repository is public.** `gh repo view` reports `"visibility":"PUBLIC"`,
`"isPrivate":false`. Everything committed is readable by anyone, today.

1. **`plugin/scripts/install.sh` hard-codes the production board**:
   `DEFAULT_URL="${LAIKA_URL:-http://52.72.203.206}"`. A self-hosted product
   should not ship one deployment's address as the default for every other
   deployment, and a public repo should not advertise a live box.
2. **Two `server/web/` files name it in comments** — `CopyButton.tsx` and
   `test/components/copy-button.test.ts`, both documenting the insecure-context
   measurement. The measurement is worth keeping; the address is not what makes
   it true.
3. **`plugin/README.md` describes a skeleton.** It says *"Status: skeleton
   (LAI-012). The manifest, the MCP declaration, and one working command are
   here. The MCP tools themselves land in M3 and the hooks, skills, and
   remaining commands in M4."* There are **18 MCP tools**, the hooks exist and
   the commands exist. It also links to `#what-is-not-built-yet`, **a section
   that does not exist** — the anchor is dead.
4. **`docker/README.md` says the UI does not exist**: *"the SPA is not built
   yet (LAI-017)"*. It is built, and deployed.

## What is NOT in this task, and must not be done inside it

- **No LICENSE file, and no change to `package.json`'s `license` field.** Both
  are repo-root, CHIEF's by LAI-001, and the decision behind them is the
  owner's, not a builder's. Filed separately as **LAI-628**, which explains why
  the obvious advice is dangerous here.
- No change to `docker/aws/laika-ec2.yaml`'s account id — filed in LAI-628.

## Deployment does not depend on any of this

Worth stating because it is the question that prompted the task. **Removing the
address from `install.sh` cannot affect deployment**, because `install.sh` has
no part in it:

| | what it is | where the address comes from |
| --- | --- | --- |
| **Deploy** | image → ECR → SSM → `docker run` on the instance | `LAIKA_PUBLIC_URL`, written by the CloudFormation UserData from the instance's own `public-ipv4` metadata at boot |
| **`install.sh`** | a script a teammate runs on **their laptop** | typed at the prompt, or `LAIKA_URL`, or fed on stdin by the Connect page |

And onboarding keeps working, because `ConnectScreen` takes `origin` as a prop
and `setupPrompt()` bakes it into the heredoc. **The URL a teammate installs
with comes from the page they are already looking at**, which is the correct
source for a self-hosted product and the reason a baked-in default was never
load-bearing.

## Acceptance criteria

- [ ] `install.sh`'s default is `http://localhost:3000`, with `LAIKA_URL` still
      honoured and the prompt still showing the default.
- [ ] A test asserts **no production address is reachable from a clean clone** —
      a grep over `cli/`, `plugin/`, `docker/` and `server/web/src/` for a
      bare-IP `http://` origin, which fails if one comes back. A census, so no
      `head` (CLAUDE.md §5).
- [ ] The two `server/web/` comments keep the measurement and drop the address.
- [ ] `plugin/README.md` describes what exists: the tool count is asserted from
      the registry by an existing guard, not written as a number in prose
      (CLAUDE.md §3 — every number written into prose here has rotted).
- [ ] The dead `#what-is-not-built-yet` anchor is gone or points at a real
      section.
- [ ] `docker/README.md` no longer says the SPA is unbuilt.
- [ ] `cli/README.md` checked for the same class of staleness.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Notes / context

- Owner-directed, 2026-10-05, from a reviewer's list. The reviewer also advised
  adding MIT; see LAI-628 for why that one must not be actioned blind.
- **A secret sweep was run first and is clean**: no `AKIA*`, no private keys,
  no tracked `.env`. The three `lai_*` strings in the tree are obvious test
  fixtures (`lai_Sandbo…`, `lai_ThisIs…`), and the two commits that history
  flags are the ones that introduced them. Nothing live has been committed.
