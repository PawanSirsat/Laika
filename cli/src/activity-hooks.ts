import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { detectAgents, shellQuote } from './agents.ts';
import { writePrivately } from './connect.ts';

/**
 * Install and remove the activity hooks in each agent's own config (LAI-752).
 *
 * ## Where every shape comes from
 *
 * Checked against official docs and source on 2026-10-15/16 (the research for
 * this task, re-verified per agent). Nothing here is reconstructed from memory:
 *
 * | agent | file | events | source |
 * | --- | --- | --- | --- |
 * | Claude Code | `~/.claude/settings.json` (merged) | `UserPromptSubmit`, `SessionStart` (`startup\|clear`), `SessionEnd`, `Stop` | code.claude.com/docs/en/hooks |
 * | Codex CLI | `~/.codex/hooks.json` (merged) | `UserPromptSubmit`, `SessionStart` (`startup`), `SessionEnd` | learn.chatgpt.com/docs/hooks |
 * | Gemini CLI | `~/.gemini/settings.json` (merged) | `BeforeAgent`, `SessionStart`, `SessionEnd` | geminicli.com/docs/hooks |
 * | Copilot CLI | `~/.copilot/hooks/laika-activity.json` (ours) | `userPromptSubmitted`, `sessionStart`, `sessionEnd` | docs.github.com/en/copilot/reference/hooks-reference |
 * | Goose | `~/.agents/plugins/laika-activity/` (ours) | `UserPromptSubmit`, `SessionStart`, `SessionEnd` | goose-docs.ai/docs/guides/context-engineering/hooks |
 * | Kiro CLI v3 | `~/.kiro/hooks/laika-activity.json` (ours) | `UserPromptSubmit`, `SessionStart`, `SessionEnd` | kiro.dev/docs/hooks |
 *
 * **`Stop` is Claude Code's alone (LAI-776).** It fires at the end of every
 * turn, takes no matcher, and its payload carries the turn's last reply —
 * which the hook never reads (checked 2026-10-18). It is a throttled trigger:
 * the hook launches the background sync only once `next_sync_at` has passed,
 * so a long session's tokens reach the board within one sync interval rather
 * than at its end. No other agent here documents a per-turn event this could
 * use without guessing, so the others still sync on their sessions' start
 * and end.
 *
 * **Cline is skipped.** Its source puts global hooks in `~/Documents/Cline/Hooks`
 * and its release post in `~/Documents/Cline/Rules/Hooks`; it has no session-end
 * hook, its `TaskStart` may fire every turn, and a hook that prints no JSON
 * makes it warn on every prompt. That is not a mechanism this can install
 * without guessing.
 *
 * ## Other people's files
 *
 * The same restraint as `laika connect`: a file that does not parse is refused
 * and the entry to add is printed instead; the first change to an existing
 * file leaves `<file>.bak` once; an identical install writes nothing. **Ours is
 * recognised by the script's name in the command** — `laika-activity-hook` —
 * so `off` removes exactly what `on` added and nothing a person wrote.
 */

export const MARKER = 'laika-activity-hook';
/** In every file of our own — the hook command, or the Goose plugin's name. */
const OWN_MARKER = 'laika-activity';

export type HookAgent =
  'claude-code' | 'codex' | 'gemini-cli' | 'copilot' | 'goose' | 'kiro' | 'cline';

export const HOOK_AGENTS: readonly HookAgent[] = [
  'claude-code',
  'codex',
  'gemini-cli',
  'copilot',
  'goose',
  'kiro',
  'cline',
];

const NAMES: Readonly<Record<HookAgent, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  'gemini-cli': 'Gemini CLI',
  copilot: 'Copilot CLI',
  goose: 'Goose',
  kiro: 'Kiro CLI',
  cline: 'Cline',
};

export interface HookReport {
  readonly agent: HookAgent;
  readonly name: string;
  readonly status: 'installed' | 'unchanged' | 'skipped' | 'refused' | 'removed' | 'absent';
  readonly summary: string;
  readonly detail?: readonly string[];
}

type Mode = 'prompt' | 'session-start' | 'session-end' | 'turn-end';

