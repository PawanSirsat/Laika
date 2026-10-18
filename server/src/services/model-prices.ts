/**
 * API-equivalent cost — the dated price table, pure (D-084 item 10, LAI-773).
 *
 * What the tokens Laika counted would cost **at list price on the vendor's
 * API**: a figure to compare work by, never anybody's bill. Everyone here is
 * on a flat plan, and the page says so beside every figure — *API-equivalent,
 * not your bill*.
 *
 * ## Where the prices come from
 *
 * This table, in the code, dated, each row naming its source page. Nothing
 * fetches a price (§13.4): a new price reaches Laika in a release, or an
 * owner or admin enters it on the Organisation page (§4.35), which wins over
 * the table. A row this table could not read off its source says so
 * (`confirmed: false`, with a `note`), and every figure built on one says it
 * was (`unconfirmed_models`).
 *
 * ## What one row prices
 *
 * The four counts Laika keeps (§4.33), per million tokens: uncached input,
 * output, cache writes and cache reads. **Cache writes are priced at the
 * five-minute rate**: neither the session files nor the telemetry split a
 * write by how long it was kept (Claude Code's `cacheCreation` counts the
 * five-minute and one-hour writes together), and the five-minute rate is the
 * lower, so the figure stays a floor, like the counts under it (D-084 item 9).
 *
 * **A model with no price shows no price, never zero**: its tokens are carried
 * as `unpriced_tokens` beside the dollars, so a cheap-looking figure is never
 * a missing one.
 */

/** When the table was last read off its sources. */
export const PRICES_AS_OF = '2026-10-18';

const ANTHROPIC = 'https://platform.claude.com/docs/en/about-claude/pricing';
const OPENAI = 'https://developers.openai.com/api/docs/pricing';

/** One model's list price, USD per million tokens. */
export interface ModelPrice {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  /** The five-minute write rate (see the module comment). */
  readonly cache_write: number;
  readonly cache_read: number;
  /** The page the price was read from, or `org` for an organisation's own. */
  readonly source: string;
  readonly as_of: string;
  /** False when the source did not list this model and the row is inferred. */
  readonly confirmed: boolean;
  readonly note?: string;
}

const anthropic = (
  model: string,
  input: number,
  output: number,
  cacheWrite: number,
  cacheRead: number,
  note?: string,
): ModelPrice => ({
  model,
  input,
  output,
  cache_write: cacheWrite,
  cache_read: cacheRead,
  source: ANTHROPIC,
  as_of: PRICES_AS_OF,
  confirmed: true,
  ...(note === undefined ? {} : { note }),
});

/** OpenAI lists input, cached input and output; a cache write is billed as input. */
const openai = (
  model: string,
  input: number,
  cachedInput: number,
  output: number,
  inferredFrom?: string,
): ModelPrice => ({
  model,
  input,
  output,
  cache_write: input,
  cache_read: cachedInput,
  source: OPENAI,
  as_of: PRICES_AS_OF,
  confirmed: inferredFrom === undefined,
  note:
    inferredFrom === undefined
      ? 'OpenAI lists no cache-write price; a write is priced as input.'
      : `Not on OpenAI's price page on ${PRICES_AS_OF}; priced as ${inferredFrom}, which is.`,
});

/**
 * The table. Anthropic's rows are the pricing page's *Model pricing* table
 * read on {@link PRICES_AS_OF} — base input, 5m cache writes, cache hits and
 * output — under the model ids its models overview gives as each one's
 * "Claude API ID" (platform.claude.com/docs/en/about-claude/models/overview,
 * MODELS below). OpenAI's are its *Standard* tier. Gemini CLI's models carry no row:
 * none was read, so they show no price until an admin enters one.
 */
export const MODEL_PRICES: readonly ModelPrice[] = [
  anthropic('claude-fable-5-1', 10, 50, 12.5, 0.25),
  anthropic('claude-fable-5', 10, 50, 12.5, 1),
  anthropic('claude-opus-5-5', 4, 20, 5, 0.2),
  anthropic('claude-opus-5', 5, 25, 6.25, 0.5),
  anthropic('claude-opus-4-8', 5, 25, 6.25, 0.5),
  anthropic('claude-opus-4-7', 5, 25, 6.25, 0.5),
  anthropic('claude-opus-4-6', 5, 25, 6.25, 0.5),
  anthropic('claude-opus-4-5', 5, 25, 6.25, 0.5),
  // Re-read in review, 2026-10-18. ANTHROPIC's table: "Claude Sonnet 5.5 |
  // $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok² | $10 / MTok" — ² "cache
  // hits … on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the
  // base input price". MODELS: Claude API ID `claude-sonnet-5-5`.
  anthropic('claude-sonnet-5-5', 2, 10, 2.5, 0.1),
  anthropic('claude-sonnet-5', 2, 10, 2.5, 0.2),
  anthropic('claude-sonnet-4-6', 3, 15, 3.75, 0.3),
  anthropic('claude-sonnet-4-5', 3, 15, 3.75, 0.3),
  // Re-read in review, 2026-10-18. ANTHROPIC's table: "Claude Haiku 5.5 (for
  // prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok
  // | $0.01 / MTok | $0.50 / MTok", and over 100,000 "$0.50 | $0.625 | $1 |
  // $0.05 | $2.50". MODELS: Claude API ID `claude-haiku-5-5`.
  anthropic(
    'claude-haiku-5-5',
    0.1,
    0.5,
    0.125,
    0.01,
    'Priced at its rate for prompts up to 100,000 tokens; longer prompts cost five times as much, so this is a floor.',
  ),
  anthropic('claude-haiku-4-5', 1, 5, 1.25, 0.1),
  anthropic('claude-haiku-4-5-20251001', 1, 5, 1.25, 0.1),
  openai('gpt-6.1-sol', 2, 0.1, 10),
  openai('gpt-5.3-codex', 1.75, 0.175, 14),
  openai('gpt-5.2', 1.75, 0.175, 14),
  openai('gpt-5.1', 1.25, 0.125, 10),
  openai('gpt-5.2-codex', 1.75, 0.175, 14, 'gpt-5.3-codex'),
  openai('gpt-5.1-codex', 1.25, 0.125, 10, 'gpt-5.1'),
  openai('gpt-5.1-codex-max', 1.25, 0.125, 10, 'gpt-5.1'),
];

