# Agent marks — provenance and licence

The agent picker on Connect, and presence everywhere, draw each coding agent as
**two letters on a tinted tile** (`AgentMark.tsx`). No vendor logo, icon or
other third-party artwork is shipped in this directory or anywhere in
`server/web/` for this purpose (LAI-737).

Why monograms, from the research in LAI-737 (`agent-client-configs/REPORT.md`,
§ "Logos for the agent picker", 2026-10-12):

| Brand                                      | Owner's terms                                                                           | Verdict    |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | ---------- |
| Claude / Claude Code / Anthropic           | use only _"as specifically permitted by us"_ (anthropic.com/legal/trademark-guidelines) | don't ship |
| OpenAI / Codex                             | removed from simple-icons at OpenAI's request                                           | don't ship |
| Gemini / Antigravity (Google)              | _"request permission through our approval form"_                                        | don't ship |
| VS Code (Microsoft)                        | not OK _"to associate your offerings with Microsoft"_                                   | don't ship |
| GitHub Copilot, Cursor, Windsurf, Continue | permission or contact required                                                          | ask first  |
| Zed, Cline, OpenCode, Hermes               | permissive or unstated                                                                  | low risk   |

The monograms also keep the three rules the rest of the UI keeps: no new
dependency, no request to another origin (SPEC §13.4), and no new colour — the
tints are the theme's chip families (D-020).

If real logos are wanted later, vendor them one file at a time into this
directory with a provenance and licence line each here, starting with the low
risk ones, and get written permission before shipping any marked _don't ship_
or _ask first_.
