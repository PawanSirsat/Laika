import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { EditorAttach } from '../../../api/attachment-upload.ts';
import {
  deleteAttachment,
  listTaskAttachments,
  type Attachment,
} from '../../../api/attachments.ts';
import { ApiError } from '../../../api/errors.ts';
import { subscribeToEvents } from '../../../api/event-stream.ts';
import type { Round } from '../../../api/review.ts';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import {
  attachmentRows,
  attachmentsHeading,
  changesFilesOf,
  type AttachmentReader,
} from './attachments-derive.ts';
import { fileKind, filesFrom } from './editor/attach.ts';
import { FileGlyph } from './FileGlyph.tsx';
import { OutputViewer } from './OutputViewer.tsx';
import {
  ATTACHMENT_GROUP_TITLES,
  groupAttachments,
  outputBy,
  outputItem,
  roundBy,
  roundOutputs,
  type OutputItem,
} from './outputs-derive.ts';
import './attachments.css';
import './outputs.css';

export interface AttachmentsSectionProps {
  readonly slug: string;
  readonly taskId: string;
  /**
   * The board's uploader, aimed at this task (`useEditorAttach`). **Absent,
   * the section is not drawn at all** — the board has no store (D-150), or
   * has not said yet.
   */
  readonly attach: EditorAttach | undefined;
  /** Holds `attachment.create` here: the button and the drop zone. */
  readonly mayAttach: boolean;
  /** Who is reading, for *Remove* (§3.2: a lead any, a member their own). */
  readonly reader: AttachmentReader;
  /** A person's name for an id, as the panel knows them. */
  readonly nameOf: (userId: string) => string;
  /**
   * The task's rounds, newest first, as the panel read them (LAI-1117): a
   * file a round's summary links is one of an agent's **outputs** (D-162),
   * with the caption and the agent that link names.
   */
  readonly rounds?: readonly Round[] | undefined;
}

/** A file on its way from this section, or one that did not make it. */
interface Sending {
  readonly id: number;
  readonly name: string;
  readonly progress: number;
  readonly error?: string | undefined;
}

type Listing =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly files: readonly Attachment[] }
  | { readonly status: 'error'; readonly error: unknown };

/**
 * Every file on the task (D-150, LAI-1301), between the proof and the
 * activity: its kind, name, size, who added it and when, a link that opens
 * it — the server answers a download for anything it will not show — and
 * *Remove* where the reader may. *Attach files*, or files dropped on the
 * section, upload to this task without touching its text.
 *
 * **Live.** A file added or removed anywhere — this panel's editor, another
 * tab, an agent — arrives as an `attachment.*` frame, and the list is read
 * again.
 */
