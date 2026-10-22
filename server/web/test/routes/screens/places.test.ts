import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canonicalZone, PLACES, placeLabel, placeOf } from '../../../src/routes/screens/places.ts';

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

  void test('the runtime’s own spelling of a zone finds the place: Asia/Calcutta is New Delhi (LAI-896)', () => {
    // Chrome and Node both answer this alias for India; the list says Kolkata.
    assert.equal(canonicalZone('Asia/Kolkata'), canonicalZone('Asia/Calcutta'));
    assert.equal(placeOf('Asia/Calcutta')?.city, 'New Delhi');
    assert.equal(placeOf('Asia/Kolkata')?.city, 'New Delhi');
    // A name the runtime refuses neither throws nor matches.
    assert.equal(canonicalZone('Not/A_Zone'), 'Not/A_Zone');
    assert.equal(placeOf('Not/A_Zone'), undefined);
    assert.equal(placeOf(''), undefined);
  });
});
