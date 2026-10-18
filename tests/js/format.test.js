import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cumulative,
  easeOut,
  formatDate,
  formatNumber,
  formatPercent,
  indexOfWeek,
  movingAverage,
  rangeStart,
  toCSV,
  trend,
} from '../../docs/assets/js/lib/format.js';

test('formatNumber uses Greek and English separators', () => {
  assert.equal(formatNumber(5868533, 'el'), '5.868.533');
  assert.equal(formatNumber(5868533, 'en'), '5,868,533');
  assert.equal(formatNumber(null, 'en'), '–');
});

test('formatPercent takes values on a 0-100 scale', () => {
  assert.equal(formatPercent(73.44, 'en'), '73.4%');
  assert.equal(formatPercent(73.44, 'el').replace(/\s/g, ''), '73,4%');
  assert.equal(formatPercent(undefined, 'en'), '–');
});

test('formatDate does not shift ISO dates across time zones', () => {
  assert.equal(formatDate('2022-01-09', 'en', 'long'), '9 January 2022');
  assert.equal(formatDate(null, 'en'), '–');
});

test('trend reports direction and rounded percentage', () => {
  assert.deepEqual(trend(299, 266), { dir: 'up', pct: 12.4 });
  assert.deepEqual(trend(50, 100), { dir: 'down', pct: -50 });
  assert.equal(trend(100, 100).dir, 'flat');
  assert.equal(trend(10, 0), null);
  assert.equal(trend(null, 10), null);
});

test('rangeStart keeps the last N weeks', () => {
  assert.equal(rangeStart(340, '6m'), 314);
  assert.equal(rangeStart(340, '1y'), 288);
  assert.equal(rangeStart(340, 'all'), 0);
  assert.equal(rangeStart(10, '2y'), 0);
  assert.equal(rangeStart(10, 'bogus'), 0);
});

test('indexOfWeek finds the first week on or after a date', () => {
  const weeks = ['2022-01-02', '2022-01-09', '2022-01-16'];
  assert.equal(indexOfWeek(weeks, '2022-01-05'), 1);
  assert.equal(indexOfWeek(weeks, '2022-01-02'), 0);
  assert.equal(indexOfWeek(weeks, '2030-01-01'), 2);
});

test('cumulative and movingAverage treat gaps as zero', () => {
  assert.deepEqual(cumulative([1, null, 2, 3]), [1, 1, 3, 6]);
  assert.deepEqual(movingAverage([2, 4, 6, 8], 2), [null, 3, 5, 7]);
});

test('toCSV quotes fields that need it', () => {
  const csv = toCSV(['a', 'b'], [['x,y', 'say "hi"'], [1, null]]);
  assert.equal(csv, 'a,b\n"x,y","say ""hi"""\n1,');
});

test('easeOut maps 0..1 onto 0..1', () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.ok(easeOut(0.5) > 0.5);
});
