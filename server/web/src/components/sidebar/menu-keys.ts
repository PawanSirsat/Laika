/**
 * Where a key moves the focus in a menu of `count` items, from `index` (`-1`
 * for none), or `undefined` when the key is not a move (LAI-796, the user
 * menu). The WAI-ARIA menu pattern: the arrows step and wrap, Home and End
 * jump to the ends.
 */
export function menuStep(count: number, index: number, key: string): number | undefined {
  if (count === 0) return undefined;
  switch (key) {
    case 'ArrowDown':
      return index < 0 ? 0 : (index + 1) % count;
    case 'ArrowUp':
      return index <= 0 ? count - 1 : index - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
