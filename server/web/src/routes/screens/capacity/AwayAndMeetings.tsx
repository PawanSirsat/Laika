import type { CapacityEntry } from '../../../api/presence.ts';
import { awayChips, meetingsText } from './capacity-derive.ts';

/**
 * A person's away and meetings on Capacity (LAI-1331): why they are away —
 * their own period, Outlook's out of office, or both, each a pill with a
 * glyph **and** words — and their meetings this week. Nothing at all when
 * there is nothing to say, or nothing the reader may be told (D-137, D-102).
 *
 * A card draws it as its own line the card's whole width (`card`): beside
 * the load badge the name's column is too narrow for *Outlook · Out of office
 * until Wed 25 Nov*. A list row draws it under the name, in a cell the table
 * scrolls.
 */
export function AwayAndMeetings({
  person,
  card = false,
}: {
  readonly person: CapacityEntry;
  readonly card?: boolean;
}) {
  const chips = awayChips(person.away);
  const meetings = meetingsText(person.meeting_minutes_week);
  if (chips.length === 0 && meetings === undefined) return null;
  const Line = card ? 'div' : 'span';
  return (
    <Line className={card ? 'cap-cal cap-cal-card' : 'cap-cal'} data-cap-cal="">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="avail-pill"
          data-avail-pill="away"
          data-away={chip.key}
          title={`${chip.label} — ${chip.title}`}
        >
          <span className="avail-pill-glyph" aria-hidden="true">
            ◐
          </span>
          <span>{chip.label}</span>
        </span>
      ))}
      {meetings !== undefined && (
        <span className="cap-meetings" data-meetings="">
          {meetings}
        </span>
      )}
    </Line>
  );
}
