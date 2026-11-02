import { AGENT_CLIENT_NAMES, asAgentClient } from '../../../../api/agent-clients.ts';
import type { AgentVerification } from '../../../../api/tool-setup.ts';
import type { StatusTone } from '../../../../components/wizard/StatusChip.tsx';
import { ACTIVE_MS, OFFLINE_MS } from './overview-state.ts';
import type { ToolCapability } from './tool-catalog.ts';

/**
 * One tool's status and checklist (LAI-1061, plan LAI-1042 §E.3, §H), from
 * `GET /agents/:id/verification` and the catalog's capabilities — **and
 * nothing else**. No click, no copied command, no config file and no other
 * tool's request moves anything here.
 *
 * - **Needs setup**: no live credential, or one nothing has used.
 * - **Connected**: the credential reached the board, but the tool itself has
 *   not announced itself on it — or, for a tool with sessions, has opened
 *   none yet.
 * - **Ready**: this tool's own MCP request on its own credential, and a
 *   session where the tool has them, last seen within 15 minutes.
 * - **Idle** / **Offline**: that evidence, last seen 15 min – 7 days ago, or
 *   longer.
 *
 * The board's `tool_request` already fails another tool's name; this reads
 * the slug again anyway, so a server that said `pass` for the wrong client
 * still could not tick this row.
 */

export type ReadinessKey = 'revoked' | 'needs-setup' | 'connected' | 'ready' | 'idle' | 'offline';

export interface Readiness {
  readonly key: ReadinessKey;
  readonly word: string;
  readonly tone: StatusTone;
  readonly reason: string;
  /** No version report from the CLI and none in the tool's own request. */
  readonly versionUnknown: boolean;
}

export type CheckId =
  | 'device_paired'
  | 'credential_installed'
  | 'tool_request'
  | 'required_capabilities'
  | 'session_hooks';

export interface CheckLine {
  readonly id: CheckId;
  readonly label: string;
  /** `unsupported` is a capability the tool does not have: never a failure, never a pass. */
  readonly state: 'pass' | 'fail' | 'unsupported';
  /** What the evidence is, or exactly what is missing and how to produce it. */
  readonly detail: string;
}

/**
 * The tool's own request on its own credential, read twice over: the board's
 * state, and the evidence it names (`services/harness-evidence.ts`, D-125) —
 * the MCP client's own name for a tool that has one, or, for one whose client
 * says only `mcp` (Omnigent, Hermes), the CLI's report naming the harness.
 */
export function ownToolRequest(v: AgentVerification): boolean {
  const request = v.checks.tool_request;
  if (request.state !== 'pass') return false;
  if (request.detail.evidence === 'client_info') return request.detail.client_slug === v.harness;
  if (request.detail.evidence === 'client_report') return v.client_report?.harness === v.harness;
  return false;
}

/** The capabilities the CLI must report for this harness, all reported. */
function capabilitiesMet(v: AgentVerification): boolean {
  return v.checks.required_capabilities.state === 'pass';
}

/** The tool's sessions, when it has them; trivially met when it does not. */
function sessionsMet(v: AgentVerification, tool: ToolCapability): boolean {
  return !tool.sessions || v.checks.session_hooks.state === 'pass';
}

