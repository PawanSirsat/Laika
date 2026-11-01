/** Shared by grouping, confirmation and the one-time migration (LAI-590). */
export function deviceLabelKey(label: string | null): string {
  return label?.trim().toLowerCase() ?? '';
}

/** What a device is called: the devices list's rule (LAI-590), kept by `devices` (LAI-1045). */
export function deviceDisplayName(label: string | null): string {
  return deviceLabelKey(label) === '' ? 'Unnamed device' : (label ?? '').trim();
}
