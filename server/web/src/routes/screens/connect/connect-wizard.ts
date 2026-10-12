import {
  AGENT_GUIDES,
  type AgentChoice,
  type AgentGuide,
  type SetupBlock,
} from './connect-agents.ts';

/**
 * Connect, laid out as a four-step wizard (LAI-740, on the owner's direct
 * instruction).
 *
 * The page's content — the agent list, every setup block, minting, the live
 * check — is unchanged; this module holds only what the wizard *adds*: which
 * heading each agent sits under, which steps are open, what the footer says,
 * and where the real token sits inside a block so the page can highlight it.
 *
 * Pure: no React, no DOM, so `connect-wizard.test.ts` asserts it directly.
 */

export type WizardStep = 1 | 2 | 3 | 4;

export const WIZARD_STEPS: readonly WizardStep[] = [1, 2, 3, 4];

export type AgentGroupId = 'terminal' | 'editor' | 'desktop' | 'other';

export interface AgentGroup {
  readonly id: AgentGroupId;
  readonly title: string;
  readonly members: readonly AgentChoice[];
}

/**
 * The picker's headings. Every guide sits under exactly one —
 * `connect-wizard.test.ts` asserts it from both sides, so a guide added to
 * `AGENT_GUIDES` without a heading here fails rather than vanishing from the
 * page. Claude Code and Codex lead, in that order, as they did in LAI-737's
 * picker: the arrow keys walk the tiles in this order.
 */
export const AGENT_GROUPS: readonly AgentGroup[] = [
  {
    id: 'terminal',
    title: 'Terminal agents',
    members: [
      'claude-code',
      'codex',
      'gemini-cli',
      'opencode',
      'amp',
      'warp',
      'hermes',
      'omnigent',
    ],
  },
  {
    id: 'editor',
    title: 'Editors & IDEs',
    members: [
      'cursor',
      'vscode',
      'windsurf',
      'antigravity',
      'zed',
      'cline',
      'continue',
      'kiro',
      'junie',
    ],
  },
  { id: 'desktop', title: 'Desktop apps', members: ['claude-desktop', 'goose'] },
  { id: 'other', title: 'Anything else', members: ['any', 'rest'] },
];

export interface ShownGroup {
  readonly id: AgentGroupId;
  readonly title: string;
  readonly guides: readonly AgentGuide[];
}

/** Whether a search matches a guide: its name or its slug, any case. */
export function matchesAgent(guide: AgentGuide, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return guide.name.toLowerCase().includes(q) || guide.id.toLowerCase().includes(q);
}

/** The groups a search leaves, in order, with empty ones dropped. */
export function groupedAgents(query: string): readonly ShownGroup[] {
  return AGENT_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    guides: group.members
      .map((id) => AGENT_GUIDES.find((g) => g.id === id))
      .filter((g): g is AgentGuide => g !== undefined && matchesAgent(g, query)),
  })).filter((group) => group.guides.length > 0);
}

/**
 * Steps 3 and 4 need a token: until one is minted here — or the reader says
 * they brought one from Tokens — they are locked. Steps 1 and 2 never are.
 */
export function stepOpen(step: WizardStep, ready: boolean): boolean {
  return step <= 2 || ready;
}

export interface FooterState {
  readonly ready: boolean;
  readonly mintedHere: boolean;
  readonly copied: boolean;
  readonly connected: boolean;
  readonly agentName: string;
}

/** Whether *Continue* goes anywhere from this step. The last step has nowhere to go. */
export function canContinue(step: WizardStep, ready: boolean): boolean {
  if (step === 4) return false;
  return stepOpen((step + 1) as WizardStep, ready);
}

/** The muted line between *Back* and *Continue*. */
export function footerHint(step: WizardStep, s: FooterState): string {
  switch (step) {
    case 1:
      return `Continue with ${s.agentName}`;
    case 2:
      if (!s.ready) return 'Mint a token to continue';
      return s.mintedHere ? 'Token minted — continue' : 'Using a token you already have';
    case 3:
      return s.copied
        ? 'Copied — continue once it is added'
        : `Add it to ${s.agentName}, then continue`;
    case 4:
      return s.connected ? 'Connected' : 'Waiting for check-in';
  }
}

/** One line of a block's text: how far it is indented, and whether it carries the real token. */
export interface CommandLine {
  readonly text: string;
  /** Its leading spaces — where its own text starts, for the hanging indent. */
  readonly lead: number;
  readonly token: boolean;
}

