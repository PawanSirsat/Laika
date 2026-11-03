import { existsSync, readFileSync, rmSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  asJson,
  backupOnce,
  codexTomlHasHandlers,
  isObject,
  parseConfig,
  paths,
  replaceFile,
} from './activity-hooks.ts';
import { adapter, explicitCommands } from './agent-adapters.ts';
import { shellQuote } from './agents.ts';
import type { Harness } from './agent-session.ts';

/**
 * Install and remove the agent-session hooks (LAI-542, proposal §4.7, §5).
 * **Opt-in**: nothing installs them but `laika agent hooks on`, and the
 * plugin's own `hooks.json` is not touched.
 *
 * | harness | file | events |
 * | --- | --- | --- |
 * | Claude Code | `~/.claude/settings.json` (merged) | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd` |
 * | Codex CLI | `~/.codex/hooks.json` (merged) | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd` (advisory) |
 * | every other harness (LAI-557) | none: `unsupported`, the explicit commands printed | — |
 *
 * `PreToolUse`, `PostToolUse` and `Stop` also drive automatic checkpoints
 * (LAI-547), which save nothing until the agent's owner consents on the
 * board; `PreToolUse` and `Stop` print nothing, so they decide no permission
 * and never keep a turn going.
 *
 * Shapes from code.claude.com/docs/en/hooks and learn.chatgpt.com/docs/hooks,
 * read 2026-10-28. `SessionStart` has no matcher: startup, resume, clear,
 * compact and fork all open (or find) the session. `SessionEnd`'s timeout is
 * 2 s — Claude Code's budget is 1.5 s unless a hook asks for more, Codex's
 * default is 1 s and its maximum 3 — and the hook only hands the end to a
 * background process, so it never needs the time.
 *
 * **Other people's hooks are never touched.** Ours are recognised by the
 * script's name, `laika-agent-hook`, so `off` removes exactly what `on` added.
 * The activity hooks (`laika-activity-hook`) are a different marker and each
 * command leaves the other's alone. Same restraint as `laika activity on`: a
 * file that does not parse is refused with the entry printed instead, the
 * first change leaves `<file>.bak` once, and an identical install writes
 * nothing.
 */

export const AGENT_MARKER = 'laika-agent-hook';

export type AgentHookEvent =
  'session-start' | 'prompt' | 'pre-tool' | 'tool' | 'tool-failed' | 'stop' | 'session-end';

export interface AgentHookReport {
  readonly harness: Harness;
  readonly status: 'installed' | 'unchanged' | 'refused' | 'removed' | 'absent' | 'unsupported';
  readonly summary: string;
  readonly detail?: readonly string[];
}

export function agentHookCommand(script: string, event: AgentHookEvent, harness: Harness): string {
  return `/bin/sh ${shellQuote(script)} ${event} ${harness}`;
}

type Group = Record<string, unknown>;

export function agentHookGroups(script: string, harness: Harness): Record<string, Group> {
  const handler = (event: AgentHookEvent, timeout: number) => ({
    type: 'command',
    command: agentHookCommand(script, event, harness),
    timeout,
  });
  return {
    SessionStart: { hooks: [handler('session-start', 10)] },
    UserPromptSubmit: { hooks: [handler('prompt', 5)] },
    // 30 s: PreToolUse may wait up to 20 s for a checkpoint to let go of the
    // interlock, and a harness kills a hook at its timeout and runs the tool.
    PreToolUse: { hooks: [handler('pre-tool', 30)] },
    PostToolUse: { hooks: [handler('tool', 5)] },
    // Claude Code only: Codex documents no PostToolUseFailure. A failed
    // tool's marker is cleared here; at Stop otherwise.
    ...(harness === 'claude-code'
      ? { PostToolUseFailure: { hooks: [handler('tool-failed', 5)] } }
      : {}),
    Stop: { hooks: [handler('stop', 5)] },
    SessionEnd: { hooks: [handler('session-end', 2)] },
  };
}

const isOurs = (handler: unknown): boolean =>
  isObject(handler) &&
  typeof handler.command === 'string' &&
  handler.command.includes(AGENT_MARKER);

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

/** Only for a harness whose adapter has hooks: Claude Code's or Codex's file. */
export function hookFile(home: string, harness: Harness): string {
  if (harness === 'claude-code') return paths.claude(home);
  if (harness === 'codex') return paths.codex(home);
  throw new Error(`${harness} has no hook file`);
}

