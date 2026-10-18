import { request } from './client.ts';

/**
 * API-equivalent prices (LAI-773, D-084 item 10, SPEC §6.4): the dated table
 * in the server's code, and an organisation's own over it. Everyone who may
 * view the organisation sees them — every cost on the Usage page was computed
 * with them — and an owner or admin on a web session may change one
 * (`can_set`). Nothing fetches a price. Mirrors `services/org-model-prices.ts`.
 */

/** One model's price, USD per million tokens (`services/model-prices.ts`). */
export interface ModelPrice {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  /** The five-minute write rate. */
  readonly cache_write: number;
  readonly cache_read: number;
  /** The page it was read from, or `org` for the organisation's own. */
  readonly source: string;
  readonly as_of: string;
  /** False when its source did not list the model and the price is inferred. */
  readonly confirmed: boolean;
  readonly note?: string;
}

/** A price in force: the organisation's own, or the table's. */
export interface ModelPriceEntry extends ModelPrice {
  readonly overridden: boolean;
  /** The table's price beneath an override, or for the model itself; `null` for none. */
  readonly table: ModelPrice | null;
}

/** `GET /org/model-prices` (`ModelPricesView`). */
export interface ModelPrices {
  /** When the code's table was last read off its sources. */
  readonly as_of: string;
  readonly can_set: boolean;
  readonly entries: readonly ModelPriceEntry[];
}

export interface PriceInput {
  readonly input: number;
  readonly output: number;
  readonly cache_write: number;
  readonly cache_read: number;
}

export function getModelPrices(signal?: AbortSignal): Promise<ModelPrices> {
  return request<ModelPrices>('/org/model-prices', signal === undefined ? {} : { signal });
}

export function setModelPrice(model: string, price: PriceInput): Promise<ModelPrices> {
  return request<ModelPrices>(`/org/model-prices/${encodeURIComponent(model)}`, {
    method: 'PUT',
    body: price,
  });
}

/** Back to the table's price, or to none for a model it does not list. */
export function resetModelPrice(model: string): Promise<ModelPrices> {
  return request<ModelPrices>(`/org/model-prices/${encodeURIComponent(model)}`, {
    method: 'DELETE',
  });
}

export type PriceStatus = 'organisation' | 'confirmed' | 'inferred';

/** Whose price this is, and how sure: the organisation's, read off a source, or inferred. */
export function priceStatus(entry: Pick<ModelPriceEntry, 'overridden' | 'confirmed'>): PriceStatus {
  if (entry.overridden) return 'organisation';
  return entry.confirmed ? 'confirmed' : 'inferred';
}

export const PRICE_STATUS_LABELS: Readonly<Record<PriceStatus, string>> = {
  organisation: 'organisation’s own',
  confirmed: 'from the price page',
  inferred: 'inferred',
};

/** `$4.00`, `$0.25`, `$0.125` — a price per million, as precise as it was given. */
export function perMillion(price: number): string {
  // Two places, or three when the price has a tenth of a cent ($0.125).
  const places = Math.round(price * 1000) % 10 === 0 ? 2 : 3;
  return `$${price.toFixed(places)}`;
}

/** A price as typed in a field: a number of dollars, at least 0, at most 10,000. */
export function parsePrice(text: string): number | undefined {
  const value = Number(text.trim().replace(/^\$/, ''));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 10_000
    ? value
    : undefined;
}
