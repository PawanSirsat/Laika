import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../../../components/forms/Button.tsx';
import { Dialog } from '../../../components/overlay/Dialog.tsx';
import { spaceColor, type SpaceColor } from '../../../theme/space-color.ts';
import {
  backgroundLabel,
  drawRect,
  FRAME_BACKGROUNDS,
  FRAME_PX,
  type FrameBackground,
  type ImageSize,
  keyPlacement,
  MAX_ZOOM,
  moveBy,
  outputSize,
  type Placement,
  smallerExport,
  START,
  zoomTo,
} from './icon-frame.ts';
import { onRadioGroupKeyDown, radioTabIndex } from './radio-keys.ts';

export interface IconFrameEditorProps {
  /** The picked image, as the person chose it — any size; it is cropped here. */
  readonly file: Blob;
  /** The space, for the Space colour background and the previews. */
  readonly space: { readonly slug: string; readonly color: string | null };
  readonly onCancel: () => void;
  /** The cropped square, PNG or WebP, at most 512 pixels and 1 MiB. */
  readonly onUse: (image: Blob) => void;
}

/**
 * The fill a background paints into the cropped image, or `null` for none.
 * White and black are the image's own pixels, stored and shown the same in
 * every theme — not a colour of the page, so not a theme token; the space's
 * colour is read from the theme, as this theme paints it.
 */
function fillOf(background: FrameBackground, color: SpaceColor): string | null {
  if (background === 'transparent') return null;
  if (background === 'white') return 'white';
  if (background === 'black') return 'black';
  // The space's colour as this theme paints it — the same token every mark uses.
  return getComputedStyle(document.documentElement).getPropertyValue(`--space-${color}`).trim();
}

/** Draw the frame's square, `size` device pixels across, onto `canvas`. */
function paint(
  canvas: HTMLCanvasElement | null,
  size: number,
  image: ImageBitmap,
  placement: Placement,
  fill: string | null,
): void {
  if (canvas === null) return;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.clearRect(0, 0, size, size);
  if (fill !== null) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);
  }
  const at = drawRect(placement, image, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, at.x, at.y, at.width, at.height);
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, 0.92);
  });
}

/**
 * Adjust a picked logo in its square before it becomes the icon (LAI-1321,
 * the owner's ask): drag to place it, zoom from the whole image fitted up to
 * 4× (slider, wheel or pinch), choose what fills the square where the logo
 * does not, and see it as a mark at sidebar and settings size. Arrows move
 * it, `+` and `-` zoom, `0` resets — from the keyboard alone.
 *
 * *Use this* crops on this side with a canvas — a square of at most 512
 * pixels, PNG or WebP whichever is smaller, never over the server's megabyte —
 * and hands it to the Icon row, which stages it until Save changes. Cancel
 * changes nothing. The geometry is `icon-frame.ts`, tested on its own.
 */
