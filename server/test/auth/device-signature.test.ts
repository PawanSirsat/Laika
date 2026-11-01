import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  keyFingerprint,
  pairingMessage,
  parseDevicePublicKey,
  verifyDeviceSignature,
} from '../../src/auth/device-signature.ts';

/**
 * A device's Ed25519 key, as pairing reads it (§4.79, LAI-1050). The HTTP
 * half is `test/http/routes/device-pairing.test.ts`.
 */

function ed25519() {
  const pair = generateKeyPairSync('ed25519');
  return {
    encoded: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: pair.privateKey,
  };
}

describe('parseDevicePublicKey', () => {
  it('reads a base64url SPKI DER Ed25519 key', () => {
    expect(parseDevicePublicKey(ed25519().encoded)?.asymmetricKeyType).toBe('ed25519');
  });

  it('refuses every other key and every non-canonical spelling', () => {
    const { encoded } = ed25519();
    const x25519 = generateKeyPairSync('x25519')
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64url');
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64url');
    for (const bad of [
      x25519,
      ec,
      `${encoded}=`,
      `${encoded}AA`,
      Buffer.from(encoded, 'base64url').toString('base64'),
      encoded.slice(0, -4),
      '',
      'not a key',
    ]) {
      expect(parseDevicePublicKey(bad), bad).toBeNull();
    }
  });
});

describe('keyFingerprint', () => {
  it('is 16 hex characters, stable for one key and different for another', () => {
    const a = ed25519().encoded;
    expect(keyFingerprint(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(keyFingerprint(a)).toBe(keyFingerprint(a));
    expect(keyFingerprint(a)).not.toBe(keyFingerprint(ed25519().encoded));
  });
});

describe('verifyDeviceSignature', () => {
  const message = pairingMessage('01PAIR', 'nonce', 'https://board.example');

  it('accepts the key’s signature over exactly that message', () => {
    const { encoded, privateKey } = ed25519();
    const key = parseDevicePublicKey(encoded);
    expect(key).not.toBeNull();
    const signature = sign(null, message, privateKey).toString('base64url');
    expect(verifyDeviceSignature(key!, message, signature)).toBe(true);
  });

  it('refuses another key, another message, another board, and junk', () => {
    const { encoded, privateKey } = ed25519();
    const key = parseDevicePublicKey(encoded)!;
    const other = ed25519().privateKey;
    const sig = (m: Buffer, k = privateKey) => sign(null, m, k).toString('base64url');
    expect(verifyDeviceSignature(key, message, sig(message, other))).toBe(false);
    expect(
      verifyDeviceSignature(
        key,
        message,
        sig(pairingMessage('01PAIR', 'n2', 'https://board.example')),
      ),
    ).toBe(false);
    expect(
      verifyDeviceSignature(
        key,
        message,
        sig(pairingMessage('01PAIR', 'nonce', 'https://evil.example')),
      ),
    ).toBe(false);
    for (const junk of ['', 'AAAA', '!!!', 'A'.repeat(86)]) {
      expect(verifyDeviceSignature(key, message, junk), junk).toBe(false);
    }
  });
});
