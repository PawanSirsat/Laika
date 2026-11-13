/**
 * The overlay stack (LAI-1205): Escape belongs to the top entry, a modal
 * knows how many modals are under it, and only a modal or panel locks the
 * page's scroll — a popover or menu never does.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  isTopLayer,
  locksScroll,
  modalDepth,
  openLayers,
  pushLayer,
  removeLayer,
} from '../../../src/components/overlay/layer-stack.ts';

const opened: number[] = [];
function open(kind: Parameters<typeof pushLayer>[0]): number {
  const id = pushLayer(kind);
  opened.push(id);
  return id;
}

afterEach(() => {
  for (const id of opened.splice(0)) removeLayer(id);
  assert.deepEqual(openLayers(), [], 'a test left a layer open');
});

void describe('the top of the stack', () => {
  void test('is the last opened, and only it', () => {
    const panel = open('panel');
    assert.equal(isTopLayer(panel), true);
    const menu = open('menu');
    assert.equal(isTopLayer(menu), true);
    assert.equal(isTopLayer(panel), false, 'the panel still thinks Escape is its');
  });

  void test('passes back down when the top closes', () => {
    const dialog = open('modal');
    const confirm = open('modal');
    removeLayer(confirm);
    assert.equal(isTopLayer(dialog), true);
  });

  void test('is not disturbed by a layer underneath closing first', () => {
    const panel = open('panel');
    const popover = open('popover');
    removeLayer(panel);
    assert.equal(isTopLayer(popover), true);
    assert.deepEqual(openLayers(), ['popover']);
  });

  void test('removing an id twice, or one never pushed, changes nothing', () => {
    const dialog = open('modal');
    removeLayer(-1);
    removeLayer(dialog);
    removeLayer(dialog);
    assert.deepEqual(openLayers(), []);
  });
});

void describe('depth', () => {
  void test('counts the modals and panels open, never popovers or menus', () => {
    assert.equal(modalDepth(), 0);
    open('panel');
    open('menu');
    open('popover');
    assert.equal(modalDepth(), 1);
    open('modal');
    assert.equal(modalDepth(), 2);
  });
});

void describe('the scroll lock', () => {
  void test('is on for a modal or a panel, off for popovers and menus alone', () => {
    assert.equal(locksScroll([]), false);
    assert.equal(locksScroll(['popover', 'menu']), false);
    assert.equal(locksScroll(['modal']), true);
    assert.equal(locksScroll(['menu', 'panel']), true);
  });
});
