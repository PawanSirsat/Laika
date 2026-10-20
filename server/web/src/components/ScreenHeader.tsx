import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './screen-header.css';

export interface ScreenHeaderProps {
  /** `Board`, `Timeline`, `Sprints` — the screen's own name. */
  readonly title: string;
  /** `laika-core · v0.4 release`. Omitted when there is nothing true to say. */
  readonly context?: ReactNode;
  /** Controls, right-aligned. */
  readonly children?: ReactNode;
  /**
   * `band` — the compact bar every screen had (the default).
   * `page` — a top-level page of the reorganised app (LAI-796): a larger
   * title, a line under it, and a row below for its tabs.
   */
  readonly variant?: 'band' | 'page';
  /** Page only: a sentence under the title. */
  readonly description?: ReactNode;
  /** Page only: before the title — an organisation's mark. */
  readonly lead?: ReactNode;
  /** Page only: the row under the title — the page's tabs, or My day's week. */
  readonly below?: ReactNode;
  /**
   * Page only: receives the element a screen inside the page hands its header
   * controls to — see {@link EmbeddedScreen}.
   */
  readonly onActionsSlot?: (element: HTMLElement | null) => void;
}

interface Embed {
  /** Where the embedded screen's controls go — the page header's actions. */
  readonly slot: HTMLElement | null;
  /** Draw the screen's own title as a section heading, rather than not at all. */
  readonly titled: boolean;
}

const EmbedContext = createContext<Embed | undefined>(undefined);

export interface EmbeddedScreenProps {
  readonly slot: HTMLElement | null;
  readonly titled?: boolean;
  readonly children: ReactNode;
}

/**
 * A screen shown inside a page rather than as one (LAI-796): Review inside
 * Inbox, Capacity inside Insights, Tokens inside Developer access.
 *
 * **The screens are unchanged.** Each still renders its own `ScreenHeader`;
 * inside this, that header gives up its band — the page already says where
 * the reader is, in its title and its tabs — and **hands its controls to the
 * page header**, so a screen's own control (Usage's range, a *New token*
 * button) sits where the page's controls sit. Its context line stays with the
 * screen, above its content, because it is about what the screen shows.
 */
export function EmbeddedScreen({ slot, titled = false, children }: EmbeddedScreenProps) {
  return <EmbedContext.Provider value={{ slot, titled }}>{children}</EmbedContext.Provider>;
}

/**
 * The header bar every screen shares.
 *
 * The prototype gives all ten screens the identical band — `12px 18px` on
 * `var(--bg-card)` with a bottom border, the title at 15px/800 and a 10px context
 * line beside it, controls pushed right. Building it once means a new screen
 * cannot drift, and it removes the reason each screen had its own header markup.
 *
 * It also fixes a visible defect: `AppShell` used to render its own
 * `<h1>Board</h1>` above `BoardScreen`, which renders the project name — so the
 * board showed two stacked headings.
 */
export function ScreenHeader({
  title,
  context,
  children,
  variant = 'band',
  description,
  lead,
  below,
  onActionsSlot,
}: ScreenHeaderProps) {
  const embed = useContext(EmbedContext);

  if (embed !== undefined && variant === 'band') {
    return (
      <>
        {embed.titled ? (
          <div className="screen-section-head">
            <h2 className="screen-section-title">{title}</h2>
            {context !== undefined && <span className="screen-section-context">{context}</span>}
          </div>
        ) : (
          context !== undefined && <p className="screen-embedded-context">{context}</p>
        )}
        {children !== undefined && embed.slot !== null && createPortal(children, embed.slot)}
      </>
    );
  }

  if (variant === 'page') {
    return (
      <header className={below === undefined ? 'screen-page' : 'screen-page screen-page-tabbed'}>
        <div className="screen-page-row">
          {lead}
          <div className="screen-page-titles">
            <div className="screen-page-titleline">
              <h1 className="screen-page-title">{title}</h1>
              {context !== undefined && <span className="screen-page-context">{context}</span>}
            </div>
            {description !== undefined && <p className="screen-page-desc">{description}</p>}
          </div>
          <div className="screen-page-actions">
            {children}
            {/* `display: contents`: what a screen hands up flows in this row. */}
            <span className="screen-page-slot" ref={onActionsSlot} />
          </div>
        </div>
        {below !== undefined && <div className="screen-page-below">{below}</div>}
      </header>
    );
  }

  return (
    <header className="screen-bar">
      <h1 className="screen-bar-title">{title}</h1>
      {context !== undefined && <p className="screen-bar-context">{context}</p>}
      {children !== undefined && <div className="screen-bar-actions">{children}</div>}
    </header>
  );
}
