import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATE, parseState, serializeState } from '../../docs/assets/js/lib/state.js';

test('parseState keeps valid values and ignores the rest', () => {
  const state = parseState('?lang=en&metric=deaths&range=5y&scale=log&evil=<script>');
  assert.equal(state.lang, 'en');
  assert.equal(state.metric, 'deaths');
  assert.equal(state.range, DEFAULT_STATE.range);
  assert.equal(state.scale, 'log');
  assert.equal(state.evil, undefined);
});

test('serializeState omits defaults and round-trips', () => {
  assert.equal(serializeState(DEFAULT_STATE), '');
  const state = { ...DEFAULT_STATE, mode: 'cumulative', compare: 'fully_vaccinated' };
  const query = serializeState(state);
  assert.equal(query, '?mode=cumulative&compare=fully_vaccinated');
  assert.deepEqual(parseState(query), state);
});

test('parseState uses the provided fallback', () => {
  assert.equal(parseState('', { ...DEFAULT_STATE, lang: 'en' }).lang, 'en');
});
