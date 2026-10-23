import type { EntryKind } from '../../../api/time.ts';
import { KINDS } from './entry-kinds.ts';

export const ENTRY_TITLE_MAX = 120;
export const ENTRY_DESCRIPTION_MAX = 2000;

export interface EntryDetails {
  readonly kind: EntryKind | undefined;
  readonly title: string;
  readonly description: string;
}

export const EMPTY_DETAILS: EntryDetails = { kind: undefined, title: '', description: '' };

export interface EntryDetailsFieldsProps {
  readonly value: EntryDetails;
  readonly onChange: (next: EntryDetails) => void;
  /** With no card the title is the entry's name, so it is asked for. */
  readonly titleRequired: boolean;
  /** Prefix for the fields' ids, so two forms on one page stay apart. */
  readonly idPrefix: string;
  readonly busy: boolean;
}

/**
 * What an entry was (D-108, LAI-897): its kind as a segment — a second press
 * clears it — a title and a description. Shared by the New entry panel and
 * the Add time form, so the two never drift.
 */
export function EntryDetailsFields({
  value,
  onChange,
  titleRequired,
  idPrefix,
  busy,
}: EntryDetailsFieldsProps) {
  return (
    <div className="myday-details">
      <div className="myday-kinds" role="group" aria-label="Kind">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className="myday-kind"
            data-kind-pick={k.kind}
            aria-pressed={value.kind === k.kind}
            disabled={busy}
            onClick={() => {
              onChange({ ...value, kind: value.kind === k.kind ? undefined : k.kind });
            }}
          >
            <span className="myday-kind-glyph" aria-hidden="true">
              {k.glyph}
            </span>
            {k.label}
          </button>
        ))}
      </div>
      <label className="myday-field">
        <span className="myday-field-label">Title{titleRequired ? '' : ' (optional)'}</span>
        <input
          id={`${idPrefix}-title`}
          className="input"
          data-entry-title
          value={value.title}
          maxLength={ENTRY_TITLE_MAX}
          placeholder={
            titleRequired ? 'A name for it — Team sync, Customer call…' : 'A name for it'
          }
          disabled={busy}
          onChange={(event) => {
            onChange({ ...value, title: event.target.value });
          }}
        />
      </label>
      <label className="myday-field">
        <span className="myday-field-label">Description (optional)</span>
        <textarea
          id={`${idPrefix}-description`}
          className="input myday-textarea"
          data-entry-description
          rows={2}
          value={value.description}
          maxLength={ENTRY_DESCRIPTION_MAX}
          placeholder="What happened, in your words"
          disabled={busy}
          onChange={(event) => {
            onChange({ ...value, description: event.target.value });
          }}
        />
      </label>
    </div>
  );
}
