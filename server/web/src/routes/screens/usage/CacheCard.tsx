import { compactTokens, COST_LABEL, percent, usd, type Usage } from '../../../api/usage.ts';
import { InfoTip } from '../profile/InfoTip.tsx';

/**
 * *Cache efficiency* per space (LAI-773; the research's idea 6): of every
 * input-side token, the share read from the prompt cache, and what those
 * reads saved against fresh input at list price.
 */
export function CacheCard({ usage }: { readonly usage: Usage }) {
  return (
    <section
      className="prof-card usage-card"
      data-section="cache"
      aria-labelledby="usage-cache-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="usage-cache-title">
          Cache efficiency
        </h3>
        <span className="prof-card-caption">per space · saving is {COST_LABEL}</span>
        <InfoTip label="About cache efficiency">
          <p className="usage-info">
            Of every token an agent sent in — fresh input, cache writes and cache reads — the share
            read from the cache. The saving is what those reads would have cost as fresh input at
            list price, less what they cost as reads. Per space, never per person.
          </p>
        </InfoTip>
      </header>
      {usage.cache_by_project.length === 0 ? (
        <p className="prof-empty">No tokens are tied to a space’s tasks in this range.</p>
      ) : (
        <table className="usage-table" aria-label="Cache efficiency by space">
          <thead>
            <tr>
              <th scope="col">Space</th>
              <th scope="col">From cache</th>
              <th scope="col">Saved</th>
            </tr>
          </thead>
          <tbody>
            {usage.cache_by_project.map((p) => (
              <tr key={p.project.slug}>
                <th scope="row">{p.project.name}</th>
                <td title={`${compactTokens(p.cache_read)} of ${compactTokens(p.input_side)}`}>
                  {percent(p.share)}
                </td>
                <td className="usage-money">
                  {p.saving_usd === null ? 'no price' : usd(p.saving_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
