/**
 * The bell's data hook (LAI-1221). `node --test` cannot render a hook, so its
 * rules are pinned here — which stream frame re-reads which store, that
 * *last seen* is written per person and survives a refusing storage, and
 * that the hook opens no stream of its own — and its behaviour on screen is
 * `test/browser/header-actions.test.ts`'s.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { code } from '../../helpers/code.ts';
import { markSeen, staleSourceFor } from '../../../src/components/shell/use-notifications.ts';

void describe('which frame re-reads which store', () => {
  void test('a status change, the review queue; a hand-off verb, the hand-offs', () => {
    assert.equal(staleSourceFor('task.status_changed', false), 'review');
    for (const verb of ['task.handoff_offered', 'task.handoff_expired', 'task.recovered']) {
      assert.equal(staleSourceFor(verb, false), 'handoffs', verb);
    }
  });

  void test('an unlisted verb only for a reader who may read unlisted work', () => {
    assert.equal(staleSourceFor('unlisted.logged', true), 'unlisted');
    assert.equal(staleSourceFor('unlisted.logged', false), undefined);
  });

  void test('everything else re-reads nothing: a comment is not a request', () => {
    for (const verb of ['comment.added', 'task.updated', 'heartbeat.session']) {
      assert.equal(staleSourceFor(verb, true), undefined, verb);
    }
  });
});

void describe('last seen', () => {
  void test('is written per person, and a refusing storage is not an error', () => {
    const map = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
      },
    });
    try {
      markSeen('u1', 1234);
      assert.equal(map.get('laika.notifications.seen.u1'), '1234');
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          setItem: () => {
            throw new Error('denied');
          },
        },
      });
      assert.doesNotThrow(() => {
        markSeen('u1', 5678);
      });
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
      else Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

void describe('one stream', () => {
  void test('listens on the shared stream and never opens an EventSource of its own', async () => {
    const source = code(
      await readFile(
        new URL('../../../src/components/shell/use-notifications.ts', import.meta.url),
        'utf8',
      ),
    );
    assert.match(source, /subscribeToEvents\(slug,/);
    assert.doesNotMatch(source, /new EventSource/);
  });
});
