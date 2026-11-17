import { useState } from 'react';
import { avatarColor } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import type { Theme } from '../../theme/theme.ts';
import {
  groupOverflow,
  overflowWords,
  PRESENCE_WORDS,
  type AvatarSize,
  type Presence,
} from './avatar-model.ts';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import './avatar.css';

export interface AvatarProps {
  /** The person's name: the initials, the accessible name and the hover. */
  readonly name: string;
  /** Their user id, which picks the stable colour. Absent draws the neutral disc. */
  readonly userId?: string | undefined;
  readonly theme: Theme;
  readonly size?: AvatarSize | undefined;
  /**
   * A picture, when one is served. None is today; the fallback is the point:
   * a picture that fails to load gives way to the initials, never to the
   * browser's broken-image icon.
   */
  readonly src?: string | undefined;
  readonly presence?: Presence | undefined;
  /**
   * The accessible name in full — `Accountable: Ada Lovelace`. Defaults to the
   * name. `null` marks the avatar decorative, for a row that already says the
   * name in text beside it.
   */
  readonly label?: string | null | undefined;
  readonly className?: string | undefined;
}

/**
 * A person, as a disc (LAI-1206): a picture when there is one, the initials
 * otherwise, and a presence dot only when presence is actually known.
 *
 * The initials come from `theme/initials.ts` — the single source — and the
 * colour from `theme/avatar-color.ts`, applied as an inline style (allowed by
 * `style-src-attr`, as every avatar before this one was).
 */
export function Avatar({
  name,
  userId,
  theme,
  size = 24,
  src,
  presence,
  label,
  className,
}: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const colour = userId === undefined ? undefined : avatarColor(userId, theme);
  const spoken =
    label === null
      ? undefined
      : `${label ?? name}${presence === undefined ? '' : `, ${PRESENCE_WORDS[presence]}`}`;
  const picture = src !== undefined && src !== '' && !broken;
  const face = (
    <span
      className={`avatar avatar-${String(size)}${className === undefined ? '' : ` ${className}`}`}
      {...(spoken === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': spoken })}
      data-presence={presence}
    >
      <span
        className="avatar-disc t-avatar"
        style={
          colour === undefined || picture
            ? undefined
            : {
                background: colour.background,
                color: colour.foreground,
                borderColor: colour.border,
              }
        }
      >
        {picture ? (
          <img
            className="avatar-img"
            src={src}
            alt=""
            width={size}
            height={size}
            onError={() => {
              setBroken(true);
            }}
          />
        ) : (
          initials(name)
        )}
      </span>
      {presence !== undefined && (
        <span className={`avatar-presence avatar-presence-${presence}`} aria-hidden="true" />
      )}
    </span>
  );
  // Its name on hover, focus or a long press: the shared tooltip (LAI-1213),
  // lazy because a board draws one per card. It was a bare `title`.
  return label === null ? (
    face
  ) : (
    <Tooltip content={label ?? name} lazy>
      {face}
    </Tooltip>
  );
}

export interface AvatarGroupPerson {
  readonly userId: string;
  readonly name: string;
  readonly presence?: Presence | undefined;
}

/**
 * People, overlapped, with a `+N` for the rest (LAI-1206). The group is one
 * image to a screen reader — `Ada Lovelace, Jo and 3 more: …` — rather than
 * eight separate discs to tab past.
 */
export function AvatarGroup({
  people,
  theme,
  max = 4,
  size = 24,
  label,
}: {
  readonly people: readonly AvatarGroupPerson[];
  readonly theme: Theme;
  readonly max?: number | undefined;
  readonly size?: AvatarSize | undefined;
  /** What the group is: `Watching`, `In this space`. Read before the names. */
  readonly label?: string | undefined;
}) {
  const { shown, extra } = groupOverflow(people.length, max);
  const visible = people.slice(0, shown);
  const rest = people.slice(shown).map((p) => p.name);
  const names = visible.map((p) => p.name).join(', ');
  const spoken = `${label === undefined ? '' : `${label}: `}${names}${
    extra > 0 ? `${names === '' ? '' : ', '}${overflowWords(rest)}` : ''
  }`;
  return (
    <span className={`avatar-group avatar-group-${String(size)}`} role="img" aria-label={spoken}>
      {visible.map((person) => (
        <Avatar
          key={person.userId}
          name={person.name}
          userId={person.userId}
          theme={theme}
          size={size}
          presence={person.presence}
          label={null}
        />
      ))}
      {extra > 0 && (
        <Tooltip content={overflowWords(rest)} lazy>
          <span className="avatar avatar-more t-avatar" aria-hidden="true">
            <span className="avatar-disc">{`+${String(extra)}`}</span>
          </span>
        </Tooltip>
      )}
    </span>
  );
}
