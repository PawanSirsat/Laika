import { useGates } from '../../api/permissions.ts';
import { useOrgPeople } from '../../api/use-org-people.ts';
import { Icon } from '../icon/Icon.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useShell } from './shell-context.ts';
import { backToMeHref, personView, SEE_EVERYONE } from './header-model.ts';

/** What each person view shows of them, for the chip's spoken name. */
const VIEW_NOUN = { 'my-day': 'day', work: 'work', time: 'time' } as const;

/**
 * **Viewing: <name>** (LAI-1188): said in the header while a screen shows
 * somebody else — My day's `?user=`, Work's `&person=`, Time's `&member=` —
 * with one click back to the reader's own view of the same screen.
 *
 * Only for a reader who holds *See everyone's analytics*
 * (`people.analytics.read`, from `GET /permissions`); a member never has a
 * person view to leave, and their browser never asks for the people list.
 * Reading only — no session or identity changes, and the screen underneath
 * still draws only what the server sends.
 */
export function ViewingChip() {
  const {
    route: { path, params, navigate },
    me,
  } = useShell();
  const { org } = useGates(me !== undefined);
  const view = me !== undefined && org(SEE_EVERYONE) ? personView(path, params, me.id) : undefined;
  const people = useOrgPeople(view !== undefined);
  if (view === undefined || me === undefined) return null;

  const name = people?.find((p) => p.id === view.userId)?.name ?? 'This person';
  const back = `Back to your own ${VIEW_NOUN[view.kind]}`;
  return (
    <span className="shell-viewing" data-viewing-chip={view.kind}>
      <span className="shell-viewing-text">
        <span className="shell-viewing-label">Viewing:</span>{' '}
        <span className="shell-viewing-name">{name}</span>
      </span>
      <Tooltip content={back}>
        <button
          type="button"
          className="shell-viewing-back"
          data-viewing-back
          onClick={() => {
            navigate(backToMeHref(view, path, params, me.id));
          }}
        >
          <span className="shell-viewing-me" aria-hidden="true">
            Me
          </span>
          <Icon name="close" size="tiny" />
          <span className="visually-hidden">
            Stop viewing {name}. {back}
          </span>
        </button>
      </Tooltip>
    </span>
  );
}
