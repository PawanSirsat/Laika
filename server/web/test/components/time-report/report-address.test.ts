/**
 * The Time report's address (LAI-1189, LAI-1216): read leniently, written
 * with defaults left out, and never touching a key it does not own.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dayParam,
  readReportAddress,
  REPORT_ADDRESS_KEYS,
  writeReportAddress,
} from '../../../src/components/time-report/report-address.ts';

const read = (query: string) => readReportAddress(new URLSearchParams(query));

void describe('reading the address', () => {
  void test('every field, as written', () => {
    assert.deepEqual(
      read(
        'tab=time&period=week&date=2026-11-02&from=2026-10-01&to=2026-10-31&space=laika,onroute&member=u2&kind=meeting,work&link=general&drafts=include',
      ),
      {
        range: 'week',
        anchor: '2026-11-02',
        from: '2026-10-01',
        to: '2026-10-31',
        spaces: ['laika', 'onroute'],
        members: ['u2'],
        kinds: ['meeting', 'work'],
        link: 'general',
        drafts: true,
      },
    );
  });

  void test('anything it cannot use is absent, never an error', () => {
    assert.deepEqual(
      read('period=year&date=2026-02-30&from=yesterday&kind=bogus&link=nope&drafts=yes&member=,,'),
      {
        range: undefined,
        anchor: undefined,
        from: undefined,
        to: undefined,
        spaces: undefined,
        members: undefined,
        kinds: undefined,
        link: undefined,
        drafts: undefined,
      },
    );
    assert.deepEqual(
      read('kind=meeting,bogus,meeting').kinds,
      ['meeting'],
      'junk and repeats kept',
    );
  });

  void test('a day must be a real one', () => {
    assert.equal(dayParam('2026-11-13'), '2026-11-13');
    assert.equal(dayParam('2026-02-29'), undefined, 'no 29 Feb in 2026');
    assert.equal(dayParam('13/11/2026'), undefined);
    assert.equal(dayParam(null), undefined);
  });
});

void describe('writing the address', () => {
  void test('an empty address leaves only the keys the report does not own', () => {
    const was = new URLSearchParams('tab=time&period=week&member=u2&kind=work');
    assert.equal(writeReportAddress(was, {}).toString(), 'tab=time');
  });

  void test('what it writes reads back the same', () => {
    const address = {
      range: 'range',
      from: '2026-10-01',
      to: '2026-10-10',
      spaces: ['laika'],
      members: ['u2', 'u3'],
      kinds: ['review'],
      link: 'task',
      drafts: true,
    } as const;
    const written = writeReportAddress(new URLSearchParams('tab=time'), address);
    assert.equal(written.get('tab'), 'time');
    assert.equal(written.get('member'), 'u2,u3');
    assert.equal(written.get('drafts'), 'include');
    const back = readReportAddress(written);
    assert.deepEqual(
      { ...back, anchor: undefined },
      {
        ...address,
        anchor: undefined,
        spaces: ['laika'],
        members: ['u2', 'u3'],
        kinds: ['review'],
      },
    );
  });

  void test('drafts off is the default and writes nothing', () => {
    assert.equal(writeReportAddress(new URLSearchParams(), { drafts: false }).toString(), '');
  });

  void test('it owns exactly the keys it reads', () => {
    assert.deepEqual([...REPORT_ADDRESS_KEYS].sort(), [
      'date',
      'drafts',
      'from',
      'kind',
      'link',
      'member',
      'period',
      'space',
      'to',
    ]);
  });
});
