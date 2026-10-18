import { and, eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { orgModelPrices, orgs } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { MODEL_PATTERN } from './token-usage.ts';
import {
  MODEL_PRICES,
  type ModelPrice,
  priceBook,
  type PriceBook,
  PRICES_AS_OF,
} from './model-prices.ts';

/**
 * An organisation's own API-equivalent prices (§4.35, D-084 item 10,
 * LAI-773): what an owner or admin entered over the dated table, on a web
 * session (`org.model_prices.set`). The table stays in the code; a row here
 * wins for its model and says it is the organisation's (`source: 'org'`).
 */

/** The table and the organisation's prices, as every cost figure reads them. */
export function loadPriceBook(db: Db): PriceBook {
  const rows = db.select().from(orgModelPrices).all();
  return priceBook(
    rows.map((r) => ({
      model: r.model,
      input: r.input,
      output: r.output,
      cache_write: r.cacheWrite,
      cache_read: r.cacheRead,
    })),
  );
}

/**
 * `GET /org/model-prices`: every price in force, the organisation's first.
 * Anyone who may view the organisation sees them — they are what every cost
 * figure on the Usage page was computed with — and `can_set` says who may
 * change them.
 */
export interface ModelPricesView {
  /** When the code's table was last read off its sources. */
  as_of: string;
  can_set: boolean;
  entries: (ModelPrice & { overridden: boolean; table: ModelPrice | null })[];
}

export function getModelPrices(db: Db, actor: ResolvedActor): ModelPricesView {
  assertCan(actor, 'org.read');
  return modelPricesView(db, can(actor, 'org.model_prices.set'));
}

function modelPricesView(db: Db, canSet: boolean): ModelPricesView {
  const rows = db.select().from(orgModelPrices).all();
  const own = new Map(rows.map((r) => [r.model, r]));
  const table = new Map(MODEL_PRICES.map((e) => [e.model, e]));
  const book = priceBook(
    rows.map((r) => ({
      model: r.model,
      input: r.input,
      output: r.output,
      cache_write: r.cacheWrite,
      cache_read: r.cacheRead,
    })),
  );
  return {
    as_of: PRICES_AS_OF,
    can_set: canSet,
    entries: book.entries().map((e) => {
      const set = own.get(e.model);
      return {
        ...e,
        ...(set === undefined ? {} : { as_of: new Date(set.updatedAt).toISOString().slice(0, 10) }),
        overridden: set !== undefined,
        table: table.get(e.model) ?? null,
      };
    }),
  };
}

export interface PriceInput {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

function orgId(db: Db): string {
  const org = db.select({ id: orgs.id }).from(orgs).limit(1).get();
  if (org === undefined) throw ApiError.notFound('No organisation');
  return org.id;
}

/** `PUT /org/model-prices/:model` — owners and admins, session only. */
export function setModelPrice(
  db: Db,
  actor: ResolvedActor,
  model: string,
  price: PriceInput,
  now: number = Date.now(),
): ModelPricesView {
  assertCan(actor, 'org.model_prices.set');
  if (!MODEL_PATTERN.test(model)) {
    throw new ApiError('unprocessable', 'A model id is 1–64 of a–z, 0–9, ., _, : and -', {
      field: 'model',
    });
  }
  const id = orgId(db);
  const values = {
    input: price.input,
    output: price.output,
    cacheWrite: price.cache_write,
    cacheRead: price.cache_read,
    setBy: actor.userId,
    updatedAt: now,
  };
  db.insert(orgModelPrices)
    .values({ orgId: id, model, ...values })
    .onConflictDoUpdate({ target: [orgModelPrices.orgId, orgModelPrices.model], set: values })
    .run();
  return modelPricesView(db, true);
}

/** `DELETE /org/model-prices/:model` — back to the table's price, or none. */
export function deleteModelPrice(db: Db, actor: ResolvedActor, model: string): ModelPricesView {
  assertCan(actor, 'org.model_prices.set');
  db.delete(orgModelPrices)
    .where(and(eq(orgModelPrices.orgId, orgId(db)), eq(orgModelPrices.model, model)))
    .run();
  return modelPricesView(db, true);
}
