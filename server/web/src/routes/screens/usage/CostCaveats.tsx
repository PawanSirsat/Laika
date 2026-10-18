import { costCaveats, type UsageCost } from '../../../api/usage.ts';

/** A cost's caveats as a quiet line, or nothing. */
export function CostCaveats({ cost }: { readonly cost: UsageCost }) {
  const lines = costCaveats(cost);
  if (lines.length === 0) return null;
  return <span className="usage-cost-caveat">{lines.join(' · ')}</span>;
}
