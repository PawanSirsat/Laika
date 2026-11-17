/**
 * A fake Power Automate flow (D-154, LAI-1314), served through an injected
 * `fetch` — **no test makes a real call** to Teams.
 *
 * It records every request — the address, the headers and the body exactly as
 * sent — and answers `202 Accepted`, as Power Automate does. `answer` decides
 * otherwise for one request: a status, `'hang'` until the client gives up, or
 * `'refused'` / `'dropped'` — a connection that never opened, and one that
 * broke after it did.
 */

/** A fixture address on Power Automate's current host, never a real flow. */
export const TEAMS_URL =
  'https://default0fixture.00.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/0fixture/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=fixtureSignatureNeverReal9Wq3';

/** A second one, to tell two spaces' channels apart. */
export const TEAMS_URL_2 =
  'https://prod-27.westeurope.logic.azure.com:443/workflows/1fixture/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=fixtureSecondSignatureXyZ7';

export interface TeamsRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  redirect: RequestInit['redirect'];
}

/** What one request is answered with. */
export type TeamsAnswer = number | 'hang' | 'refused' | 'dropped';

export interface FakeTeams {
  fetchImpl: typeof fetch;
  requests: TeamsRequest[];
  /** Answer the next request with this; `undefined` is `202`. */
  answer: ((req: TeamsRequest) => TeamsAnswer | undefined) | null;
  /** Each request's `text`, parsed back from the JSON it was sent as. */
  texts(): string[];
}

/** A promise that settles only when the request's signal aborts — the flow hung. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

/** Undici's shape for a failed connection: a `TypeError` whose `cause` carries the code. */
function networkError(code: string): TypeError {
  const err = new TypeError('fetch failed');
  (err as TypeError & { cause: unknown }).cause = Object.assign(new Error(code), { code });
  return err;
}

export function fakeTeams(): FakeTeams {
  const fake: FakeTeams = {
    requests: [],
    answer: null,
    texts() {
      return fake.requests.map((r) => (JSON.parse(r.body) as { text: string }).text);
    },
    fetchImpl: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const req: TeamsRequest = {
        url,
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : '',
        redirect: init?.redirect,
      };
      fake.requests.push(req);
      const answer = fake.answer?.(req) ?? 202;
      if (answer === 'hang') return hang(init?.signal);
      if (answer === 'refused') throw networkError('ECONNREFUSED');
      if (answer === 'dropped') throw networkError('ECONNRESET');
      // A body Laika must never read or repeat.
      return new Response(answer === 204 ? null : 'flow said: secret-ish details', {
        status: answer,
      });
    },
  };
  return fake;
}
