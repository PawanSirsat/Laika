import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

/**
 * A device's Ed25519 key, as pairing reads it (§4.79, LAI-1050; plan LAI-1042
 * §E.1). Node's built-in `crypto` only.
 *
 * A public key is not secret. Holding the **private** half is what a device
 * proves, by signing the server's challenge; nothing here is a credential,
 * and nothing here is an `Actor`.
 */

/** Ed25519's SPKI DER is always this long: a 12-byte header and the 32-byte key. */
const ED25519_SPKI_BYTES = 44;
const ED25519_SIGNATURE_BYTES = 64;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Parse a base64url SPKI DER Ed25519 public key, or `null`. Only the canonical
 * encoding is accepted, so one key has exactly one spelling: a key re-encoded
 * with padding or trailing bytes is refused rather than compared unequal.
 */
export function parseDevicePublicKey(encoded: string): KeyObject | null {
  if (!BASE64URL.test(encoded)) return null;
  const der = Buffer.from(encoded, 'base64url');
  if (der.length !== ED25519_SPKI_BYTES || der.toString('base64url') !== encoded) return null;
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return null;
  }
  if (key.asymmetricKeyType !== 'ed25519') return null;
  return key;
}

/** What a person compares: sha256 of the SPKI DER, its first 16 hex characters. */
export function keyFingerprint(encoded: string): string {
  return createHash('sha256').update(Buffer.from(encoded, 'base64url')).digest('hex').slice(0, 16);
}

/**
 * The bytes a device signs to complete pairing. The board's origin is in it,
 * so a signature made for one board is no use at another.
 */
export function pairingMessage(pairingId: string, nonce: string, boardOrigin: string): Buffer {
  return Buffer.from(`laika-pair-v1\n${pairingId}\n${nonce}\n${boardOrigin}`, 'utf8');
}

/** Whether `signature` (base64url) is the key's Ed25519 signature over `message`. */
export function verifyDeviceSignature(key: KeyObject, message: Buffer, signature: string): boolean {
  if (!BASE64URL.test(signature)) return false;
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.length !== ED25519_SIGNATURE_BYTES) return false;
  try {
    return verify(null, message, key, bytes);
  } catch {
    return false;
  }
}

/**
 * The bytes a paired device signs to redeem a tool setup exchange (§4.80,
 * LAI-1056). Its own prefix, so a pairing signature is never a redeem one;
 * the exchange, the device and the board's origin are all in it, so a
 * signature for one is no use for any other.
 */
export function toolRedeemMessage(
  exchangeId: string,
  deviceId: string,
  challenge: string,
  boardOrigin: string,
): Buffer {
  return Buffer.from(
    `laika-tool-redeem-v1\n${exchangeId}\n${deviceId}\n${challenge}\n${boardOrigin}`,
    'utf8',
  );
}
