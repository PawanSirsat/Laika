import { type TeamsPostReason } from '../db/enums.ts';
import { ApiError } from '../errors.ts';
import { teamsPayload, type TeamsNotice } from './teams-message.ts';

/**
 * Posting to a space's Teams channel through its Power Automate webhook
 * (D-154, LAI-1314).
 *
 * **One of the few places data leaves the instance** (§13.4), so it follows
 * `services/provider.ts` and `clan-client.ts`: no SDK, an injectable
 * `fetchImpl` so **no test makes a real call**, a timeout on every request
 * cleared in `finally`, and **Teams' answer never read, echoed or logged** —
 * only its status. Redirects are not followed: a webhook that answers `3xx` is
 * refused, never chased to wherever it points.
 *
 * **No retry here.** One post is one request. Whether a later tick may try a
 * scheduled post again is the caller's decision, made from the reason this
 * answers — and a post that may have arrived (`no_answer`) is never sent
 * twice: a duplicate in a client's channel cannot be unsent, a gap is a row
 * somebody can read (KSage's `delivery.rs`, *"A timeout is not retried"*).
 */

/** Ten seconds, KSage's: long enough for a cold flow, short enough that a tick of many spaces ends. */
export const TEAMS_TIMEOUT_MS = 10_000;

export interface TeamsClientDeps {
  /** Injected by every test: **no test calls Teams**. */
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

/** What one request came to. Never Teams' body. */
export type TeamsSendResult =
  | { readonly outcome: 'sent'; readonly httpStatus: number }
  | {
      readonly outcome: 'failed';
      readonly reason: Extract<
        TeamsPostReason,
        'refused' | 'unavailable' | 'unreachable' | 'no_answer'
      >;
      readonly httpStatus: number | null;
    };

/** The failures a later attempt at the same slot may try again: nothing reached Teams, or it said *not now*. */
export function isRetryable(reason: TeamsPostReason | null): boolean {
  return reason === 'unavailable' || reason === 'unreachable';
}

/**
 * The hosts a Power Automate or Teams webhook lives on.
 *
 * A Power Automate trigger URL is `https://….logic.azure.com/workflows/…`
 * (classic) or `https://….environment.api.powerplatform.com/powerautomate/…`
 * (the current one; KSage's organisation-wide address is on it); a Teams
 * *Incoming Webhook* is `https://….webhook.office.com/…`. **Nothing else**:
 * the posting job sends a space's work to this address every minute, and an
 * address an owner can point at `localhost`, a metadata service or an
 * internal host is a way to make the server send requests there.
 */
const TEAMS_HOST_SUFFIXES = ['.logic.azure.com', '.powerplatform.com', '.webhook.office.com'];

function refuse(message: string, reason: 'webhook_url_invalid' | 'webhook_url_not_https'): never {
  throw new ApiError('unprocessable', message, { field: 'webhook_url', reason });
}

/** A checked address, with what a screen may show of it. */
export interface TeamsWebhookAddress {
  /** As given, trimmed: the address is posted to exactly as Power Automate made it. */
  readonly url: string;
  readonly host: string;
  readonly last4: string;
}

/**
 * Check a pasted webhook address — `https:`, no user or password, on the
 * default port, on one of {@link TEAMS_HOST_SUFFIXES} — and say what may be
 * shown of it. A refusal is `422` with `{ field: 'webhook_url', reason }`.
 *
 * The query is kept: Power Automate's `sig=` is in it, and it is the
 * credential. The address is **not** normalised — the flow is called exactly
 * as Power Automate wrote it.
 */
export function checkTeamsWebhookUrl(input: string): TeamsWebhookAddress {
  const url = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    refuse('webhook_url is not a URL', 'webhook_url_invalid');
  }
  if (parsed.protocol !== 'https:') {
    refuse('webhook_url must be an https address', 'webhook_url_not_https');
  }
  // `URL` lower-cases the host, writes an IP literal canonically — never under
  // one of the suffixes — and drops a default `:443`.
  const host = parsed.hostname;
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    !TEAMS_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  ) {
    refuse(
      'webhook_url must be a Power Automate or Teams webhook address (logic.azure.com, powerplatform.com or webhook.office.com)',
      'webhook_url_invalid',
    );
  }
  if (url.length > 2000) refuse('webhook_url is too long', 'webhook_url_invalid');
  return { url, host, last4: url.slice(-4) };
}

/** Whether a stored address still passes {@link checkTeamsWebhookUrl} — asked before every post. */
export function isTeamsWebhookUrl(url: string): boolean {
  try {
    return checkTeamsWebhookUrl(url).url === url;
  } catch {
    return false;
  }
}

/** A failure before any answer: did the connection never happen, or may the post have arrived? */
function classifyThrown(err: unknown, timedOut: boolean): TeamsSendResult {
  if (timedOut) return { outcome: 'failed', reason: 'no_answer', httpStatus: null };
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  // Refused, unresolvable, or never connected: nothing left this process.
  const neverConnected =
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH';
  // Anything else — a connection dropped mid-exchange — is ambiguous, and the
  // safe reading of ambiguous is *do not send it again*.
  return neverConnected
    ? { outcome: 'failed', reason: 'unreachable', httpStatus: null }
    : { outcome: 'failed', reason: 'no_answer', httpStatus: null };
}

/**
 * Post one notice. Never throws for anything Teams or the network did: the
 * answer is the outcome, to be recorded.
 */
export async function sendToTeams(
  url: string,
  notice: TeamsNotice,
  deps: TeamsClientDeps = {},
): Promise<TeamsSendResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? TEAMS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: teamsPayload(notice),
      redirect: 'manual',
      signal: controller.signal,
    });
    // Read nothing of it, and let the connection go.
    await response.body?.cancel().catch(() => undefined);

    const status = response.status;
    if (status >= 200 && status < 300) return { outcome: 'sent', httpStatus: status };
    // 408, 429 and 5xx are *not now*: nothing was delivered, so a later
    // attempt cannot duplicate it. Every other answer is final.
    const notNow = status === 408 || status === 429 || status >= 500;
    return { outcome: 'failed', reason: notNow ? 'unavailable' : 'refused', httpStatus: status };
  } catch (err) {
    return classifyThrown(err, timedOut);
  } finally {
    clearTimeout(timer);
  }
}
