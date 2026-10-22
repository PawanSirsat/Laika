import { ago, spaceSubline, updatedAt } from './spaces-model.ts';
import {
  AccessBadge,
  SpaceActions,
  SpaceAvatar,
  SpaceBar,
  SpaceCounts,
  SpaceFaces,
  type SpaceItemProps,
} from './SpaceParts.tsx';

/**
 * A space in the grid (D-103 item 12, LAI-978): **one shape for every space.**
 *
 * The description is clamped to two lines and holds two lines when it is
 * short or absent, and the bar, the counts and the footer are always drawn —
 * so a long description cannot make one card taller than its row, which is
 * what the owner's screenshot of the old page showed.
 */
export function SpaceCard(props: SpaceItemProps) {
  const { space, kind, theme, now, handlers } = props;
  const opens = kind === 'yours';
  const described = space.description !== null && space.description.trim() !== '';
  return (
    <article
      className={kind === 'archived' ? 'project-card project-card-archived' : 'project-card'}
      data-space={space.slug}
    >
      <header className="project-card-head">
        <SpaceAvatar space={space} size="lg" />
        <div className="project-card-titles">
          <h3 className="project-card-name">
            {opens ? (
              <button
                type="button"
                className="project-card-open"
                onClick={() => {
                  handlers.onOpen(space);
                }}
              >
                {space.name}
              </button>
            ) : (
              space.name
            )}
          </h3>
          <p className="project-card-sub">{spaceSubline(space)}</p>
        </div>
        <div className="project-card-meta">
          <AccessBadge space={space} />
          <span className="project-card-updated">updated {ago(updatedAt(space), now)}</span>
        </div>
      </header>

      <p className={described ? 'project-card-desc' : 'project-card-desc project-card-desc-none'}>
        {described ? space.description : 'No description yet.'}
      </p>

      <div className="project-card-progress">
        <SpaceBar space={space} />
        <SpaceCounts space={space} />
      </div>

      <footer className="project-card-foot">
        <SpaceFaces space={space} theme={theme} />
        <span className="space-card-actions">
          <SpaceActions {...props} settingsLabel="icon" />
        </span>
      </footer>
    </article>
  );
}
