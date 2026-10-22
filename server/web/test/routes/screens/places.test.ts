import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PLACES, placeLabel, placeOf } from '../../../src/routes/screens/places.ts';

/** The places a person may be (LAI-895): each a zone the runtime knows, each once. */
void describe('places', () => {
  void test('every key is a zone the runtime knows, and no key repeats', () => {
    for (const place of PLACES) {
      assert.doesNotThrow(
        () => new Intl.DateTimeFormat('en', { timeZone: place.key }),
        `${place.key} is not a zone`,
      );
      assert.ok(
        Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180,
        `${place.key} is off the map`,
      );
    }
    assert.equal(new Set(PLACES.map((p) => p.key)).size, PLACES.length);
  });

  void test('a key finds its place and says where; an unknown one finds nothing', () => {
    const delhi = placeOf('Asia/Kolkata');
    assert.ok(delhi !== undefined);
    assert.equal(placeLabel(delhi), 'New Delhi, India');
    assert.equal(placeOf('Mars/Olympus'), undefined);
    assert.equal(placeOf(null), undefined);
  });
});