/**
 * A block's text cut into its lines (LAI-742; runs since LAI-740), so each can
 * hang under its own start and the lines holding the real token can be
 * highlighted **without changing the text at all** — joined with `\n` they are
 * the input exactly, which is what the copy button copies and what a selection
 * picks up. Before a mint there is no secret, and nothing is marked: a
 * placeholder is not a token.
 */
export function commandLines(text: string, secret: string | undefined): readonly CommandLine[] {
  const marks = secret !== undefined && secret !== '';
  return text.split('\n').map((line) => ({
    text: line,
    lead: line.length - line.replace(/^ +/, '').length,
    token: marks && line.includes(secret),
  }));
}

const LANG_CHIPS: Readonly<Record<SetupBlock['lang'], string | undefined>> = {
  sh: 'Terminal',
  json: 'JSON config',
  toml: 'TOML config',
  yaml: 'YAML config',
  text: undefined,
};

/**
 * The small grey chips beside the *Automatic / By hand* toggle: what the
 * blocks on show ask of the reader, read from the blocks themselves rather
 * than written per agent, so they cannot claim something a block does not.
 */
export function requirementChips(
  blocks: readonly SetupBlock[],
  via: AgentGuide['via'],
): readonly string[] {
  const chips: string[] = [via === 'mcp' ? 'MCP over HTTP' : 'REST API'];
  for (const block of blocks) {
    const chip = LANG_CHIPS[block.lang];
    if (chip !== undefined && !chips.includes(chip)) chips.push(chip);
  }
  return chips;
}

/** The two ways a block can be followed, where an agent has both. */
export type SetupMode = 'auto' | 'hand';

export function setupModes(blocks: readonly SetupBlock[]): readonly SetupMode[] {
  const modes: SetupMode[] = [];
  if (blocks.some((b) => b.group === 'recommended')) modes.push('auto');
  if (blocks.some((b) => b.group === 'manual')) modes.push('hand');
  return modes;
}

export interface RailState {
  readonly agentName: string;
  /** The minted token's name, or `undefined` when nothing was minted here. */
  readonly tokenName: string | undefined;
  /** The reader said they brought a token from Tokens instead. */
  readonly brought: boolean;
  readonly copied: boolean;
  readonly connected: boolean;
  readonly watching: boolean;
}

/** The one-line state under each step's name on the rail. */
export function railLabel(step: WizardStep, s: RailState): string {
  switch (step) {
    case 1:
      return s.agentName;
    case 2:
      return s.tokenName ?? (s.brought ? 'Using an existing token' : 'Not minted yet');
    case 3:
      return s.copied ? 'Command copied' : 'Not copied yet';
    case 4:
      return s.connected ? 'Connected' : s.watching ? 'Waiting for check-in' : 'Not checked yet';
  }
}

/**
 * Where a block's note sits (LAI-741). A recommended block's note *introduces*
 * it — Claude Code's "Open Claude Code in your project folder… and paste
 * this" is the instruction for the block, not a remark about it — so it reads
 * above, as it did before LAI-740. Every other note follows up and stays below.
 */
export function noteAbove(block: SetupBlock): boolean {
  return block.group === 'recommended';
}

/**
 * The rail's second group (LAI-741): what used to sit below the wizard, folded
 * into it. Never locked and never counted in *Step n of 4* — none of it is
 * needed to connect.
 */
export type ExtraId = 'share' | 'tools' | 'invite';

export interface Extra {
  readonly id: ExtraId;
  /** The rail row's name, and the card's title. */
  readonly name: string;
  /** The card's one-line description. */
  readonly line: string;
}

export const EXTRAS: readonly Extra[] = [
  {
    id: 'share',
    name: 'Share with your project',
    line: 'For the project lead: one block that puts every session in this project.',
  },
  {
    id: 'tools',
    name: 'What agents can do',
    line: 'The tools a connected agent gets, and the rules the board holds it to.',
  },
  {
    id: 'invite',
    name: 'Invite a teammate',
    line: 'Everyone connects with a token of their own.',
  },
];

/** The extras this reader sees: *Invite a teammate* only for someone who can invite. */
export function extrasFor(canInvite: boolean): readonly Extra[] {
  return EXTRAS.filter((extra) => extra.id !== 'invite' || canInvite);
}
