/**
 * What a self-discovering guard found — printed, and floored (LAI-465).
 *
 * ## The defect this exists for
 *
 * Three guards in one week decided their own reach and none reported it: the
 * nullability regex that required one backticked name per row and skipped five
 * columns in multi-name rows; the response-type census that finds types by a
 * `View` suffix and missed two of three new ones; and `structure.test.ts`, whose
 * naming and mirror rules all pass if the directory walk returns nothing.
 *
 * **In every case the guard could not tell *"nothing here"* from *"nothing I
 * recognise"***, and both look like a green test.
 *
 * ## Why printing, and not only asserting
 *
 * A floor assertion catches the total collapse — a walk that returns zero, a
 * parser that matches nothing. It cannot catch the **partial** miss, which is
 * what actually happened all three times: 24 statements instead of 29, one
 * response type instead of three. Nothing is zero, so nothing fails.
 *
 * The only thing that catches a partial miss is **a reader seeing the number**.
 * `served=14` in the gate output is falsifiable by anybody who knows the
 * codebase; silence is not. So this prints on every run, including a passing
 * one — that is the point, not noise.
 *
 * ## Why it throws rather than returning a verdict
 *
 * A caller that has to check a return value is a caller that can forget to. The
 * guards this replaces already had their floors written as ordinary assertions
 * and the two that lacked one lacked it silently.
 */
export function reportDiscovery(guard: string, found: Readonly<Record<string, number>>): void {
  const entries = Object.entries(found);
  if (entries.length === 0) {
    throw new Error(`reportDiscovery("${guard}") was given nothing to report`);
  }

  // **`process.stdout.write`, not `console.log`.** Vitest intercepts `console.*`
  // and the default reporter — the one the root gate runs — does not print it on
  // a passing test. A report only a `--reporter=verbose` run can see is a report
  // nobody reads, which is the defect this function exists for, one level up.
  process.stdout.write(
    `[discovery] ${guard}: ${entries.map(([k, n]) => `${k}=${String(n)}`).join(' ')}\n`,
  );

  const empty = entries.filter(([, n]) => n === 0).map(([k]) => k);
  if (empty.length > 0) {
    throw new Error(
      `${guard} discovered nothing for: ${empty.join(', ')}. ` +
        'An empty input set makes every assertion below compare nothing to nothing ' +
        'and pass — the guard cannot tell "nothing here" from "nothing I recognise".',
    );
  }
}