export interface InstallOptions {
  readonly home: string;
  readonly script: string;
  /** `/bin/zsh -f` or `/bin/sh`. */
  readonly shell: string;
  readonly agents: readonly HookAgent[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The command line every agent runs. Shell-agnostic: no operators, one quoted path. */
export function hookCommand(shell: string, script: string, mode: Mode, kind: string): string {
  return `${shell} ${shellQuote(script)} ${mode} ${kind}`;
}

/* -------------------------------------------------------------------------- */
/* Which agents                                                               */
/* -------------------------------------------------------------------------- */

function jsonHasLaika(path: string, container: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const servers = (parsed as Record<string, unknown> | null)?.[container];
    return typeof servers === 'object' && servers !== null && 'laika' in servers;
  } catch {
    return false;
  }
}

const copilotHome = (home: string, env?: Readonly<Record<string, string | undefined>>): string =>
  env?.COPILOT_HOME !== undefined && env.COPILOT_HOME !== ''
    ? env.COPILOT_HOME
    : join(home, '.copilot');

/**
 * Claude Code always, plus every agent with a `laika` server at user scope —
 * the files `laika connect` writes, and for the agents it prints a snippet for,
 * the file that snippet names.
 */
export function configuredAgents(
  home: string,
  env?: Readonly<Record<string, string | undefined>>,
): HookAgent[] {
  const found = new Set<HookAgent>(['claude-code']);
  const connected = detectAgents(home);
  if (connected.includes('codex')) found.add('codex');
  if (connected.includes('gemini-cli')) found.add('gemini-cli');
  if (jsonHasLaika(join(copilotHome(home, env), 'mcp-config.json'), 'mcpServers')) {
    found.add('copilot');
  }
  try {
    const goose = readFileSync(join(home, '.config', 'goose', 'config.yaml'), 'utf8');
    if (/^extensions:/m.test(goose) && /^\s+laika:\s*$/m.test(goose)) found.add('goose');
  } catch {
    // No Goose config.
  }
  if (jsonHasLaika(join(home, '.kiro', 'settings', 'mcp.json'), 'mcpServers')) found.add('kiro');
  const cline = join(home, '.cline', 'data', 'settings', 'cline_mcp_settings.json');
  if (jsonHasLaika(cline, 'mcpServers')) found.add('cline');
  return HOOK_AGENTS.filter((a) => found.has(a));
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export const asJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Replace a file atomically, keeping its mode: `~/.claude/settings.json` may
 * hold the token `laika init` wrote (0600), and must never be rewritten wider.
 */
export function replaceFile(path: string, content: string): void {
  let mode = 0o600;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    mkdirSync(dirname(path), { recursive: true });
  }
  const temp = `${path}.laika-${String(process.pid)}-${String(Date.now())}.tmp`;
  try {
    writeFileSync(temp, content, { mode, flag: 'wx' });
    renameSync(temp, path);
  } catch (cause) {
    rmSync(temp, { force: true });
    throw cause;
  }
}

/** The original, once. Private, because it may hold a token. */
export function backupOnce(path: string): string | undefined {
  const backup = `${path}.bak`;
  if (!existsSync(path) || existsSync(backup)) return undefined;
  writePrivately(backup, readFileSync(path));
  return backup;
}

/* -------------------------------------------------------------------------- */
/* Merged files: Claude Code, Codex, Gemini CLI                               */
/* -------------------------------------------------------------------------- */

type Handler = Record<string, unknown>;
interface Group {
  readonly matcher?: string;
  readonly hooks: Handler[];
}

const isOurs = (handler: unknown): boolean =>
  isObject(handler) && typeof handler.command === 'string' && handler.command.includes(MARKER);

interface MergedSpec {
  readonly path: string;
  /** Event name → the group to add. */
  readonly groups: Readonly<Record<string, Group>>;
}

type Parsed =
  | { readonly ok: true; readonly doc: Record<string, unknown>; readonly existed: boolean }
  | { readonly ok: false; readonly why: string };

export function parseConfig(path: string): Parsed {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
      return { ok: true, doc: {}, existed: false };
    return { ok: false, why: `cannot be read (${(cause as Error).message})` };
  }
  let doc: unknown;
  try {
    doc = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    return { ok: false, why: 'is not valid JSON (comments are not supported)' };
  }
  if (!isObject(doc)) return { ok: false, why: 'does not contain a JSON object' };
  const hooks = doc.hooks;
  if (hooks !== undefined && !isObject(hooks))
    return { ok: false, why: 'has a "hooks" that is not an object' };
  for (const value of Object.values(hooks ?? {})) {
    if (!Array.isArray(value)) return { ok: false, why: 'has a hook event that is not a list' };
  }
  return { ok: true, doc, existed: true };
}

