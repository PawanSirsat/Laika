import { useState } from 'react';
import { groupOverflow, overflowWords } from '../../../components/avatar/avatar-model.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { FileGlyph } from './FileGlyph.tsx';
import { OutputViewer } from './OutputViewer.tsx';
import type { OutputItem } from './outputs-derive.ts';
import './outputs.css';

export interface OutputsStripProps {
  readonly items: readonly OutputItem[];
  /** What the strip is, for a screen reader: *Outputs of round 2*. */
  readonly label: string;
  /** Tiles before the *+N*, which counts as one of them (Avatar's `groupOverflow`). */
  readonly max?: number;
}

/**
 * **A strip of outputs** (D-162, LAI-1352): a tile per file — an image's own
 * picture, scaled down and loaded only as it nears the screen; any other file
 * its glyph — with the caption under it, and a *+N* for the rest. A tile
 * opens the viewer on its file, and *+N* on the first one it stands for.
 *
 * No thumbnails are made on the server (phase 1): an image tile is the image
 * itself, drawn small. On a phone the strip scrolls sideways and snaps to a
 * tile, as the KPI row does, rather than wrapping into a wall.
 */
export function OutputsStrip({ items, label, max = 5 }: OutputsStripProps) {
  const [open, setOpen] = useState<number | null>(null);
  const { shown, extra } = groupOverflow(items.length, max);
  const rest = items.slice(shown);
  return (
    <>
      <ul className="out-strip" aria-label={label}>
        {items.slice(0, shown).map((item, at) => (
          <li key={item.id} className="out-cell">
            <OutputTile
              item={item}
              onOpen={() => {
                setOpen(at);
              }}
            />
          </li>
        ))}
        {extra > 0 && (
          <li className="out-cell">
            <Tooltip content={overflowWords(rest.map((item) => item.caption))} lazy>
              <button
                type="button"
                className="out-tile out-more"
                aria-label={`Open the other ${String(extra)}: ${rest.map((item) => item.caption).join(', ')}`}
                onClick={() => {
                  setOpen(shown);
                }}
              >
                <span className="out-thumb out-more-count">{`+${String(extra)}`}</span>
                <span className="out-caption">more</span>
              </button>
            </Tooltip>
          </li>
        )}
      </ul>
      {open !== null && (
        <OutputViewer
          items={items}
          start={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

/** One file: its picture or its glyph, and its caption. */
function OutputTile({ item, onOpen }: { readonly item: OutputItem; readonly onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const picture = item.show === 'image' && !broken;
  return (
    <Tooltip content={item.by === null ? item.caption : `${item.caption} — ${item.by}`} lazy>
      <button
        type="button"
        className="out-tile"
        data-output={item.id}
        data-kind={item.kind}
        aria-label={item.caption}
        onClick={onOpen}
      >
        <span className="out-thumb" data-glyph={picture ? undefined : item.glyph}>
          {picture ? (
            <img
              src={item.url}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => {
                setBroken(true);
              }}
            />
          ) : (
            <FileGlyph kind={item.glyph} size={22} />
          )}
          {item.show === 'video' && <span className="out-play" aria-hidden="true" />}
        </span>
        <span className="out-caption">{item.caption}</span>
      </button>
    </Tooltip>
  );
}
