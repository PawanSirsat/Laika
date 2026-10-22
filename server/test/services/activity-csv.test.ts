import { describe, expect, it } from 'vitest';
import { csvField, csvLine, HISTORY_CSV_COLUMNS } from '../../src/services/activity-csv.ts';
import { parseCsv } from '../helpers/csv.ts';

/**
 * The CSV escaping behind `GET /activity/history?format=csv` (LAI-984).
 * Written here rather than taken from a package (the task adds no dependency),
 * so every rule RFC 4180 has is asserted on its own.
 */
describe('csvField', () => {
  it('leaves a plain value alone', () => {
    expect(csvField('task.created')).toBe('task.created');
    expect(csvField(42)).toBe('42');
  });

  it('writes null and undefined as an empty field', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('quotes a comma', () => {
    expect(csvField('Ada, Countess')).toBe('"Ada, Countess"');
  });

  it('quotes a double quote and doubles it', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a newline and a carriage return, keeping them', () => {
    expect(csvField('one\ntwo')).toBe('"one\ntwo"');
    expect(csvField('one\r\ntwo')).toBe('"one\r\ntwo"');
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const out = csvField(`${lead}HYPERLINK("x")`);
      expect(out.startsWith('"\'') || out.startsWith("'"), JSON.stringify(out)).toBe(true);
    }
    expect(csvField('=1+1')).toBe("'=1+1");
    // Quoting still applies on top of the prefix.
    expect(csvField('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('does not touch a number, negative or not', () => {
    expect(csvField(-3)).toBe('-3');
  });
});

describe('csvLine', () => {
  it('joins with commas and ends with CRLF', () => {
    expect(csvLine(['a', 'b,c', null, 'd"e'])).toBe('a,"b,c",,"d""e"\r\n');
  });

  it('round-trips through a reader that knows RFC 4180', () => {
    const values = ['plain', 'with, comma', 'with "quotes"', 'multi\nline', ''];
    expect(parseCsv(csvLine(values))).toEqual([values]);
  });
});

describe('HISTORY_CSV_COLUMNS', () => {
  it('names each column once', () => {
    expect(new Set(HISTORY_CSV_COLUMNS).size).toBe(HISTORY_CSV_COLUMNS.length);
    expect(HISTORY_CSV_COLUMNS[0]).toBe('created_at');
  });
});
