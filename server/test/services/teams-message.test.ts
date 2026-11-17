import { describe, expect, it } from 'vitest';
import {
  asciiEscaped,
  noticeHtml,
  noticeText,
  teamsPayload,
  type TeamsNotice,
} from '../../src/services/teams-message.ts';

/**
 * The bytes a Teams post is sent as (D-154, LAI-1314) — KSage's `notify.rs`
 * tests, ported, because **the flows KSage posts to must take Laika's posts
 * unchanged**: one `text` field, HTML inside it, every non-ASCII character
 * escaped.
 */

describe('the payload KSage’s flows read', () => {
  it('is one top-level text field and nothing beside it', () => {
    const body = teamsPayload({ title: 'LAI-1 is yours', lines: ['A title'] });
    expect(Object.keys(JSON.parse(body) as object)).toEqual(['text']);
    // Built by hand, as KSage's is: no spaces, the field first.
    expect(body.startsWith('{"text":"<b>LAI-1 is yours</b><br>A title"')).toBe(true);
    expect(body.endsWith('"}')).toBe(true);
  });

  it('escapes every multi-byte character, so an em dash cannot lose the message', () => {
    const out = asciiEscaped('done — shipped ✅');
    expect(/^[\x00-\x7f]*$/.test(out)).toBe(true);
    expect(out).toContain('\\u2014');
    expect(out).toContain('\\u2705');
  });

  it('writes a character beyond the BMP as its two surrogate halves, as JSON spells it', () => {
    const body = teamsPayload({ title: 'Status', fields: [['Status', '🔴 Blocked']], lines: [] });
    expect(/^[\x00-\x7f]*$/.test(body)).toBe(true);
    expect(body).toContain('\\ud83d\\udd34');
    // And it reads back as the same character.
    expect((JSON.parse(body) as { text: string }).text).toContain('🔴 Blocked');
  });
});

