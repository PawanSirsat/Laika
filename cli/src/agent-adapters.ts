/**
 * The harnesses `laika agent` knows, and what each one's adapter does
 * (LAI-557, proposal §5). **One table**: the session engine, the hooks, the
 * checkpoint and hand-off commands all read the harness from here, so a
 * harness is added once and every command takes it.
 *
 * An adapter is deliberately small. The engine — the session bound to a PID,
 * the watcher, checkpoints, hand-offs — is shared and harness-blind. What
 * differs is only:
 *
 * - **the slug** the session reports as its `harness` (SPEC §4.65, D-118) and
 *   the name its label shows (D-120: `<harness> · <device>`, e.g.
 *   *Gemini CLI · Belka*);
 * - **`agentHarness`**, the §4.63 `AGENT_CLIENTS` slug to register the agent
 *   under on the Agents screen — `other` where the board has no slug yet;
 * - **`comm`**, the executable name the PID walk looks for. Absent where the
 *   harness runs under a generic name (`node`, an Electron helper) or where no
 *   real process was ever seen here: the walk would have to guess, so it does
 *   not, and `laika agent session start` needs `--pid` instead;
 * - **`hooks`**: `true` only where `laika agent hooks on` writes a hook format
 *   that was read from the harness's docs **and** run by a real binary of it.
 *   Everywhere else the hook entry stays silent and the explicit commands are
 *   the path (`cli/agent-adapters/CAPABILITIES.md`). A similarly named hook in
 *   another harness is never assumed to behave like Claude Code's: Gemini CLI
 *   times hooks in milliseconds and denies with `decision`, Cursor answers in
 *   snake_case, Antigravity in camelCase with `injectSteps`.
 */

export const HARNESSES = [
  'claude-code',
  'codex',
  'cursor',
  'copilot-cli',
  'copilot-vscode',
  'copilot-cloud',
  'gemini-cli',
  'antigravity',
  'omnigent',
] as const;

export type Harness = (typeof HARNESSES)[number];

export const isHarness = (value: string | undefined): value is Harness =>
  (HARNESSES as readonly string[]).includes(value ?? '');

export interface HarnessAdapter {
  readonly harness: Harness;
  /** The harness half of the agent's label (D-120). */
  readonly name: string;
  /** The §4.63 slug to register the agent under; `other` where the board has none yet. */
  readonly agentHarness: string;
  /** What `ps -o comm=` prints for it; absent means `--pid` is required. */
  readonly comm?: RegExp;
  /** `laika agent hooks on` installs for it: a hook format verified on a real binary. */
  readonly hooks: boolean;
  /**
   * The helper keeps only its credential (LAI-1060, plan LAI-1042 §M): no
   * sessions, no hooks. `laika agent session start` refuses it, because
   * nothing here has seen its process or its hook format.
   */
  readonly credentialOnly?: true;
}

export const ADAPTERS: Readonly<Record<Harness, HarnessAdapter>> = {
  'claude-code': {
    harness: 'claude-code',
    name: 'Claude Code',
    agentHarness: 'claude-code',
    comm: /^claude$/,
    hooks: true,
  },
  codex: { harness: 'codex', name: 'Codex', agentHarness: 'codex', comm: /^codex/, hooks: true },
  cursor: { harness: 'cursor', name: 'Cursor', agentHarness: 'cursor', hooks: false },
  // The board has no Copilot slug yet (LAI-1014): the agent registers as `other`.
  'copilot-cli': {
    harness: 'copilot-cli',
    name: 'Copilot CLI',
    agentHarness: 'other',
    hooks: false,
  },
  // Copilot in VS Code connects to MCP as `Visual Studio Code` (D-076), which
  // the board already names `vscode`.
  'copilot-vscode': {
    harness: 'copilot-vscode',
    name: 'Copilot in VS Code',
    agentHarness: 'vscode',
    hooks: false,
  },
  'copilot-cloud': {
    harness: 'copilot-cloud',
    name: 'Copilot cloud agent',
    agentHarness: 'other',
    hooks: false,
  },
  'gemini-cli': {
    harness: 'gemini-cli',
    name: 'Gemini CLI',
    agentHarness: 'gemini-cli',
    hooks: false,
  },
  antigravity: {
    harness: 'antigravity',
    name: 'Antigravity',
    agentHarness: 'antigravity',
    hooks: false,
  },
  // Credential only (LAI-1060): Laika opens no session for an `omnigent`
  // process. Omnigent's sessions go through the hooks of the harness that
  // runs them (LAI-1101, measured on 0.19.1): polly's own turns run on Claude
  // Code through `claude-sdk`, which loads `~/.claude/settings.json`, and its
  // workers on Claude Code or Codex. Every one carries `OMNIGENT=1`. On a
  // device holding this agent's credential those hooks end the session at
  // each turn's Stop, and open it with this agent's credential where that
  // harness's MCP entry follows Omnigent runs too (`hookCredential` in
  // `agent.ts`, review B1).
  omnigent: {
    harness: 'omnigent',
    name: 'Omnigent',
    agentHarness: 'omnigent',
    hooks: false,
    credentialOnly: true,
  },
};

export const adapter = (harness: Harness): HarnessAdapter => ADAPTERS[harness];

/** The harnesses `laika agent hooks on` installs for when none is named. */
export const HOOK_HARNESSES: readonly Harness[] = HARNESSES.filter((h) => ADAPTERS[h].hooks);

/**
 * The explicit path for a harness with no verified hooks: what to run, and
 * when, from the agent's own shell tool or the person's terminal. Printed by
 * `laika agent hooks on --harness <it>` in place of installing anything.
 */
export function explicitCommands(harness: Harness): string[] {
  const h = harness;
  if (h === 'omnigent') {
    return [
      'Omnigent has no hooks of its own, so nothing was installed for it.',
      'Its sessions open through the hooks of the harness that runs them — polly runs on',
      'Claude Code (claude-sdk) — so install those: laika agent hooks on --harness claude-code',
      '(and codex, if its workers run Codex). Inside Omnigent they act as this agent, with',
      `~/.laika/agents/${h}.json, where their Laika MCP entry is the switching helper`,
      '`laika tool add` writes; otherwise as their own. polly’s MCP is the bridge',
      '`laika tool add omnigent` installs.',
    ];
  }
  if (ADAPTERS[h].credentialOnly === true) {
    return [
      `${ADAPTERS[h].name} is credential only here: no hooks and no sessions, so nothing was installed.`,
      `Its token is in ~/.laika/agents/${h}.json (0600); point its MCP config at the board by hand.`,
    ];
  }
  return [
    `${ADAPTERS[h].name} has no hook adapter Laika has verified, so nothing was installed.`,
    'Run the shared helper yourself (cli/agent-adapters/CAPABILITIES.md):',
    `  laika agent login ${h} --url <board> < agent-token        # once`,
    `  laika agent session start --harness ${h} --harness-session <id> --pid <harness pid>`,
    `  laika agent inbox --harness ${h}                           # at a prompt or tool boundary`,
    `  laika agent checkpoint save --harness ${h} --note-file note.json`,
    `  laika agent session end --harness ${h} --harness-session <id>`,
    'The watcher renews the session while that PID lives; nothing is delivered',
    'mid-turn — the agent sees new work only when one of these commands runs.',
  ];
}
