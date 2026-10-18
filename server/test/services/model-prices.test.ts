import { describe, expect, it } from 'vitest';
import {
  MODEL_PRICES,
  PRICES_AS_OF,
  costOf,
  emptyCost,
  addCost,
  priceBook,
  type PriceOverride,
} from '../../src/services/model-prices.ts';

/**
 * API-equivalent cost (D-084 item 10, LAI-773): a dated table in the code,
 * an organisation's own prices over it, and **no price rather than zero** for a
 * model nobody priced. Every figure is what the same tokens would cost at list
 * price on the vendor's API — never the developer's bill.
 */

describe('the dated table', () => {
  it('dates every entry and names where its price came from', () => {
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(MODEL_PRICES.length).toBeGreaterThan(10);
    for (const entry of MODEL_PRICES) {
      expect(entry.model).toMatch(/^[a-z0-9][a-z0-9._:-]{0,63}$/);
      expect(entry.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.source).toMatch(/^https:\/\//);
      expect(typeof entry.confirmed).toBe('boolean');
      for (const value of [entry.input, entry.output, entry.cache_write, entry.cache_read]) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
      // An entry not read off its source says so in words.
      if (!entry.confirmed) expect(entry.note).toBeTruthy();
    }
    expect(new Set(MODEL_PRICES.map((e) => e.model)).size).toBe(MODEL_PRICES.length);
  });

  it('carries the Anthropic list prices as published on the pricing page', () => {
    const at = (model: string) => MODEL_PRICES.find((e) => e.model === model);
    expect(at('claude-opus-5-5')).toMatchObject({
      input: 4,
      output: 20,
      cache_write: 5,
      cache_read: 0.2,
      confirmed: true,
    });
    expect(at('claude-fable-5-1')).toMatchObject({
      input: 10,
      output: 50,
      cache_write: 12.5,
      cache_read: 0.25,
    });
    expect(at('claude-fable-5')).toMatchObject({ cache_read: 1 });
    expect(at('claude-sonnet-5')).toMatchObject({ input: 2, output: 10, cache_read: 0.2 });
    expect(at('claude-haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5, cache_read: 0.1 });
  });

  it('carries Sonnet 5.5 and Haiku 5.5 as re-read in review, each confirmed off the page', () => {
    const at = (model: string) => MODEL_PRICES.find((e) => e.model === model);
    // "Claude Sonnet 5.5 | $2 | $2.50 | $4 | $0.10² | $10" (base, 5m, 1h, hits, output).
    expect(at('claude-sonnet-5-5')).toMatchObject({
      input: 2,
      output: 10,
      cache_write: 2.5,
      cache_read: 0.1,
      confirmed: true,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    });
    // "Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 | $0.125 | $0.20 | $0.01 | $0.50".
    expect(at('claude-haiku-5-5')).toMatchObject({
      input: 0.1,
      output: 0.5,
      cache_write: 0.125,
      cache_read: 0.01,
      confirmed: true,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    });
    expect(at('claude-haiku-5-5')?.note).toMatch(/100,000 tokens/);
  });
});

describe('a price book', () => {
  it('finds a model by its id, and a dated id by its alias', () => {
    const book = priceBook([]);
    expect(book.price('claude-opus-4-8')?.input).toBe(5);
    // A dated snapshot of a priced alias.
    expect(book.price('claude-sonnet-4-5-20250929')?.input).toBe(3);
    expect(book.price('no-such-model')).toBeUndefined();
  });

  it("puts an organisation's own price over the table's", () => {
    const override: PriceOverride = {
      model: 'claude-opus-4-8',
      input: 1,
      output: 2,
      cache_write: 3,
      cache_read: 0.5,
    };
    const book = priceBook([override]);
    expect(book.price('claude-opus-4-8')).toMatchObject({
      input: 1,
      source: 'org',
      confirmed: true,
    });
    // Even for a model the table does not know.
    expect(priceBook([{ ...override, model: 'llama-x' }]).price('llama-x')?.output).toBe(2);
  });
});

describe('what tokens cost', () => {
  const book = priceBook([]);

  it('prices each of the four counts at its own rate, per million', () => {
    const cost = costOf(book, 'claude-opus-5-5', {
      input: 1_000_000,
      output: 1_000_000,
      cache_write: 1_000_000,
      cache_read: 10_000_000,
    });
    // 4 + 20 + 5 + 10 × 0.2
    expect(cost.usd).toBeCloseTo(31, 10);
    expect(cost.unpriced_tokens).toBe(0);
    expect(cost.unpriced_models).toEqual([]);
  });

  it('never prices an unknown model at zero: its tokens are counted as unpriced', () => {
    const cost = costOf(book, 'mystery-1', {
      input: 10,
      output: 20,
      cache_write: 30,
      cache_read: 1000,
    });
    expect(cost.usd).toBe(0);
    // The headline: input + output + cache writes (D-084 item 8).
    expect(cost.unpriced_tokens).toBe(60);
    expect(cost.unpriced_models).toEqual(['mystery-1']);
  });

  it('adds up, and says which priced models were not confirmed', () => {
    const total = emptyCost();
    addCost(
      total,
      costOf(book, 'claude-opus-4-8', { input: 1e6, output: 0, cache_write: 0, cache_read: 0 }),
    );
    addCost(
      total,
      costOf(book, 'mystery-1', { input: 5, output: 0, cache_write: 0, cache_read: 0 }),
    );
    addCost(
      total,
      costOf(book, 'mystery-1', { input: 5, output: 0, cache_write: 0, cache_read: 0 }),
    );
    expect(total.usd).toBeCloseTo(5, 10);
    expect(total.unpriced_tokens).toBe(10);
    expect(total.unpriced_models).toEqual(['mystery-1']);
    const unconfirmed = MODEL_PRICES.find((e) => !e.confirmed);
    if (unconfirmed !== undefined) {
      addCost(
        total,
        costOf(book, unconfirmed.model, { input: 1e6, output: 0, cache_write: 0, cache_read: 0 }),
      );
      expect(total.unconfirmed_models).toEqual([unconfirmed.model]);
    }
  });
});
