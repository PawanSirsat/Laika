import { request } from './client.ts';
import type { DeviceKind } from './devices.ts';

/**
 * Device pairing, the owner's side (SPEC §4.79, LAI-1050; screen by
 * LAI-1061, plan LAI-1042 §E.1).
 *
 * The browser asks for a code, shows it once, and waits: the device claims
 * the code with its new key, the owner compares the key's fingerprint with
 * what their terminal printed and approves it, and the device completes the
 * pairing by signing. **No credential passes through here** — the code binds
 * a key, it grants nothing, and nothing a tool uses is ever minted by it.
 *
 * Mirrors `DevicePairingView` and `CreatedPairingView` in
 * `server/src/services/device-pairing.ts`; `view-type-drift.test.ts` holds
 * the pairs together. The device's own side (`/device-pairing/*`) is the
 * CLI's, never this file's.
 */

export const PAIRING_STATES = [
  'open',
  'claimed',
  'approved',
  'completed',
  'denied',
  'expired',
  'cancelled',
] as const;
export type PairingState = (typeof PAIRING_STATES)[number];

export interface DevicePairing {
  readonly id: string;
  /** `expired` once ten minutes pass, whatever the stored state says. */
  readonly state: PairingState;
  readonly kind: DeviceKind;
  readonly display_name: string;
  /** The device being paired: chosen at create, or made at completion. */
  readonly device_id: string | null;
  /** What the device said when it claimed the code; null until then. */
  readonly claimed: {
    readonly key_fingerprint: string;
    readonly os: string | null;
    readonly cli_version: string | null;
    readonly claimed_at: number;
  } | null;
  readonly created_at: number;
  readonly expires_at: number;
  readonly decided_at: number | null;
  readonly completed_at: number | null;
}

export interface CreatedPairing {
  readonly pairing: DevicePairing;
  /** Shown once: only its hash is stored, and this page keeps it in memory only. */
  readonly user_code: string;
  /** `laika device pair --board <origin> --code <code>`, as the server builds it. */
  readonly command: string;
}

export interface NewPairing {
  readonly kind: DeviceKind;
  readonly display_name: string;
  /** Pair this imported device of yours, by explicit choice, rather than make one. */
  readonly device_id?: string;
}

export function createPairingRequest(body: NewPairing): Promise<CreatedPairing> {
  return request<CreatedPairing>('/devices/pairing-requests', { method: 'POST', body });
}

/**
 * Your own requests still waiting — open, claimed or approved, and not past
 * their ten minutes — newest first (D-139, LAI-1151). Each carries the
 * fingerprint approving echoes back, and never a code (D-124). Session only.
 */
export function listPendingPairingRequests(
  signal?: AbortSignal,
): Promise<{ data: DevicePairing[] }> {
  return request<{ data: DevicePairing[] }>(
    '/devices/pairing-requests',
    signal === undefined ? {} : { signal },
  );
}

export function getPairingRequest(id: string, signal?: AbortSignal): Promise<DevicePairing> {
  return request<DevicePairing>(
    `/devices/pairing-requests/${encodeURIComponent(id)}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Approve the key that was shown. `key_fingerprint` is **the one on screen**,
 * echoed back: a key that changed after the page drew it is refused
 * (`409 pairing_key_changed`) rather than approved by mistake.
 */
export function approvePairingRequest(id: string, keyFingerprint: string): Promise<DevicePairing> {
  return request<DevicePairing>(`/devices/pairing-requests/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: { key_fingerprint: keyFingerprint },
  });
}

export function denyPairingRequest(id: string, keyFingerprint: string): Promise<DevicePairing> {
  return request<DevicePairing>(`/devices/pairing-requests/${encodeURIComponent(id)}/deny`, {
    method: 'POST',
    body: { key_fingerprint: keyFingerprint },
  });
}

export function cancelPairingRequest(id: string): Promise<void> {
  return request<void>(`/devices/pairing-requests/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
