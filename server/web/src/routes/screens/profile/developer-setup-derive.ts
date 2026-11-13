import type {
  DeveloperSetup,
  SetupActivity,
  SetupDevice,
  SetupToken,
  SetupTool,
} from '../../../api/developer-setup.ts';
import type { DevicePairing } from '../../../api/device-pairing.ts';
import type { ProjectSetup } from '../../../api/project-setups.ts';
import { revokeRefusal } from '../../../api/owner-setup.ts';
import { timeLabel } from '../../../api/time-label.ts';
import type { AgentVerification } from '../../../api/tool-setup.ts';
import { IDLE_AFTER_MS } from './token-groups.ts';
import { listedStatus, type ListedStatus } from '../developer/v3/devices-view.ts';
import { SETUP_CHIPS, type SetupChipKey } from '../developer/v3/overview-state.ts';
import { repoGroups } from '../developer/v3/repo-groups.ts';
import { catalogTool } from '../developer/v3/tool-catalog.ts';
import {
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
 * (LAI-1137), so both are derived here from the checks, repository records
 * and client reports the read serves — by **calling** Developer access's own
 * rules, not restating them: a tool's status is `listedStatus`, a repository
 * setup's is `repoGroups` (`recordState`), a helper's is `updateStatus`. What
 * the tab adds is only which of those it lists, set out on `attentionItems`.
 *
 * **Your own Developer access tab draws the same layout** (LAI-1156, D-139):
 * `own-setup-derive.ts` assembles a {@link SetupView} from your own reads, and
 * the few words that differ — whose setup, who is told — are {@link voiceFor}'s.
 */

/**
 * What the tab draws: the admin read as it comes, or your own reads put into
 * the same shape (LAI-1156). `unverified` names the live tools whose own
 * verification could not be read — only your own reads ask for it per tool —
 * so their status falls back to the agent's stamps rather than to a check
 * that was never made.
 */
export interface SetupView extends DeveloperSetup {
  readonly unverified?: readonly string[];
}

/** The words that differ between someone else's setup and your own (frames 2p, F). */
export interface Voice {
  readonly own: boolean;
  /** *Rowan*, or *you* in a sentence about your own. */
  readonly first: string;
  readonly notice: string;
  readonly reading: string;
  readonly errLead: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyItems: readonly string[];
  readonly reach: string;
  readonly everySpace: string;
}

export function voiceFor(own: boolean, name: string): Voice {
  if (own) {
    return {
      own,
      first: 'you',
      notice: 'Your setup · owners and admins see a read-only copy, and you can see when they look',
      reading: 'Reading your setup…',
      errLead: 'Your setup could not be read.',
      emptyTitle: 'You haven’t set up any tools yet',
      emptyBody:
        'No device is paired and no tool holds a credential, so no agent can pick up or work on cards for you. Your own time and cards are not affected.',
      emptyItems: [
        'Pair a device with the Laika helper, then add a tool. Each tool gets its own credential.',
        'Personal tokens, if you make any, show up under Tokens here.',
      ],
      reach: 'by your live tools',
      everySpace: 'Every space you can open',
    };
  }
  const first = firstName(name);
  return {
    own,
    first,
    notice: `Owners and admins only · read-only · ${first} can see that you looked`,
    reading: `Reading ${first}’s setup…`,
    errLead: `${first}’s setup could not be read.`,
    emptyTitle: `${first} hasn’t set up any tools yet`,
    emptyBody: `No device is paired and no tool holds a credential, so no agent can pick up or work on cards for ${first}. Their own time and cards are not affected.`,
    emptyItems: [
      `${first} starts from Developer access on their own account. Admins can’t set it up for them.`,
      'Personal tokens, if any are made later, show up under Tokens here.',
    ],
    reach: 'by their live tools',
    everySpace: 'Every space they can open',
  };
}

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

/**
 * A tool's status word, from its own verification — the rule Developer access
 * uses. `unverified` is a tool whose verification was not read: then the
 * agent's own stamps, as Developer access says it while one is missing.
 */
export function toolState(tool: SetupTool, now: number, unverified = false): ListedStatus {
  return listedStatus(tool, unverified ? undefined : verificationOf(tool, now), now);
}

/** Whether `view` could not read this tool's verification (your own reads only). */
export function isUnverified(view: Pick<SetupView, 'unverified'>, toolId: string): boolean {
  return view.unverified?.includes(toolId) === true;
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

/** A repository setup's chip, in an admin's words: *Recorded by you* is the member's word here. */
export const SETUP_WORDS: Readonly<Record<SetupChipKey, string>> = {
  checked: SETUP_CHIPS.checked.word,
  recorded: 'Recorded by them',
  'update-available': SETUP_CHIPS['update-available'].word,
  missing: SETUP_CHIPS.missing.word,
};

/** The chip's word: Developer access's own on your own setup, the admin's on someone else's. */
export function setupWord(chip: SetupChipKey, own: boolean): string {
  return own ? SETUP_CHIPS[chip].word : SETUP_WORDS[chip];
}

export interface RepoRow {
  /** An element id: `repoGroups`' key, made safe. */
  readonly key: string;
  readonly repo: string;
  readonly projectSlug: string;
  readonly usedBy: readonly string[];
  /** `repoGroups`' chip — `recordState`'s rule, the one Developer access uses. */
  readonly chip: SetupChipKey;
  /** The newest local check's columns; `null` where nothing checked it. */
  readonly instructions: boolean | null;
  readonly project: boolean | null;
  readonly prefix: boolean | null;
  readonly revision: number | null;
  readonly checkedAt: number | null;
}

/**
 * One row per repository setup, grouped **by `repoGroups`** with the member's
 * live tools — exactly as their own Developer access groups them, so a
 * record of a revoked tool goes with it there and here alike. The chip is
 * `repoGroups`' (`recordState` underneath): a project or prefix mismatch, or an
 * older template, is *Update available*; no block found is *No block found*.
 * The columns are the newest local check in the group, shown as the facts.
 */
export function repoRows(
  records: readonly ProjectSetup[],
  tools: readonly SetupTool[],
  devices: readonly SetupDevice[],
): RepoRow[] {
  const live = tools.filter((t) => t.status === 'active');
  return repoGroups(records, live).map((group) => {
    // `repoGroups`' key is `<project id>:<repo key>` or `<project id>:self:<agent id>`.
    const projectId = group.projectId;
    const rest = group.key.slice(projectId.length + 1);
    const mine = records.filter(
      (r) =>
        r.project_id === projectId &&
        (rest.startsWith('self:')
          ? r.repo_key === '' && (r.agent_id ?? '') === rest.slice(5)
          : r.repo_key === rest),
    );
    const newest = mine
      .filter((r) => r.source === 'local_check')
      .sort((x, y) => (y.checked_at ?? 0) - (x.checked_at ?? 0))[0];
    const usedBy = group.devices.flatMap((line) => {
      const names = line.tools.map((t) => {
        const tool = live.find((x) => x.id === t.id);
        const device = devices.find((d) => d.agent_ids.includes(t.id));
        const name = tool === undefined ? t.name : toolName(tool);
        return device === undefined ? name : `${name} · ${device.display_name}`;
      });
      return names;
    });
    return {
      key: group.key.replace(/[^A-Za-z0-9_-]/g, '-'),
      repo: group.repoLabel ?? group.projectSlug,
      projectSlug: group.projectSlug,
      usedBy: [...new Set(usedBy)],
      chip: group.chip,
      instructions: newest === undefined ? null : newest.block_found,
      project: newest?.project_match ?? null,
      prefix: newest?.prefix_match ?? null,
      revision: newest?.template_revision ?? null,
      checkedAt: newest?.checked_at ?? null,
    };
  });
}

/** A row the health line names: what Developer access would not call set up. */
export function repoNeedsAttention(row: Pick<RepoRow, 'chip'>): boolean {
  return row.chip === 'missing' || row.chip === 'update-available';
}

// ------------------------------------------------------------------ attention

export interface AttentionItem {
  readonly label: string;
  /** The element id the link moves focus to. */
  readonly target: string;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The health line's items. **Every rule is one Developer access already
 * uses**, so the tab and the member's own page agree about the same setup:
 *
 * - **a tool** is listed when its own chip says *Needs setup* — the same
 *   `toolState` call (`listedStatus`), with that status's reason. The chip
 *   and the line cannot disagree, because they are one call;
 * - **a tool's helper** is listed only when its update is *Update required*,
 *   as Developer access's own `attentionItems` lists it. *Update available*
 *   stays a chip on the device row (`ROW_UPDATE_KEYS`) and is not attention —
 *   frame 2p's health line names no helper update, so nothing here widens it;
 * - **a repository setup** is listed when `repoGroups`' chip is *No block
 *   found* or *Update available* (`recordState`).
 *
 * Only live tools and devices count — a revoked one needs nothing.
 */
export function attentionItems(
  view: Pick<SetupView, 'devices' | 'tools' | 'repositories' | 'now' | 'unverified'>,
  manifest: UpdateManifest | 'failed' | undefined,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const where = (tool: SetupTool): string => {
    const device = view.devices.find((d) => d.agent_ids.includes(tool.id));
    return device === undefined ? toolName(tool) : `${toolName(tool)} on ${device.display_name}`;
  };
  for (const tool of view.tools) {
    if (tool.status !== 'active') continue;
    const status = toolState(tool, view.now, isUnverified(view, tool.id));
    const required = toolUpdate(tool, manifest)?.key === 'required';
    const why = [
      status.key === 'needs-setup' ? lowerFirst(status.reason) : null,
      required ? 'helper update required' : null,
    ].filter((part): part is string => part !== null);
    if (why.length > 0) {
      items.push({ label: `${where(tool)}: ${why.join('; ')}`, target: anchorFor.tool(tool.id) });
    }
  }
  for (const row of repoRows(view.repositories, view.tools, view.devices)) {
    if (repoNeedsAttention(row)) {
      items.push({
        label: `${row.repo}: ${lowerFirst(SETUP_WORDS[row.chip])}`,
        target: anchorFor.repo(row.key),
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

/** Grants of live tools to spaces the reader cannot open, counted (D-132 item 5). */
export function hiddenGrants(tools: readonly SetupTool[]): number {
  return tools.filter((t) => t.status === 'active').reduce((n, t) => n + t.grants_hidden, 0);
}

/** The line for repository setups in spaces the reader cannot open — a count, never a name. */
export function hiddenSetupsLine(count: number): string {
  return `${String(count)} ${count === 1 ? 'setup' : 'setups'} in spaces you can’t see`;
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

/** One line of *Recent setup activity*; `meId` reads your own acts as *by you*. */
export function activityLine(entry: SetupActivity, meId?: string): string {
  const by = entry.by === null ? '' : ` by ${entry.by.id === meId ? 'you' : entry.by.name}`;
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

/** Your own revoke tells nobody; it is in your activity, which an admin's copy shows. */
export const OWN_NOTIFY_LINE =
  'It shows in your setup activity, where owners and admins can see it too.';

/** What each confirm says stops working (frames 2v–2x), or undefined when the row is gone. */
export function confirmCopy(
  pending: Pending,
  view: DeveloperSetup,
  first: string,
  own = false,
): ConfirmCopy | undefined {
  const notify = own ? OWN_NOTIFY_LINE : notifyLine(first);
  const now = view.now;
  if (pending.kind === 'unpair') {
    const device = view.devices.find((d) => d.id === pending.id);
    if (device === undefined) return undefined;
    const tools = toolsOn(device, view.tools).filter((t) => t.status === 'active');
    const creds = tools
      .map((t) => liveCredential(t, now)?.prefix)
      .filter((p): p is string => p !== undefined);
    if (own) {
      // Your own is Developer access's *Disconnect* (`POST /agents/devices/revoke`):
      // every tool on the device is revoked, and the device stays paired.
      return {
        title: `Disconnect ${device.display_name}?`,
        lead: 'This revokes every tool on it. The device stays paired, so a tool can be added to it again.',
        stops: [
          `${tools.map(toolName).join(' and ')} on ${device.display_name} stop now. An agent running there is ended.`,
          creds.length === 0
            ? 'Their credentials are revoked.'
            : `${String(creds.length)} tool ${creds.length === 1 ? 'credential is' : 'credentials are'} revoked: ${creds.map((p) => `${p}…`).join(', ')}.`,
        ],
        notify,
        cta: `Disconnect ${device.display_name}`,
      };
    }
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

/** The success notice after a revoke (frame 2v's follow-on); nobody is told about your own. */
export function doneLine(
  pending: Pending,
  view: DeveloperSetup,
  first: string,
  own = false,
): string {
  const told = own ? '' : ` ${first} was notified.`;
  if (pending.kind === 'unpair') {
    const name = view.devices.find((d) => d.id === pending.id)?.display_name ?? 'The device';
    return own ? `${name} is disconnected.` : `${name} is unpaired.${told}`;
  }
  if (pending.kind === 'tool') {
    const tool = view.tools.find((t) => t.id === pending.id);
    return `${tool === undefined ? 'The tool' : toolName(tool)} was revoked.${told}`;
  }
  return `Token revoked.${told}`;
}

// ------------------------------------------------------------------ pairing (your own)

/** What a pending request still needs, and whether Approve and Decline are offered (D-124). */
export function pairingStep(p: DevicePairing): { readonly line: string; readonly decide: boolean } {
  if (p.state === 'claimed' && p.claimed !== null) {
    return { line: 'compare the key with your terminal, then approve it', decide: true };
  }
  if (p.state === 'approved')
    return { line: 'approved · waiting for the device to finish', decide: false };
  return { line: 'waiting for the device to claim it', decide: false };
}

/** A revoke's refusal, in the reader's terms — the shared rule's sentence (`owner-setup.ts`). */
export const refusalLine = revokeRefusal;

// ------------------------------------------------------------------ the summary (LAI-1217)

/**
 * A token flag, from the token's own fields and nothing else (LAI-1217). Only
 * a token that still works is flagged — revoked and expired need nothing.
 *
 * - `never`: it has never been used (`last_used_at` is null);
 * - `stale`: its last use is older than {@link STALE_AFTER_MS};
 * - `expiring`: `expires_at` falls within {@link EXPIRING_WITHIN_MS}.
 */
export type TokenFlag = 'never' | 'stale' | 'expiring';

export const STALE_AFTER_MS = 90 * 86_400_000;
export const EXPIRING_WITHIN_MS = 14 * 86_400_000;

export const TOKEN_FLAG_WORDS: Readonly<Record<TokenFlag, string>> = {
  never: 'Never used',
  stale: 'Unused 90+ days',
  expiring: 'Expires soon',
};

export function tokenFlags(token: SetupToken, now: number): TokenFlag[] {
  const state = tokenState(token, now);
  if (state === 'revoked' || state === 'expired') return [];
  const flags: TokenFlag[] = [];
  if (token.last_used_at === null) flags.push('never');
  else if (now - token.last_used_at > STALE_AFTER_MS) flags.push('stale');
  if (token.expires_at !== null && token.expires_at - now <= EXPIRING_WITHIN_MS) {
    flags.push('expiring');
  }
  return flags;
}

/** Every token the read serves, personal first. */
export function allTokens(view: Pick<DeveloperSetup, 'tokens'>): SetupToken[] {
  return [...view.tokens.personal, ...view.tokens.tool_credentials];
}

/** Live tokens carrying at least one flag. */
export function flaggedTokens(view: Pick<DeveloperSetup, 'tokens'>, now: number): SetupToken[] {
  return allTokens(view).filter((t) => tokenFlags(t, now).length > 0);
}

/** The summary's line for flagged tokens, or nothing when none is. */
export function flaggedTokensLine(count: number): string | undefined {
  if (count === 0) return undefined;
  return count === 1 ? '1 token to review' : `${String(count)} tokens to review`;
}

/**
 * Where a step in `/developer` goes — the reader's **own** Developer access,
 * by tab. Only your own setup links there: an owner reading someone else's
 * would land on their own setup, so that view never gets one.
 */
export const DEVELOPER_HREF = {
  overview: '/developer?tab=overview',
  devices: '/developer?tab=devices',
  tools: '/developer?tab=tools',
  connect: '/developer?tab=connect',
  projects: '/developer?tab=projects',
  tokens: '/developer?tab=tokens',
} as const;

/** The one primary next step: a link into `/developer`, or a jump within the tab. */
export type NextStep =
  | { readonly kind: 'link'; readonly label: string; readonly href: string; readonly why: string }
  | {
      readonly kind: 'jump';
      readonly label: string;
      readonly target: string;
      readonly why: string;
    };

/** The id the pending pairing block carries, so a step can move focus to it. */
export const PENDING_ANCHOR = 'dev-pending';
/** The tokens section's id, for the same reason. */
export const TOKENS_ANCHOR = 'ds-tokens-title';

/**
 * The tab's single next step (LAI-1217), in the order a person would do
 * things. **Your own** steps link into Developer access, where the action
 * lives; **someone else's** never do — the only step there is moving to the
 * first thing that needs attention, because only they can change it.
 */
export function nextStep(
  view: SetupView,
  items: readonly AttentionItem[],
  own: boolean,
): NextStep | undefined {
  const flagged = flaggedTokens(view, view.now).length;
  if (!own) {
    const first = items[0];
    if (first !== undefined) {
      return {
        kind: 'jump',
        label: 'Go to the first issue',
        target: first.target,
        why: 'Each item below moves to its row.',
      };
    }
    return undefined;
  }
  const claimed = view.pending_pairing.find((p) => p.state === 'claimed');
  if (claimed !== undefined) {
    return {
      kind: 'jump',
      label: 'Review the pairing request',
      target: PENDING_ANCHOR,
      why: `${claimed.display_name} is waiting for you to approve it.`,
    };
  }
  const liveDevices = view.devices.filter((d) => d.status === 'active').length;
  const liveTools = view.tools.filter((t) => t.status === 'active').length;
  if (liveDevices === 0 && liveTools === 0) {
    return {
      kind: 'link',
      label: 'Pair a device',
      href: DEVELOPER_HREF.devices,
      why: 'Pair the computer your agents run on, then add a tool to it.',
    };
  }
  if (liveTools === 0) {
    return {
      kind: 'link',
      label: 'Add a tool',
      href: DEVELOPER_HREF.connect,
      why: 'A paired device with no tool cannot pick up cards yet.',
    };
  }
  const first = items[0];
  if (first !== undefined) {
    const repo = first.target.startsWith('dev-repo-');
    return {
      kind: 'link',
      label: repo ? 'Fix the repository setup' : 'Fix in Developer access',
      href: repo ? DEVELOPER_HREF.projects : DEVELOPER_HREF.tools,
      why: `Start with ${first.label}. Each item below moves to its row.`,
    };
  }
  if (flagged > 0) {
    return {
      kind: 'link',
      label: 'Review tokens',
      href: DEVELOPER_HREF.tokens,
      why: `${flaggedTokensLine(flagged) ?? ''}: never used, unused for 90 days or expiring soon.`,
    };
  }
  return undefined;
}

export function summaryHeadline(view: SetupView, attention: number): string {
  if (isEmptySetup(view)) return 'Nothing set up yet';
  return attentionWord(attention);
}
