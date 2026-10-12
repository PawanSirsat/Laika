# Agent marks — provenance and licence

The agent picker on Connect, and presence everywhere (Capacity, the Agents
chip), draw each coding agent with **its real brand mark** (`AgentMark.tsx`,
data in `agent-logos.ts`). This reverses LAI-737, which shipped two-letter
monograms only; the owner asked for the original marks directly (LAI-740).

## How they got here

Each SVG was downloaded once with `curl` on 2026-10-12, in this order of
preference: **LobeHub Icons** (MIT), then **Simple Icons** (CC0), then the
vendor's own brand kit or repository. The path data was copied exactly into
`agent-logos.ts`; nothing is fetched at run time, there is no npm dependency,
and no request leaves this origin (SPEC §13.4).

Cleaning was limited to what a 34px tile cannot show: Visual Studio Code's two
drop-shadow filters and its 25% blend overlay, and Continue's full-frame clip
path. Gradient and mask ids are renamed per instance at render.

The MIT and CC0 licences cover the **drawings**. The marks themselves remain
their owners' trademarks; LAI-737's research (below) records what each owner
says about using them.

| Slug | Mark | Source | Licence / terms |
| ---- | ---- | ------ | --------------- |
| `claude-code` | Claude Code (Anthropic) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/claudecode-color.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `codex` | Codex (OpenAI) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/codex-color.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `cursor` | Cursor | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/cursor.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `antigravity` | Google Antigravity | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/antigravity.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `opencode` | OpenCode | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/opencode.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `gemini-cli` | Gemini CLI (Google) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/geminicli-color.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `vscode` | Visual Studio Code (Microsoft) | https://code.visualstudio.com/assets/branding/visual-studio-code-icons.zip (visual-studio-code-icons/vscode.svg) | Microsoft brand kit — "Visual Studio Code, VS Code, and the Visual Studio Code icon are trademarks of Microsoft Corporation. All rights reserved."; use per code.visualstudio.com/brand. Drop-shadow filters and the 25% blend overlay removed. |
| `windsurf` | Windsurf | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/windsurf.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `omnigent` | Omnigent | https://omnigent.ai/images/favicon.svg | Vendor site favicon (omnigent.ai); no licence stated — the mark is Omnigent's |
| `hermes` | Hermes Agent (Nous Research) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/hermesagent.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `zed` | Zed Industries | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/zedindustries.svg | CC0-1.0 — Simple Icons 16.35.0 (simpleicons.org); the mark is its owner's trademark |
| `cline` | Cline | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/cline.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `roo` | Roo Code | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/roocode.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `continue` | Continue | https://raw.githubusercontent.com/continuedev/continue/main/extensions/intellij/src/main/resources/META-INF/pluginIcon.svg | Vendor repository asset (continuedev/continue, Apache-2.0); the mark is Continue's trademark. Full-frame clipPath removed (no visual effect). |
| `kiro` | Kiro (AWS) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/kiro-color.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `goose` | Goose (Block) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/goose.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `amp` | Amp (Sourcegraph) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/amp-color.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `junie` | Junie (JetBrains) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/junie-color.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `warp` | Warp | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/warp.svg | CC0-1.0 — Simple Icons 16.35.0 (simpleicons.org); the mark is its owner's trademark |
| `claude-desktop` | Claude (Anthropic) | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/claude-color.svg | MIT — LobeHub Icons (github.com/lobehub/lobe-icons, commit bcdb7c8); the mark is its owner's trademark |
| `other` | none — _another agent_ is not a brand | — | keeps its monogram |

## Trademark terms, as LAI-737 recorded them

LAI-737 chose monograms because of these terms (`agent-client-configs/REPORT.md`,
§ "Logos for the agent picker", 2026-10-12). They have not changed; the owner
decided to ship the marks with them on record.

| Brand                                      | Owner's terms                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Claude / Claude Code / Anthropic           | use only _"as specifically permitted by us"_ (anthropic.com/legal/trademark-guidelines) |
| OpenAI / Codex                             | removed from simple-icons at OpenAI's request                                           |
| Gemini / Antigravity (Google)              | _"request permission through our approval form"_                                        |
| VS Code (Microsoft)                        | not OK _"to associate your offerings with Microsoft"_                                   |
| GitHub Copilot, Cursor, Windsurf, Continue | permission or contact required                                                          |
| Zed, Cline, OpenCode, Hermes               | permissive or unstated                                                                  |

To remove a mark, delete its entry from `agent-logos.ts` and its row above:
`AgentMark` falls back to the monogram, and `agent-logos.test.ts` names the
slug that fell back.
