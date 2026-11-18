import { createHash, createHmac } from 'node:crypto';
import { type AttachmentStoreEnv } from '../env.ts';
import { ApiError } from '../errors.ts';

/**
 * The operator's S3-compatible store (D-150, LAI-1300) — where attachments
 * live, and **the fifth place data leaves the instance** (§13.4).
 *
 * **No SDK.** AWS Signature Version 4 is a handful of HMACs on `node:crypto`,
 * written here as pure functions so each step can be held against AWS's own
 * published examples byte for byte (`test/services/s3-client.test.ts`). The
 * client around them follows `clan-client.ts`: an injectable `fetchImpl`, so
 * **no test calls a store**; an injectable clock; a timeout on every request,
 * cleared in `finally`; and **the store's response body is never read into an
 * error** — its words are a third party's on their way to a Laika user.
 *
 * **Path-style**, `<endpoint>/<bucket>/<key>`: the store D-150 runs (Garage)
 * serves it, and it needs no DNS per bucket. The signer itself takes the host
 * and the path as inputs, so AWS's virtual-host examples check it as well.
 *
 * **Only what Laika names.** Every key is one Laika made (`p/<project>/<id>`,
 * never a filename), and the client knows four operations: presign a `PUT`
 * or a `GET` for a browser, and `HEAD`, read a range and `DELETE` itself.
 */

/** SigV4's algorithm name, and the service every S3-compatible store signs as. */
const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';

/** The payload hash a presigned URL signs: the browser's body is not known yet. */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/** SHA-256 of nothing — the body of a `HEAD`, a `GET` and a `DELETE`. */
export const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

/** Long enough for a slow store, short enough that a hung one frees the request. */
export const STORE_TIMEOUT_MS = 15_000;

/** How long a browser has to upload, once asked (D-150 item 3). */
export const PUT_EXPIRES_SECONDS = 600;

/** How long a read's redirect stays good (D-150 item 3). */
export const GET_EXPIRES_SECONDS = 300;

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * SigV4's URI encoding: every byte but `A–Z a–z 0–9 - _ . ~` as `%XX` in
 * upper case — and `/` too unless it separates a path's segments.
 * `encodeURIComponent` is close and wrong: it leaves `!'()*` alone.
 */
