import { describe, expect, it } from 'vitest';
import {
  httpProviderClient,
  PROVIDER_TIMEOUT_MS,
  type ProviderConfig,
  ProviderResponseError,
  ProviderUnavailableError,
} from '../../src/services/provider.ts';

/**
 * The org's LLM provider (§12, §10.2, LAI-450).
 *
 * **No test here makes an outbound call.** `fetch` is injected, which is the
 * point of injecting it: a suite that can reach the network fails differently on
 * a train, and this is the one module whose whole job is to leave the machine.
 */

const ANTHROPIC: ProviderConfig = {
  provider: 'anthropic',
  baseUrl: null,
  apiKey: 'sk-ant-0123',
};
const OLLAMA: ProviderConfig = {
  provider: 'openai_compatible',
  baseUrl: 'http://ollama.internal:11434',
  apiKey: null,
};

function respond(body: unknown, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
}

/**
 * Capture what would have gone over the wire.
 *
 * The reply has to match the **config being tested**, not Anthropic's shape by
 * default — the first version answered an Anthropic envelope to an
 * `openai_compatible` client, which threw `ProviderResponseError` and made two
 * tests fail for a reason that had nothing to do with what they asserted.
 */
function capture(config: ProviderConfig): {
  calls: { url: string; init: RequestInit }[];
  fetch: typeof fetch;
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const body =
    config.provider === 'anthropic'
      ? { content: [{ text: '{"proposals":[]}' }] }
      : { choices: [{ message: { content: '{"proposals":[]}' } }] };

  const impl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as unknown as typeof fetch;

  return { calls, fetch: impl };
}

describe('reaching the provider', () => {
  it('reads anthropic’s envelope', async () => {
    const client = httpProviderClient(ANTHROPIC, respond({ content: [{ text: 'hello' }] }));

    expect(await client.complete({ prompt: 'p' })).toBe('hello');
  });

  it('reads an openai-compatible envelope', async () => {
    const client = httpProviderClient(
      OLLAMA,
      respond({ choices: [{ message: { content: 'hello' } }] }),
    );

    expect(await client.complete({ prompt: 'p' })).toBe('hello');
  });

  it('sends the key the way each provider wants it', async () => {
    const anthropic = capture(ANTHROPIC);
    await httpProviderClient(ANTHROPIC, anthropic.fetch).complete({ prompt: 'p' });

    const headers = anthropic.calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-0123');
    expect(headers['anthropic-version']).toBeDefined();
    // Not the other scheme: a key sent as a bearer to Anthropic simply fails,
    // and one sent both ways is a key in two places.
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends no Authorization header when there is no key', async () => {
    // §12 covers Ollama and vLLM, which are commonly unauthenticated on a
    // private network. `Bearer null` would be worse than nothing.
    const seen = capture(OLLAMA);
    await httpProviderClient(OLLAMA, seen.fetch).complete({ prompt: 'p' });

    expect((seen.calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('a provider that will not answer is not a crash', () => {
  it('is unavailable, not internal, when the connection fails', async () => {
    // LAI-437's distinction one layer out: a dependency being down is not the
    // same fault as our code being wrong, and `internal` invites a bug report.
    const client = httpProviderClient(ANTHROPIC, () => Promise.reject(new Error('ECONNREFUSED')));

    await expect(client.complete({ prompt: 'p' })).rejects.toThrow(ProviderUnavailableError);
  });

  it('is unavailable when the provider answers 500', async () => {
    const client = httpProviderClient(ANTHROPIC, respond({ error: 'boom' }, 500));

    await expect(client.complete({ prompt: 'p' })).rejects.toThrow(ProviderUnavailableError);
  });

  it('does not echo the provider’s own error text', async () => {
    // §13.1 keeps other people's detail out of our responses, and a third
    // party's error body on its way to a Laika user is exactly that.
    const client = httpProviderClient(
      ANTHROPIC,
      respond({ error: 'quota-exhausted-for-acct-99' }, 429),
    );

    await expect(client.complete({ prompt: 'p' })).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('acct-99') as unknown }),
    );
  });

  it('times out rather than holding the request open', async () => {
    // **The fake has to honour the signal**, because that is what the real
    // `fetch` does and what the timeout relies on. The first version ignored it
    // and simply never resolved, so the test hit vitest's own timeout at five
    // seconds — passing nothing and proving nothing about the abort.
    const hang = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      })) as unknown as typeof fetch;
    const client = httpProviderClient(ANTHROPIC, hang, 20);

    await expect(client.complete({ prompt: 'p' })).rejects.toThrow(ProviderUnavailableError);
  });

  it('has a timeout at all, and it is not minutes', () => {
    // The constant, asserted: a hung provider holding a connection until some
    // other layer gives up is the failure this bounds.
    expect(PROVIDER_TIMEOUT_MS).toBeGreaterThan(1_000);
    expect(PROVIDER_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it('refuses a response with no text in it', async () => {
    const client = httpProviderClient(ANTHROPIC, respond({ content: [] }));

    await expect(client.complete({ prompt: 'p' })).rejects.toThrow(ProviderResponseError);
  });

  it('refuses openai_compatible with no base URL', async () => {
    const client = httpProviderClient({ ...OLLAMA, baseUrl: null }, capture(OLLAMA).fetch);

    await expect(client.complete({ prompt: 'p' })).rejects.toThrow(ProviderUnavailableError);
  });
});
