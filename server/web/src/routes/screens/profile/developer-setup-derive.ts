import type {
  DeveloperSetup,
  SetupActivity,
  SetupDevice,
  SetupToken,
  SetupTool,
} from '../../../api/developer-setup.ts';
import type { ProjectSetup } from '../../../api/project-setups.ts';
import { revokeRefusal } from '../../../api/owner-setup.ts';
import { timeLabel } from '../../../api/time-label.ts';
import type { AgentVerification } from '../../../api/tool-setup.ts';
import { PROJECT_BLOCK_REVISION } from '../connect/connect-copy.ts';
import { IDLE_AFTER_MS } from './token-groups.ts';
import { listedStatus, type ListedStatus } from '../developer/v3/devices-view.ts';
import { catalogTool } from '../developer/v3/tool-catalog.ts';
import {
  offersUpdate,
  updateStatus,
  type UpdateManifest,
  type UpdateStatus,
} from '../developer/v3/update-status.ts';

/**
 * The profile's *Developer setup* tab, worked out (LAI-1140, frames 2p–2ab):
 * every word and count the tab draws comes from `GET /people/:id/developer-
 * setup` through here, and nothing else. Kept free of React so `node --test`
 * reaches every rule.
 *
 * **The server computes no attention list and no "update available"**
 * (LAI-1137): both are derived here, from the checks, repository records and
 * client reports the read serves, with the same rules the member's own
 * Developer access uses (`listedStatus`, `recordState`'s revision, and
 * `updateStatus`).
 */

/** The token search appears only past this many tokens (frame 2p). */
export const SEARCH_OVER = 8;

/** The name the tab's sentences use: the first word of the person's name. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first === '' ? 'This person' : first;
}

/** The anchor a health-line link moves focus to. */
export const anchorFor = {
  tool: (id: string): string => `dev-tool-${id}`,
  repo: (key: string): string => `dev-repo-${key}`,
  device: (id: string): string => `dev-device-${id}`,
} as const;

// ------------------------------------------------------------------ tokens

export type TokenState = 'active' | 'idle' | 'never' | 'expired' | 'revoked';
export type TokenFilter = 'active' | 'expired' | 'revoked' | 'all';

export const TOKEN_FILTERS: readonly (readonly [TokenFilter, string])[] = [
  ['active', 'Active'],
  ['expired', 'Expired'],
  ['revoked', 'Revoked'],
  ['all', 'All'],
];

export const TOKEN_STATE_WORDS: Readonly<Record<TokenState, string>> = {
  active: 'Active',
  idle: 'Idle',
  never: 'Never used',
  expired: 'Expired',
  revoked: 'Revoked',
};

/** One token's state: revoked, then expired, then how recently it was used — *Idle* as the panel's token list reads it. */
export function tokenState(token: SetupToken, now: number): TokenState {
  if (token.revoked_at !== null) return 'revoked';
  if (token.expires_at !== null && token.expires_at <= now) return 'expired';
  if (token.last_used_at === null) return 'never';
  return now - token.last_used_at > IDLE_AFTER_MS ? 'idle' : 'active';
}

/** *Active* is every token that still works — used lately, idle, or never used. */
export function inFilter(state: TokenState, filter: TokenFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return state === 'active' || state === 'idle' || state === 'never';
  return state === filter;
}

export function tokenCounts(
  tokens: readonly SetupToken[],
  now: number,
): Readonly<Record<TokenFilter, number>> {
  const states = tokens.map((t) => tokenState(t, now));
  const count = (f: TokenFilter): number => states.filter((s) => inFilter(s, f)).length;
  return {
    active: count('active'),
    expired: count('expired'),
    revoked: count('revoked'),
    all: count('all'),
  };
}

/** The tokens the filter and the search leave, by name or prefix, case aside. */
export function shownTokens(
  tokens: readonly SetupToken[],
  filter: TokenFilter,
  query: string,
  now: number,
): SetupToken[] {
  const q = query.trim().toLowerCase();
  return tokens.filter(
    (t) =>
      inFilter(tokenState(t, now), filter) &&
      (q === '' || t.name.toLowerCase().includes(q) || t.prefix.toLowerCase().includes(q)),
  );
}

/** The line under a filter that leaves nothing. */
export function noTokensLine(filter: TokenFilter, query: string): string {
  if (query.trim() !== '') return `No token matches “${query.trim()}”.`;
  return filter === 'all' ? 'No tokens.' : `No ${filter} tokens.`;
}

// ------------------------------------------------------------------ tools

/** The verification shape `listedStatus` reads, from what the setup serves for one tool. */
export function verificationOf(tool: SetupTool, now: number): AgentVerification {
  return {
    agent_id: tool.id,
    harness: tool.harness,
    status: tool.status,
    now,
    last_seen_at: tool.last_seen_at,
    checks: tool.checks,
    client_report: tool.client_report,
  };
}

