import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Secrets at rest — AES-256-GCM under a key derived from `LAIKA_SECRET` (§12).
 *
 * Flat, for the same reason `errors.ts` is: `services/` encrypts and
 * `http/routes/` decrypts, and `services/` may not import `http/`.
 *
 * ## What §12 asks for
 *
 * > Secrets are encrypted at rest with **AES-256-GCM** under a key derived from
 * > `LAIKA_SECRET` … Ciphertext lives in `orgs.*_enc`; plaintext is never
 * > logged, never returned by the API … and never written to `activity`.
 *
 * Three columns are declared for it — `ai_api_key_enc`, `smtp_json_enc`,
 * `github_webhook_secret_enc` — and until now nothing wrote or read one.
 *
 * ## `LAIKA_SECRET` cannot be rotated, and that is written down rather than
 * discovered
 *
 * Changing it changes every derived key, so **every stored secret stops
 * decrypting** — `SecretAuthError`, from the moment the new value is read. There
 * is no re-encryption path here and building one is not this module's job: it
 * needs both the old and the new secret present at once, which is a deployment
 * procedure before it is code.
 *
 * **The sharp edge is that the instance still looks configured.** The columns
 * are non-null, so `configured: true`, and every *use* fails. That is LAI-437's
 * family — an infrastructure fault reading as an absence — which is why
 * `decryptSecret` throws two named errors rather than returning `null`, and why
 * `SecretAuthError`'s message names the rotation as the first thing to check.
 *
 * **`LAIKA_SECRET` also signs session cookies** (`env.ts`), so rotating it
 * already signs everybody out. An operator who does it is not expecting a quiet
 * day; they are expecting to be told what else broke.
 *
 * So today the answer is: **re-enter the secrets after a rotation.** The version
 * prefix below is what keeps a real rotation procedure possible later — LAI-162.
 */

/**
 * **`LAIKA_SECRET` is a passphrase, not a key.**
 *
 * §11.7 requires at least 32 *characters*, which is not 32 bytes of entropy and
 * is not the right length or distribution for AES-256. Using it directly as key
 * material would also mean every column shares one key.
 *
 * HKDF-SHA256 fixes both: it expands the passphrase to exactly 32 bytes, and its
 * `info` parameter gives each column its own key for free. `node:crypto` has it,
 * so this costs no dependency.
 */
const KEY_BYTES = 32;

/**
 * **The salt is fixed, and that is a decision rather than an oversight.**
 *
 * A random salt has to be stored beside the ciphertext, and it buys what a
 * random salt is for: stopping one precomputed table attacking many secrets.
 * There is one `LAIKA_SECRET` per instance and one instance per deployment
 * (D-002), so there is no population to protect — and per-column separation,
 * which is the property actually wanted here, comes from `info` instead.
 *
 * It is a constant string rather than empty so that a future scheme can change
 * it and mean something by it.
 */
const SALT = Buffer.from('laika/secrets/v1');

/**
 * Which column a key is for.
 *
 * A closed union rather than a free string: `info` selects the key, so a typo
 * would derive a *different, valid* key and fail to decrypt at some later date
 * with no clue why. This makes that a compile error.
 */
export type SecretPurpose =
  'ai_api_key' | 'smtp_json' | 'github_webhook_secret' | 'transcript_webhook_secret';

/**
 * `v1.` and then base64url of `nonce ‖ tag ‖ ciphertext`.
 *
 * **Versioned as text, deliberately.** A format with no version cannot be
 * changed later without a migration that has no way to tell the two apart, and
 * a prefix that is readable in a database column means an operator can see
 * which scheme a row uses without decoding anything. The version is *outside*
 * the authenticated blob, which is safe here because it selects the parser
 * rather than any parameter: an attacker who rewrites it gets a parse failure,
 * not a weaker cipher.
 */
const VERSION = 'v1';
/** GCM's standard nonce. 96 bits is what the mode is specified around. */
const NONCE_BYTES = 12;
/** GCM's tag. Truncating it weakens authentication and is not worth the bytes. */
const TAG_BYTES = 16;

/** Something claiming to be a Laika secret is not one, or is a version we do not know. */
export class SecretFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretFormatError';
  }
}

/**
 * The ciphertext did not authenticate.
 *
 * **Wrong key and tampered row are the same GCM failure and cannot be told
 * apart** — that is what authentication means. Named separately from
 * `SecretFormatError` because the *responses* differ: a format error is a bug or
 * a hand-edited row, while this one is "either `LAIKA_SECRET` changed or someone
 * wrote to your database".
 *
 * Neither may be reported as "no secret configured". That is LAI-437's family:
 * an infrastructure failure rendered as an absence sends the operator to set a
 * value that is already there.
 */
export class SecretAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretAuthError';
  }
}

function keyFor(secret: string, purpose: SecretPurpose): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), SALT, purpose, KEY_BYTES));
}

/**
 * Plaintext → the string to store in an `*_enc` column.
 *
 * A fresh nonce every call. **Reusing one under the same key is the failure that
 * breaks GCM completely** — it leaks the XOR of two plaintexts and, worse, the
 * authentication key — and it is silent: the ciphertext looks fine and decrypts
 * correctly. `test/secrets.test.ts` asserts two encryptions of one plaintext
 * differ, which is the only cheap way to see it.
 */
export function encryptSecret(plaintext: string, secret: string, purpose: SecretPurpose): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, purpose), nonce);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return `${VERSION}.${Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64url')}`;
}

/**
 * The stored string → plaintext, or a throw.
 *
 * Never returns `null` for a failure. A caller that cannot tell "no secret" from
 * "the secret would not decrypt" will report the second as the first, and §12's
 * columns are nullable precisely so absence has its own representation.
 */
export function decryptSecret(stored: string, secret: string, purpose: SecretPurpose): string {
  const dot = stored.indexOf('.');
  const version = dot === -1 ? '' : stored.slice(0, dot);
  if (version !== VERSION) {
    // The value, never the plaintext or the key — and not the payload either,
    // which is the only part an attacker controls.
    throw new SecretFormatError(`Not a ${VERSION} secret (found ${JSON.stringify(version)})`);
  }

  const raw = Buffer.from(stored.slice(dot + 1), 'base64url');
  if (raw.length < NONCE_BYTES + TAG_BYTES) {
    throw new SecretFormatError('Secret is too short to contain a nonce and a tag');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(secret, purpose),
    raw.subarray(0, NONCE_BYTES),
  );
  decipher.setAuthTag(raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));

  try {
    return Buffer.concat([
      decipher.update(raw.subarray(NONCE_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // `final()` is where GCM checks the tag. The driver's message says
    // "Unsupported state or unable to authenticate data", which tells an
    // operator nothing; this says what to look at.
    throw new SecretAuthError(
      'Stored secret failed authentication — LAIKA_SECRET has changed, or the row was altered',
    );
  }
}
