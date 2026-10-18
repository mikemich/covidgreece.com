// Pure helpers shared by the UI and the unit tests (no DOM access here).

const LOCALES = { el: 'el-GR', en: 'en-GB' };

export function localeFor(lang) {
  return LOCALES[lang] || LOCALES.el;
}

export function formatNumber(value, lang, options = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return new Intl.NumberFormat(localeFor(lang), options).format(value);
}

export function formatCompact(value, lang) {
  return formatNumber(value, lang, { notation: 'compact', maximumFractionDigits: 1 });
}

export function formatPercent(value, lang, digits = 1) {
  if (value === null || value === undefined) return '–';
  return formatNumber(value / 100, lang, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ISO dates are parsed as UTC midnight, so format them in UTC as well to
// avoid an off-by-one day for visitors west of Greenwich.
export function formatDate(iso, lang, style = 'long') {
  if (!iso) return '–';
  const options = {
    long: { day: 'numeric', month: 'long', year: 'numeric' },
    short: { day: 'numeric', month: 'short', year: 'numeric' },
    month: { month: 'short', year: 'numeric' },
    monthLong: { month: 'long', year: 'numeric' },
  }[style];
  return new Intl.DateTimeFormat(localeFor(lang), { ...options, timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/** Week-over-week change: direction + percentage (null when not computable). */
export function trend(current, previous) {
  if (current === null || current === undefined || !previous) return null;
  const pct = ((current - previous) / previous) * 100;
  const dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
  return { dir, pct: Math.round(pct * 10) / 10 };
}

export const RANGES = { '6m': 26, '1y': 52, '2y': 104, all: Infinity };

/** Index of the first week to show for a range key ('6m', '1y', 'all', ...). */
export function rangeStart(length, range) {
  const weeks = RANGES[range] ?? Infinity;
  return Number.isFinite(weeks) ? Math.max(0, length - weeks) : 0;
}

/** Index of the first week on or after an ISO date. */
export function indexOfWeek(weeks, iso) {
  const index = weeks.findIndex((week) => week >= iso);
  return index === -1 ? weeks.length - 1 : index;
}

/** Running total of a series, treating gaps as zero. */
export function cumulative(values) {
  let total = 0;
  return values.map((value) => (total += value || 0));
}

/** Simple moving average over `size` points (null until enough points). */
export function movingAverage(values, size) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] || 0;
    if (i >= size) sum -= values[i - size] || 0;
    out.push(i >= size - 1 ? sum / size : null);
  }
  return out;
}

/** Serialise rows to RFC 4180 CSV (quotes fields containing , " or newlines). */
export function toCSV(header, rows) {
  const escape = (cell) => {
    const text = cell === null || cell === undefined ? '' : String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

/** Ease-out cubic, used by the count-up animation. */
export function easeOut(t) {
  return 1 - (1 - t) ** 3;
}