/** A tool's status word, from its own verification — the rule Developer access uses. */
export function toolState(tool: SetupTool, now: number): ListedStatus {
  return listedStatus(tool, verificationOf(tool, now), now);
}

export interface CheckMark {
  readonly label: string;
  readonly ok: boolean;
}

/** The five checks frame 2p draws on each tool; a revoked tool passes none. */
export function checkMarks(tool: SetupTool): readonly CheckMark[] {
  const live = tool.status === 'active';
  const c = tool.checks;
  return [
    { label: 'Device paired', ok: live && c.device_paired.state === 'pass' },
    { label: 'Credential installed', ok: live && c.credential_installed.state === 'pass' },
    { label: 'Credential used', ok: live && c.credential_used.state === 'pass' },
    { label: 'MCP connected', ok: live && c.tool_request.state === 'pass' },
    { label: 'Required capabilities', ok: live && c.required_capabilities.state === 'pass' },
  ];
}

/** The tool's name as people say it: the catalogue's, else what it was registered as. */
export function toolName(tool: Pick<SetupTool, 'harness' | 'display_name'>): string {
  return catalogTool(tool.harness)?.name ?? tool.display_name;
}

/** The newest live credential's prefix, for the facts and the confirm. */
export function liveCredential(tool: SetupTool, now: number): SetupToken | undefined {
  return tool.tokens.find((t) => inFilter(tokenState(t, now), 'active'));
}

/** The tool's helper update status, against the board's manifest. */
export function toolUpdate(
  tool: SetupTool,
  manifest: UpdateManifest | 'failed' | undefined,
): UpdateStatus | undefined {
  if (tool.status !== 'active' || manifest === undefined || manifest === 'failed') return undefined;
  return updateStatus(manifest, tool.client_report);
}

// ------------------------------------------------------------------ devices

/** The device each tool is on: by id, as the setup's `agent_ids` says. */
export function toolsOn(device: SetupDevice, tools: readonly SetupTool[]): SetupTool[] {
  return device.agent_ids
    .map((id) => tools.find((t) => t.id === id))
    .filter((t): t is SetupTool => t !== undefined);
}

/** Tools the setup lists on no device — an unlinked label, or a device since removed. */
export function looseTools(view: Pick<DeveloperSetup, 'devices' | 'tools'>): SetupTool[] {
  const placed = new Set(view.devices.flatMap((d) => d.agent_ids));
  return view.tools.filter((t) => !placed.has(t.id));
}

/** The newest helper version any active tool on the device reported. */
export function deviceHelper(tools: readonly SetupTool[]): string | null {
  const reports = tools
    .filter((t) => t.status === 'active' && t.client_report?.cli_version != null)
    .map((t) => t.client_report)
    .filter((r): r is NonNullable<SetupTool['client_report']> => r !== null)
    .sort((a, b) => (b.reported_at ?? 0) - (a.reported_at ?? 0));
  const version = reports[0]?.cli_version?.trim() ?? '';
  return version === '' ? null : version;
}

export function launcherWord(launcher: SetupDevice['launcher']): string {
  if (launcher.state === 'on') {
    const running = launcher.running ?? 0;
    return launcher.max_concurrent === null
      ? `On · ${String(running)} running`
      : `On · ${String(running)} running / max ${String(launcher.max_concurrent)}`;
  }
  return launcher.state === 'unknown' ? 'Unknown' : 'Off';
}

export function pickupWord(launcher: SetupDevice['launcher']): string {
  const p = launcher.auto_pickup;
  if (launcher.state !== 'on' || p === null) return 'Off';
  if (p.work_requests && p.handoffs) return 'On';
  if (p.work_requests) return 'Work requests';
  if (p.handoffs) return 'Hand-offs';
  return 'Off';
}

// ------------------------------------------------------------------ repositories

export interface RepoRow {
  readonly key: string;
  readonly repo: string;
  readonly projectSlug: string;
  readonly usedBy: readonly string[];
  readonly instructions: boolean;
  /** `null` when the record could not check it, which is never a mismatch. */
  readonly project: boolean | null;
  readonly prefix: boolean | null;
  readonly revision: number | null;
  readonly outOfDate: boolean;
  readonly checkedAt: number | null;
  readonly failed: boolean;
}

/**
 * One row per repository and space, from its newest record; the tools that
 * recorded it are *Used by*. A browser record (`repo_key: ''`) is its own row.
 */
