import { NavIcon } from '../../../components/sidebar/NavIcon.tsx';
import {
  SPACES_FILTERS,
  type SpacesCounts,
  type SpacesFilter,
  type SpacesQuery,
  type SpacesView,
} from './spaces-model.ts';

const FILTER_LABELS: Readonly<Record<SpacesFilter, string>> = {
  all: 'All',
  yours: 'Yours',
  public: 'Public',
  archived: 'Archived',
};

export interface SpacesToolbarProps {
  readonly query: SpacesQuery;
  readonly counts: SpacesCounts;
  readonly onChange: (patch: Partial<SpacesQuery>) => void;
}

/**
 * Search, the four chips with their counts, and Grid / List (D-103 item 12,
 * LAI-978). Every choice is written to the URL by the screen, so a reload or
 * a shared link opens the page as it was left.
 */
export function SpacesToolbar({ query, counts, onChange }: SpacesToolbarProps) {
  return (
    <div className="spaces-toolbar">
      <label className="spaces-search">
        <NavIcon name="search" size={16} className="spaces-search-icon" />
        <input
          type="search"
          className="spaces-search-input"
          placeholder="Search spaces"
          aria-label="Search spaces"
          value={query.q}
          onChange={(event) => {
            onChange({ q: event.target.value });
          }}
        />
      </label>

      <div className="spaces-seg" role="group" aria-label="Show">
        {SPACES_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className="spaces-seg-btn spaces-chip"
            data-filter={filter}
            aria-pressed={query.filter === filter}
            onClick={() => {
              onChange({ filter });
            }}
          >
            {FILTER_LABELS[filter]}
            <span className="spaces-seg-count">{counts[filter]}</span>
          </button>
        ))}
      </div>

      <div className="spaces-seg spaces-view" role="group" aria-label="View">
        {(
          [
            ['grid', 'Grid', 'spaces-more'],
            ['list', 'List', 'rows'],
          ] as const
        ).map(([view, label, icon]: readonly [SpacesView, string, 'spaces-more' | 'rows']) => (
          <button
            key={view}
            type="button"
            className="spaces-seg-btn"
            data-view={view}
            aria-pressed={query.view === view}
            onClick={() => {
              onChange({ view });
            }}
          >
            <NavIcon name={icon} size={14} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
