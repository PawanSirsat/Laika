/**
 * Which class a glass surface takes (LAI-1132), kept out of the component so
 * `node --test` can check it — it cannot import a `.tsx`.
 */

export type GlassLevel = 1 | 2 | 3;

/**
 * A surface inside another glass surface never blurs: a nested blur only
 * frosts its parent's pane, at twice the cost. It takes the opaque
 * solid-on-glass surface instead.
 */
export function glassClass(
  level: GlassLevel,
  nested: boolean,
  opts: {
    readonly interactive?: boolean | undefined;
    readonly selected?: boolean | undefined;
  } = {},
): string {
  return [
    nested ? 'glass-solid' : `glass-${String(level)}`,
    opts.interactive === true ? 'glass-interactive' : '',
    opts.selected === true ? 'glass-selected' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');
}