export function uriEncode(value: string, keepSlash = false): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (keepSlash && ch === '/')) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** `20130524T000000Z` — ISO 8601 basic, UTC, no fraction. */
export function amzDate(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export interface SigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/** `<date>/<region>/s3/aws4_request`. */
function credentialScope(date: string, region: string): string {
  return `${date}/${region}/${SERVICE}/aws4_request`;
}

/** The four HMACs that turn the secret into the day's key for this region. */
export function signingKey(secretAccessKey: string, date: string, region: string): Buffer {
  const day = hmac(`AWS4${secretAccessKey}`, date);
  const inRegion = hmac(day, region);
  const forService = hmac(inRegion, SERVICE);
  return hmac(forService, 'aws4_request');
}

/** The query string as SigV4 orders it: encoded, then sorted by name and value. */
export function canonicalQuery(query: readonly (readonly [string, string])[]): string {
  return query
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

export interface CanonicalRequestInput {
  method: string;
  /** The path as sent, unencoded; each segment is encoded here. */
  path: string;
  query: readonly (readonly [string, string])[];
  /** Every header to sign, any case; values are trimmed and inner runs of spaces folded. */
  headers: Readonly<Record<string, string>>;
  payloadHash: string;
}

/** The headers SigV4 signs, lowercased and sorted. */
function canonicalHeaders(headers: Readonly<Record<string, string>>): {
  lines: string;
  signed: string;
} {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    lines: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  };
}

/** Step 1: the canonical request, exactly as AWS's examples print it. */
export function canonicalRequest(input: CanonicalRequestInput): string {
  const { lines, signed } = canonicalHeaders(input.headers);
  return [
    input.method,
    uriEncode(input.path, true),
    canonicalQuery(input.query),
    lines,
    signed,
    input.payloadHash,
  ].join('\n');
}

/** Step 2: what is signed. */
export function stringToSign(amz: string, region: string, request: string): string {
  return [ALGORITHM, amz, credentialScope(amz.slice(0, 8), region), sha256Hex(request)].join('\n');
}

/** Step 3: the signature, hex. */
export function signature(credentials: SigningCredentials, amz: string, request: string): string {
  const key = signingKey(credentials.secretAccessKey, amz.slice(0, 8), credentials.region);
  return createHmac('sha256', key)
    .update(stringToSign(amz, credentials.region, request), 'utf8')
    .digest('hex');
}

export interface PresignInput {
  method: 'GET' | 'PUT';
  /** `host[:port]` — signed, and what the browser will send. */
  host: string;
  path: string;
  /** Headers the browser must send exactly, besides `host`. */
  headers?: Readonly<Record<string, string>>;
  /** Query parameters to sign beside the `X-Amz-*` ones — `response-content-type`, say. */
  query?: readonly (readonly [string, string])[];
  now: number;
  expiresSeconds: number;
}

/**
 * A presigned URL's query string (AWS's "Authenticating Requests: Using Query
 * Parameters"): the `X-Amz-*` parameters, the caller's own, and the signature
 * last. The URL is `<scheme>://<host><path>?<this>`.
 */
export function presignQuery(credentials: SigningCredentials, input: PresignInput): string {
  const amz = amzDate(input.now);
  const headers = { host: input.host, ...input.headers };
  const { signed } = canonicalHeaders(headers);
  const query: (readonly [string, string])[] = [
    ...(input.query ?? []),
    ['X-Amz-Algorithm', ALGORITHM],
    [
      'X-Amz-Credential',
      `${credentials.accessKeyId}/${credentialScope(amz.slice(0, 8), credentials.region)}`,
    ],
    ['X-Amz-Date', amz],
    ['X-Amz-Expires', String(input.expiresSeconds)],
    ['X-Amz-SignedHeaders', signed],
  ];
  const request = canonicalRequest({
    method: input.method,
    path: input.path,
    query,
    headers,
    payloadHash: UNSIGNED_PAYLOAD,
  });
  return `${canonicalQuery(query)}&X-Amz-Signature=${signature(credentials, amz, request)}`;
}

export interface HeaderSignInput {
  method: string;
  host: string;
  path: string;
  query?: readonly (readonly [string, string])[];
  /** Headers to send and sign besides `host`, `x-amz-date` and `x-amz-content-sha256`. */
  headers?: Readonly<Record<string, string>>;
  payloadHash: string;
  now: number;
}

/**
 * The headers of a request signed in its `Authorization` header (AWS's
 * "Signature Calculations for the Authorization Header"). `host` is signed
 * and not returned: `fetch` sends it from the URL.
 */
export function signedHeaders(
  credentials: SigningCredentials,
  input: HeaderSignInput,
): Record<string, string> {
  const amz = amzDate(input.now);
  const sent = {
    ...input.headers,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amz,
  };
  const headers = { host: input.host, ...sent };
  const request = canonicalRequest({
    method: input.method,
    path: input.path,
    query: input.query ?? [],
    headers,
    payloadHash: input.payloadHash,
  });
  const scope = credentialScope(amz.slice(0, 8), credentials.region);
  return {
    ...sent,
    authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope},SignedHeaders=${
      canonicalHeaders(headers).signed
    },Signature=${signature(credentials, amz, request)}`,
  };
}

// ---------------------------------------------------------------- the client

/**
 * The store could not be reached, or would not answer (§6.3's `unavailable`).
 * Its own words never come with it.
 */
export class StoreUnavailableError extends ApiError {
  constructor(why: string) {
    super('unavailable', 'The file store could not be reached', {
      reason: 'store_unreachable',
      why,
    });
    this.name = 'StoreUnavailableError';
  }
}

/** What a presigned upload is: where, how, until when. */
export interface PresignedPut {
  url: string;
  method: 'PUT';
  /** Every header the browser must send exactly as given — the signature covers them. */
  headers: { 'content-type': string; 'content-disposition': string };
  expiresAt: number;
}

export interface PresignedGet {
  url: string;
  expiresAt: number;
}

/** What `HEAD` found, or `null` when the object is not there. */
export interface StoredObject {
  size: number;
}

export interface StoreClient {
  presignPut(
    key: string,
    object: { contentType: string; contentLength: number; contentDisposition: string },
    now: number,
  ): PresignedPut;
  presignGet(
    key: string,
    response: { contentType: string; contentDisposition: string },
    now: number,
  ): PresignedGet;
  head(key: string): Promise<StoredObject | null>;
  /**
   * The bytes put by Laika itself, header-signed with their SHA-256 — only
   * an inbound mail's attachment, which Brevo hands to the server and never
   * to a browser (D-155, LAI-1315).
   */
  put(
    key: string,
    body: Uint8Array,
    object: { contentType: string; contentDisposition: string },
  ): Promise<void>;
  /** Bytes `from`–`to` inclusive, or fewer when the object is shorter. */
  readRange(key: string, from: number, to: number): Promise<Uint8Array>;
  /** Removes the object; one that is already gone is not an error. */
  remove(key: string): Promise<void>;
}

export interface StoreClientOptions {
  store: AttachmentStoreEnv;
  fetchImpl?: typeof fetch | undefined;
  /** The clock header-signed requests are dated with; presigning takes `now` itself. */
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
}

/** At most `limit` bytes of a body, and the rest left unread. */
async function readUpTo(res: Response, limit: number): Promise<Uint8Array> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const out = new Uint8Array(limit);
  let filled = 0;
  try {
    while (filled < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, limit - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.slice(0, filled);
}

/** `/<bucket>/<key>` — the path-style object path, unencoded. */
function objectPath(bucket: string, key: string): string {
  return `/${bucket}/${key}`;
}

export function storeClient(options: StoreClientOptions): StoreClient {
  const { store } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  const origin = new URL(store.endpoint);
  const host = origin.host;
  const credentials: SigningCredentials = {
    accessKeyId: store.accessKeyId,
    secretAccessKey: store.secretAccessKey,
    region: store.region,
  };

  const urlOf = (path: string, query: string): string =>
    `${origin.origin}${uriEncode(path, true)}${query === '' ? '' : `?${query}`}`;

  /**
   * One header-signed request: the answer's status and headers, and — for a
   * `2xx` when `readBytes` is given — at most that many bytes of its body.
   * Nothing else of a body is read: an error's is the store's words.
   */
  async function send(
    method: 'HEAD' | 'GET' | 'DELETE' | 'PUT',
    key: string,
    extra: Record<string, string> = {},
    readBytes = 0,
    payload?: Uint8Array,
  ): Promise<{ status: number; headers: Headers; body: Uint8Array }> {
    const path = objectPath(store.bucket, key);
    const headers = signedHeaders(credentials, {
      method,
      host,
      path,
      headers: extra,
      // A body is signed by its digest, so the store refuses one changed in flight.
      payloadHash:
        payload === undefined ? EMPTY_SHA256 : createHash('sha256').update(payload).digest('hex'),
      now: clock(),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetchImpl(urlOf(path, ''), {
        method,
        headers,
        signal: controller.signal,
        ...(payload === undefined ? {} : { body: payload }),
      });
      // Read inside the timeout.
      const ok = res.status >= 200 && res.status < 300;
      const body = ok && readBytes > 0 ? await readUpTo(res, readBytes) : new Uint8Array();
      if (!(ok && readBytes > 0)) await res.body?.cancel();
      return { status: res.status, headers: res.headers, body };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      throw new StoreUnavailableError(timedOut ? 'timed out' : 'could not connect');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    presignPut(key, object, now) {
      const path = objectPath(store.bucket, key);
      const headers = {
        'content-type': object.contentType,
        'content-disposition': object.contentDisposition,
      };
      const query = presignQuery(credentials, {
        method: 'PUT',
        host,
        path,
        // `content-length` is signed and never returned: the browser sets it
        // from the file, and a different size is refused by the store.
        headers: { ...headers, 'content-length': String(object.contentLength) },
        now,
        expiresSeconds: PUT_EXPIRES_SECONDS,
      });
      return {
        url: urlOf(path, query),
        method: 'PUT',
        headers,
        expiresAt: now + PUT_EXPIRES_SECONDS * 1000,
      };
    },

    presignGet(key, response, now) {
      const path = objectPath(store.bucket, key);
      const query = presignQuery(credentials, {
        method: 'GET',
        host,
        path,
        query: [
          ['response-content-disposition', response.contentDisposition],
          ['response-content-type', response.contentType],
        ],
        now,
        expiresSeconds: GET_EXPIRES_SECONDS,
      });
      return { url: urlOf(path, query), expiresAt: now + GET_EXPIRES_SECONDS * 1000 };
    },

    async head(key) {
      const answer = await send('HEAD', key);
      if (answer.status === 404) return null;
      if (answer.status < 200 || answer.status >= 300) {
        throw new StoreUnavailableError(`HEAD answered ${String(answer.status)}`);
      }
      // Read as digits first: `Number(null)` is 0, so a store that sent no
      // length would otherwise read as an empty object — a size mismatch to
      // the caller, when it is the store failing to answer.
      const length = answer.headers.get('content-length');
      const size = length !== null && /^\d+$/.test(length) ? Number(length) : NaN;
      if (!Number.isSafeInteger(size)) {
        throw new StoreUnavailableError('HEAD answered no size');
      }
      return { size };
    },

    async readRange(key, from, to) {
      const want = to - from + 1;
      const answer = await send('GET', key, { range: `bytes=${String(from)}-${String(to)}` }, want);
      if (answer.status !== 206 && answer.status !== 200) {
        throw new StoreUnavailableError(`GET answered ${String(answer.status)}`);
      }
      // A store that ignored the range answers `200` and the whole object;
      // `readUpTo` stopped reading it after the bytes asked for.
      return answer.body;
    },

    async put(key, body, object) {
      const answer = await send(
        'PUT',
        key,
        {
          'content-type': object.contentType,
          'content-disposition': object.contentDisposition,
        },
        0,
        body,
      );
      if (answer.status < 200 || answer.status >= 300) {
        throw new StoreUnavailableError(`PUT answered ${String(answer.status)}`);
      }
    },

    async remove(key) {
      const answer = await send('DELETE', key);
      if (answer.status === 404 || (answer.status >= 200 && answer.status < 300)) return;
      throw new StoreUnavailableError(`DELETE answered ${String(answer.status)}`);
    },
  };
}
