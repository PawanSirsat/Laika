import type { TokenView } from '../../../api/tokens.ts';
import type { OrgUser } from '../../../api/users.ts';

/**
 * What Security works out before it draws (LAI-1210): which of a person's
 * tokens deserve a second look, and which people a search keeps. Pure: the
 * clock is passed in.
 *
 * **Every flag is a field the server sent, read literally.** Nothing is
 * inferred about what a token is for, who uses it, or whether it is safe — a
 * token unused for a long time is *unused for a long time*, not *abandoned*.
 */

const DAY = 86_400_000;

/** A live token not used for this long is worth a look. */
export const STALE_DAYS = 90;
/** A live token that expires within this long is worth a look. */
export const EXPIRING_DAYS = 7;

export type TokenRisk = 'never-used' | 'stale' | 'expiring';

export const RISK_LABELS: Readonly<Record<TokenRisk, string>> = {
  'never-used': 'Never used',
  stale: `Unused ${String(STALE_DAYS)}+ days`,
  expiring: `Expires within ${String(EXPIRING_DAYS)} days`,
};

type RiskFields = Pick<TokenView, 'last_used_at' | 'expires_at' | 'revoked_at' | 'created_at'>;

/**
 * The flags on one token. A revoked or expired token has none — it no longer
 * works, so there is nothing to act on — and a token made in the last day is
 * not *never used* yet, only new.
 */
export function tokenRisks(token: RiskFields, now: number): readonly TokenRisk[] {
  if (token.revoked_at !== null) return [];
  if (token.expires_at !== null && token.expires_at <= now) return [];
  const risks: TokenRisk[] = [];
  if (token.last_used_at === null) {
    if (now - token.created_at >= DAY) risks.push('never-used');
  } else if (now - token.last_used_at >= STALE_DAYS * DAY) {
    risks.push('stale');
  }
  if (token.expires_at !== null && token.expires_at - now <= EXPIRING_DAYS * DAY) {
    risks.push('expiring');
  }
  return risks;
}

/**
 * One line over a person's tokens: *3 tokens · 1 never used · 1 unused 90+
 * days*. Counts are of live tokens for the flags, of every token listed for
 * the total, so a revoked token in the audit history still counts as listed.
 */
export function riskSummary(tokens: readonly RiskFields[], now: number): string {
  const live = tokens.filter(
    (t) => t.revoked_at === null && (t.expires_at === null || t.expires_at > now),
  ).length;
  const counts: Record<TokenRisk, number> = { 'never-used': 0, stale: 0, expiring: 0 };
  for (const token of tokens) for (const risk of tokenRisks(token, now)) counts[risk] += 1;
  const parts = [
    `${String(tokens.length)} ${tokens.length === 1 ? 'token' : 'tokens'}`,
    ...(live === tokens.length ? [] : [`${String(live)} working`]),
    ...(['never-used', 'stale', 'expiring'] as const)
      .filter((risk) => counts[risk] > 0)
      .map((risk) => `${String(counts[risk])} ${RISK_LABELS[risk].toLowerCase()}`),
  ];
  return parts.join(' · ');
}

/** People whose name or email holds the search, case-insensitively, in the order given. */
export function searchPeople<T extends Pick<OrgUser, 'name' | 'email'>>(
  people: readonly T[],
  query: string,
): readonly T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return people;
  return people.filter(
    (p) => p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle),
  );
}
