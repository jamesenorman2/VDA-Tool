import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickEntry as q } from '../src/quickentry.js';

test('straight, left, right', () => {
  const r = q('s 45\nl 30 25\nR 30,25,High St');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.sections.map((s) => [s.sType, s.sLength, s.radius]), [['STRAIGHT', 45, 150], ['CURVE_LEFT', 30, 25], ['CURVE_RIGHT', 30, 25]]);
  assert.equal(r.sections[2].description, 'High St');
});
test('units and # comments', () => {
  const r = q('l 100ft 50 ft # Mill Lane\ns 12000mm\ns 1500 cm');
  assert.deepEqual(r.sections.map((s) => [s.sLength, s.radius]), [[30.48, 15.24], [12, 150], [15, 150]]);
  assert.equal(r.sections[0].description, 'Mill Lane');
});
test('csv header ignored, errors reported, others still parsed', () => {
  const r = q('type,length,radius,description\ns,10\nl 5\nfoo 3\nr 10 0');
  assert.equal(r.sections.length, 1);
  assert.equal(r.errors.length, 3);
});
test('radius over 150 becomes a straight with a note', () => {
  const r = q('l 40 200');
  assert.equal(r.sections[0].sType, 'STRAIGHT');
  assert.equal(r.notes.length, 1);
});
