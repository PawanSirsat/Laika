import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { isIconType, isOneEmoji, stageProjectIcon } from '../../../api/project-icons.ts';
import { lookOf, subscribeLooks } from '../../../api/project-looks.ts';
import type { Project } from '../../../api/projects.ts';
import { useAttachmentLimit } from '../../../api/use-attach.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { ProjectMark } from '../../../components/ProjectMark.tsx';
import { emojiLabel, ICON_EMOJIS } from './icon-choices.ts';
import { IconFrameEditor } from './IconFrameEditor.tsx';
import { type HeldIcon, heldIconPreview, holdIcon } from './space-settings-model.ts';

export interface IconSectionProps {
  readonly project: Project;
  /** The icon change waiting for Save changes, or `null` for none (LAI-1321). */
  readonly held: HeldIcon | null;
  readonly onHold: (held: HeldIcon | null) => void;
  /** While General saves: nothing here may change under it. */
  readonly saving?: boolean;
}

/** The largest picture the frame editor opens — it is cropped to far less, but a camera photo must still open. */
const PICK_MAX_BYTES = 25 * 1024 * 1024;

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // `readAsDataURL` always answers a string; anything else is a read that failed.
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('unreadable'));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('unreadable'));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Space settings → General → Icon (D-152, LAI-1311; held since LAI-1321):
 * what every mark of this space draws — an image, an emoji, or else its first
 * letter on its colour. Shown to org owners and admins only; the tab decides.
 *
 * **Every change waits for Save changes**, as every other General field does
 * (the owner, 2026-11-18: a change that saved on its own left Save disabled,
 * and looked unsaved). Picking an image opens the frame editor; *Use this*
 * puts the cropped square in the store at once — so Save only has to say so —
 * and holds it, previewed and marked *Not saved yet*. An emoji and Remove are
 * held the same way. The tab sends them with Save and drops them on Discard.
 *
 * Upload is offered only on a board with a file store (`GET /org`'s
 * `attachments`); without one, emoji and letter are the choices.
 */
