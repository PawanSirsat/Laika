import { atClock } from './my-day-derive.ts';

/**
 * Sunrise and sunset for a day at a place (LAI-895, D-106), as minutes after
 * that day's midnight in the day's own zone — the Timeline's own unit. The
 * plain sunrise equation: right to a few minutes, which is all a tint behind
 * the hours needs, and no dependency.
 */

export interface SunTimes {
  readonly rise: number;
  readonly set: number;
}

const RAD = Math.PI / 180;
const sin = (deg: number): number => Math.sin(deg * RAD);
const cos = (deg: number): number => Math.cos(deg * RAD);
const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;
const DAY_MS = 86_400_000;

/**
 * The sun's rise and set on `day` (`YYYY-MM-DD`) at latitude `lat` and
 * longitude `lng` (east positive), in `tz`. `undefined` where the sun does
 * not rise or does not set that day (a polar day or night), or where the
 * day's midnight cannot be placed.
 */
export function sunTimes(day: string, lat: number, lng: number, tz: string): SunTimes | undefined {
  const midnight = atClock(day, '00:00', tz);
  const [y, m, d] = day.split('-').map(Number);
  if (midnight === undefined || y === undefined || m === undefined || d === undefined) {
    return undefined;
  }
  // Days since J2000 to this date's noon UTC, then to mean solar noon here.
  const n = Date.UTC(y, m - 1, d, 12) / DAY_MS + UNIX_EPOCH_JD - J2000;
  const solar = n - lng / 360;
  const anomaly = (357.5291 + 0.98560028 * solar) % 360;
  const centre = 1.9148 * sin(anomaly) + 0.02 * sin(2 * anomaly) + 0.0003 * sin(3 * anomaly);
  const longitude = (anomaly + centre + 180 + 102.9372) % 360;
  const transit = J2000 + solar + 0.0053 * sin(anomaly) - 0.0069 * sin(2 * longitude);
  const declination = Math.asin(sin(longitude) * sin(23.4397)) / RAD;
  const cosHour = (sin(-0.833) - sin(lat) * sin(declination)) / (cos(lat) * cos(declination));
  if (cosHour > 1 || cosHour < -1) return undefined;
  const hour = Math.acos(cosHour) / RAD / 360;
  const toMinutes = (jd: number): number =>
    Math.round(((jd - UNIX_EPOCH_JD) * DAY_MS - midnight) / 60_000);
  return { rise: toMinutes(transit - hour), set: toMinutes(transit + hour) };
}

export type SkyKind = 'night' | 'dawn' | 'day' | 'dusk';

export interface SkyPhase {
  readonly kind: SkyKind;
  /** Minutes after the day's midnight. */
  readonly start: number;
  readonly end: number;
}

/** Half the blend at each edge of the day: the hour centred on sunrise, and on sunset. */
export const TWILIGHT = 30;

/**
 * The sky across `[from, to]` minutes: night, dawn (blending up to the sun),
 * day, dusk, night — each clipped to the axis, the empty ones left out.
 */
export function skyPhases(sun: SunTimes, from: number, to: number): SkyPhase[] {
  const edges: readonly (readonly [SkyKind, number, number])[] = [
    ['night', -Infinity, sun.rise - TWILIGHT],
    ['dawn', sun.rise - TWILIGHT, sun.rise + TWILIGHT],
    ['day', sun.rise + TWILIGHT, sun.set - TWILIGHT],
    ['dusk', sun.set - TWILIGHT, sun.set + TWILIGHT],
    ['night', sun.set + TWILIGHT, Infinity],
  ];
  const out: SkyPhase[] = [];
  for (const [kind, a, b] of edges) {
    const start = Math.max(from, a);
    const end = Math.min(to, b);
    if (end > start) out.push({ kind, start, end });
  }
  return out;
}

/** A sun before a daytime hour, a moon before a night one — as the design: the sun stays through dusk. */
export function glyphAt(sun: SunTimes, minute: number): 'sun' | 'moon' {
  return minute >= sun.rise - TWILIGHT && minute < sun.set + TWILIGHT ? 'sun' : 'moon';
}
