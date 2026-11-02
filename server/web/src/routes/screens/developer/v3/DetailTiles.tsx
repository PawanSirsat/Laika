import type { ReactNode } from 'react';

export interface DetailTile {
  readonly label: string;
  readonly value: ReactNode;
  /** A `data-detail` hook naming the tile. */
  readonly id?: string;
}

/**
 * Labels over values, two to a row (LAI-1078) — the design's *Project ·
 * Target instructions*, *Device · Type*. A description list, so a screen
 * reader hears each label with its value.
 */
export function DetailTiles({ items }: { readonly items: readonly DetailTile[] }) {
  return (
    <dl className="dx-details">
      {items.map((item) => (
        <div className="dx-detail" key={item.label} data-detail={item.id}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
