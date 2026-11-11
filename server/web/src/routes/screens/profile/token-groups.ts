/**
 * The shape of *Their tokens* on a profile (LAI-321): a person can hold many
 * working tokens, most of them made by the same tool on the same machine and
 * named alike — the owner's own profile carried fifteen, six called
 * "claude-code on macOS". The list says how many there are, folds the
 * same-named ones into one row, and shows the few most recently used first.
 *
 * Pure, so the rules are tested without a browser. Nothing here hides a token
 * from the person who may revoke it: every one is a click away, and revoking
 * stays one token at a time.
 */

import { tokenAgentLabel, type TokenView } from '../../../api/tokens.ts';

/** Rows shown per kind before *Show all* (the owner, 2026-11-04). */
export const TOKENS_SHOWN = 3;

const DAY = 24 * 60 * 60 * 1000;

/** A working token unused this long reads as idle. */
export const IDLE_AFTER_MS = 14 * DAY;

/** Tokens that share one name, most recently used first. */
export interface TokenGroup {
  readonly label: string;
  readonly tokens: readonly TokenView[];
  /** The group's latest use; `null` when none of them was ever used. */
  readonly lastUsedAt: number | null;
}

/** What a row is called: a tool's credential by its tool, never its registered name. */
export function tokenName(token: Pick<TokenView, 'agent_label' | 'name'>): string {
  return tokenAgentLabel(token) ?? token.name;
}

/** Later use first; never used last. */
function byUse(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * Tokens grouped by the name a reader sees, each group's tokens most recently
 * used first, and the groups in the order of their latest use — so the rows a
 * reader is shown first are the ones in use.
 */
export function groupTokens(tokens: readonly TokenView[]): TokenGroup[] {
  const byName = new Map<string, TokenView[]>();
  for (const token of tokens) {
    const label = tokenName(token);
    byName.set(label, [...(byName.get(label) ?? []), token]);
  }
  return [...byName]
    .map(([label, group]) => {
      const sorted = [...group].sort(
        (a, b) => byUse(a.last_used_at, b.last_used_at) || b.created_at - a.created_at,
      );
      return { label, tokens: sorted, lastUsedAt: sorted[0]?.last_used_at ?? null };
    })
    .sort((a, b) => byUse(a.lastUsedAt, b.lastUsedAt) || a.label.localeCompare(b.label));
}

/** Whether a token is in use, idle, or was never used at all. */
export type TokenUse = 'recent' | 'idle' | 'never';

export function tokenUse(lastUsedAt: number | null, now: number): TokenUse {
  if (lastUsedAt === null) return 'never';
  return now - lastUsedAt >= IDLE_AFTER_MS ? 'idle' : 'recent';
}

/** How many of a group's tokens are idle or never used. */
export function unusedCount(group: TokenGroup, now: number): number {
  return group.tokens.filter((token) => tokenUse(token.last_used_at, now) !== 'recent').length;
}

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** "15 working · 10 personal · 5 tool credentials" — a kind with none is not named. */
export function tokenSummary(live: readonly Pick<TokenView, 'kind'>[]): string {
  const agent = live.filter((token) => token.kind === 'agent').length;
  const personal = live.length - agent;
  return [
    `${String(live.length)} working`,
    ...(personal > 0 ? [`${String(personal)} personal`] : []),
    ...(agent > 0 ? [count(agent, 'tool credential', 'tool credentials')] : []),
  ].join(' · ');
}

/** The rows to draw: the first few, or all of them once asked. */
export function shownRows<T>(
  rows: readonly T[],
  all: boolean,
  limit: number = TOKENS_SHOWN,
): { readonly shown: readonly T[]; readonly hidden: number } {
  if (all || rows.length <= limit) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, limit), hidden: rows.length - limit };
}