export function IconFrameEditor({ file, space, onCancel, onUse }: IconFrameEditorProps) {
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [placement, setPlacement] = useState<Placement>(START);
  const [background, setBackground] = useState<FrameBackground>('transparent');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const smallRef = useRef<HTMLCanvasElement | null>(null);
  const largeRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const helpId = useId();
  const zoomId = useId();
  const backgroundId = useId();
  const color = spaceColor({ slug: space.slug, color: space.color });

  useEffect(() => {
    let cancelled = false;
    let opened: ImageBitmap | null = null;
    createImageBitmap(file)
      .then((bitmap) => {
        opened = bitmap;
        if (cancelled) bitmap.close();
        else setImage(bitmap);
      })
      .catch(() => {
        if (!cancelled) setUnreadable(true);
      });
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [file]);

  // Redraw the frame and both previews whenever anything about them changes.
  useEffect(() => {
    if (image === null) return;
    const fill = fillOf(background, color);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    paint(frameRef.current, Math.round(FRAME_PX * dpr), image, placement, fill);
    paint(smallRef.current, Math.round(18 * dpr), image, placement, fill);
    paint(largeRef.current, Math.round(64 * dpr), image, placement, fill);
  }, [image, placement, background, color]);

  const size: ImageSize = image ?? { width: 1, height: 1 };

  // The wheel zooms; registered by hand because React's wheel listener is passive.
  useEffect(() => {
    const box = boxRef.current;
    if (box === null || image === null) return;
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      setPlacement((p) => zoomTo(p, p.zoom * Math.exp(-event.deltaY * 0.002), image));
    };
    box.addEventListener('wheel', wheel, { passive: false });
    return () => {
      box.removeEventListener('wheel', wheel);
    };
  }, [image]);

  const down = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const held = pointers.current;
    const was = held.get(event.pointerId);
    if (was === undefined || image === null) return;
    const now = { x: event.clientX, y: event.clientY };
    if (held.size === 1) {
      setPlacement((p) => moveBy(p, now.x - was.x, now.y - was.y, image));
    } else if (held.size === 2) {
      // A pinch: the zoom follows the distance between the two fingers.
      const other = [...held.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other !== undefined) {
        const before = Math.hypot(was.x - other.x, was.y - other.y);
        const after = Math.hypot(now.x - other.x, now.y - other.y);
        if (before > 0) setPlacement((p) => zoomTo(p, (p.zoom * after) / before, image));
      }
    }
    held.set(event.pointerId, now);
  };

  const up = (event: PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
  };

  const use = useCallback(async (): Promise<void> => {
    if (image === null) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const out = document.createElement('canvas');
      paint(out, outputSize(image, placement.zoom), image, placement, fillOf(background, color));
      const png = await toBlob(out, 'image/png');
      if (png === null) throw new Error('no image');
      const best = smallerExport(png, await toBlob(out, 'image/webp'));
      if (best === null) {
        setProblem('That image is too detailed to fit in 1 MB — zoom in, or pick a simpler one.');
        return;
      }
      onUse(best);
    } catch {
      setProblem('The image could not be prepared. Try another one.');
    } finally {
      setBusy(false);
    }
  }, [image, placement, background, color, onUse]);

  return (
    <Dialog
      title="Adjust the logo"
      description="Drag it into place and zoom to fit. What falls outside the square is cut off."
      size="lg"
      onClose={onCancel}
      busy={busy}
      backdropCloses={false}
      className="ss-frame-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-action="frame-cancel">
            Cancel
          </Button>
          <Button
            busy={busy}
            disabled={image === null}
            onClick={() => {
              void use();
            }}
            data-action="frame-use"
          >
            Use this
          </Button>
        </>
      }
    >
      {unreadable ? (
        <p className="ss-field-error" role="alert">
          That file could not be read as an image.
        </p>
      ) : (
        <div className="ss-frame">
          <div className="ss-frame-work">
            <div
              ref={boxRef}
              className="ss-frame-box"
              data-background={background}
              tabIndex={0}
              role="group"
              aria-label="Logo position"
              aria-describedby={helpId}
              data-frame
              data-zoom={placement.zoom.toFixed(2)}
              data-x={placement.x.toFixed(1)}
              data-y={placement.y.toFixed(1)}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onKeyDown={(event) => {
                if (image === null) return;
                const next = keyPlacement(placement, event.key, event.shiftKey, image);
                if (next === null) return;
                event.preventDefault();
                setPlacement(next);
              }}
            >
              <canvas ref={frameRef} className="ss-frame-canvas" aria-hidden="true" />
            </div>
            <p className="ss-help" id={helpId}>
              Drag, or use the arrow keys, to move it; + and − zoom; 0 starts again.
            </p>
          </div>

          <div className="ss-frame-controls">
            <label className="ss-label" htmlFor={zoomId}>
              Zoom
            </label>
            <input
              id={zoomId}
              className="ss-frame-zoom"
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={placement.zoom}
              disabled={image === null}
              data-frame-zoom
              onChange={(event) => {
                const zoom = Number(event.currentTarget.value);
                setPlacement((p) => zoomTo(p, zoom, size));
              }}
            />

            <span className="ss-label" id={backgroundId}>
              Background
            </span>
            <div
              className="ss-frame-backgrounds"
              role="radiogroup"
              aria-labelledby={backgroundId}
              onKeyDown={onRadioGroupKeyDown}
            >
              {FRAME_BACKGROUNDS.map((option, index) => {
                const on = option === background;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={radioTabIndex(on, index, true)}
                    className={on ? 'ss-frame-bg ss-frame-bg-on' : 'ss-frame-bg'}
                    data-frame-background={option}
                    data-color={option === 'space' ? color : undefined}
                    onClick={() => {
                      setBackground(option);
                    }}
                  >
                    <span
                      className="ss-frame-bg-swatch"
                      aria-hidden="true"
                      // The swatch shows the very fill the crop paints.
                      style={
                        option === 'transparent'
                          ? undefined
                          : { background: fillOf(option, color) ?? undefined }
                      }
                    />
                    {backgroundLabel(option)}
                  </button>
                );
              })}
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPlacement(START);
              }}
              disabled={image === null}
              data-action="frame-reset"
            >
              Reset
            </Button>

            <span className="ss-label">Preview</span>
            <div className="ss-frame-previews">
              <span className="project-mark project-mark-sm project-mark-image ss-frame-preview">
                <canvas ref={smallRef} aria-hidden="true" />
              </span>
              <span className="project-mark project-mark-2xl project-mark-image ss-frame-preview">
                <canvas ref={largeRef} aria-hidden="true" />
              </span>
            </div>

            {problem !== undefined && (
              <p className="ss-field-error" role="alert" data-frame-error>
                {problem}
              </p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