/** `/bin/sh '<script>' <event> <harness>` → its three words, or `undefined` for any other command. */
function parseAgentHookCommand(
  command: string,
): { script: string; event: string; harness: string } | undefined {
  const m = /^\/bin\/sh '((?:[^']|'\\'')*)' (\S+) (\S+)$/.exec(command);
  if (m === null) return undefined;
  return { script: (m[1] ?? '').replace(/'\\''/g, "'"), event: m[2] ?? '', harness: m[3] ?? '' };
}

/**
 * Whether `laika agent hooks on`'s set is really in a harness's hook file
 * (LAI-1111), read from the commands themselves: every event it installs has
 * a `laika-agent-hook` command for that event and harness, and the script
 * each one runs exists. The marker anywhere in the file is not enough — a
 * set from a checkout that was moved or removed runs nothing, and a
 * hand-rolled hook that only mentions the name is not ours. One line per
 * problem; none means the hooks are on.
 */
export function agentHooksProblems(home: string, harness: Harness): string[] {
  const path = hookFile(home, harness);
  const parsed = parseConfig(path);
  if (!parsed.ok) return [`${path} ${parsed.why}`];
  if (!parsed.existed) return [`${path} does not exist`];
  const hooks = isObject(parsed.doc.hooks) ? parsed.doc.hooks : {};
  const missing: string[] = [];
  const scripts = new Set<string>();
  for (const [event, group] of Object.entries(agentHookGroups('', harness))) {
    const wanted = (group.hooks as { command: string }[])[0]?.command ?? '';
    const arg = wanted.split(' ').at(-2);
    let found = false;
    for (const g of (hooks[event] as unknown[] | undefined) ?? []) {
      if (!isObject(g) || !Array.isArray(g.hooks)) continue;
      for (const h of g.hooks) {
        if (!isOurs(h)) continue;
        const parts = parseAgentHookCommand((h as { command: string }).command);
        if (parts === undefined || parts.event !== arg || parts.harness !== harness) continue;
        found = true;
        scripts.add(parts.script);
      }
    }
    if (!found) missing.push(event);
  }
  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`${path} has no ${AGENT_MARKER} command for ${missing.join(', ')}`);
  }
  for (const script of scripts) {
    if (!existsSync(script)) {
      problems.push(
        `the hook script ${script} does not exist (the checkout it was installed from moved or was removed)`,
      );
    }
  }
  return problems;
}

function manual(path: string, groups: Record<string, Group>): string[] {
  return [
    `Add this to the "hooks" object in ${path} yourself:`,
    ...JSON.stringify(
      Object.fromEntries(Object.entries(groups).map(([event, group]) => [event, [group]])),
      null,
      2,
    ).split('\n'),
  ];
}

/**
 * A harness with no verified hook format (LAI-557): nothing is read or
 * written — not its config, not Claude Code's or Codex's — and the explicit
 * commands are printed instead.
 */
function unsupported(harness: Harness, mode: 'on' | 'off'): AgentHookReport {
  return mode === 'on'
    ? {
        harness,
        status: 'unsupported',
        summary: 'no verified hook adapter — nothing installed',
        detail: explicitCommands(harness),
      }
    : { harness, status: 'absent', summary: 'no hook adapter — nothing to remove' };
}

export function installAgentHooks(home: string, script: string, harness: Harness): AgentHookReport {
  if (!adapter(harness).hooks) return unsupported(harness, 'on');
  const path = hookFile(home, harness);
  const groups = agentHookGroups(script, harness);

  if (harness === 'codex') {
    let toml = '';
    try {
      toml = readFileSync(paths.codexToml(home), 'utf8');
    } catch {
      toml = '';
    }
    if (codexTomlHasHandlers(toml)) {
      return {
        harness,
        status: 'refused',
        summary: `${paths.codexToml(home)} already defines hooks — hooks.json left alone`,
        detail: manual('the file where you keep your Codex hooks', groups),
      };
    }
  }

  const parsed = parseConfig(path);
  if (!parsed.ok) {
    return {
      harness,
      status: 'refused',
      summary: `${path} ${parsed.why} — left alone`,
      detail: manual(path, groups),
    };
  }
  const hooks = withoutOurs(isObject(parsed.doc.hooks) ? parsed.doc.hooks : {});
  for (const [event, group] of Object.entries(groups)) {
    hooks[event] = [...((hooks[event] as unknown[] | undefined) ?? []), group];
  }
  const next = { ...parsed.doc, hooks };
  if (parsed.existed && isDeepStrictEqual(next, parsed.doc)) {
    return { harness, status: 'unchanged', summary: `already installed in ${path}` };
  }
  const backup = backupOnce(path);
  replaceFile(path, asJson(next));
  return {
    harness,
    status: 'installed',
    summary: `hooks added to ${path}${backup === undefined ? '' : ` (backup: ${backup})`}`,
    ...(harness === 'codex'
      ? { detail: ['Codex runs a new hook only after you trust it: start codex and open /hooks.'] }
      : {}),
  };
}

export function removeAgentHooks(home: string, harness: Harness): AgentHookReport {
  if (!adapter(harness).hooks) return unsupported(harness, 'off');
  const path = hookFile(home, harness);
  if (!existsSync(path)) return { harness, status: 'absent', summary: 'nothing installed' };
  const parsed = parseConfig(path);
  if (!parsed.ok) {
    return {
      harness,
      status: 'refused',
      summary: `${path} ${parsed.why} — left alone; remove any "${AGENT_MARKER}" hook by hand`,
    };
  }
  if (!isObject(parsed.doc.hooks))
    return { harness, status: 'absent', summary: 'nothing installed' };
  const hooks = withoutOurs(parsed.doc.hooks);
  if (isDeepStrictEqual(hooks, parsed.doc.hooks)) {
    return { harness, status: 'absent', summary: 'nothing installed' };
  }
  const next: Record<string, unknown> = { ...parsed.doc };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  else next.hooks = hooks;
  if (Object.keys(next).length === 0 && !existsSync(`${path}.bak`)) {
    rmSync(path, { force: true });
    return {
      harness,
      status: 'removed',
      summary: `deleted ${path} (only Laika’s hooks were in it)`,
    };
  }
  replaceFile(path, asJson(next));
  return { harness, status: 'removed', summary: `hooks removed from ${path}` };
}
