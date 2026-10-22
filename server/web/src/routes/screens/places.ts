/**
 * Where a person is (LAI-895, D-106): a short list of places, each keyed by
 * its IANA zone, with the latitude and longitude the Timeline's sky is
 * computed from. The key is what the server stores (`user_time_settings.place`);
 * the figures live here, so a place is one line to add.
 *
 * The list is deliberately one place a zone, the zone's capital or largest
 * city: the sky it gives is right to a few minutes across that zone, which is
 * all a tint behind the hours needs.
 */

export interface Place {
  /** The IANA zone, and the key stored. */
  readonly key: string;
  readonly city: string;
  readonly country: string;
  readonly lat: number;
  readonly lng: number;
}

export const PLACES: readonly Place[] = [
  { key: 'Asia/Kolkata', city: 'New Delhi', country: 'India', lat: 28.61, lng: 77.21 },
  { key: 'Asia/Colombo', city: 'Colombo', country: 'Sri Lanka', lat: 6.93, lng: 79.85 },
  { key: 'Asia/Kathmandu', city: 'Kathmandu', country: 'Nepal', lat: 27.72, lng: 85.32 },
  { key: 'Asia/Dhaka', city: 'Dhaka', country: 'Bangladesh', lat: 23.81, lng: 90.41 },
  { key: 'Asia/Karachi', city: 'Karachi', country: 'Pakistan', lat: 24.86, lng: 67.01 },
  { key: 'Asia/Dubai', city: 'Dubai', country: 'United Arab Emirates', lat: 25.2, lng: 55.27 },
  { key: 'Asia/Riyadh', city: 'Riyadh', country: 'Saudi Arabia', lat: 24.71, lng: 46.68 },
  { key: 'Asia/Tehran', city: 'Tehran', country: 'Iran', lat: 35.69, lng: 51.39 },
  { key: 'Asia/Jerusalem', city: 'Jerusalem', country: 'Israel', lat: 31.77, lng: 35.21 },
  { key: 'Asia/Singapore', city: 'Singapore', country: 'Singapore', lat: 1.35, lng: 103.82 },
  { key: 'Asia/Kuala_Lumpur', city: 'Kuala Lumpur', country: 'Malaysia', lat: 3.14, lng: 101.69 },
  { key: 'Asia/Jakarta', city: 'Jakarta', country: 'Indonesia', lat: -6.21, lng: 106.85 },
  { key: 'Asia/Bangkok', city: 'Bangkok', country: 'Thailand', lat: 13.76, lng: 100.5 },
  { key: 'Asia/Manila', city: 'Manila', country: 'Philippines', lat: 14.6, lng: 120.98 },
  { key: 'Asia/Hong_Kong', city: 'Hong Kong', country: 'Hong Kong', lat: 22.32, lng: 114.17 },
  { key: 'Asia/Shanghai', city: 'Shanghai', country: 'China', lat: 31.23, lng: 121.47 },
  { key: 'Asia/Seoul', city: 'Seoul', country: 'South Korea', lat: 37.57, lng: 126.98 },
  { key: 'Asia/Tokyo', city: 'Tokyo', country: 'Japan', lat: 35.68, lng: 139.69 },
  { key: 'Australia/Perth', city: 'Perth', country: 'Australia', lat: -31.95, lng: 115.86 },
  { key: 'Australia/Melbourne', city: 'Melbourne', country: 'Australia', lat: -37.81, lng: 144.96 },
  { key: 'Australia/Sydney', city: 'Sydney', country: 'Australia', lat: -33.87, lng: 151.21 },
  { key: 'Pacific/Auckland', city: 'Auckland', country: 'New Zealand', lat: -36.85, lng: 174.76 },
  {
    key: 'Africa/Johannesburg',
    city: 'Johannesburg',
    country: 'South Africa',
    lat: -26.2,
    lng: 28.05,
  },
  { key: 'Africa/Nairobi', city: 'Nairobi', country: 'Kenya', lat: -1.29, lng: 36.82 },
  { key: 'Africa/Lagos', city: 'Lagos', country: 'Nigeria', lat: 6.52, lng: 3.38 },
  { key: 'Africa/Cairo', city: 'Cairo', country: 'Egypt', lat: 30.04, lng: 31.24 },
  { key: 'Africa/Casablanca', city: 'Casablanca', country: 'Morocco', lat: 33.57, lng: -7.59 },
  { key: 'Europe/Istanbul', city: 'Istanbul', country: 'Türkiye', lat: 41.01, lng: 28.98 },
  { key: 'Europe/Moscow', city: 'Moscow', country: 'Russia', lat: 55.76, lng: 37.62 },
  { key: 'Europe/Warsaw', city: 'Warsaw', country: 'Poland', lat: 52.23, lng: 21.01 },
  { key: 'Europe/Stockholm', city: 'Stockholm', country: 'Sweden', lat: 59.33, lng: 18.07 },
  { key: 'Europe/Berlin', city: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.41 },
  { key: 'Europe/Amsterdam', city: 'Amsterdam', country: 'Netherlands', lat: 52.37, lng: 4.9 },
  { key: 'Europe/Zurich', city: 'Zurich', country: 'Switzerland', lat: 47.38, lng: 8.54 },
  { key: 'Europe/Rome', city: 'Rome', country: 'Italy', lat: 41.9, lng: 12.5 },
  { key: 'Europe/Paris', city: 'Paris', country: 'France', lat: 48.86, lng: 2.35 },
  { key: 'Europe/Madrid', city: 'Madrid', country: 'Spain', lat: 40.42, lng: -3.7 },
  { key: 'Europe/Lisbon', city: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 },
  { key: 'Europe/Dublin', city: 'Dublin', country: 'Ireland', lat: 53.35, lng: -6.26 },
  { key: 'Europe/London', city: 'London', country: 'United Kingdom', lat: 51.51, lng: -0.13 },
  { key: 'America/Sao_Paulo', city: 'São Paulo', country: 'Brazil', lat: -23.55, lng: -46.63 },
  {
    key: 'America/Argentina/Buenos_Aires',
    city: 'Buenos Aires',
    country: 'Argentina',
    lat: -34.6,
    lng: -58.38,
  },
  { key: 'America/Santiago', city: 'Santiago', country: 'Chile', lat: -33.45, lng: -70.67 },
  { key: 'America/Lima', city: 'Lima', country: 'Peru', lat: -12.05, lng: -77.04 },
  { key: 'America/Bogota', city: 'Bogotá', country: 'Colombia', lat: 4.71, lng: -74.07 },
  { key: 'America/Mexico_City', city: 'Mexico City', country: 'Mexico', lat: 19.43, lng: -99.13 },
  { key: 'America/New_York', city: 'New York', country: 'United States', lat: 40.71, lng: -74.01 },
  { key: 'America/Toronto', city: 'Toronto', country: 'Canada', lat: 43.65, lng: -79.38 },
  { key: 'America/Chicago', city: 'Chicago', country: 'United States', lat: 41.88, lng: -87.63 },
  { key: 'America/Denver', city: 'Denver', country: 'United States', lat: 39.74, lng: -104.99 },
  {
    key: 'America/Los_Angeles',
    city: 'Los Angeles',
    country: 'United States',
    lat: 34.05,
    lng: -118.24,
  },
  { key: 'America/Vancouver', city: 'Vancouver', country: 'Canada', lat: 49.28, lng: -123.12 },
  { key: 'Pacific/Honolulu', city: 'Honolulu', country: 'United States', lat: 21.31, lng: -157.86 },
];

/** The place a key names, or none: an unknown key draws no sky. */
export function placeOf(key: string | null | undefined): Place | undefined {
  if (key === null || key === undefined) return undefined;
  return PLACES.find((p) => p.key === key);
}

/** `New Delhi, India`. */
export function placeLabel(place: Place): string {
  return `${place.city}, ${place.country}`;
}
