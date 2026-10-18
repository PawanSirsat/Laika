import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  getModelPrices,
  parsePrice,
  perMillion,
  PRICE_STATUS_LABELS,
  priceStatus,
  resetModelPrice,
  setModelPrice,
  type ModelPriceEntry,
  type ModelPrices,
} from '../../../api/model-prices.ts';
import { COST_LABEL } from '../../../api/usage.ts';
import { Button } from '../../../components/forms/Button.tsx';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly prices: ModelPrices }
  | { readonly kind: 'error'; readonly message: string };

const FIELDS = [
  ['input', 'Input'],
  ['output', 'Output'],
  ['cache_write', 'Cache write'],
  ['cache_read', 'Cache read'],
] as const;

type Field = (typeof FIELDS)[number][0];

/** A model's id as the server takes one. */
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

/**
 * *Model prices* (LAI-773, D-084 item 10): the prices every cost on the Usage
 * page is computed with — the dated table in Laika's code, each row with the
 * page it was read from, and the organisation's own over it. Everyone who may
 * view the organisation sees them; an owner or admin on a web session may
 * change one (`can_set`), and reset it to the table's.
 *
 * **API-equivalent, not your bill**, said at the top: list prices on the
 * vendor's API, for comparing work. Nothing fetches a price — a new one comes
 * with a release, or is typed in here. A price the table could not read off
 * its source says *inferred*, and a model with no price shows none on Usage,
 * never $0.
 */
