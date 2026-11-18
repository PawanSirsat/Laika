/**
 * `src/api/people-directory.ts` — everyone's synced photo, title and manager
 * (D-161, LAI-1330): one read a session, held for every avatar, forgotten on
 * a change of user, and a photo URL only at a version the server named.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, mock, test } from 'node:test';
import {
  DIRECTORY_RETRIES,
  DIRECTORY_RETRY_FIRST_MS,
  directoryEntryOf,
  directoryVersion,
  forgetDirectory,
  loadDirectory,
  photoUrlOf,
  reloadDirectory,
  rememberDirectory,
  reportsOf,
  subscribeDirectory,
} from '../../src/api/people-directory.ts';

const ada = {
  photo_v: 1_795_000_000_000,
  job_title: 'Director',
  department: 'Leadership',
  manager_id: null,
  manager_name: null,
};
const bea = {
  photo_v: null,
  job_title: 'Engineer',
  department: 'Platform',
  manager_id: 'u-ada',
  manager_name: 'Ada',
};

let asked = 0;
let answer: unknown = { people: { 'u-ada': ada, 'u-bea': bea } };
let status = 200;
/** The statuses the next asks answer with, before `status`. */
let next: number[] = [];
globalThis.fetch = ((input: string | URL) => {
  asked += 1;
  assert.equal(input instanceof URL ? input.href : input, '/api/v1/people/directory');
  const status = next.shift() ?? statusNow();
  return Promise.resolve(
    new Response(JSON.stringify(answer), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

function statusNow(): number {
  return status;
}

beforeEach(() => {
  forgetDirectory();
  asked = 0;
  status = 200;
  next = [];
  answer = { people: { 'u-ada': ada, 'u-bea': bea } };
});

/**
 * Let a fetch and the promise chain behind it settle: reading a body takes
 * real turns of the event loop, which `setImmediate` gives (only `setTimeout`
 * is mocked).
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setImmediate(done));
}

void describe('the read', () => {
  void test('happens once a session, however many ask, and again only when asked to', async () => {
    await Promise.all([loadDirectory(), loadDirectory(), loadDirectory()]);
    await loadDirectory();
    assert.equal(asked, 1);
    assert.deepEqual(directoryEntryOf('u-bea'), bea);
    await reloadDirectory();
    assert.equal(asked, 2);
  });

  void test('a refusal is a directory with nobody in it, not an error', async () => {
    status = 404;
    answer = { error: { code: 'not_found' } };
    await loadDirectory();
    assert.equal(directoryEntryOf('u-ada'), undefined);
  });

  void test('a read with no answer is tried again, backing off, until it has one (F9)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      next = [503, 503];
      await loadDirectory();
      assert.equal(asked, 1);
      assert.equal(directoryEntryOf('u-ada'), undefined);
      mock.timers.tick(DIRECTORY_RETRY_FIRST_MS - 1);
      await settle();
      assert.equal(asked, 1, 'tried again before its wait');
      mock.timers.tick(1);
      await settle();
      assert.equal(asked, 2);
      // The second wait is twice the first.
      mock.timers.tick(DIRECTORY_RETRY_FIRST_MS);
      await settle();
      assert.equal(asked, 2);
      mock.timers.tick(DIRECTORY_RETRY_FIRST_MS);
      await settle();
      assert.equal(asked, 3);
      assert.deepEqual(directoryEntryOf('u-ada'), ada);
    } finally {
      mock.timers.reset();
    }
  });

  void test('gives up after its tries, and a refusal is never tried again', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      status = 503;
      await loadDirectory();
      for (let i = 0; i < DIRECTORY_RETRIES + 2; i += 1) {
        mock.timers.tick(60_000);
        await settle();
      }
      assert.equal(asked, DIRECTORY_RETRIES + 1);

      forgetDirectory();
      asked = 0;
      status = 403;
      answer = { error: { code: 'forbidden' } };
      await loadDirectory();
      mock.timers.tick(60_000);
      await settle();
      assert.equal(asked, 1);
    } finally {
      mock.timers.reset();
    }
  });

  void test('forgetting clears everyone, and the next ask reads again', async () => {
    await loadDirectory();
    forgetDirectory();
    assert.equal(directoryEntryOf('u-ada'), undefined);
    await loadDirectory();
    assert.equal(asked, 2);
  });
});

void describe('the held map', () => {
  void test('tells listeners only when an entry changed, and drops anyone gone', () => {
    let told = 0;
    const stop = subscribeDirectory(() => {
      told += 1;
    });
    rememberDirectory({ people: { 'u-ada': ada } });
    const at = directoryVersion();
    rememberDirectory({ people: { 'u-ada': { ...ada } } });
    assert.equal(told, 1);
    assert.equal(directoryVersion(), at);
    rememberDirectory({ people: { 'u-bea': bea } });
    assert.equal(told, 2);
    assert.equal(directoryEntryOf('u-ada'), undefined);
    stop();
  });

  void test('an answer that is not a directory teaches nothing', () => {
    rememberDirectory({ people: { 'u-ada': ada } });
    rememberDirectory(null as never);
    rememberDirectory({} as never);
    assert.deepEqual(directoryEntryOf('u-ada'), ada);
  });

  void test('my team is everyone whose manager I am', () => {
    rememberDirectory({ people: { 'u-ada': ada, 'u-bea': bea } });
    assert.deepEqual([...reportsOf('u-ada')], ['u-bea']);
    assert.deepEqual([...reportsOf('u-bea')], []);
  });
});

void describe('photoUrlOf', () => {
  void test('is the photo at its version, and nothing without one', () => {
    assert.equal(photoUrlOf('u-ada', ada), '/api/v1/users/u-ada/photo?v=1795000000000');
    assert.equal(photoUrlOf('u-bea', bea), null);
    assert.equal(photoUrlOf('u-cal', undefined), null);
  });
});
