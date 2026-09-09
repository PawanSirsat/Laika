import { type AiProvider } from '../db/enums.ts';
import { ApiError } from '../errors.ts';

/**
 * The org's LLM provider (SPEC §12, §10.2, LAI-450).
 *
 * **The one place data leaves the instance.** Everything about this module is
 * shaped by that: what it sends is built by the caller and asserted by a test,
 * it has a timeout, and it never retries — a retry doubles an outbound copy of
 * somebody's project data and doubles the bill.
 *
 * **No SDK** (LAI-450's Notes). One provider is `anthropic` and one is
 * `openai_compatible`; both are HTTP and `fetch` is in the runtime. An SDK here
 * would be a dependency that decides retry and telemetry behaviour on our behalf.
 */

/**
 * Long enough for a real completion, short enough that a hung provider does not
 * hold a request open until something else times out.
 *
 * §10.2 answers `202` and the work is not user-facing, so the caller is a
 * machine that can retry — waiting minutes buys nothing and holds a connection.
 */
export const PROVIDER_TIMEOUT_MS = 30_000;

export interface ProviderConfig {
  provider: AiProvider;
  baseUrl: string | null;
  apiKey: string | null;
}

/** What §10.2 sends. Built by the caller so a test can assert it exactly. */
export interface ProviderRequest {
  prompt: string;
}

/**
 * A provider that cannot be reached is **not a crash** and not `internal`.
 *
 * `unavailable` (§6.3) says *"this server cannot do that right now"*, which is
 * exactly true and tells a caller to try later — where `internal` says Laika has
 * a bug and invites a report. The distinction is LAI-437's, one layer out: a
 * dependency being down is not the same fault as our code being wrong.
 */
export class ProviderUnavailableError extends ApiError {
  constructor(reason: string) {
    super('unavailable', 'The AI provider could not be reached', { reason });
    this.name = 'ProviderUnavailableError';
  }
}

/** The model returned something that is not the §10.2 shape. */
export class ProviderResponseError extends ApiError {
  constructor(reason: string) {
    super('unprocessable', 'The AI provider returned something unusable', { reason });
    this.name = 'ProviderResponseError';
  }
}

export interface ProviderClient {
  complete(request: ProviderRequest): Promise<string>;
}

/**
 * The real client. Injectable at the service boundary, so **no test in this repo
 * makes an outbound call** — a suite that can reach the network is a suite that
 * fails differently on a train.
 */
export function httpProviderClient(
  config: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): ProviderClient {
  return {
    async complete(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const res = await fetchImpl(endpointFor(config), {
          method: 'POST',
          headers: headersFor(config),
          body: JSON.stringify(bodyFor(config, request)),
          signal: controller.signal,
        });

        if (!res.ok) {
          // The provider's own body is not echoed: it is a third party's error
          // text on its way to a Laika user, and §13.1 keeps other people's
          // detail out of our responses.
          throw new ProviderUnavailableError(`provider answered ${String(res.status)}`);
        }

        return textFrom(config, await res.json());
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // `AbortError`, DNS failure, connection refused — all the same fault
        // from a caller's point of view, and none of them is our bug.
        throw new ProviderUnavailableError(
          err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'could not connect',
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function endpointFor(config: ProviderConfig): string {
  if (config.provider === 'anthropic') return 'https://api.anthropic.com/v1/messages';

  // §12 requires a base URL for `openai_compatible`, and LAI-447 refuses to
  // store one without it — so this cannot be null in practice, and throwing
  // rather than defaulting keeps it that way.
  if (config.baseUrl === null || config.baseUrl === '') {
    throw new ProviderUnavailableError('openai_compatible has no base URL');
  }
  return `${config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
}

function headersFor(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (config.provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (config.apiKey !== null) headers['x-api-key'] = config.apiKey;
    return headers;
  }

  // Optional for `openai_compatible` — §12 covers Ollama and vLLM, which are
  // commonly unauthenticated on a private network.
  if (config.apiKey !== null) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function bodyFor(config: ProviderConfig, request: ProviderRequest): unknown {
  const message = { role: 'user', content: request.prompt };

  return config.provider === 'anthropic'
    ? { model: 'claude-sonnet-4-5', max_tokens: 4096, messages: [message] }
    : { model: 'default', messages: [message] };
}

/** Pull the text out of whichever envelope the provider used. */
function textFrom(config: ProviderConfig, body: unknown): string {
  const root = body as {
    content?: { text?: unknown }[];
    choices?: { message?: { content?: unknown } }[];
  };

  const text =
    config.provider === 'anthropic' ? root.content?.[0]?.text : root.choices?.[0]?.message?.content;

  if (typeof text !== 'string' || text === '') {
    throw new ProviderResponseError('no text in the provider response');
  }
  return text;
}