export function repoRows(
  records: readonly ProjectSetup[],
  tools: readonly SetupTool[],
  devices: readonly SetupDevice[],
): RepoRow[] {
  const groups = new Map<string, ProjectSetup[]>();
  for (const r of records) {
    const key = `${r.project_id}:${r.repo_key === '' ? r.id : r.repo_key}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const used = (r: ProjectSetup): string | null => {
    const tool = tools.find((t) => t.id === r.agent_id);
    if (tool === undefined) return null;
    const device = devices.find((d) => d.agent_ids.includes(tool.id));
    return device === undefined ? toolName(tool) : `${toolName(tool)} · ${device.display_name}`;
  };
  return [...groups.entries()].map(([key, list]) => {
    const newest = [...list].sort((a, b) => (b.checked_at ?? 0) - (a.checked_at ?? 0))[0]!;
    const outOfDate =
      newest.template_revision !== null && newest.template_revision < PROJECT_BLOCK_REVISION;
    return {
      key: key.replace(/[^A-Za-z0-9_-]/g, '-'),
      repo: newest.repo_label ?? newest.project_slug,
      projectSlug: newest.project_slug,
      usedBy: [...new Set(list.map(used).filter((u): u is string => u !== null))],
      instructions: newest.block_found,
      project: newest.project_match,
      prefix: newest.prefix_match,
      revision: newest.template_revision,
      outOfDate,
      checkedAt: newest.checked_at,
      failed:
        !newest.block_found || newest.project_match === false || newest.prefix_match === false,
    };
  });
}

// ------------------------------------------------------------------ attention

export interface AttentionItem {
  readonly label: string;
  /** The element id the link moves focus to. */
  readonly target: string;
}

/**
 * The health line's items, worst first: what a working setup would not show.
 * Only live tools and devices count — a revoked one needs nothing.
 */
export function attentionItems(
  view: Pick<DeveloperSetup, 'devices' | 'tools' | 'repositories' | 'now'>,
  manifest: UpdateManifest | 'failed' | undefined,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const where = (tool: SetupTool): string => {
    const device = view.devices.find((d) => d.agent_ids.includes(tool.id));
    return device === undefined ? toolName(tool) : `${toolName(tool)} on ${device.display_name}`;
  };
  for (const tool of view.tools) {
    if (tool.status !== 'active') continue;
    const c = tool.checks;
    if (c.credential_installed.state === 'pass' && c.credential_used.state === 'fail') {
      items.push({
        label: `${where(tool)}: credential never used`,
        target: anchorFor.tool(tool.id),
      });
    } else if (c.tool_request.state === 'fail') {
      items.push({ label: `${where(tool)}: MCP not connected`, target: anchorFor.tool(tool.id) });
    }
  }
  for (const row of repoRows(view.repositories, view.tools, view.devices)) {
    if (row.failed) {
      items.push({ label: `${row.repo}: project check failed`, target: anchorFor.repo(row.key) });
    } else if (row.outOfDate) {
      items.push({ label: `${row.repo}: template out of date`, target: anchorFor.repo(row.key) });
    }
  }
  for (const device of view.devices) {
    if (device.status !== 'active') continue;
    const tools = toolsOn(device, view.tools);
    if (tools.some((t) => offersUpdate(toolUpdate(t, manifest)?.key ?? 'unknown'))) {
      items.push({
        label: `${device.display_name}: helper update available`,
        target: anchorFor.device(device.id),
      });
    }
  }
  return items;
}

/** The health line's headline. */
export function attentionWord(count: number): string {
  if (count === 0) return 'All set up';
  return count === 1 ? '1 thing needs attention' : `${String(count)} things need attention`;
}

// ------------------------------------------------------------------ the whole

/** Frame 2y: nothing to show but the empty state. */
export function isEmptySetup(view: DeveloperSetup): boolean {
  return (
    view.devices.length === 0 &&
    view.tools.length === 0 &&
    view.pending_pairing.length === 0 &&
    view.repositories.length === 0 &&
    view.tokens.personal.length === 0 &&
    view.tokens.tool_credentials.length === 0
  );
}

/** The spaces live tools can reach, by id, with the widest access each has. */
export function reachableSpaces(tools: readonly SetupTool[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const tool of tools) {
    if (tool.status !== 'active') continue;
    for (const g of tool.grants) {
      if (out.get(g.project_id) !== 'full') out.set(g.project_id, g.scope);
    }
  }
  return out;
}

export function accessWord(scope: string): string {
  return scope === 'full' ? 'Full' : 'Read only';
}

/** Where `last_seen_at` came from, when a device carries that moment. */
export function lastSeenDevice(view: DeveloperSetup): string | null {
  const at = view.summary.last_seen_at;
  if (at === null) return null;
  return view.devices.find((d) => d.last_seen_at === at)?.display_name ?? null;
}

export function ago(at: number | null, now: number, never = 'Never'): string {
  return at === null ? never : timeLabel(at, now).text;
}

/** One line of *Recent setup activity*. */
export function activityLine(entry: SetupActivity): string {
  const by = entry.by === null ? '' : ` by ${entry.by.name}`;
  switch (entry.kind) {
    case 'paired':
      return `Paired ${entry.subject}`;
    case 'tool_added':
      return `Added ${entry.subject}`;
    case 'tool_revoked':
      return `${entry.subject} revoked${by}`;
    case 'device_unpaired':
      return `${entry.subject} unpaired${by}`;
    case 'token_revoked':
      return `Token ${entry.subject} revoked${by}`;
    case 'project_check_failed':
      return `Project check failed for ${entry.subject}`;
  }
}

// ------------------------------------------------------------------ the confirms

export type Pending =
  | { readonly kind: 'unpair'; readonly id: string }
  | { readonly kind: 'tool'; readonly id: string }
  | { readonly kind: 'token'; readonly id: string };

export interface ConfirmCopy {
  readonly title: string;
  readonly lead: string;
  readonly stops: readonly string[];
  readonly notify: string;
  readonly cta: string;
}

/** D-133: an in-Laika notice, and nothing by email — no mailer exists. */
export function notifyLine(first: string): string {
  return `${first} is notified in Laika, and it shows in their setup activity.`;
}

/** What each confirm says stops working (frames 2v–2x), or undefined when the row is gone. */
export function confirmCopy(
  pending: Pending,
  view: DeveloperSetup,
  first: string,
): ConfirmCopy | undefined {
  const notify = notifyLine(first);
  const now = view.now;
  if (pending.kind === 'unpair') {
    const device = view.devices.find((d) => d.id === pending.id);
    if (device === undefined) return undefined;
    const tools = toolsOn(device, view.tools).filter((t) => t.status === 'active');
    const creds = tools
      .map((t) => liveCredential(t, now)?.prefix)
      .filter((p): p is string => p !== undefined);
    const stops =
      tools.length === 0
        ? [
            `Nothing on ${device.display_name} holds a live tool now; its key stops proving anything.`,
          ]
        : [
            `${tools.map(toolName).join(' and ')} on ${device.display_name} stop now. An agent running there is ended.`,
            creds.length === 0
              ? 'Their credentials are revoked.'
              : `${String(creds.length)} tool ${creds.length === 1 ? 'credential is' : 'credentials are'} revoked: ${creds.map((p) => `${p}…`).join(', ')}.`,
            `The launcher and auto-pickup stop on ${device.display_name}.`,
          ];
    return {
      title: `Unpair ${device.display_name}?`,
      lead: 'This revokes the device and every tool on it. It has to be paired again before it can be used.',
      stops,
      notify,
      cta: `Unpair ${device.display_name}`,
    };
  }
  if (pending.kind === 'tool') {
    const tool = view.tools.find((t) => t.id === pending.id);
    if (tool === undefined) return undefined;
    const device = view.devices.find((d) => d.agent_ids.includes(tool.id));
    const on = device === undefined ? '' : ` on ${device.display_name}`;
    const cred = liveCredential(tool, now);
    return {
      title: `Revoke ${toolName(tool)}${on}?`,
      lead: 'Other tools on this device keep working.',
      stops: [
        `${toolName(tool)}’s agent${on} stops now.`,
        cred === undefined
          ? 'Its credentials are revoked.'
          : `Its credential ${cred.prefix}… is revoked.`,
      ],
      notify,
      cta: `Revoke ${toolName(tool)}`,
    };
  }
  const token = [...view.tokens.personal, ...view.tokens.tool_credentials].find(
    (t) => t.id === pending.id,
  );
  if (token === undefined) return undefined;
  const client = token.last_client_name ?? token.last_client;
  return {
    title: `Revoke ${token.name}?`,
    lead: `Scope ${accessWord(token.scope).toLowerCase()}, last used ${ago(token.last_used_at, now, 'never')}.`,
    stops: [
      `Anything using ${token.prefix}… is refused from now on${client === null ? '' : ` (last client ${client})`}.`,
    ],
    notify,
    cta: 'Revoke token',
  };
}

/** The success notice after a revoke (frame 2v's follow-on). */
export function doneLine(pending: Pending, view: DeveloperSetup, first: string): string {
  if (pending.kind === 'unpair') {
    const name = view.devices.find((d) => d.id === pending.id)?.display_name ?? 'The device';
    return `${name} is unpaired. ${first} was notified.`;
  }
  if (pending.kind === 'tool') {
    const tool = view.tools.find((t) => t.id === pending.id);
    return `${tool === undefined ? 'The tool' : toolName(tool)} was revoked. ${first} was notified.`;
  }
  return `Token revoked. ${first} was notified.`;
}

/** A revoke's refusal, in the reader's terms — the shared rule's sentence (`owner-setup.ts`). */
export const refusalLine = revokeRefusal;
