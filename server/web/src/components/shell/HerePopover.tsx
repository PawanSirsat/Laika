import { type MouseEvent } from 'react';
import type { PresencePerson } from '../../api/presence.ts';
import type { Theme } from '../../theme/theme.ts';
import { Avatar } from '../avatar/Avatar.tsx';
import { PersonLink } from '../PersonLink.tsx';
import { hereStatusText } from './here-derive.ts';

/** Capacity, online first: everything about the people this list names. */
export const CAPACITY_HREF = '/insights?tab=capacity&sort=online';

export interface HerePopoverProps {
  readonly people: readonly PresencePerson[];
  readonly now: number;
  readonly theme: Theme;
  readonly navigate: (to: string) => void;
  readonly onClose: (refocus: boolean) => void;
}

/**
 * Who is here (LAI-1348): the people online, then the people away, each
 * with their status in words, and a way to Capacity for the rest of it. A
 * name is a link to the profile for a reader who may open one (`PersonLink`),
 * plain text for anyone else.
 */
export function HerePopover({ people, now, theme, navigate, onClose }: HerePopoverProps) {
  const online = people.filter((p) => p.status === 'online');
  const away = people.filter((p) => p.status === 'away');

  const toCapacity = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onClose(false);
    navigate(CAPACITY_HREF);
  };

  return (
    <div className="hdr-popover hdr-here-pop" role="dialog" aria-label="Who is here" data-here-pop>
      <div className="hdr-popover-head">
        <h2 className="hdr-popover-title">Who’s here</h2>
      </div>
      {/* A profile link navigates on its own (`PersonLink`); the list then closes. */}
      <div
        className="hdr-here-body"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a') !== null) onClose(false);
        }}
      >
        {(
          [
            ['online', 'Online', online],
            ['away', 'Away', away],
          ] as const
        ).map(
          ([key, heading, list]) =>
            list.length > 0 && (
              <section key={key} className="hdr-here-group" data-here-group={key}>
                <h3 className="hdr-menu-heading">
                  {heading} · {String(list.length)}
                </h3>
                <ul className="hdr-here-list">
                  {list.map((person) => (
                    <li
                      key={person.user_id}
                      className="hdr-here-row"
                      data-here-row={person.user_id}
                    >
                      <Avatar
                        name={person.name}
                        userId={person.user_id}
                        theme={theme}
                        size={26}
                        presence={person.status}
                        label={null}
                      />
                      <span className="hdr-here-who">
                        {/* The name in its own span: a reader who may not open a
                            profile gets the text alone, styled the same. */}
                        <PersonLink userId={person.user_id} className="hdr-here-link">
                          <span className="hdr-here-name">{person.name}</span>
                        </PersonLink>
                        <span className="hdr-here-status" data-here-status={person.status}>
                          {hereStatusText(person, now)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ),
        )}
      </div>
      <div className="hdr-here-foot">
        <a className="hdr-text-button" href={CAPACITY_HREF} onClick={toCapacity} data-here-capacity>
          Open Capacity
        </a>
      </div>
    </div>
  );
}
