/**
 * The order things happened in on this page, as one rising number (LAI-538
 * review, round 5).
 *
 * A server timestamp is not a revision: two writes in one millisecond share
 * an `updated_at`, so "is this read newer than my save?" cannot be answered
 * from the data. It can be answered locally. A list read takes a number when
 * it **starts**, a save takes one when it **completes**, and a read whose
 * number is larger began after the save — so whatever it returns is at least
 * as new as the save, even on a timestamp tie.
 */
let last = 0;

/** A number larger than every one handed out before it on this page. */
export function nextReadOrder(): number {
  last += 1;
  return last;
}