export function ModelPricesSection() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Record<Field, string>>({
    input: '',
    output: '',
    cache_write: '',
    cache_read: '',
  });
  const [newModel, setNewModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    getModelPrices(controller.signal)
      .then((prices) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', prices });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          kind: 'error',
          message: cause instanceof ApiError ? cause.message : 'The price table could not be read.',
        });
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (load.kind === 'loading') return null;

  const begin = (entry: ModelPriceEntry | undefined, model: string): void => {
    setEditing(model);
    setError(undefined);
    setDraft({
      input: entry === undefined ? '' : String(entry.input),
      output: entry === undefined ? '' : String(entry.output),
      cache_write: entry === undefined ? '' : String(entry.cache_write),
      cache_read: entry === undefined ? '' : String(entry.cache_read),
    });
  };

  const run = (work: Promise<ModelPrices>): void => {
    setBusy(true);
    setError(undefined);
    work
      .then((prices) => {
        setLoad({ kind: 'ready', prices });
        setEditing(undefined);
        setNewModel('');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'The price did not save.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const commit = (): void => {
    if (editing === undefined) return;
    const parsed = FIELDS.map(([field]) => [field, parsePrice(draft[field])] as const);
    if (parsed.some(([, value]) => value === undefined)) {
      setError('Each price is dollars per million tokens, from 0 to 10,000.');
      return;
    }
    const price = Object.fromEntries(parsed) as Record<Field, number>;
    run(setModelPrice(editing, price));
  };

  const save = (event: FormEvent): void => {
    event.preventDefault();
    commit();
  };

  return (
    <section className="org-card org-prices" aria-labelledby="org-prices" data-section="prices">
      <header className="org-card-head">
        <h2 id="org-prices">Model prices</h2>
        {load.kind === 'ready' && <span className="org-count">table of {load.prices.as_of}</span>}
      </header>
      <p className="org-note">
        Every cost on Usage is <strong>{COST_LABEL}</strong>: these list prices on the vendor’s API,
        in dollars per million tokens, applied to the tokens Laika counted. Laika never fetches a
        price. Cache writes are priced at the five-minute rate.
      </p>
      {load.kind === 'error' ? (
        <p className="org-fact-error" role="alert">
          {load.message}
        </p>
      ) : (
        <>
          <div className="org-prices-scroll">
            <table className="org-prices-table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  {FIELDS.map(([field, label]) => (
                    <th key={field} scope="col">
                      {label}
                    </th>
                  ))}
                  <th scope="col">Price from</th>
                  {load.prices.can_set && <th scope="col">Change</th>}
                </tr>
              </thead>
              <tbody>
                {load.prices.entries.map((entry) => {
                  const status = priceStatus(entry);
                  return editing === entry.model ? (
                    <tr key={entry.model} data-editing>
                      <th scope="row">
                        <code>{entry.model}</code>
                      </th>
                      {FIELDS.map(([field, label]) => (
                        <td key={field}>
                          <input
                            className="input org-price-input"
                            aria-label={`${label}, dollars per million, ${entry.model}`}
                            value={draft[field]}
                            inputMode="decimal"
                            onChange={(e) => {
                              setDraft((d) => ({ ...d, [field]: e.target.value }));
                            }}
                          />
                        </td>
                      ))}
                      <td colSpan={2}>
                        <span className="org-price-actions">
                          <Button variant="secondary" busy={busy} onClick={commit}>
                            Save
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              setEditing(undefined);
                            }}
                          >
                            Cancel
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr key={entry.model} data-model={entry.model} data-status={status}>
                      <th scope="row">
                        <code>{entry.model}</code>
                      </th>
                      {FIELDS.map(([field]) => (
                        <td key={field} className="org-price">
                          {perMillion(entry[field])}
                        </td>
                      ))}
                      <td>
                        <span className="org-price-status" data-status={status}>
                          {PRICE_STATUS_LABELS[status]}
                        </span>
                        {entry.source.startsWith('https://') ? (
                          <a
                            className="org-price-source"
                            href={entry.source}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {new URL(entry.source).hostname} · {entry.as_of}
                          </a>
                        ) : (
                          <span className="org-price-source">set {entry.as_of}</span>
                        )}
                        {entry.note !== undefined && (
                          <span className="org-fact-note">{entry.note}</span>
                        )}
                      </td>
                      {load.prices.can_set && (
                        <td>
                          <span className="org-price-actions">
                            <button
                              type="button"
                              className="org-github-done"
                              disabled={busy}
                              onClick={() => {
                                begin(entry, entry.model);
                              }}
                            >
                              Edit
                            </button>
                            {entry.overridden && (
                              <button
                                type="button"
                                className="org-github-done"
                                disabled={busy}
                                onClick={() => {
                                  run(resetModelPrice(entry.model));
                                }}
                              >
                                {entry.table === null ? 'Remove' : 'Reset'}
                              </button>
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {load.prices.can_set && editing === undefined && (
            <form
              className="org-price-new"
              onSubmit={(event) => {
                event.preventDefault();
                const model = newModel.trim().toLowerCase();
                if (!MODEL.test(model)) {
                  setError('A model id is 1–64 of a–z, 0–9, ., _, : and -.');
                  return;
                }
                const known = load.prices.entries.find((e) => e.model === model);
                begin(known, model);
                if (known === undefined) setNewModel(model);
              }}
            >
              <input
                className="input org-price-model"
                aria-label="Model id to price"
                placeholder="model id, e.g. gpt-5.1-codex-mini"
                value={newModel}
                onChange={(e) => {
                  setNewModel(e.target.value);
                }}
              />
              <Button variant="secondary" type="submit">
                Price a model
              </Button>
            </form>
          )}
          {editing !== undefined && !load.prices.entries.some((e) => e.model === editing) && (
            <form className="org-price-new" onSubmit={save} aria-label={`Price for ${editing}`}>
              <code>{editing}</code>
              {FIELDS.map(([field, label]) => (
                <input
                  key={field}
                  className="input org-price-input"
                  aria-label={`${label}, dollars per million, ${editing}`}
                  placeholder={label}
                  value={draft[field]}
                  inputMode="decimal"
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, [field]: e.target.value }));
                  }}
                />
              ))}
              <Button variant="secondary" busy={busy} type="submit">
                Save
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(undefined);
                }}
              >
                Cancel
              </Button>
            </form>
          )}
          {error !== undefined && (
            <p className="org-fact-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
