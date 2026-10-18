// Shareable view state, kept in the query string (?lang=en&metric=deaths...).

export const DEFAULT_STATE = Object.freeze({
  lang: 'el',
  metric: 'cases',
  mode: 'weekly',
  range: 'all',
  scale: 'linear',
  compare: 'deaths_per_million',
});

const ALLOWED = {
  lang: ['el', 'en'],
  metric: ['cases', 'deaths'],
  mode: ['weekly', 'cumulative'],
  range: ['6m', '1y', '2y', 'all'],
  scale: ['linear', 'log'],
  compare: ['deaths_per_million', 'cases_per_million', 'fully_vaccinated', 'excess_per_million'],
};

/** Parse a query string, ignoring unknown keys and invalid values. */
export function parseState(search, fallback = DEFAULT_STATE) {
  const params = new URLSearchParams(search);
  const state = { ...fallback };
  for (const [key, allowed] of Object.entries(ALLOWED)) {
    const value = params.get(key);
    if (value && allowed.includes(value)) state[key] = value;
  }
  return state;
}

/** Serialise only the values that differ from the defaults. */
export function serializeState(state) {
  const params = new URLSearchParams();
  for (const key of Object.keys(ALLOWED)) {
    if (state[key] && state[key] !== DEFAULT_STATE[key]) params.set(key, state[key]);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
