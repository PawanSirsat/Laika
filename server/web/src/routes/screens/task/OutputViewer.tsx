import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Dialog } from '../../../components/overlay/Dialog.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { FileGlyph } from './FileGlyph.tsx';
import type { OutputItem } from './outputs-derive.ts';

export interface OutputViewerProps {
  readonly items: readonly OutputItem[];
  /** Which one it opens on. */
  readonly start: number;
  readonly onClose: () => void;
}

/**
 * **The output viewer** (D-162, LAI-1352): one file at a time, as big as the
 * page allows — an image, a PDF, a recording that plays — and any other file
 * as a card to download. Previous and next, *2 / 6*, the caption, who it came
 * from, *Open in a new tab* and *Download*.
 *
 * The shared `Dialog`, so it keeps what every modal keeps: focus moves in,
 * stays in, and returns to the tile that opened it; Escape closes only the
 * top layer; a phone gets a sheet. ← and → step through, and wrap — a last
 * Next that disabled itself would drop the focus it held out of the dialog.
 */
export function OutputViewer({ items, start, onClose }: OutputViewerProps) {
  const count = items.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), count - 1));
  const item = items[index];
  if (item === undefined) return null;
  const many = count > 1;
  const step = (by: number): void => {
    setIndex((at) => (at + by + count) % count);
  };
  const position = `${String(index + 1)} / ${String(count)}`;
  // *2 / 6 · by Ada’s Claude Code · Belka* — whichever of the two there is.
  const about = [many ? position : null, item.by].filter((part) => part !== null).join(' · ');

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (!many || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // A recording's own controls seek with the arrows while they have focus.
    if (event.target instanceof HTMLMediaElement) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  return (
    <Dialog
      title={item.caption}
      description={about === '' ? undefined : about}
      size="lg"
      className="ovw"
      data={{ 'data-output-viewer': '', 'data-show': item.show }}
      onClose={onClose}
      onKeyDown={onKeyDown}
      initialFocus={(box) => box.querySelector<HTMLElement>('[data-ovw-step="next"]')}
    >
      {/* Said once per step, for a screen reader: where it is and what. */}
      <p className="visually-hidden" aria-live="polite">
        {many ? `${String(index + 1)} of ${String(count)}: ${item.caption}` : ''}
      </p>
      <div className="ovw-stage" data-show={item.show}>
        <OutputMedia key={item.id} item={item} />
      </div>
      <div className="ovw-bar">
        {many && (
          <span className="ovw-steps">
            <Tooltip content="Previous" shortcut="ArrowLeft">
              <button
                type="button"
                className="ovw-step"
                aria-label="Previous"
                data-ovw-step="previous"
                onClick={() => {
                  step(-1);
                }}
              >
                <Icon name="chevron-left" size="small" />
              </button>
            </Tooltip>
            <span className="ovw-count" aria-hidden="true">
              {position}
            </span>
            <Tooltip content="Next" shortcut="ArrowRight">
              <button
                type="button"
                className="ovw-step"
                aria-label="Next"
                data-ovw-step="next"
                onClick={() => {
                  step(1);
                }}
              >
                <Icon name="chevron" size="small" />
              </button>
            </Tooltip>
          </span>
        )}
        <span className="ovw-actions">
          <a
            className="button button-ghost button-sm ovw-action"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="expand" size="small" />
            Open in a new tab
          </a>
          <a
            className="button button-secondary button-sm ovw-action"
            href={item.url}
            download={item.filename ?? ''}
          >
            <Icon name="download" size="small" />
            Download
          </a>
        </span>
      </div>
    </Dialog>
  );
}

/** One file, drawn as the server lets the browser show it. */
function OutputMedia({ item }: { readonly item: OutputItem }) {
  const [failed, setFailed] = useState(false);
  if (failed || item.show === 'card') return <OutputCard item={item} blocked={false} />;
  if (item.show === 'image') {
    return (
      <img
        className="ovw-image"
        src={item.url}
        alt={item.caption}
        decoding="async"
        onError={() => {
          setFailed(true);
        }}
      />
    );
  }
  if (item.show === 'video') {
    return (
      <video
        className="ovw-video"
        src={item.url}
        controls
        playsInline
        preload="metadata"
        aria-label={item.caption}
        onError={() => {
          setFailed(true);
        }}
      />
    );
  }
  return <PdfFrame item={item} />;
}

/**
 * A PDF in a frame — the browser's own reader, no library (CLAUDE.md §5).
 *
 * The frame loads the file through the store's link (a 302), and a board
 * whose policy does not name the store under `frame-src` refuses it. That
 * refusal is a `securitypolicyviolation` on this document, so the frame
 * gives way to the download card rather than a blocked page.
 */
function PdfFrame({ item }: { readonly item: OutputItem }) {
  const [blocked, setBlocked] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const onViolation = (event: SecurityPolicyViolationEvent): void => {
      const directive = event.effectiveDirective || event.violatedDirective;
      if (!/^(frame|child|default)-src/.test(directive)) return;
      if (event.target !== frame.current && event.target !== document) return;
      setBlocked(true);
    };
    document.addEventListener('securitypolicyviolation', onViolation, true);
    return () => {
      document.removeEventListener('securitypolicyviolation', onViolation, true);
    };
  }, []);
  if (blocked) return <OutputCard item={item} blocked />;
  return <iframe ref={frame} className="ovw-frame" src={item.url} title={item.caption} />;
}

/** A file the page does not show: what it is, and the way to get it. */
function OutputCard({ item, blocked }: { readonly item: OutputItem; readonly blocked: boolean }) {
  return (
    <div className="ovw-card" data-kind={item.glyph}>
      <span className="ovw-card-glyph" aria-hidden="true">
        <FileGlyph kind={item.glyph} size={40} />
      </span>
      <span className="ovw-card-name">{item.filename ?? item.caption}</span>
      {item.size !== null && <span className="ovw-card-meta">{item.size}</span>}
      <span className="ovw-card-note">
        {blocked
          ? 'This board does not show PDFs inside the page. Open it in a new tab, or download it.'
          : 'This file opens outside the board. Download it, or open it in a new tab.'}
      </span>
    </div>
  );
}
