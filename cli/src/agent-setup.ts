import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentIo } from './agent.ts';
import { type AgentHookReport, installAgentHooks, removeAgentHooks } from './agent-hooks.ts';
import { adapter, HOOK_HARNESSES } from './agent-adapters.ts';
import {
  credentialPath,
  type Harness,
  HARNESSES,
  isHarness,
  writeCredential,
} from './agent-session.ts';
import { askSecret, closePrompt } from './prompt.ts';
import { readEnvFile } from './whoami.ts';

/**
 * `laika agent login|logout|hooks` — the one-time setup, kept out of the hook
 * path so a hook loads none of it.
 */

export const AGENT_HOOK_SCRIPT = fileURLToPath(
  new URL('../../plugin/scripts/laika-agent-hook', import.meta.url),
);

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/**
 * Is this an agent's token? `GET /agents/me/work-requests` answers `200` for
 * one and `403 not_an_agent` for a person's (SPEC §6.4) — so the person's own
 * token is refused here, before it is ever saved as an agent's.
 */
async function checkAgentToken(
  url: string,
  token: string,
): Promise<{ ok: true } | { ok: false; why: string }> {
  let response: Response;
  try {
    response = await fetch(`${url}/api/v1/agents/me/work-requests`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, why: `nothing answered at ${url}` };
  }
  if (response.ok) return { ok: true };
  let reason: unknown;
  try {
    const body = (await response.json()) as { error?: { details?: { reason?: unknown } } };
    reason = body.error?.details?.reason;
  } catch {
    reason = undefined;
  }
  if (response.status === 403 && reason === 'not_an_agent') {
    return {
      ok: false,
      why: 'that token is not a registered agent’s. Use the token shown when the agent was registered (the Agents screen), never your own.',
    };
  }
  if (response.status === 401) return { ok: false, why: 'the board refused that token.' };
  return { ok: false, why: `the board answered ${String(response.status)}.` };
}

async function login(io: AgentIo, argv: readonly string[]): Promise<number> {
  const harness = argv[1];
  if (!isHarness(harness)) {
    io.err(`laika agent login: name the harness — ${HARNESSES.join(' or ')}`);
    return 1;
  }
  const url = (
    option(argv, '--url') ??
    io.env.LAIKA_URL ??
    readEnvFile(join(io.home, '.laika', 'env')).LAIKA_URL ??
    ''
  ).replace(/\/+$/, '');
  if (url === '') {
    io.err('laika agent login: no board URL — pass --url, or run `laika connect` first');
    return 1;
  }

  let token: string;
  if (io.isTTY) {
    try {
      token = (await askSecret('Agent token (shown once when the agent was registered)')).trim();
    } finally {
      closePrompt();
    }
  } else {
    token = io.stdin().trim();
  }
  if (token === '') {
    io.err('laika agent login: no token given (pipe it on stdin; it is never an argument)');
    return 1;
  }

  const checked = await checkAgentToken(url, token);
  if (!checked.ok) {
    io.err(`laika agent login: not saved — ${checked.why}`);
    return 1;
  }
  writeCredential(io.home, harness, { url, token });
  io.out(`Saved the agent token for ${harness} in ${credentialPath(io.home, harness)} (0600).`);
  io.out(
    adapter(harness).hooks
      ? `Next: \`laika agent hooks on --harness ${harness}\` to open a session per ${harness} session.`
      : `Next: \`laika agent session start --harness ${harness} --harness-session <id> --pid <pid>\` — ${adapter(harness).name} has no verified hooks (cli/agent-adapters/CAPABILITIES.md).`,
  );
  if (adapter(harness).agentHarness !== harness) {
    io.out(
      `On the Agents screen this agent's harness is "${adapter(harness).agentHarness}" (the board has no "${harness}").`,
    );
  }
  return 0;
}

function printReport(io: AgentIo, r: AgentHookReport): void {
  const mark =
    r.status === 'refused' || r.status === 'unsupported'
      ? '!'
      : r.status === 'installed' || r.status === 'removed'
        ? '✓'
        : '·';
  io.out(`  ${mark} ${r.harness}: ${r.summary}`);
  for (const line of r.detail ?? []) io.out(`      ${line}`);
}

export async function setup(io: AgentIo, argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (command === 'login') return login(io, argv);

  if (command === 'logout') {
    const harness = argv[1];
    if (!isHarness(harness)) {
      io.err(`laika agent logout: name the harness — ${HARNESSES.join(' or ')}`);
      return 1;
    }
    rmSync(credentialPath(io.home, harness), { force: true });
    io.out(`Forgot the agent token for ${harness}.`);
    return 0;
  }

  // hooks on|off [--harness H]
  const mode = argv[1];
  const named = option(argv, '--harness');
  if ((mode !== 'on' && mode !== 'off') || (named !== undefined && !isHarness(named))) {
    io.err(`laika agent hooks: on|off [--harness ${HARNESSES.join('|')}]`);
    return 1;
  }
  // Unnamed means every harness hooks can be installed for; one named
  // without a verified adapter is answered with its explicit commands.
  const harnesses: readonly Harness[] = named === undefined ? HOOK_HARNESSES : [named];
  const reports = harnesses.map((h) =>
    mode === 'on' ? installAgentHooks(io.home, AGENT_HOOK_SCRIPT, h) : removeAgentHooks(io.home, h),
  );
  io.out(mode === 'on' ? 'Agent-session hooks:' : 'Removing agent-session hooks:');
  for (const r of reports) printReport(io, r);
  if (mode === 'on' && reports.some((r) => r.status !== 'unsupported')) {
    io.out('');
    io.out('Each harness session opens a Laika agent session with the agent’s own token,');
    io.out('renewed every 30 s while that harness process runs, and closed when it ends.');
    io.out('Nothing happens for a harness with no `laika agent login`.');
  }
  return reports.some((r) => r.status === 'refused' || r.status === 'unsupported') ? 1 : 0;
}
