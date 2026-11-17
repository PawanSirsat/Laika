/**
 * What a Teams post says, and the exact bytes it is sent as (D-154, LAI-1314)
 * — KSage's `notify.rs`, ported line for line so **the Power Automate flows
 * KSage posts to take Laika's posts unchanged**.
 *
 * The delivery details are not preferences. Each cost KSage time on the JUTA
 * build, and each is repeated here deliberately:
 *
 *  - the flow is *"Post message in a chat or channel"* and reads
 *    `triggerBody()?['text']` and nothing else, so the payload is one
 *    top-level `text` field — `{"text":"…"}`, nothing beside it;
 *  - that field is **HTML**, where a newline is whitespace, so every line
 *    break is `<br>` and the structure is carried by markup;
 *  - the JSON is **ASCII-escaped**: the gateway refuses raw multi-byte
 *    characters `400` even when the charset says UTF-8, so an em dash in a
 *    title would otherwise lose the whole message;
 *  - any `2xx` is success — Power Automate answers `202`, not `200`.
 *
 * Pure: no database, no clock, no network. `teams-client.ts` sends what this
 * builds.
 */

/** A section that is genuinely tabular: a heading carrying its count, columns, rows. */
export interface TeamsTable {
  readonly heading: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** One line between the heading and the table, for something true of the whole group. */
  readonly note: string | null;
}

/** One post, composed once and rendered as HTML for Teams and as text for a reader. */
export interface TeamsNotice {
  readonly title: string;
  /** Which scheduled run produced this, named in full; null for anything else. */
  readonly label?: string | null;
  /** The header block — label and value, in the order given, on every run. */
  readonly fields?: readonly (readonly [string, string])[];
  readonly lines: readonly string[];
  /** Rendered after `lines`, so a post opens with its summary and the detail follows. */
  readonly tables?: readonly TeamsTable[];
  /** Next steps, as bullets, after the detail and before the link. */
  readonly actions?: readonly string[];
  /** A link back into Laika. The post never acts; it only takes you there. */
  readonly link?: string | null;
}

/** The link's words, KSage's *Open in KSage* in Laika's name. */
export const OPEN_IN_LAIKA = 'Open in Laika';

/** `&`, `<` and `>` — a task title is somebody's free text, landing in an HTML field. */
function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * One line of `lines`. Indentation is meaning, not decoration — an item sits
 * under the person named on the line above it — so leading spaces become
 * non-breaking, which HTML does not eat; an unindented line ending in a colon
 * is a section heading, in bold.
 */
function renderLine(line: string): string {
  const body = escape(line.trimStart());
  const indent = line.length - line.trimStart().length;
  const heading = indent === 0 && body.endsWith(':');
  return `${'&nbsp;'.repeat(indent)}${heading ? `<b>${body}</b>` : body}`;
}

/**
 * The notice as Teams renders it — KSage's `Notice::to_html`.
 *
 * Tables carry inline styles: a posted message has no `<head>` to put a
 * stylesheet in, and an unstyled table in Teams runs its columns together.
 * **A section with no rows keeps its heading and its note and loses its
 * grid** — "no blockers" and "the blocker query broke" must not look the
 * same, and a one-row table saying *None* reads as data.
 */
