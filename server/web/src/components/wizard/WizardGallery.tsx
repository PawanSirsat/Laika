import { useState, type ReactNode } from 'react';
import { OverflowMenu } from './OverflowMenu.tsx';
import { StatusChip, type StatusTone } from './StatusChip.tsx';

/**
 * The Developer access V3 parts that Connect does not use yet (LAI-1044), on
 * `/design/states` so they can be reviewed — and their keys tested in a
 * browser — before a screen does. **Its own chunk**, like the agent states:
 * the example rows here never reach a live screen.
 *
 * The rows are examples of the shape, not data: a real screen fills them
 * from the API.
 */

const CHIPS: readonly {
  readonly tone: StatusTone;
  readonly word: string;
  readonly reason?: string;
}[] = [
  { tone: 'ok', word: 'Ready', reason: 'reached the board over MCP' },
  { tone: 'waiting', word: 'Waiting', reason: 'no check-in yet' },
  { tone: 'warn', word: 'Needs update', reason: 'the plugin is older than this board' },
  { tone: 'danger', word: 'Revoked', reason: 'its credential no longer works' },
  { tone: 'neutral', word: 'Version unknown' },
];

export default function WizardGallery() {
  const [chosen, setChosen] = useState<string | undefined>(undefined);

  return (
    <section className="agent-gallery" aria-labelledby="wizard-gallery-heading" data-wizard-gallery>
      <h2 id="wizard-gallery-heading" className="gallery-heading">
        Developer access parts
      </h2>
      <p className="gallery-sub">
        Shared components for Developer access (LAI-1044). Switch the theme above — every colour is
        an existing token.
      </p>

      <div className="gallery-grid">
        <Specimen
          id="overflow-menu"
          title="Row actions menu"
          note="⋯ opens it; arrows move, Home and End jump, Escape closes and returns focus, Tab moves on."
        >
          <div className="wizard-gallery-row">
            <span>Example row</span>
            <OverflowMenu
              label="More actions for the example row"
              items={[
                {
                  id: 'reconnect',
                  label: 'Reconnect',
                  onSelect: () => {
                    setChosen('Reconnect');
                  },
                },
                {
                  id: 'rename',
                  label: 'Rename',
                  disabled: true,
                  onSelect: () => {
                    setChosen('Rename');
                  },
                },
                {
                  id: 'details',
                  label: 'Show details',
                  onSelect: () => {
                    setChosen('Show details');
                  },
                },
                {
                  id: 'disconnect',
                  label: 'Disconnect',
                  danger: true,
                  onSelect: () => {
                    setChosen('Disconnect');
                  },
                },
              ]}
            />
            <button type="button" className="bar-control">
              After the menu
            </button>
          </div>
          <p className="gallery-item-note" role="status" data-chosen>
            {chosen === undefined ? 'Nothing chosen yet' : `Chosen: ${chosen}`}
          </p>
        </Specimen>

        <Specimen
          id="status-chip"
          title="Status chip"
          note="A dot, a word and a reason. The word says it without the colour."
        >
          <ul className="wizard-gallery-chips">
            {CHIPS.map((c) => (
              <li key={c.tone}>
                <StatusChip
                  tone={c.tone}
                  word={c.word}
                  {...(c.reason !== undefined ? { reason: c.reason } : {})}
                />
              </li>
            ))}
          </ul>
        </Specimen>
      </div>
    </section>
  );
}

function Specimen({
  id,
  title,
  note,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly children: ReactNode;
}) {
  return (
    <article className="gallery-item" data-specimen={id}>
      <header>
        <h3 className="gallery-item-title">{title}</h3>
        <p className="gallery-item-note">{note}</p>
      </header>
      <div className="gallery-stage">{children}</div>
    </article>
  );
}