function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)} h ago`;
  return `${String(Math.round(hours / 24))} days ago`;
}

export function readiness(v: AgentVerification, tool: ToolCapability): Readiness {
  const versionUnknown =
    v.client_report?.cli_version == null && v.checks.tool_request.detail.client_version === null;
  const base = { versionUnknown };
  if (v.status === 'revoked') {
    return {
      ...base,
      key: 'revoked',
      word: 'Revoked',
      tone: 'neutral',
      reason: 'Its credentials no longer work',
    };
  }
  if (v.checks.credential_installed.state !== 'pass') {
    return {
      ...base,
      key: 'needs-setup',
      word: 'Needs setup',
      tone: 'waiting',
      reason: 'No credential on this device yet',
    };
  }
  const own = ownToolRequest(v);
  if (!own) {
    if (v.checks.credential_used.state !== 'pass') {
      return {
        ...base,
        key: 'needs-setup',
        word: 'Needs setup',
        tone: 'waiting',
        reason: 'Credential installed; nothing has used it yet',
      };
    }
    return {
      ...base,
      key: 'connected',
      word: 'Connected',
      tone: 'waiting',
      reason: `The credential reached the board; ${tool.name} itself has not called it yet`,
    };
  }
  if (!capabilitiesMet(v)) {
    return {
      ...base,
      key: 'connected',
      word: 'Connected',
      tone: 'waiting',
      reason: `The helper has not reported ${v.checks.required_capabilities.detail.missing.join(', ')} yet`,
    };
  }
  if (!sessionsMet(v, tool)) {
    return {
      ...base,
      key: 'connected',
      word: 'Connected',
      tone: 'waiting',
      reason: `${tool.name} called the board; no session from its hooks yet`,
    };
  }
  const seen = v.last_seen_at ?? v.checks.tool_request.at;
  if (seen === null) {
    // Every piece of evidence is in, but the board keeps no times (presence
    // off): it cannot say the tool was seen lately, so it does not say Ready.
    return {
      ...base,
      key: 'connected',
      word: 'Connected',
      tone: 'waiting',
      reason: 'All its evidence is in; this organisation does not record when it was last seen',
    };
  }
  const age = v.now - seen;
  if (age <= ACTIVE_MS) {
    return {
      ...base,
      key: 'ready',
      word: 'Ready',
      tone: 'ok',
      reason: `${tool.name} is using its own credential`,
    };
  }
  if (age <= OFFLINE_MS) {
    return {
      ...base,
      key: 'idle',
      word: 'Idle',
      tone: 'neutral',
      reason: `Last seen ${ago(seen, v.now)}`,
    };
  }
  return {
    ...base,
    key: 'offline',
    word: 'Offline',
    tone: 'warn',
    reason: `Last seen ${ago(seen, v.now)}`,
  };
}

/** The checklist, in the order the evidence arrives. */
export function checkLines(
  v: AgentVerification,
  tool: ToolCapability,
  deviceName: string,
): readonly CheckLine[] {
  const { checks, now } = v;
  const lines: CheckLine[] = [
    checks.device_paired.state === 'pass'
      ? {
          id: 'device_paired',
          label: 'Device paired',
          state: 'pass',
          detail: `${deviceName} holds a key this board approved.`,
        }
      : {
          id: 'device_paired',
          label: 'Device paired',
          state: 'fail',
          detail: `${deviceName} is not paired. Pair it before adding a tool.`,
        },
  ];

  const credential = checks.credential_installed;
  lines.push(
    credential.state === 'pass'
      ? {
          id: 'credential_installed',
          label: 'Credential installed',
          state: 'pass',
          detail: credential.detail.via_exchange
            ? `${deviceName} fetched it with its own key${credential.at === null ? '' : `, ${ago(credential.at, now)}`}.`
            : 'A live credential exists, created outside this setup.',
        }
      : {
          id: 'credential_installed',
          label: 'Credential installed',
          state: 'fail',
          detail: `Not yet: run the command on ${deviceName}. It fetches the credential itself — nothing secret is shown here.`,
        },
  );

  const request = checks.tool_request;
  const other = request.detail.client_slug;
  let requestDetail: string;
  if (ownToolRequest(v) && request.detail.evidence === 'client_report') {
    requestDetail = `It called the board on its own credential${request.at === null ? '' : ` ${ago(request.at, now)}`}. ${tool.name}’s MCP client names no tool, so the helper’s report from the same credential says it is ${tool.name}. Both are its own word for itself.`;
  } else if (ownToolRequest(v)) {
    const named = request.detail.client_name ?? tool.name;
    const version =
      request.detail.client_version === null ? '' : ` ${request.detail.client_version}`;
    requestDetail = `It called the board on its own credential${request.at === null ? '' : ` ${ago(request.at, now)}`}, naming itself ${named}${version}. That name is the tool’s own word for itself.`;
  } else if (other !== null && other !== v.harness) {
    const client = asAgentClient(other);
    const otherName = client === null ? other : AGENT_CLIENT_NAMES[client];
    requestDetail = `A request on this credential named ${otherName}, not ${tool.name}, so it does not count. ${tool.firstRequest}`;
  } else if (checks.credential_used.state === 'pass') {
    requestDetail = `The credential reached the board, but not from ${tool.name} itself. ${tool.firstRequest}`;
  } else {
    requestDetail = `${tool.name} has not called the board yet. ${tool.firstRequest}`;
  }
  lines.push({
    id: 'tool_request',
    label: `${tool.name} connected`,
    state: ownToolRequest(v) ? 'pass' : 'fail',
    detail: requestDetail,
  });

  const caps = checks.required_capabilities;
  if (caps.detail.required.length > 0) {
    lines.push(
      caps.state === 'pass'
        ? {
            id: 'required_capabilities',
            label: 'Helper reports',
            state: 'pass',
            detail: `The helper reported what ${tool.name} needs: ${caps.detail.required.join(', ')}.`,
          }
        : {
            id: 'required_capabilities',
            label: 'Helper reports',
            state: 'fail',
            detail: `Not yet reported: ${caps.detail.missing.join(', ')}. The helper sends this after \`laika tool add\`; an older helper needs \`laika update\`.`,
          },
    );
  }

  const session = checks.session_hooks;
  if (!tool.sessions) {
    lines.push({
      id: 'session_hooks',
      label: 'Sessions and claims',
      state: 'unsupported',
      detail: `${tool.name} has no session hooks: no session claims or automatic checkpoints. Not needed for Ready.`,
    });
  } else if (session.state === 'pass') {
    lines.push({
      id: 'session_hooks',
      label: 'Sessions and claims',
      state: 'pass',
      detail: `Its hooks opened a session${session.at === null ? '' : ` ${ago(session.at, now)}`}; it can claim tasks.`,
    });
  } else {
    lines.push({
      id: 'session_hooks',
      label: 'Sessions and claims',
      state: 'fail',
      detail:
        `No session yet: its hooks open one when ${tool.name} starts. ${tool.notes[0] ?? ''}`.trim(),
    });
  }
  return lines;
}

/** One sentence for the live region: the status, and what is still missing. */
export function readinessSummary(r: Readiness, lines: readonly CheckLine[], name: string): string {
  const missing = lines.filter((line) => line.state === 'fail').map((line) => line.label);
  if (missing.length === 0) return `${name}: ${r.word}.`;
  return `${name}: ${r.word}. Still missing: ${missing.join(', ')}.`;
}