/** `hooks` with every handler of ours removed, and any group or event left empty by that. */
function withoutOurs(hooks: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept: unknown[] = [];
    for (const group of groups as unknown[]) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const handlers = group.hooks.filter((h) => !isOurs(h));
      if (handlers.length === group.hooks.length) kept.push(group);
      else if (handlers.length > 0) kept.push({ ...group, hooks: handlers });
    }
    if (kept.length > 0 || (groups as unknown[]).length === 0) next[event] = kept;
  }
  return next;
}

function manualSteps(spec: MergedSpec): string[] {
  return [
    `Add this to the "hooks" object in ${spec.path} yourself:`,
    ...JSON.stringify(
      Object.fromEntries(Object.entries(spec.groups).map(([event, group]) => [event, [group]])),
      null,
      2,
    ).split('\n'),
  ];
}

function installMerged(agent: HookAgent, spec: MergedSpec, notes: readonly string[]): HookReport {
  const name = NAMES[agent];
  const parsed = parseConfig(spec.path);
  if (!parsed.ok) {
    return {
      agent,
      name,
      status: 'refused',
      summary: `${spec.path} ${parsed.why} — left alone`,
      detail: manualSteps(spec),
    };
  }
  const hooks = withoutOurs(isObject(parsed.doc.hooks) ? parsed.doc.hooks : {});
  for (const [event, group] of Object.entries(spec.groups)) {
    hooks[event] = [...((hooks[event] as unknown[] | undefined) ?? []), group];
  }
  const next = { ...parsed.doc, hooks };
  if (parsed.existed && isDeepStrictEqual(next, parsed.doc)) {
    return {
      agent,
      name,
      status: 'unchanged',
      summary: `already installed in ${spec.path}`,
      detail: notes,
    };
  }
  const backup = backupOnce(spec.path);
  replaceFile(spec.path, asJson(next));
  return {
    agent,
    name,
    status: 'installed',
    summary: `hooks added to ${spec.path}${backup === undefined ? '' : ` (backup: ${backup})`}`,
    detail: notes,
  };
}

function removeMerged(agent: HookAgent, path: string): HookReport {
  const name = NAMES[agent];
  if (!existsSync(path)) return { agent, name, status: 'absent', summary: 'nothing installed' };
  const parsed = parseConfig(path);
  if (!parsed.ok) {
    return {
      agent,
      name,
      status: 'refused',
      summary: `${path} ${parsed.why} — left alone; remove any "${MARKER}" hook from it by hand`,
    };
  }
  if (!isObject(parsed.doc.hooks))
    return { agent, name, status: 'absent', summary: 'nothing installed' };
  const hooks = withoutOurs(parsed.doc.hooks);
  if (isDeepStrictEqual(hooks, parsed.doc.hooks)) {
    return { agent, name, status: 'absent', summary: 'nothing installed' };
  }
  const next: Record<string, unknown> = { ...parsed.doc };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  else next.hooks = hooks;
  // A file `on` created (no original was ever backed up) and that now holds
  // nothing goes with the hooks; one that existed before keeps its shape.
  if (Object.keys(next).length === 0 && !existsSync(`${path}.bak`)) {
    rmSync(path, { force: true });
    return {
      agent,
      name,
      status: 'removed',
      summary: `deleted ${path} (only Laika’s hooks were in it)`,
    };
  }
  replaceFile(path, asJson(next));
  return { agent, name, status: 'removed', summary: `hooks removed from ${path}` };
}

/* -------------------------------------------------------------------------- */
/* Files of our own: Copilot CLI, Goose, Kiro                                 */
/* -------------------------------------------------------------------------- */

interface OwnFile {
  readonly path: string;
  readonly content: string;
}

function installOwn(
  agent: HookAgent,
  files: readonly OwnFile[],
  notes: readonly string[],
): HookReport {
  const name = NAMES[agent];
  for (const file of files) {
    const existing = existsSync(file.path) ? readFileSync(file.path, 'utf8') : undefined;
    if (existing !== undefined && !existing.includes(OWN_MARKER)) {
      return {
        agent,
        name,
        status: 'refused',
        summary: `${file.path} exists and is not Laika's — left alone`,
      };
    }
  }
  if (files.every((f) => existsSync(f.path) && readFileSync(f.path, 'utf8') === f.content)) {
    return {
      agent,
      name,
      status: 'unchanged',
      summary: `already installed: ${files[0]?.path ?? ''}`,
      detail: notes,
    };
  }
  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    replaceFile(file.path, file.content);
  }
  return {
    agent,
    name,
    status: 'installed',
    summary: `wrote ${files[0]?.path ?? ''}`,
    detail: notes,
  };
}

