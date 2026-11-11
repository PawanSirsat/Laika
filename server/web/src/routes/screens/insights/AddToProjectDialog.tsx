import { useEffect, useId, useRef, useState } from 'react';
import type { AvailabilityRow } from '../../../api/availability.ts';
import { ApiError } from '../../../api/errors.ts';
import { addMember, projectRoleLabel, type ProjectRole } from '../../../api/members.ts';
import { listTasks, type TaskSummary } from '../../../api/tasks.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { AvailabilityPill } from '../../../components/availability/AvailabilityPill.tsx';
import {
  canTake,
  firstName,
  reasonOf,
} from '../../../components/availability/availability-derive.ts';
import '../../../components/availability/availability.css';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';

/** A space this reader may add people to. */
export interface AddableSpace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface AddToProjectDialogProps {
  readonly row: AvailabilityRow;
  /** Only the spaces the reader may manage members of — a space admin's own (§3.2). */
  readonly spaces: readonly AddableSpace[];
  readonly onAdded: (space: AddableSpace, role: ProjectRole) => void;
  /** The list is stale — someone else added them first (`409`). */
  readonly onStale: () => void;
  readonly onClose: () => void;
  readonly restore: () => HTMLElement | null | undefined;
}

/** The message's limit (§4.87). */
const MESSAGE_MAX = 500;
/** How many ready cards the dialog offers. */
const CARDS_SHOWN = 8;

type Cards =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly cards: readonly TaskSummary[] };

/**
 * **Add to project…** (frames 2j–2l, D-134; LAI-1139): put someone in a space
 * with a role, optionally hand them a first card and a message, in **one**
 * `POST /projects/:slug/members` — the server makes the membership, the card's
 * assignee and their notice one transaction. A bottom sheet on a phone.
 *
 * Offers only the spaces the reader may manage: every space for an owner or
 * admin, the spaces they lead for a space admin. A space the person is
 * already in is shown and cannot be picked.
 */
