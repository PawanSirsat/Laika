import type { Checkpoint } from '../../../api/handoffs.ts';
import { dateTime } from '../../../api/time-label.ts';

const VERIFICATION: Readonly<Record<Checkpoint['verification'], string>> = {
  pending: 'Not yet verified',
  verified: 'Verified on the remote',
  ref_deleted: 'Its branch was deleted',
  uncertain: 'Could not be verified',
};

/**
 * **Evidence while the work is in progress** (LAI-1199; Workroom spec §1.3):
 * the newest save's branch, commit and files, **labelled as a save and not
 * as proof** — proof is what a finished round claims and GitHub confirms,
 * below it.
 */
export function LatestSave({
  save,
  status,
  hasRounds,
}: {
  readonly save: Checkpoint | undefined;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly hasRounds: boolean;
}) {
  if (save === undefined) {
    if (status !== 'ready' || hasRounds) return null;
    return <p className="wr-empty">No round yet, and no save to show in the meantime.</p>;
  }
  return (
    <section className="wr-card wr-save" aria-labelledby="wr-save-h" data-card="latest-save">
      <h3 id="wr-save-h" className="wr-card-title">
        Latest save <span className="wr-badge">A save, not yet proof</span>
      </h3>
      <p className="wr-card-body">
        <code>{save.commit_sha.slice(0, 7)}</code> on <code>{save.branch}</code> ·{' '}
        {String(save.manifest.length)} file{save.manifest.length === 1 ? '' : 's'} ·{' '}
        {VERIFICATION[save.verification]} · {dateTime(save.created_at, Date.now())}
      </p>
    </section>
  );
}