function removeOwn(agent: HookAgent, target: string, probe: string): HookReport {
  const name = NAMES[agent];
  if (!existsSync(target)) return { agent, name, status: 'absent', summary: 'nothing installed' };
  let content = '';
  try {
    content = readFileSync(probe, 'utf8');
  } catch {
    content = '';
  }
  if (!content.includes(OWN_MARKER)) {
    return { agent, name, status: 'refused', summary: `${target} is not Laika's — left alone` };
  }
  rmSync(target, { recursive: true, force: true });
  return { agent, name, status: 'removed', summary: `deleted ${target}` };
}

/* -------------------------------------------------------------------------- */
/* Per agent                                                                  */
/* -------------------------------------------------------------------------- */

export const paths = {
  claude: (home: string) => join(home, '.claude', 'settings.json'),
  codex: (home: string) => join(home, '.codex', 'hooks.json'),
  codexToml: (home: string) => join(home, '.codex', 'config.toml'),
  gemini: (home: string) => join(home, '.gemini', 'settings.json'),
  copilot: (home: string, env?: Readonly<Record<string, string | undefined>>) =>
    join(copilotHome(home, env), 'hooks', 'laika-activity.json'),
  gooseDir: (home: string) => join(home, '.agents', 'plugins', 'laika-activity'),
  kiro: (home: string) => join(home, '.kiro', 'hooks', 'laika-activity.json'),
};

/**
 * Does Codex's config.toml define hook handlers of its own? Codex merges those
 * with hooks.json and warns on every start, and which one a person meant to
 * edit is not ours to decide. `hooks.state` — where Codex records which hooks
 * were trusted — is not a handler and does not count.
 */
