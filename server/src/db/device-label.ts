/** Shared by grouping, confirmation and the one-time migration (LAI-590). */
export function deviceLabelKey(label: string | null): string {
  return label?.trim().toLowerCase() ?? '';
}
