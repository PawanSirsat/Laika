import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../../../components/forms/Button.tsx';
import { Dialog } from '../../../components/overlay/Dialog.tsx';
import { spaceColor, type SpaceColor } from '../../../theme/space-color.ts';
import {
  backgroundLabel,
  describePlacement,
  drawRect,
  exportPlan,
  FRAME_BACKGROUNDS,
  FRAME_PX,
  type FrameBackground,
  ICON_LIMIT_BYTES,
  type ImageSize,
  isReduced,
  keyPlacement,
  MAX_ZOOM,
  moveBy,
  outputSize,
  type Placement,
  smallestUnder,
  START,
  zoomTo,
} from './icon-frame.ts';
import { onRadioGroupKeyDown, radioTabIndex } from './radio-keys.ts';

export interface IconFrameEditorProps {
  /** The picked image, as the person chose it — any size; it is cropped here. */
  readonly file: Blob;
  /** The space, for the Space colour background and the previews. */
  readonly space: { readonly slug: string; readonly color: string | null };
  /**
   * The most bytes the board takes for an image: its attachment limit, when
   * that is under the icon's megabyte (LAI-1321 review).
   */
  readonly maxBytes?: number | undefined;
  readonly onCancel: () => void;
  /**
   * The cropped square, PNG or WebP, at most 512 pixels and `maxBytes`;
   * `reduced` when it had to be made smaller or lower quality to fit.
   */
  readonly onUse: (image: Blob, reduced: boolean) => void;
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

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
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
export function IconFrameEditor({
  file,
  space,
  maxBytes = ICON_LIMIT_BYTES,
  onCancel,
  onUse,
}: IconFrameEditorProps) {
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
      // In frame pixels: the box is FRAME_PX wide by its CSS, but a zoomed
      // page or a narrower layout must still move the image with the pointer.
      const scale = FRAME_PX / (event.currentTarget.clientWidth || FRAME_PX);
      setPlacement((p) => moveBy(p, (now.x - was.x) * scale, (now.y - was.y) * scale, image));
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
      const first = outputSize(image, placement.zoom);
      const fill = fillOf(background, color);
      // The first tier with an encoding under the limit wins (`exportPlan`).
      // Painted again only when the size changes — tracked here, not read off
      // the canvas, whose width starts at 300 whatever was asked.
      let painted = 0;
      for (const tier of exportPlan(first)) {
        const size = tier[0]?.size ?? first;
        if (painted !== size) {
          paint(out, size, image, placement, fill);
          painted = size;
        }
        const made: { blob: Blob; step: (typeof tier)[number] }[] = [];
        for (const step of tier) {
          const blob = await toBlob(out, step.type, step.quality);
          if (blob !== null) made.push({ blob, step });
        }
        const fits = smallestUnder(
          made.map((m) => ({ ...m, size: m.blob.size })),
          maxBytes,
        );
        if (fits !== null) {
          onUse(fits.blob, isReduced(fits.step, first));
          return;
        }
      }
      setProblem(
        'That image is too detailed to fit this board’s limit, even small — pick a simpler one.',
      );
    } catch {
      setProblem('The image could not be prepared. Try another one.');
    } finally {
      setBusy(false);
    }
  }, [image, placement, background, color, maxBytes, onUse]);

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
            {/* Where it is now, said as it moves (LAI-1321 review). */}
            <p className="visually-hidden" aria-live="polite" data-frame-status>
              {image === null ? '' : describePlacement(placement)}
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
