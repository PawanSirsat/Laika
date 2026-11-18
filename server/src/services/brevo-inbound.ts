/**
 * Brevo's API, for one thing only: an inbound mail's attachment, by the
 * download token the inbound webhook announced (D-155, LAI-1315). Brevo posts
 * a mail's text and never its files; each file is fetched once, here, with the
 * organisation's Brevo API key, and put in the D-150 store.
 *
 * **One fixed origin.** The key goes in the `api-key` header to
 * `https://api.brevo.com` and nowhere else — the token is one path segment,
 * checked and encoded, so no announced value can send the key to another host
 * or another of Brevo's paths.
 *
 * **Bounded.** At most `maxBytes` are read: a `Content-Length` over it is
 * `too_large` before a byte is read, and so is a body that runs past it, with
 * the rest never read. Brevo's error bodies are never read or passed on.
 *
 * **Uncompressed, or its length disbelieved.** `fetch` asks for gzip unless
 * told otherwise, and inflates what it gets while `Content-Length` keeps the
 * compressed size. So it asks for `identity`; and a body that comes compressed
 * anyway is read by what arrives, never by its declared length — which also
 * bounds a gzip bomb at `maxBytes`.
 */

/** Where Brevo's API is. Fixed: the key is never sent anywhere else. */
export const BREVO_API_ORIGIN = 'https://api.brevo.com';

/**
 * A `DownloadToken` Laika will put in a Brevo URL: one path segment that
 * resolves to itself (LAI-1315 F1). Brevo does not say what its tokens are made
 * of; the one published sample begins `eyJ0eXAiOi`, a JWT, so base64url and its
 * dots are let through — and the two dot segments, `.` and `..`, are not, since
 * a URL resolves `/v3/inbound/attachments/..` to `/v3/inbound/`. No `/`, no
 * `%`: nothing else in a segment resolves.
 */
export const DOWNLOAD_TOKEN = /^(?!\.{1,2}$)[A-Za-z0-9_.=-]{1,2048}$/;

/** How long one fetch may take, headers and body. */
export const BREVO_TIMEOUT_MS = 30_000;

/** Brevo would not hand the file over: its status, or why there was none. */
export class BrevoFetchError extends Error {
  // Fields, not parameter properties, which Node's type stripping cannot load
  // (the concurrency tests' workers run with it).
  readonly why: string;
  readonly status: number | null;

  constructor(why: string, status: number | null) {
    super(`Brevo did not hand over the attachment: ${why}`);
    this.name = 'BrevoFetchError';
    this.why = why;
    this.status = status;
  }
}

/** The buffer a body of no declared length starts in. */
const FIRST_BUFFER_BYTES = 64 * 1024;

/** A `Content-Length` as a byte count, or null when there is none to believe. */
function declaredLength(header: string | null): number | null {
  if (header === null || !/^\d{1,15}$/.test(header.trim())) return null;
  return Number(header.trim());
}

/** The file's bytes, or word that it is over the board's limit. */
export type FetchedAttachment =
  { readonly kind: 'bytes'; readonly bytes: Uint8Array } | { readonly kind: 'too_large' };

export interface BrevoFetchOptions {
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

/** `GET /v3/inbound/attachments/{downloadToken}` (Brevo's API reference). */
export async function fetchInboundAttachment(
  apiKey: string,
  downloadToken: string,
  maxBytes: number,
  options: BrevoFetchOptions = {},
): Promise<FetchedAttachment> {
  // The parser queues no other token; asked again here, where the key is sent.
  if (!DOWNLOAD_TOKEN.test(downloadToken)) {
    throw new BrevoFetchError('not a download token', null);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? BREVO_TIMEOUT_MS);
  try {
    const res = await fetchImpl(
      `${BREVO_API_ORIGIN}/v3/inbound/attachments/${encodeURIComponent(downloadToken)}`,
      {
        method: 'GET',
        headers: { 'api-key': apiKey, accept: '*/*', 'accept-encoding': 'identity' },
        redirect: 'error',
        signal: controller.signal,
      },
    );
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => undefined);
      throw new BrevoFetchError(`answered ${String(res.status)}`, res.status);
    }
    // A length over the limit is refused before a byte is read — unless the
    // body came compressed, when the length is the compressed one and says
    // nothing about what will be read.
    const encoding = res.headers.get('content-encoding')?.trim().toLowerCase() ?? '';
    const declared =
      encoding === '' || encoding === 'identity'
        ? declaredLength(res.headers.get('content-length'))
        : null;
    if (declared !== null && declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: 'too_large' };
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader();
    if (reader === undefined) return { kind: 'bytes', bytes: new Uint8Array() };
    // One buffer, written as the body arrives — not every chunk held and then
    // copied whole (F2). Sized to the declared length when there is one;
    // otherwise grown, never past `maxBytes`.
    let buffer = new Uint8Array(declared ?? Math.min(maxBytes, FIRST_BUFFER_BYTES));
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total + value.length > maxBytes) return { kind: 'too_large' };
        if (total + value.length > buffer.length) {
          if (declared !== null)
            throw new BrevoFetchError('sent more than it declared', res.status);
          const grown = new Uint8Array(
            Math.min(maxBytes, Math.max(buffer.length * 2, total + value.length)),
          );
          grown.set(buffer.subarray(0, total));
          buffer = grown;
        }
        buffer.set(value, total);
        total += value.length;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return { kind: 'bytes', bytes: buffer.subarray(0, total) };
  } catch (err) {
    if (err instanceof BrevoFetchError) throw err;
    const timedOut = err instanceof Error && err.name === 'AbortError';
    throw new BrevoFetchError(timedOut ? 'timed out' : 'could not connect', null);
  } finally {
    clearTimeout(timer);
  }
}
