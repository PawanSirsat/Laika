import type { RegisteredAgent } from './agents.ts';
import { request } from './client.ts';

/**
 * The owner's devices (SPEC §4.78; API by LAI-1045, screen by LAI-1054).
 *
 * A device is a row of its own now, not only the label its agents share:
 * **imported** from those labels when the board upgraded, or **paired** by
 * the CLI later (plan LAI-1042 slice C). Its agents — a tool on that device
 * each — come with it, revoked ones included. Mirrors `DeviceView` in
 * `server/src/services/devices.ts`; `view-type-drift.test.ts` holds the two
 * together.
 *
 * Owner only: another person's device is the same `404` as none.
 */

export const DEVICE_KINDS = ['local', 'cloud'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const DEVICE_ORIGINS = ['imported', 'paired'] as const;
export type DeviceOrigin = (typeof DEVICE_ORIGINS)[number];

export const DEVICE_STATUSES = ['active', 'revoked'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export interface Device {
  readonly id: string;
  readonly display_name: string;
  /** The normalised label; `null` is the unnamed device, as `/agents/devices` keys it. */
  readonly device_label: string | null;
  readonly kind: DeviceKind;
  readonly origin: DeviceOrigin;
  readonly status: DeviceStatus;
  /** The owner said it is theirs — here, or by its label on `/agents/devices/confirm`. */
  readonly confirmed: boolean;
  readonly confirmed_at: number | null;
  readonly paired_at: number | null;
  /** Shown to people to compare; not a secret. `null` until the device is paired. */
  readonly key_fingerprint: string | null;
  /** The newest of the device's own and its agents' last-seen times. */
  readonly last_seen_at: number | null;
  readonly active_count: number;
  readonly revoked_count: number;
  /** Its agents, newest first, active and revoked — the shapes `GET /agents` sends. */
  readonly agents: readonly RegisteredAgent[];
  readonly created_at: number;
  readonly revoked_at: number | null;
}

/** Every device at once: the server never pages them. */
export function listDevices(signal?: AbortSignal): Promise<{ data: Device[] }> {
  return request<{ data: Device[] }>('/devices', signal === undefined ? {} : { signal });
}

/**
 * Rename one of your active devices (LAI-1095, §4.78): every tool on it is
 * relabelled with it, and the device comes back whole. Session only; a name
 * another of your active devices holds is `409 device_name_taken`.
 */
export function renameDevice(id: string, displayName: string): Promise<Device> {
  return request<Device>(`/devices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { display_name: displayName },
  });
}
