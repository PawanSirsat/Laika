import { firstName } from '../../../components/availability/availability-derive.ts';

/**
 * The profile's frame (SPEC §11.4.2.1, D-139, LAI-1152): which tabs a reader
 * gets, what each is called, and the notice's two wordings. Pure, so the rules
 * are tested without a page.
 */

/**
 * The profile's sections (LAI-959, LAI-1134, LAI-1140, LAI-1152): the record,
 * the person's day, their time, and their developer setup — *Developer
 * access* on your own. For someone else, Day and Time report are *See
 * everyone's analytics* and Developer setup is *See and manage anyone's
 * developer setup*, so a reader may hold either set alone; on your own, all
 * four are yours (D-139).
 */
export type ProfileTab = 'overview' | 'day' | 'time' | 'dev';

const TABS: readonly ProfileTab[] = ['overview', 'day', 'time', 'dev'];

/** A tab's name: Developer setup is *Developer access* on your own (SPEC §11.4.2.1). */
export function profileTabLabel(id: ProfileTab, own: boolean): string {
  if (id === 'day') return 'Day';
  if (id === 'time') return 'Time report';
  if (id === 'dev') return own ? 'Developer access' : 'Developer setup';
  return 'Overview';
}

/** `?tab=` as a tab: `hours` is the Time report's old name, kept so its links still land. */
export function profileTab(tab: string | undefined): ProfileTab {
  if (tab === 'day') return 'day';
  if (tab === 'time' || tab === 'hours') return 'time';
  if (tab === 'dev') return 'dev';
  return 'overview';
}

/**
 * The tabs this reader may open on this profile: every one on your own
 * (D-139 item 1), and on someone else's only those the reader is granted.
 */
export function profileTabs(
  own: boolean,
  readsDays: boolean,
  readsSetup: boolean,
): readonly ProfileTab[] {
  return TABS.filter(
    (id) =>
      id === 'overview' ||
      own ||
      (readsDays && (id === 'day' || id === 'time')) ||
      (readsSetup && id === 'dev'),
  );
}

/** The notice at the top right (SPEC §11.4.2.1), in its two wordings. */
export function profileNotice(own: boolean, name: string): string {
  return own
    ? 'Owners and admins see a read-only copy · you can see who looked'
    : `Owners and admins only · read-only · ${firstName(name)} can see that you looked`;
}