export function IconSection({ project, held, onHold, saving = false }: IconSectionProps) {
  const look = useSyncExternalStore(subscribeLooks, () => lookOf(project.slug));
  const current = look !== undefined ? look.icon : project.icon;
  const shown = heldIconPreview(current, held);
  const limit = useAttachmentLimit();
  const [picked, setPicked] = useState<Blob | null>(null);
  const [staging, setStaging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typedId = useId();
  const pickerId = useId();

  const busy = staging || saving;
  const shownEmoji = shown !== null && 'emoji' in shown ? shown.emoji : undefined;
  const typedIssue =
    typed.trim() !== '' && !isOneEmoji(typed) ? 'Type or paste a single emoji.' : undefined;

  const hold = (change: HeldIcon): void => {
    setFailure(undefined);
    onHold(holdIcon(current, change));
  };

  const pickFile = (file: File | undefined): void => {
    if (file === undefined) return;
    setFailure(undefined);
    if (!isIconType(file.type)) {
      setFailure('An icon is a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > PICK_MAX_BYTES) {
      setFailure('That picture is too large to open — 25 MB at most.');
      return;
    }
    setPicked(file);
  };

  /** The cropped square, into the store at once and held until Save. */
  const stage = (image: Blob): void => {
    setPicked(null);
    setStaging(true);
    setProgress(0);
    setFailure(undefined);
    Promise.all([
      stageProjectIcon(project.slug, image, (fraction) => {
        setProgress(fraction);
      }),
      asDataUrl(image),
    ])
      .then(([staged, preview]) => {
        hold({ kind: 'image', staged, preview });
      })
      .catch((cause: unknown) => {
        setFailure(failureText(cause));
      })
      .finally(() => {
        setStaging(false);
        setProgress(null);
      });
  };

  return (
    <div className="ss-row" data-icon-section>
      <div className="ss-row-label">
        <span className="ss-label" id={`${pickerId}-label`}>
          Icon
        </span>
        <p className="ss-help">
          {limit === null
            ? 'An emoji, or else the first letter of the name on the space’s colour. This board has no file store, so images are off.'
            : 'An image or an emoji, or else the first letter of the name on the space’s colour. Shown wherever this space appears.'}
        </p>
      </div>
      <div className="ss-row-field">
        <div className="ss-icon">
          <ProjectMark
            project={{ slug: project.slug, name: project.name, color: project.color, icon: shown }}
            size="xl"
            labelled
            preview
          />
          <div className="ss-icon-actions">
            {limit !== null && limit !== undefined && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  busy={staging}
                  disabled={busy}
                  data-action="icon-upload"
                  onClick={() => fileRef.current?.click()}
                >
                  Upload image
                </Button>
                <input
                  ref={fileRef}
                  className="ss-icon-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-icon-file
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    pickFile(file);
                  }}
                />
              </>
            )}
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={picking}
              aria-controls={pickerId}
              disabled={busy}
              data-action="icon-emoji"
              onClick={() => {
                setPicking((open) => !open);
              }}
            >
              Choose emoji
            </Button>
            {shown !== null && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                data-action="icon-remove"
                onClick={() => {
                  hold({ kind: 'remove' });
                }}
              >
                Remove
              </Button>
            )}
            {held !== null && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                data-action="icon-keep"
                onClick={() => {
                  onHold(null);
                }}
              >
                Keep current
              </Button>
            )}
          </div>
        </div>
        {held !== null && (
          <p className="ss-icon-held" data-icon-held>
            Not saved yet — Save changes to use it.
          </p>
        )}
        {limit !== null && limit !== undefined && (
          <p className="ss-help">
            PNG, JPEG or WebP. You can position and zoom it before it is used.
          </p>
        )}

        {picking && (
          <div className="ss-emoji-picker" id={pickerId} data-emoji-picker>
            <div className="ss-emoji-grid" role="group" aria-labelledby={`${pickerId}-label`}>
              {ICON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={emoji === shownEmoji ? 'ss-emoji ss-emoji-on' : 'ss-emoji'}
                  aria-label={emojiLabel(emoji)}
                  aria-pressed={emoji === shownEmoji}
                  disabled={busy}
                  data-emoji={emoji}
                  onClick={() => {
                    hold({ kind: 'emoji', emoji });
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="ss-emoji-typed">
              <label htmlFor={typedId} className="ss-help">
                Or type or paste any emoji
              </label>
              <input
                id={typedId}
                className="ss-emoji-input"
                value={typed}
                maxLength={16}
                autoComplete="off"
                aria-invalid={typedIssue !== undefined}
                aria-describedby={typedIssue !== undefined ? `${typedId}-issue` : undefined}
                data-emoji-input
                onChange={(event) => {
                  setTyped(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  // Enter takes the emoji here; it must not submit anything around it.
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (typed.trim() === '' || typedIssue !== undefined) return;
                  hold({ kind: 'emoji', emoji: typed.trim() });
                  setTyped('');
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || typed.trim() === '' || typedIssue !== undefined}
                data-action="icon-emoji-use"
                onClick={() => {
                  hold({ kind: 'emoji', emoji: typed.trim() });
                  setTyped('');
                }}
              >
                Use it
              </Button>
              {typedIssue !== undefined && (
                <p className="ss-field-error" id={`${typedId}-issue`}>
                  {typedIssue}
                </p>
              )}
            </div>
          </div>
        )}

        <p className="ss-help" role="status" data-icon-status>
          {staging && progress !== null ? `Uploading — ${String(Math.round(progress * 100))}%` : ''}
        </p>
        {failure !== undefined && (
          <p className="ss-field-error" role="alert" data-icon-error>
            {failure}
          </p>
        )}
      </div>

      {picked !== null && (
        <IconFrameEditor
          file={picked}
          space={{ slug: project.slug, color: project.color }}
          onCancel={() => {
            setPicked(null);
          }}
          onUse={stage}
        />
      )}
    </div>
  );
}

/** What went wrong, in the words of whoever knows: the file check, the server, or the store. */
function failureText(cause: unknown): string {
  if (cause instanceof ApiError) {
    const reason = (cause.details as { reason?: unknown } | null)?.reason;
    if (reason === 'attachments_off') return 'This board has no file store, so images are off.';
    return cause.message;
  }
  if (cause instanceof Error && cause.name === 'IconFileError') return cause.message;
  return 'The image could not be uploaded. Try again.';
}
