/**
 * Brevo's API, for one thing only: an inbound mail's attachment, by the
 * download token the inbound webhook announced (D-155, LAI-1315). Brevo posts
 * a mail's text and never its files; each file is fetched once, here, with the
 * organisation's Brevo API key, and put in the D-150 store.
 *
 * **One fixed origin.** The key goes in the `api-key` header to
 * `https://api.brevo.com` and nowhere else — the token is a path segment,
 * encoded, so no announced value can send the key to another host.
 *
 * **Bounded.** At most `maxBytes` are read: a file Brevo's estimate called
 * small and the body says otherwise is `too_large`, and the rest is never
 * read. Brevo's error bodies are never read or passed on.
 */

/** Where Brevo's API is. Fixed: the key is never sent anywhere else. */
export const BREVO_API_ORIGIN = 'https://api.brevo.com';

/** How long one fetch may take, headers and body. */
export const BREVO_TIMEOUT_MS = 30_000;

/** Brevo would not hand the file over: its status, or why there was none. */
export class BrevoFetchError extends Error {
  constructor(
    readonly why: string,
    readonly status: number | null,
  ) {
    super(`Brevo did not hand over the attachment: ${why}`);
    this.name = 'BrevoFetchError';
  }
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
        headers: { 'api-key': apiKey, accept: '*/*' },
        redirect: 'error',
        signal: controller.signal,
      },
    );
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => undefined);
      throw new BrevoFetchError(`answered ${String(res.status)}`, res.status);
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader();
    if (reader === undefined) return { kind: 'bytes', bytes: new Uint8Array() };
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) return { kind: 'too_large' };
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { kind: 'bytes', bytes };
  } catch (err) {
    if (err instanceof BrevoFetchError) throw err;
    const timedOut = err instanceof Error && err.name === 'AbortError';
    throw new BrevoFetchError(timedOut ? 'timed out' : 'could not connect', null);
  } finally {
    clearTimeout(timer);
  }
}
