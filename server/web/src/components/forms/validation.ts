/**
 * Client-side validation. Pure functions, no React, no network.
 *
 * Client-side only, by design (LAI-021 AC8): this catches typos before a round
 * trip, it is **not** a security boundary. The server validates independently,
 * and anything enforced only here is not enforced.
 *
 * Every message names what to fix. "Invalid input" tells the reader they are
 * wrong without telling them how to stop being wrong.
 */

export type Validity = { readonly ok: true } | { readonly ok: false; readonly message: string };

const OK: Validity = { ok: true };

function fail(message: string): Validity {
  return { ok: false, message };
}

export function required(value: string, fieldName: string): Validity {
  return value.trim() === '' ? fail(`${fieldName} is required.`) : OK;
}

/**
 * Deliberately permissive: something, an `@`, something with a dot.
 *
 * Full RFC 5322 in a regex is a famous mistake — it rejects addresses that work
 * and accepts ones that do not. The only authority on whether an address is
 * real is whether mail reaches it, so this catches "no @ at all" and gets out
 * of the way.
 */
export function email(value: string): Validity {
  const trimmed = value.trim();
  if (trimmed === '') return fail('Email is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return fail('That does not look like an email address — check for a missing @ or domain.');
  }
  return OK;
}

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Length first, and length mostly.
 *
 * Composition rules ("one uppercase, one symbol") push people towards
 * `Password1!` and are worse than length. Argon2id (SPEC §13.1) is what makes a
 * long passphrase safe.
 */
export function password(value: string): Validity {
  if (value === '') return fail('Password is required.');
  if (value.length < MIN_PASSWORD_LENGTH) {
    const missing = MIN_PASSWORD_LENGTH - value.length;
    return fail(
      `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters — ${String(missing)} more to go.`,
    );
  }
  return OK;
}

export function passwordsMatch(value: string, confirmation: string): Validity {
  if (confirmation === '') return fail('Confirm your password.');
  return value === confirmation ? OK : fail('The two passwords do not match.');
}

/** Strength bands, for the meter. Not a gate — `password()` is the gate. */
export type Strength = 'weak' | 'fair' | 'good' | 'strong';

export interface StrengthResult {
  readonly band: Strength;
  /** 0–4, for the meter's filled segments. */
  readonly score: number;
  /** What would most improve it. Empty once strong. */
  readonly hint: string;
}

const COMMON = new Set([
  'password',
  'password123',
  'letmein',
  'qwerty',
  'welcome',
  'changeme',
  'admin',
  'laika',
]);

/**
 * Length-dominant scoring with a variety bonus, and a hard floor for anything
 * on the common list — a 16-character `passwordpassword` is not strong.
 */
export function strength(value: string): StrengthResult {
  if (value === '') return { band: 'weak', score: 0, hint: '' };

  const normalised = value.toLowerCase();
  if (COMMON.has(normalised)) {
    return { band: 'weak', score: 0, hint: 'That is one of the first passwords anyone tries.' };
  }

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(value)).length;
  const length = value.length;

  if (length < MIN_PASSWORD_LENGTH) {
    return {
      band: 'weak',
      score: 1,
      hint: `Length helps more than symbols — aim for ${String(MIN_PASSWORD_LENGTH)}+ characters.`,
    };
  }

  // Length dominates, and at this length it decides on its own. `password()`
  // already argues that a long passphrase beats a short jumble; scoring
  // `correct horse battery staple` as merely "fair" because it is all
  // lowercase would contradict the advice the field itself gives.
  if (length >= 24) return { band: 'strong', score: 4, hint: '' };
  if (length >= 20 && classes >= 2) return { band: 'strong', score: 4, hint: '' };
  if (classes >= 3) return { band: 'strong', score: 4, hint: '' };
  if (classes === 2) {
    return { band: 'good', score: 3, hint: 'A longer passphrase would make this stronger.' };
  }
  return { band: 'fair', score: 2, hint: 'Try a few unrelated words rather than one.' };
}