export function AddToProjectDialog({
  row,
  spaces,
  onAdded,
  onStale,
  onClose,
  restore,
}: AddToProjectDialogProps) {
  const first = firstName(row.user.name);
  const member = new Set(row.spaces.map((s) => s.id));
  const [joined, setJoined] = useState<ReadonlySet<string>>(new Set());
  const open = spaces.filter((s) => !member.has(s.id) && !joined.has(s.id));
  const [spaceId, setSpaceId] = useState<string | undefined>(open[0]?.id);
  const [role, setRole] = useState<ProjectRole>('member');
  const [viewerOnly, setViewerOnly] = useState(false);
  const [card, setCard] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [cards, setCards] = useState<Cards>({ status: 'loading' });
  const [cardsAsked, setCardsAsked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const space = spaces.find((s) => s.id === spaceId);

  useDialogFocus(box, { restore });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [busy, onClose]);

  // The cards nobody holds yet in the chosen space, ready ones first.
  const slug = space?.slug;
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    setCards({ status: 'loading' });
    setCard(undefined);
    Promise.all([
      listTasks(slug, { status: 'todo', assignee: 'none', limit: CARDS_SHOWN }, controller.signal),
      listTasks(
        slug,
        { status: 'backlog', assignee: 'none', limit: CARDS_SHOWN },
        controller.signal,
      ),
    ])
      .then(([todo, backlog]) => {
        if (controller.signal.aborted) return;
        setCards({ status: 'ready', cards: [...todo.data, ...backlog.data].slice(0, CARDS_SHOWN) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCards({ status: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, [slug, cardsAsked]);

  const chosenCard = cards.status === 'ready' ? cards.cards.find((c) => c.id === card) : undefined;
  const roleName = projectRoleLabel(role);

  const submit = async (): Promise<void> => {
    if (space === undefined || busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await addMember(space.slug, row.user.id, role, {
        message,
        assignTaskId: card,
      });
      onAdded(space, role);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'conflict') {
        // Someone added them first: say so, and take the space off the list.
        setProblem(`${first} is already a member of ${space.name}.`);
        setJoined((j) => new Set([...j, space.id]));
        setSpaceId(open.find((s) => s.id !== space.id)?.id);
        onStale();
      } else if (cause instanceof ApiError && cause.code === 'unprocessable') {
        const reason = reasonOf(cause.details);
        const field = (cause.details as { field?: unknown } | null)?.field;
        if (reason === 'user_deactivated') {
          setProblem(`${row.user.name} is deactivated and can’t be added to a space.`);
        } else if (reason === 'task_not_assignable') {
          setProblem('That card can no longer be handed over. Pick another, or no card.');
          setCardsAsked((n) => n + 1);
        } else if (field === 'role') {
          setViewerOnly(true);
          setRole('viewer');
          setProblem(cause.message);
        } else {
          setProblem(cause.message);
        }
      } else {
        setProblem(cause instanceof Error ? cause.message : `${first} could not be added.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const roles: readonly ProjectRole[] = viewerOnly ? ['viewer'] : ['member', 'lead'];

  return (
    <>
      <div className="avail-scrim" aria-hidden="true" />
      <div
        ref={box}
        className="avail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        data-add-to-project
      >
        <h2 id={`${id}-title`}>Add {first} to a project</h2>
        <p className="avail-inline avail-quiet">
          <AvailabilityPill availability={row.availability} hideHours />
          {row.availability?.hours_per_week !== undefined && (
            <span>
              {canTake(row.availability) === '—'
                ? 'no hours set'
                : `can take ${canTake(row.availability).replace('/wk', '/week')}`}
            </span>
          )}
        </p>

        <fieldset>
          <legend className="avail-label">Space</legend>
          {spaces.map((s) => {
            const already = member.has(s.id) || joined.has(s.id);
            return (
              <label
                key={s.id}
                className="avail-option"
                data-on={spaceId === s.id}
                data-disabled={already}
              >
                <input
                  type="radio"
                  name={`${id}-space`}
                  value={s.id}
                  checked={spaceId === s.id}
                  disabled={already || busy}
                  onChange={() => {
                    setSpaceId(s.id);
                    setProblem(undefined);
                  }}
                />
                <span>{s.name}</span>
                {already && <span className="avail-option-note">already a member</span>}
              </label>
            );
          })}
        </fieldset>

        {space !== undefined && (
          <>
            <fieldset>
              <legend className="avail-label">Role in space</legend>
              <div className="avail-inline" role="radiogroup" aria-label="Role in space">
                {roles.map((r) => (
                  <label key={r} className="avail-option" data-on={role === r}>
                    <input
                      type="radio"
                      name={`${id}-role`}
                      value={r}
                      checked={role === r}
                      disabled={busy}
                      onChange={() => {
                        setRole(r);
                      }}
                    />
                    <span>{projectRoleLabel(r)}</span>
                  </label>
                ))}
              </div>
              {viewerOnly && (
                <p className="avail-quiet">
                  {first} is a viewer in the organisation, so Viewer is the only role on offer.
                </p>
              )}
            </fieldset>

            <fieldset>
              <legend className="avail-label">First card to assign · optional</legend>
              <label className="avail-option" data-on={card === undefined}>
                <input
                  type="radio"
                  name={`${id}-card`}
                  checked={card === undefined}
                  disabled={busy}
                  onChange={() => {
                    setCard(undefined);
                  }}
                />
                <span>No card yet</span>
              </label>
              {cards.status === 'loading' && (
                <p className="avail-quiet">Reading the cards in {space.name}…</p>
              )}
              {cards.status === 'error' && (
                <p className="avail-error">
                  The cards in {space.name} could not be read.{' '}
                  <button
                    type="button"
                    className="avail-link"
                    onClick={() => {
                      setCardsAsked((n) => n + 1);
                    }}
                  >
                    Retry
                  </button>
                </p>
              )}
              {cards.status === 'ready' && cards.cards.length === 0 && (
                <p className="avail-quiet">No unassigned cards ready in {space.name}.</p>
              )}
              {cards.status === 'ready' &&
                cards.cards.map((c) => (
                  <label key={c.id} className="avail-option" data-on={card === c.id}>
                    <input
                      type="radio"
                      name={`${id}-card`}
                      value={c.id}
                      checked={card === c.id}
                      disabled={busy}
                      onChange={() => {
                        setCard(c.id);
                      }}
                    />
                    <span className="avail-option-key">{c.key}</span>
                    <span>{c.title}</span>
                  </label>
                ))}
            </fieldset>

            <label className="avail-field">
              <span className="avail-label">Message to {first} · optional</span>
              <textarea
                value={message}
                maxLength={MESSAGE_MAX}
                disabled={busy}
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
              />
            </label>

            <p className="avail-summary" data-add-summary>
              {first} joins {space.name} as {roleName}
              {chosenCard !== undefined && ` and gets ${chosenCard.key}`}. They are notified, and it
              shows up in their My day.
            </p>
          </>
        )}

        {space === undefined && (
          <p className="avail-quiet">{first} is already in every space you can add people to.</p>
        )}

        {problem !== undefined && (
          <p className="avail-error" role="alert">
            {problem}
          </p>
        )}

        <div className="avail-dialog-foot">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {space !== undefined && (
            <Button
              variant="primary"
              busy={busy}
              onClick={() => {
                void submit();
              }}
            >
              {`Add to ${space.name}`}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