describe('the HTML Teams renders', () => {
  it('gets line breaks, not one paragraph', () => {
    const html = noticeHtml({
      title: "Murphy's Law (MUR) — before stand-up",
      lines: [
        'Blocked (2) — needs a decision today:',
        '  MUR-108 — Gate C. Nobody recorded what it is waiting on.',
        '',
        'In flight:',
        '  Aniket Salunkhe:',
        '    MUR-100 — Drafting Engine',
      ],
      link: 'https://laika.example/board?project=mur',
    });

    expect(html).not.toContain('\n');
    // Title, six lines, the blank before the link, and the link: eight breaks.
    expect(html.match(/<br>/g)).toHaveLength(8);
    expect(html).toContain('<b>Blocked (2) — needs a decision today:</b>');
    expect(html).toContain('<b>In flight:</b>');
    // Indentation is meaning: the owner under the heading, the task under the owner.
    expect(html).toContain('&nbsp;&nbsp;Aniket Salunkhe:');
    expect(html).toContain('&nbsp;&nbsp;&nbsp;&nbsp;MUR-100');
    expect(html).toContain('<a href="https://laika.example/board?project=mur">Open in Laika</a>');
  });

  it('escapes a quote, so nothing can end the link’s attribute', () => {
    const html = noticeHtml({
      title: 'Say "done"',
      lines: [],
      link: 'https://laika.example/task/X" onmouseover="alert(1)',
    });
    expect(html).toContain(
      '<a href="https://laika.example/task/X&quot; onmouseover=&quot;alert(1)">Open in Laika</a>',
    );
    expect(html).toContain('<b>Say &quot;done&quot;</b>');
    expect(html).not.toContain('" onmouseover');
  });

  it('never lets a title become markup', () => {
    const html = noticeHtml({
      title: 'New comment on <script>alert(1)</script>',
      lines: ['  Fix the <div> & the >> arrows'],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;div&gt; &amp; the &gt;&gt;');
  });

  it('never lets a cell, a heading, a note, a field or an action become markup', () => {
    const html = noticeHtml({
      title: 'x',
      label: '<b>label</b>',
      fields: [['<i>k</i>', '<script>alert(1)</script>']],
      lines: [],
      tables: [
        {
          heading: '<b>heading</b>',
          headers: ['<th>'],
          rows: [['<script>alert(2)</script>']],
          note: '<i>note</i>',
        },
      ],
      actions: ['<img src=x onerror=alert(1)>'],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;b&gt;heading');
    expect(html).toContain('&lt;i&gt;note');
    expect(html).toContain('&lt;i&gt;k');
    expect(html).toContain('&lt;b&gt;label');
  });

  it('draws a tabular section as a table, before the actions and the link', () => {
    const notice: TeamsNotice = {
      title: 'RMB (RMB) — before stand-up',
      lines: ['Blocked 2  ·  In flight 5'],
      tables: [
        {
          heading: 'Blocked (2) — needs a decision today',
          headers: ['Task', 'What', 'Who', 'Waiting'],
          rows: [
            ['RMB-52', 'Deployment on Kvell', 'Suhit Telang', 'for 4 days'],
            ['RMB-107', 'PPTX export 502s', 'Yash Khatri', 'for a day'],
          ],
          note: null,
        },
      ],
      actions: ['Decide or escalate 2 blocked task(s).', 'Next update: 06:00 PM IST today.'],
      link: 'https://laika.example/board?project=rmb',
    };
    const html = noticeHtml(notice);
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html.match(/<th /g)).toHaveLength(4);
    expect(html.match(/<td /g)).toHaveLength(8);
    expect(html.match(/<li>/g)).toHaveLength(2);
    const table = html.indexOf('<table');
    const actions = html.indexOf('Actions / next steps');
    const link = html.indexOf('Open in Laika');
    expect(table).toBeGreaterThan(-1);
    expect(table < actions && actions < link).toBe(true);
  });

  it('keeps an empty section’s heading and note, and draws no grid for it', () => {
    const html = noticeHtml({
      title: 'x',
      lines: [],
      tables: [
        {
          heading: 'Blocked (0) — needs a decision today',
          headers: ['Task', 'What'],
          rows: [],
          note: 'Nothing blocked.',
        },
      ],
    });
    expect(html).toContain('Blocked (0)');
    expect(html).toContain('Nothing blocked.');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<th');
  });

  it('puts the header block above the summary, label bold and value plain', () => {
    const html = noticeHtml({
      title: 'RMB (RMB) — Daily Update',
      label: '11:00 AM IST Run Update',
      fields: [
        ['Run', '11:00 AM IST Run Update'],
        ['Status', '🟡 At Risk'],
        ['Owner', 'Suhit Telang'],
      ],
      lines: ['Past their date 8  ·  In flight 29'],
    });
    expect(html).toContain('<b>Status:</b> 🟡 At Risk');
    expect(html.indexOf('Owner:')).toBeLessThan(html.indexOf('Past their date'));
  });
});

describe('the plain text', () => {
  it('pads a table into columns', () => {
    const text = noticeText({
      title: 't',
      lines: [],
      tables: [
        {
          heading: 'Blocked (2)',
          headers: ['Task', 'Who'],
          rows: [
            ['RMB-52', 'Suhit'],
            ['RMB-1070', 'Yash'],
          ],
          note: null,
        },
      ],
    });
    const rows = text.split('\n').filter((l) => l.startsWith('RMB-'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.indexOf('Suhit')).toBe(rows[1]?.indexOf('Yash'));
  });

  it('lines the header values up under each other', () => {
    const text = noticeText({
      title: 'x',
      fields: [
        ['Run', 'a'],
        ['Status', 'b'],
        ['Owner', 'c'],
      ],
      lines: [],
    });
    const valueAt = (label: string) => {
      const line = text.split('\n').find((l) => l.startsWith(label)) ?? '';
      return line.length - line.slice(line.indexOf(':') + 1).trimStart().length;
    };
    expect(valueAt('Run:')).toBe(valueAt('Status:'));
    expect(valueAt('Status:')).toBe(valueAt('Owner:'));
  });

  it('ends with the actions as a list, then the link', () => {
    const text = noticeText({
      title: 'x',
      lines: [],
      actions: ['Next update: 06:00 PM IST today.'],
      link: 'https://laika.example/board?project=x',
    });
    expect(text).toContain('  - Next update: 06:00 PM IST today.');
    expect(text.endsWith('Open in Laika: https://laika.example/board?project=x')).toBe(true);
  });
});
