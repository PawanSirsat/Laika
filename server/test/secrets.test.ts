import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  SecretAuthError,
  SecretFormatError,
  type SecretPurpose,
} from '../src/secrets.ts';

/**
 * §12's secrets at rest (LAI-161).
 *
 * The properties here are the ones that fail **silently** when they are wrong.
 * AES-GCM with a reused nonce still produces ciphertext that decrypts; a tag
 * that is never checked still returns the right plaintext on the happy path.
 * Nothing in a round-trip test sees either.
 */

const SECRET = 'a-laika-secret-that-is-at-least-32-characters-long';
const OTHER = 'a-different-laika-secret-also-at-least-32-characters';
const PURPOSE: SecretPurpose = 'github_webhook_secret';

describe('round trip', () => {
  it('returns what it was given', () => {
    for (const plaintext of [
      'ghp_0123456789',
      '',
      'x'.repeat(10_000),
      '{"host":"smtp.example.test","port":587}',
      'ключ 🔐 clé',
    ]) {
      expect(decryptSecret(encryptSecret(plaintext, SECRET, PURPOSE), SECRET, PURPOSE)).toBe(
        plaintext,
      );
    }
  });

  it('does not contain the plaintext', () => {
    // The one thing a reader checks by eye, asserted so it stays true. A format
    // change that accidentally stored the plaintext alongside the ciphertext
    // would round-trip perfectly.
    const plaintext = 'ghp_secret_value_nobody_should_see';

    const stored = encryptSecret(plaintext, SECRET, PURPOSE);

    expect(stored).not.toContain(plaintext);
    expect(Buffer.from(stored.slice(3), 'base64url').toString('utf8')).not.toContain(plaintext);
  });
});

describe('the nonce is never reused', () => {
  it('encrypts the same plaintext to different ciphertexts', () => {
    // **The failure that is invisible from everywhere else.** A fixed nonce
    // under one key leaks the XOR of two plaintexts and the authentication key,
    // and every other test in this file still passes.
    const stored = Array.from({ length: 8 }, () => encryptSecret('same', SECRET, PURPOSE));

    expect(new Set(stored).size).toBe(stored.length);
    // And they all still decrypt, so the difference is the nonce rather than
    // something being broken.
    for (const one of stored) expect(decryptSecret(one, SECRET, PURPOSE)).toBe('same');
  });
});

describe('tampering is detected', () => {
  /** Flip one bit in the stored payload at `offset` bytes from its start. */
  function corrupt(stored: string, offset: number): string {
    const raw = Buffer.from(stored.slice(stored.indexOf('.') + 1), 'base64url');
    raw.writeUInt8(raw.readUInt8(offset) ^ 0x01, offset);
    return `${stored.slice(0, stored.indexOf('.'))}.${raw.toString('base64url')}`;
  }

  const stored = encryptSecret('ghp_0123456789', SECRET, PURPOSE);

  it('rejects a flipped nonce byte', () => {
    // Each case asserts the **error type**, not that something threw: a broken
    // setup throws too, and `toThrow()` alone cannot tell them apart (§5).
    expect(() => decryptSecret(corrupt(stored, 0), SECRET, PURPOSE)).toThrow(SecretAuthError);
  });

  it('rejects a flipped tag byte', () => {
    expect(() => decryptSecret(corrupt(stored, 12), SECRET, PURPOSE)).toThrow(SecretAuthError);
  });

  it('rejects a flipped ciphertext byte', () => {
    expect(() => decryptSecret(corrupt(stored, 28), SECRET, PURPOSE)).toThrow(SecretAuthError);
  });

  it('rejects a truncated payload as a format error, not an auth error', () => {
    // A different fault with a different fix — this one is a bug or a bad
    // migration, not a rotated key.
    expect(() => decryptSecret('v1.AAAA', SECRET, PURPOSE)).toThrow(SecretFormatError);
  });

  it('rejects an unknown version, naming what it found', () => {
    expect(() => decryptSecret('v2.AAAA', SECRET, PURPOSE)).toThrow(SecretFormatError);
    expect(() => decryptSecret('not-a-secret', SECRET, PURPOSE)).toThrow(SecretFormatError);
  });
});

describe('the key', () => {
  it('stops opening every secret when LAIKA_SECRET is rotated', () => {
    // **This is the rotation case, named as such.** There is no re-encryption
    // path, so changing the secret makes every stored value undecryptable — and
    // the columns stay non-null, so the instance still reports itself as
    // configured. `secrets.ts` says so; this is what says it stays true.
    const stored = {
      ai_api_key: encryptSecret('sk-ant-0123', SECRET, 'ai_api_key'),
      smtp_json: encryptSecret('{"host":"x"}', SECRET, 'smtp_json'),
      github_webhook_secret: encryptSecret('ghp_0123', SECRET, 'github_webhook_secret'),
      transcript_webhook_secret: encryptSecret('tr_0123', SECRET, 'transcript_webhook_secret'),
    } as const;

    for (const purpose of Object.keys(stored) as SecretPurpose[]) {
      // Not `SecretFormatError`: the row is well-formed. An operator who rotated
      // the secret needs to be told that, not "your database is corrupt".
      expect(() => decryptSecret(stored[purpose], OTHER, purpose), purpose).toThrow(
        SecretAuthError,
      );
      // And the old secret still opens them, so the failure is the key and not
      // the writing.
      expect(decryptSecret(stored[purpose], SECRET, purpose), purpose).toBeTypeOf('string');
    }
  });

  it('differs per purpose, so one column cannot decrypt another', () => {
    // The reason `info` exists. Without it a leaked webhook secret would be
    // enough to read the API key out of a stolen database file.
    const stored = encryptSecret('ghp_0123456789', SECRET, 'github_webhook_secret');

    expect(() => decryptSecret(stored, SECRET, 'ai_api_key')).toThrow(SecretAuthError);
    expect(() => decryptSecret(stored, SECRET, 'smtp_json')).toThrow(SecretAuthError);
  });

  it('is stable across calls, so yesterday’s ciphertext still opens', () => {
    // The other half of "derives a key": a derivation that mixed in anything
    // per-call would encrypt happily and never decrypt again.
    const stored = encryptSecret('ghp_0123456789', SECRET, PURPOSE);

    for (let i = 0; i < 3; i++)
      expect(decryptSecret(stored, SECRET, PURPOSE)).toBe('ghp_0123456789');
  });
});

describe('failures say nothing they should not', () => {
  it('never puts the plaintext, the key or the payload in a message', () => {
    const plaintext = 'ghp_secret_value_nobody_should_see';
    const stored = encryptSecret(plaintext, SECRET, PURPOSE);

    for (const [label, run] of [
      ['wrong key', () => decryptSecret(stored, OTHER, PURPOSE)],
      ['bad version', () => decryptSecret(`v9.${stored.slice(3)}`, SECRET, PURPOSE)],
    ] as const) {
      let message = '';
      try {
        run();
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }

      expect(message, label).not.toBe('');
      expect(message, label).not.toContain(plaintext);
      expect(message, label).not.toContain(SECRET);
      expect(message, label).not.toContain(OTHER);
      // The payload is the one part an attacker controls; echoing it back is how
      // an error message becomes an oracle.
      expect(message, label).not.toContain(stored.slice(3, 40));
    }
  });
});