export function noticeHtml(notice: TeamsNotice): string {
  const fields = notice.fields ?? [];
  const out = [`<b>${escape(notice.title)}</b>`];
  if (notice.label !== undefined && notice.label !== null)
    out.push(`<b>${escape(notice.label)}</b>`);
  // The label is bold and the value is not, so the eye runs down the labels.
  for (const [key, value] of fields) out.push(`<b>${escape(key)}:</b> ${escape(value)}`);
  if (fields.length > 0 && notice.lines.length > 0) out.push('');
  out.push(...notice.lines.map(renderLine));

  let html = out.join('<br>');
  for (const table of notice.tables ?? []) {
    html += `<br><br><b>${escape(table.heading)}</b>`;
    if (table.note !== null) html += `<br>${escape(table.note)}`;
    if (table.rows.length === 0) continue;
    html += '<table style="border-collapse:collapse;margin-top:6px" border="1" cellpadding="6">';
    if (table.headers.length > 0) {
      html += '<tr>';
      for (const header of table.headers) {
        html += `<th align="left" style="background:#f2f5f8">${escape(header)}</th>`;
      }
      html += '</tr>';
    }
    for (const row of table.rows) {
      html += '<tr>';
      for (const cell of row) html += `<td align="left">${escape(cell)}</td>`;
      html += '</tr>';
    }
    html += '</table>';
  }

  const actions = notice.actions ?? [];
  if (actions.length > 0) {
    html += '<br><br><b>Actions / next steps</b><ul>';
    for (const action of actions) html += `<li>${escape(action)}</li>`;
    html += '</ul>';
  }

  // The address is Laika's own, not user text, and is escaped anyway so this
  // stays true if that ever stops being the case.
  if (notice.link !== undefined && notice.link !== null) {
    html += `<br><br><a href="${escape(notice.link)}">${OPEN_IN_LAIKA}</a>`;
  }
  return html;
}

/** Padded to the widest cell per column, so a table is still a table in plain text. */
function padRow(cells: readonly string[], widths: readonly number[]): string {
  return cells
    .map((cell, i) => cell.padEnd(widths[i] ?? 0))
    .join('  ')
    .trimEnd();
}

/**
 * The notice as plain text — KSage's `Notice::to_text`, the rendering a test
 * and a log can read. Field values line up under each other, which is the
 * whole reason two runs a day can be compared at a glance.
 */
export function noticeText(notice: TeamsNotice): string {
  const fields = notice.fields ?? [];
  const out = [notice.title];
  if (notice.label !== undefined && notice.label !== null) out.push(notice.label);
  if (fields.length > 0) {
    out.push('');
    const width = Math.max(0, ...fields.map(([key]) => [...key].length));
    for (const [key, value] of fields) out.push(`${`${key}:`.padEnd(width + 1)}  ${value}`);
  }
  if (notice.lines.length > 0) out.push('');
  out.push(...notice.lines);

  for (const table of notice.tables ?? []) {
    out.push('', table.heading);
    if (table.note !== null) out.push(table.note);
    if (table.rows.length === 0) continue;
    const columns = Math.max(table.headers.length, ...table.rows.map((row) => row.length));
    const widths = Array.from({ length: columns }, (_, i) =>
      Math.max(
        [...(table.headers[i] ?? '')].length,
        ...table.rows.map((row) => [...(row[i] ?? '')].length),
      ),
    );
    if (table.headers.length > 0) out.push(padRow(table.headers, widths));
    for (const row of table.rows) out.push(padRow(row, widths));
  }

  const actions = notice.actions ?? [];
  if (actions.length > 0) {
    out.push('', 'Actions / next steps');
    for (const action of actions) out.push(`  - ${action}`);
  }
  if (notice.link !== undefined && notice.link !== null) {
    out.push('', `${OPEN_IN_LAIKA}: ${notice.link}`);
  }
  return out.join('\n');
}

/**
 * Every non-ASCII UTF-16 unit as `\uXXXX` — KSage's `ascii_escaped`.
 * `JSON.stringify` does not do this, and the Teams gateway needs it.
 *
 * Per UTF-16 unit, not per code point: a character beyond the BMP — the
 * stand-up's 🔴 — is written as its two surrogate halves, which is how JSON
 * spells it and what KSage sends.
 */
export function asciiEscaped(text: string): string {
  return text.replace(
    /[^\x00-\x7f]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * The request body: `{"text":"<html>"}`, ASCII-escaped, built by hand so the
 * escaping survives — byte for byte what KSage's `notify::send` writes.
 */
export function teamsPayload(notice: TeamsNotice): string {
  return `{"text":${asciiEscaped(JSON.stringify(noticeHtml(notice)))}}`;
}