export function codexTomlHasHandlers(toml: string): boolean {
  let inHooksTable = false;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line);
    if (header !== null) {
      const name = (header[1] ?? '').replace(/["']/g, '');
      inHooksTable = name === 'hooks';
      if (/^hooks\.[A-Z]/.test(name)) return true;
      continue;
    }
    if (/^["']?hooks["']?\s*=/.test(line)) return true;
    if (/^["']?hooks["']?\s*\.\s*["']?[A-Z]/.test(line)) return true;
    if (inHooksTable && /^["']?[A-Z]/.test(line)) return true;
  }
  return false;
}

function claudeSpec(o: InstallOptions): MergedSpec {
  const cmd = (mode: Mode): string => hookCommand(o.shell, o.script, mode, 'claude-code');
  return {
    path: paths.claude(o.home),
    groups: {
      UserPromptSubmit: { hooks: [{ type: 'command', command: cmd('prompt'), timeout: 5 }] },
      SessionStart: {
        matcher: 'startup|clear',
        hooks: [{ type: 'command', command: cmd('session-start'), timeout: 10 }],
      },
      SessionEnd: { hooks: [{ type: 'command', command: cmd('session-end') }] },
      // Every turn's end: a sync once one is due (LAI-776). No matcher — Stop takes none.
      Stop: { hooks: [{ type: 'command', command: cmd('turn-end'), timeout: 5 }] },
    },
  };
}

function codexSpec(o: InstallOptions): MergedSpec {
  const cmd = (mode: Mode): string => hookCommand(o.shell, o.script, mode, 'codex');
  return {
    path: paths.codex(o.home),
    groups: {
      UserPromptSubmit: { hooks: [{ type: 'command', command: cmd('prompt'), timeout: 5 }] },
      SessionStart: {
        matcher: 'startup',
        hooks: [{ type: 'command', command: cmd('session-start'), timeout: 10 }],
      },
      SessionEnd: { hooks: [{ type: 'command', command: cmd('session-end'), timeout: 1 }] },
    },
  };
}

function geminiSpec(o: InstallOptions): MergedSpec {
  const handler = (mode: Mode, timeout: number): Handler => ({
    name: 'laika-activity',
    type: 'command',
    command: hookCommand(o.shell, o.script, mode, 'gemini-cli'),
    timeout,
  });
  return {
    path: paths.gemini(o.home),
    groups: {
      BeforeAgent: { hooks: [handler('prompt', 5000)] },
      SessionStart: { hooks: [handler('session-start', 10000)] },
      SessionEnd: { hooks: [handler('session-end', 2000)] },
    },
  };
}

export function copilotFile(o: InstallOptions): OwnFile {
  const handler = (mode: Mode, timeoutSec: number) => ({
    type: 'command',
    bash: hookCommand(o.shell, o.script, mode, 'copilot'),
    timeoutSec,
  });
  return {
    path: paths.copilot(o.home, o.env),
    content: asJson({
      version: 1,
      hooks: {
        userPromptSubmitted: [handler('prompt', 5)],
        sessionStart: [handler('session-start', 10)],
        sessionEnd: [handler('session-end', 2)],
      },
    }),
  };
}

export function gooseFiles(o: InstallOptions): OwnFile[] {
  const dir = paths.gooseDir(o.home);
  const group = (mode: Mode, timeout: number) => ({
    hooks: [{ type: 'command', command: hookCommand(o.shell, o.script, mode, 'goose'), timeout }],
  });
  return [
    {
      path: join(dir, 'plugin.json'),
      content: asJson({
        name: 'laika-activity',
        version: '0.1.0',
        description:
          'Laika: counts prompts and sessions per day for the activity heatmap. Installed by `laika activity on`, removed by `laika activity off`.',
      }),
    },
    {
      path: join(dir, 'hooks', 'hooks.json'),
      content: asJson({
        hooks: {
          UserPromptSubmit: [group('prompt', 5)],
          SessionStart: [group('session-start', 10)],
          SessionEnd: [group('session-end', 2)],
        },
      }),
    },
  ];
}

export function kiroFile(o: InstallOptions): OwnFile {
  const hook = (mode: Mode, trigger: string) => ({
    name: `laika-activity-${mode}`,
    trigger,
    action: { type: 'command', command: hookCommand(o.shell, o.script, mode, 'kiro') },
  });
  return {
    path: paths.kiro(o.home),
    content: asJson({
      version: 'v1',
      hooks: [
        hook('prompt', 'UserPromptSubmit'),
        hook('session-start', 'SessionStart'),
        hook('session-end', 'SessionEnd'),
      ],
    }),
  };
}

const CLINE_SKIP: HookReport = {
  agent: 'cline',
  name: NAMES.cline,
  status: 'skipped',
  summary: 'skipped — its hook mechanism could not be verified',
  detail: [
    'Cline’s source and its release notes disagree on where global hooks live',
    '(~/Documents/Cline/Hooks vs ~/Documents/Cline/Rules/Hooks), it has no',
    'session-end hook, and a silent hook makes it warn on every prompt.',
  ],
};

export function installActivityHooks(o: InstallOptions): HookReport[] {
  return o.agents.map((agent): HookReport => {
    switch (agent) {
      case 'claude-code':
        return installMerged(agent, claudeSpec(o), [
          'Runs in every Claude Code session, with or without the plugin. Not under Devin',
          'CLI, which also reads these hooks: those prompts are not counted as Claude Code.',
        ]);
      case 'codex': {
        let toml = '';
        try {
          toml = readFileSync(paths.codexToml(o.home), 'utf8');
        } catch {
          toml = '';
        }
        const spec = codexSpec(o);
        if (codexTomlHasHandlers(toml)) {
          return {
            agent,
            name: NAMES[agent],
            status: 'refused',
            summary: `${paths.codexToml(o.home)} already defines hooks — hooks.json left alone`,
            detail: [
              'Codex would merge both files and warn on every start. Add these where you',
              'keep your hooks instead:',
              ...manualSteps(spec).slice(1),
            ],
          };
        }
        return installMerged(agent, spec, [
          'Codex runs a new hook only after you trust it: start codex and open /hooks.',
        ]);
      }
      case 'gemini-cli':
        return installMerged(agent, geminiSpec(o), []);
      case 'copilot':
        return installOwn(
          agent,
          [copilotFile(o)],
          [
            'Copilot CLI before 1.0.22 fires sessionStart on every prompt, which overcounts sessions.',
          ],
        );
      case 'goose':
        return installOwn(agent, gooseFiles(o), [
          'Goose finds the plugin itself on its next start.',
        ]);
      case 'kiro':
        return installOwn(
          agent,
          [kiroFile(o)],
          ['Global hooks are read by Kiro CLI v3 only, not the Kiro IDE.'],
        );
      case 'cline':
        return CLINE_SKIP;
    }
  });
}

export function removeActivityHooks(
  home: string,
  env?: Readonly<Record<string, string | undefined>>,
): HookReport[] {
  const gooseDir = paths.gooseDir(home);
  return [
    removeMerged('claude-code', paths.claude(home)),
    removeMerged('codex', paths.codex(home)),
    removeMerged('gemini-cli', paths.gemini(home)),
    removeOwn('copilot', paths.copilot(home, env), paths.copilot(home, env)),
    removeOwn('goose', gooseDir, join(gooseDir, 'plugin.json')),
    removeOwn('kiro', paths.kiro(home), paths.kiro(home)),
  ];
}
