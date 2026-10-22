import { useEffect, useState } from 'react';
import { listAllUsers, type OrgUser } from '../../../api/users.ts';
import { Dropdown, type DropdownOption } from '../../../components/Dropdown.tsx';

/** `undefined` while reading; the people, the reader first left out; `null` if the read failed. */
export type People = readonly OrgUser[] | null | undefined;

/**
 * The organisation's active people, for the switcher and the banner's name.
 * Asked only by a reader who holds *See everyone's analytics* (LAI-959).
 */
export function usePeople(enabled: boolean): People {
  const [people, setPeople] = useState<People>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listAllUsers(controller.signal)
      .then(({ users }) => {
        if (!controller.signal.aborted) {
          setPeople([...users].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPeople(null);
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);
  return people;
}

export interface ViewingSwitchProps {
  readonly meId: string;
  /** Whose day is shown; `undefined` is the reader's own. */
  readonly subjectId: string | undefined;
  readonly people: People;
  readonly onPick: (userId: string | undefined) => void;
}

const ME = '';

/**
 * **Viewing: Me ▾** (LAI-959, D-102): My day for somebody else, read only.
 * Drawn only for a reader who holds the capability — absent, not disabled,
 * for everyone else. The choice is the URL's `?user=`, so Back returns.
 */
export function ViewingSwitch({ meId, subjectId, people, onPick }: ViewingSwitchProps) {
  const others = (people ?? []).filter((p) => p.id !== meId);
  const options: DropdownOption[] = [
    { value: ME, label: 'Me' },
    ...others.map((p) => ({ value: p.id, label: p.name, detail: p.email })),
  ];
  // A `?user=` the list has not named yet still reads as somebody, not as Me.
  if (subjectId !== undefined && !others.some((p) => p.id === subjectId)) {
    options.push({ value: subjectId, label: 'This person' });
  }
  const current = options.find((o) => o.value === (subjectId ?? ME));

  return (
    <span className="myday-viewing-switch" data-viewing-switch>
      <Dropdown
        value={subjectId ?? ME}
        options={options}
        aria-label="Whose day"
        noun="people"
        variant="bare"
        className="myday-chip myday-viewing-trigger"
        display={
          <>
            <span className="myday-viewing-label">Viewing:</span> {current?.label ?? 'Me'}
          </>
        }
        onChange={(value) => {
          onPick(value === ME ? undefined : value);
        }}
      />
    </span>
  );
}
