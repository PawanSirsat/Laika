import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  iconFileProblem,
  isOneEmoji,
  removeProjectIcon,
  setProjectEmoji,
  uploadProjectIcon,
} from '../../../api/project-icons.ts';
import { lookOf, subscribeLooks } from '../../../api/project-looks.ts';
import type { Project } from '../../../api/projects.ts';
import { useAttachmentLimit } from '../../../api/use-attach.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { ProjectMark } from '../../../components/ProjectMark.tsx';
import { emojiLabel, ICON_EMOJIS } from './icon-choices.ts';

export interface IconSectionProps {
  readonly project: Project;
}

type Busy = 'upload' | 'emoji' | 'remove' | null;

/**
 * Space settings → General → Icon (D-152, LAI-1311): what every mark of this
 * space draws — an uploaded image, an emoji, or else its first letter on its
 * colour. Shown to org owners and admins only; the screen decides that.
 *
 * **Each change saves at once**, outside General's form: an upload is sent
 * the moment a file is picked, so there is nothing to hold for Save — and a
 * change here must not reset a half-typed name above it. So it does not hand
 * the screen a new project: the answer is remembered by slug
 * (`api/project-looks.ts`), and every mark on the page, this preview among
 * them, redraws from there.
 *
 * Upload is offered only on a board with a file store (`GET /org`'s
 * `attachments`); without one, emoji and letter are the choices.
 */
export function IconSection({ project }: IconSectionProps) {
  const look = useSyncExternalStore(subscribeLooks, () => lookOf(project.slug));
  const icon = look !== undefined ? look.icon : project.icon;
  const limit = useAttachmentLimit();
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typedId = useId();
  const pickerId = useId();

  const current = icon !== null && 'emoji' in icon ? icon.emoji : undefined;
  const hasIcon = icon !== null;
  const typedIssue =
    typed.trim() !== '' && !isOneEmoji(typed) ? 'Type or paste a single emoji.' : undefined;

  const run = (kind: Exclude<Busy, null>, work: () => Promise<unknown>, said: string): void => {
    setBusy(kind);
    setFailure(undefined);
    setDone(undefined);
    work()
      .then(() => {
        setDone(said);
      })
      .catch((cause: unknown) => {
        setFailure(failureText(cause));
      })
      .finally(() => {
        setBusy(null);
        setProgress(null);
      });
  };

  const pickFile = (file: File | undefined): void => {
    if (file === undefined) return;
    const problem = iconFileProblem(file, limit ?? undefined);
    if (problem !== null) {
      setDone(undefined);
      setFailure(problem.message);
      return;
    }
    setProgress(0);
    run(
      'upload',
      () =>
        uploadProjectIcon(project.slug, file, (fraction) => {
          setProgress(fraction);
        }),
      'Image saved as the icon.',
    );
  };

  const chooseEmoji = (emoji: string): void => {
    run('emoji', () => setProjectEmoji(project.slug, emoji), `${emoji} is the icon now.`);
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
          <ProjectMark project={project} size="xl" labelled />
          <div className="ss-icon-actions">
            {limit !== null && limit !== undefined && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  busy={busy === 'upload'}
                  disabled={busy !== null}
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
              disabled={busy !== null}
              data-action="icon-emoji"
              onClick={() => {
                setPicking((open) => !open);
              }}
            >
              Choose emoji
            </Button>
            {hasIcon && (
              <Button
                variant="secondary"
                size="sm"
                busy={busy === 'remove'}
                disabled={busy !== null}
                data-action="icon-remove"
                onClick={() => {
                  run(
                    'remove',
                    () => removeProjectIcon(project.slug),
                    'Icon removed: the space shows its letter.',
                  );
                }}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
        {limit !== null && limit !== undefined && (
          <p className="ss-help">PNG, JPEG or WebP, up to 1 MB. A square image reads best.</p>
        )}

        {picking && (
          <div className="ss-emoji-picker" id={pickerId} data-emoji-picker>
            <div className="ss-emoji-grid" role="group" aria-labelledby={`${pickerId}-label`}>
              {ICON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={emoji === current ? 'ss-emoji ss-emoji-on' : 'ss-emoji'}
                  aria-label={emojiLabel(emoji)}
                  aria-pressed={emoji === current}
                  disabled={busy !== null}
                  data-emoji={emoji}
                  onClick={() => {
                    chooseEmoji(emoji);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <form
              className="ss-emoji-typed"
              onSubmit={(event) => {
                event.preventDefault();
                if (typed.trim() === '' || typedIssue !== undefined) return;
                chooseEmoji(typed.trim());
                setTyped('');
              }}
            >
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
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={busy !== null || typed.trim() === '' || typedIssue !== undefined}
                data-action="icon-emoji-use"
              >
                Use it
              </Button>
              {typedIssue !== undefined && (
                <p className="ss-field-error" id={`${typedId}-issue`}>
                  {typedIssue}
                </p>
              )}
            </form>
          </div>
        )}

        <p className="ss-help" role="status" data-icon-status>
          {busy === 'upload' && progress !== null
            ? `Uploading — ${String(Math.round(progress * 100))}%`
            : (done ?? '')}
        </p>
        {failure !== undefined && (
          <p className="ss-field-error" role="alert" data-icon-error>
            {failure}
          </p>
        )}
      </div>
    </div>
  );
}

/** What went wrong, in the words of whoever knows: the file check, the server, or the store. */
function failureText(cause: unknown): string {
  if (cause instanceof ApiError) {
    const reason = (cause.details as { reason?: unknown } | null)?.reason;
    if (reason === 'attachments_off') return 'This board has no file store, so images are off.';
    if (reason === 'type_mismatch') return 'That file is not the image it says it is.';
    return cause.message;
  }
  if (cause instanceof Error && cause.name === 'IconFileError') return cause.message;
  return 'The icon could not be saved. Try again.';
}