export function AttachmentsSection({
  slug,
  taskId,
  attach,
  mayAttach,
  reader,
  nameOf,
  rounds,
}: AttachmentsSectionProps) {
  const [open, setOpen] = useState(true);
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  const [reads, setReads] = useState(0);
  const [sending, setSending] = useState<readonly Sending[]>([]);
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const sendSeq = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirm();
  const on = attach !== undefined;

  /*
   * Which files are outputs (D-162): each round's own, with its caption and
   * who it came from. The round, not the file, knows the agent — the file's
   * `uploaded_by` is the person it acted for.
   */
  const outputs = useMemo(() => {
    const byId = new Map<string, { readonly caption: string; readonly by: string }>();
    const own = roundOutputs(rounds ?? []);
    for (const round of rounds ?? []) {
      for (const ref of own.get(round.number) ?? []) {
        byId.set(ref.id, { caption: ref.caption, by: roundBy(round, nameOf) });
      }
    }
    return byId;
  }, [rounds, nameOf]);

  const reload = useCallback(() => {
    setReads((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!on) return undefined;
    const controller = new AbortController();
    listTaskAttachments(taskId, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setListing({ status: 'ready', files: answer.data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListing({ status: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [on, taskId, reads]);

  useEffect(() => {
    if (!on) return undefined;
    return subscribeToEvents(slug, (frame) => {
      if (frame.kind === 'activity' && changesFilesOf(frame, taskId)) reload();
    });
  }, [on, slug, taskId, reload]);

  if (attach === undefined) return null;
  const files = listing.status === 'ready' ? listing.files : [];
  // Nothing to show and nothing the reader may add: no section at all.
  if (listing.status === 'ready' && files.length === 0 && !mayAttach && sending.length === 0) {
    return null;
  }
  // Grouped — Outputs, In comments, Other — and drawn in that order, which is
  // also the order the viewer steps through them.
  const groups = groupAttachments(files, new Set(outputs.keys()));
  const ordered = groups.flatMap((entry) => entry.files);
  const rows = attachmentRows(ordered, reader, nameOf, Date.now());
  const items: OutputItem[] = ordered.map((file) => {
    const output = outputs.get(file.id);
    return outputItem(
      { id: file.id, caption: output?.caption ?? file.filename, image: false },
      file,
      output?.by ?? outputBy(nameOf(file.uploaded_by), null),
    );
  });
  // One group of files with no output or comment among them needs no heading.
  const headed = groups.length > 1 || groups[0]?.group !== 'other';

  const send = (chosen: readonly File[]): void => {
    for (const file of chosen) {
      sendSeq.current += 1;
      const id = sendSeq.current;
      const name = file.name === '' ? 'Pasted file' : file.name;
      setSending((list) => [...list, { id, name, progress: 0 }]);
      attach
        .upload(file, {
          onProgress: (progress) => {
            setSending((list) => list.map((s) => (s.id === id ? { ...s, progress } : s)));
          },
        })
        .then(() => {
          setSending((list) => list.filter((s) => s.id !== id));
          reload();
        })
        .catch((cause: unknown) => {
          const error = cause instanceof Error ? cause.message : `Could not upload “${name}”.`;
          setSending((list) => list.map((s) => (s.id === id ? { ...s, error } : s)));
        });
    }
  };

  const remove = async (file: Attachment): Promise<void> => {
    const yes = await confirm({
      title: `Remove “${file.filename}”?`,
      body: 'It goes from the task, and a link to it in a description or a comment will find nothing.',
      confirmLabel: 'Remove',
      danger: true,
      icon: 'delete',
    });
    if (!yes) return;
    setRemoving(file.id);
    setRemoveError(undefined);
    try {
      await deleteAttachment(file.id);
      setListing((was) =>
        was.status === 'ready'
          ? { status: 'ready', files: was.files.filter((f) => f.id !== file.id) }
          : was,
      );
    } catch (cause) {
      setRemoveError(
        cause instanceof ApiError ? cause.message : `Could not remove “${file.filename}”.`,
      );
    } finally {
      setRemoving(undefined);
    }
  };

  const dropHandlers = mayAttach
    ? {
        onDragOver: (event: DragEvent<HTMLElement>) => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          const dropped = filesFrom(event.dataTransfer);
          setDragging(false);
          if (dropped.length === 0) return;
          event.preventDefault();
          setOpen(true);
          send(dropped);
        },
      }
    : {};

  return (
    <section
      className={dragging ? 'panel-section att-section att-dragging' : 'panel-section att-section'}
      data-section="attachments"
      {...dropHandlers}
    >
      <div className="att-head">
        <button
          type="button"
          className="panel-fold"
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          <span className={open ? 'meta-chevron meta-chevron-open' : 'meta-chevron'} />
          {attachmentsHeading(files.length)}
        </button>
        {mayAttach && (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                fileInput.current?.click();
              }}
            >
              Attach files
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const chosen = Array.from(event.target.files ?? []);
                event.target.value = '';
                setOpen(true);
                send(chosen);
              }}
            />
          </>
        )}
      </div>

      {open && (
        <div className="att-body" aria-busy={listing.status === 'loading'}>
          {listing.status === 'error' && (
            <p className="att-note att-note-error" role="alert">
              Could not read the files.
              {listing.error instanceof ApiError ? ` ${listing.error.message}` : ''}{' '}
              <button type="button" className="att-retry" onClick={reload}>
                Try again
              </button>
            </p>
          )}

          {groups.map((entry) => (
            <div key={entry.group} className="att-group" data-group={entry.group}>
              {headed && (
                <h4 className="att-group-title">
                  {ATTACHMENT_GROUP_TITLES[entry.group]}{' '}
                  <span className="att-group-count">{entry.files.length}</span>
                </h4>
              )}
              <ul
                className="att-list"
                aria-label={
                  headed
                    ? `${ATTACHMENT_GROUP_TITLES[entry.group]} on this task`
                    : 'Files on this task'
                }
              >
                {entry.files.map((file) => {
                  const at = ordered.indexOf(file);
                  const row = rows[at];
                  const item = items[at];
                  if (row === undefined || item === undefined) return null;
                  return (
                    <li key={row.id} className="att-row" data-kind={item.kind}>
                      <button
                        type="button"
                        className="att-icon att-preview"
                        aria-label={`Preview ${row.filename}`}
                        onClick={() => {
                          setViewing(at);
                        }}
                      >
                        {item.show === 'image' ? (
                          <img src={row.url} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <FileGlyph kind={row.kind} size={18} />
                        )}
                      </button>
                      <span className="att-main">
                        <a
                          className="att-name"
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.filename}
                        </a>
                        <span className="att-meta">
                          {row.size} · {row.uploader} ·{' '}
                          <Tooltip content={row.when.full}>
                            <time
                              dateTime={row.when.iso}
                              tabIndex={0}
                              aria-label={`${row.when.text}, ${row.when.full}`}
                            >
                              {row.when.text}
                            </time>
                          </Tooltip>
                        </span>
                      </span>
                      {row.mayDelete && (
                        <button
                          type="button"
                          className="att-remove"
                          aria-label={`Remove ${row.filename}`}
                          disabled={removing !== undefined}
                          onClick={() => void remove(file)}
                        >
                          {removing === row.id && (
                            <Spinner size="sm" label={`Removing ${row.filename}`} />
                          )}
                          Remove
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {viewing !== null && (
            <OutputViewer
              items={items}
              start={viewing}
              onClose={() => {
                setViewing(null);
              }}
            />
          )}

          {removeError !== undefined && (
            <p className="att-note att-note-error" role="alert">
              {removeError}
            </p>
          )}

          {sending.length > 0 && (
            <ul className="att-sending" aria-label="Files being attached">
              {sending.map((s) => (
                <li
                  key={s.id}
                  className={s.error === undefined ? 'att-send' : 'att-send att-send-failed'}
                >
                  <FileGlyph kind={fileKind(s.name)} size={14} />
                  <span className="att-send-name">{s.name}</span>
                  {s.error === undefined ? (
                    <span
                      className="att-bar"
                      role="progressbar"
                      aria-label={`Uploading ${s.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(s.progress * 100)}
                    >
                      <span
                        className="att-fill"
                        style={{ width: `${String(Math.round(s.progress * 100))}%` }}
                      />
                    </span>
                  ) : (
                    <>
                      <span className="att-send-error" role="alert">
                        {s.error}
                      </span>
                      <Tooltip content="Dismiss" side="top">
                        <button
                          type="button"
                          className="att-dismiss"
                          aria-label={`Dismiss ${s.name}`}
                          onClick={() => {
                            setSending((list) => list.filter((x) => x.id !== s.id));
                          }}
                        >
                          <Icon name="close" size="small" />
                        </button>
                      </Tooltip>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {listing.status === 'ready' && rows.length === 0 && sending.length === 0 && (
            <p className="att-note att-empty">No files yet.</p>
          )}

          {/*
            Where to drop more — for a mouse or a trackpad. A phone or a
            tablet has nothing to drop (the coarse pointer, and the phone's
            width, hide it in attachments.css): Attach files is the way in.
          */}
          {mayAttach && (
            <p className="att-drop">
              <FileGlyph kind="paperclip" size={14} />
              {dragging
                ? 'Drop to attach to this task'
                : 'Drop files here to attach them, or paste a screenshot into the description.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