/** An organisation's own price for a model (§4.35). */
export interface PriceOverride {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cache_write: number;
  readonly cache_read: number;
}

/** The four counts one row of `token_usage_days` holds. */
export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cache_write: number;
  readonly cache_read: number;
}

/**
 * A cost, always with what it could not price beside it — *API-equivalent,
 * not your bill*.
 */
export interface UsageCost {
  /** USD at list price, over the tokens of priced models. */
  usd: number;
  /** Headline tokens (input + output + cache writes) of models with no price. */
  unpriced_tokens: number;
  /** Those models, sorted. */
  unpriced_models: string[];
  /** Priced models whose price was inferred, not read off a source, sorted. */
  unconfirmed_models: string[];
}

export function emptyCost(): UsageCost {
  return { usd: 0, unpriced_tokens: 0, unpriced_models: [], unconfirmed_models: [] };
}

const insertSorted = (list: string[], value: string): void => {
  if (list.includes(value)) return;
  list.push(value);
  list.sort();
};

/** Add `more` into `into`, in place. */
export function addCost(into: UsageCost, more: UsageCost): UsageCost {
  into.usd += more.usd;
  into.unpriced_tokens += more.unpriced_tokens;
  for (const m of more.unpriced_models) insertSorted(into.unpriced_models, m);
  for (const m of more.unconfirmed_models) insertSorted(into.unconfirmed_models, m);
  return into;
}

/** The table with an organisation's prices over it. */
export interface PriceBook {
  price(model: string): ModelPrice | undefined;
  /** Every price in force, the organisation's first, then the table's, by model. */
  entries(): ModelPrice[];
}

/** `claude-sonnet-4-5-20250929` → `claude-sonnet-4-5`: a dated snapshot of a priced alias. */
const undated = (model: string): string => model.replace(/-\d{8}$/, '');

export function priceBook(overrides: readonly PriceOverride[], updatedOn?: string): PriceBook {
  const byModel = new Map<string, ModelPrice>(MODEL_PRICES.map((e) => [e.model, e]));
  const own = new Set<string>();
  for (const o of overrides) {
    own.add(o.model);
    byModel.set(o.model, {
      model: o.model,
      input: o.input,
      output: o.output,
      cache_write: o.cache_write,
      cache_read: o.cache_read,
      source: 'org',
      as_of: updatedOn ?? PRICES_AS_OF,
      confirmed: true,
    });
  }
  return {
    price: (model) => byModel.get(model) ?? byModel.get(undated(model)),
    entries: () =>
      [...byModel.values()].sort(
        (a, b) =>
          Number(own.has(b.model)) - Number(own.has(a.model)) || a.model.localeCompare(b.model),
      ),
  };
}

/** What one model's tokens cost — or, with no price, how many went unpriced. */
export function costOf(book: PriceBook, model: string, counts: TokenCounts): UsageCost {
  const price = book.price(model);
  if (price === undefined) {
    return {
      usd: 0,
      unpriced_tokens: counts.input + counts.output + counts.cache_write,
      unpriced_models: [model],
      unconfirmed_models: [],
    };
  }
  const usd =
    (counts.input * price.input +
      counts.output * price.output +
      counts.cache_write * price.cache_write +
      counts.cache_read * price.cache_read) /
    1_000_000;
  return {
    usd,
    unpriced_tokens: 0,
    unpriced_models: [],
    unconfirmed_models: price.confirmed ? [] : [model],
  };
}

/**
 * What a model's cache reads saved: the same tokens as fresh input, less what
 * they cost as reads — `null` with no price for the model.
 */
export function cacheSaving(book: PriceBook, model: string, cacheRead: number): number | null {
  const price = book.price(model);
  if (price === undefined) return null;
  return (cacheRead * Math.max(0, price.input - price.cache_read)) / 1_000_000;
}
