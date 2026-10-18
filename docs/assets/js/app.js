import { applyTranslations, t } from './i18n.js';
import {
  cumulative,
  easeOut,
  formatCompact,
  formatDate,
  formatNumber,
  formatPercent,
  indexOfWeek,
  movingAverage,
  rangeStart,
  toCSV,
  trend,
} from './lib/format.js';
import { DEFAULT_STATE, parseState, serializeState } from './lib/state.js';
import * as charts from './charts.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // private mode or blocked storage: preferences simply aren't remembered
  }
  return null;
}

function initialLanguage() {
  const saved = storage('lang');
  if (saved === 'el' || saved === 'en') return saved;
  const langs = navigator.languages || [navigator.language || 'el'];
  return langs.some((l) => l.toLowerCase().startsWith('el')) ? 'el' : 'en';
}

const state = parseState(location.search, { ...DEFAULT_STATE, lang: initialLanguage() });
let data = null; // { greece, compare, milestones }
let focus = null; // { start, end } when a wave card zoomed the main chart
let theme = null;
const instances = {}; // chart instances by name
const builders = {}; // functions that (re)build each chart

// ---------------------------------------------------------------- helpers

const fmt = {
  n: (v) => formatNumber(v, state.lang),
  compact: (v) => formatCompact(v, state.lang),
  pct: (v, d = 1) => formatPercent(v, state.lang, d),
  date: (iso) => formatDate(iso, state.lang, 'long'),
  short: (iso) => formatDate(iso, state.lang, 'short'),
  month: (iso) => formatDate(iso, state.lang, 'month'),
  monthLong: (iso) => formatDate(iso, state.lang, 'monthLong'),
};

function countryName(name) {
  return t(state.lang, `country.${name}`);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function syncUrl() {
  const url = `${location.pathname}${serializeState(state)}${location.hash}`;
  history.replaceState(null, '', url);
}

/** Animate a number from 0 to `target` (respects reduced motion). */
function countUp(el, target, format) {
  if (target === null || target === undefined) {
    el.textContent = '–';
    return;
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || el.dataset.animated) {
    el.textContent = format(target);
    return;
  }
  el.dataset.animated = 'true';
  const duration = 1400;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    el.textContent = format(target * easeOut(progress));
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = format(target);
  };
  requestAnimationFrame(step);
}

/** Run `callback` once the element scrolls into view. */
function whenVisible(el, callback) {
  if (!('IntersectionObserver' in window)) {
    callback();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        callback();
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  observer.observe(el);
}

function setupReveal() {
  $$('.reveal:not(.is-visible), .wave:not(.is-visible)').forEach((el) => whenVisible(el, () => el.classList.add('is-visible')));
}

/** Register a chart builder; it runs when its canvas first becomes visible. */
function registerChart(name, canvas, build) {
  builders[name] = () => {
    instances[name]?.destroy();
    instances[name] = build(canvas);
  };
  whenVisible(canvas, () => {
    builders[name].ready = true;
    builders[name]();
  });
}

function rebuildCharts() {
  theme = charts.applyChartTheme();
  Object.values(builders).forEach((build) => build.ready && build());
}

function sliceFrom(series, start, end = series.length) {
  return series.slice(start, end);
}

// ---------------------------------------------------------------- hero

function renderHero() {
  const s = data.greece.summary;
  countUp($('[data-stat="weekCases"]'), s.cases, fmt.n);
  countUp($('[data-stat="vaccinated"]'), s.fully_vaccinated.value, (v) => fmt.pct(v));
  countUp($('[data-stat="totalCases"]'), s.total_cases, fmt.n);
  countUp($('[data-stat="totalDeaths"]'), s.total_deaths, fmt.n);

  const change = trend(s.cases, s.previous_cases);
  const trendEl = $('#trend');
  trendEl.hidden = !change;
  if (change) {
    trendEl.textContent = t(state.lang, `trend.${change.dir}`, { pct: fmt.pct(Math.abs(change.pct)) });
  }
  $('#updated').textContent = t(state.lang, 'hero.updated', { date: fmt.date(s.week) });

  const meta = data.greece.meta;
  $('#datasrc').innerHTML = t(state.lang, 'source', {
    source: `<a href="${meta.source_url}">Our World in Data</a>`,
    license: meta.license,
  });
}

// ---------------------------------------------------------------- main chart

function mainSeries() {
  const series = data.greece.series;
  if (state.mode === 'cumulative') {
    const totals = state.metric === 'deaths' ? series.total_deaths : series.total_cases;
    return totals.some((v) => v !== null) ? totals : cumulative(series[state.metric]);
  }
  return series[state.metric];
}

function mainWindow(length) {
  if (focus) return focus;
  return { start: rangeStart(length, state.range), end: length };
}

function buildMain(canvas) {
  const { weeks } = data.greece.series;
  const all = mainSeries();
  const { start, end } = mainWindow(weeks.length);
  const labels = sliceFrom(weeks, start, end);
  let values = sliceFrom(all, start, end);
  const log = state.scale === 'log';
  if (log) values = values.map((v) => (v > 0 ? v : null)); // log axes cannot show zero

  const weekly = state.mode === 'weekly';
  const average = weekly ? sliceFrom(movingAverage(all, 4), start, end) : null;
  const waveMarkers = data.greece.waves
    .map((wave, i) => ({ index: weeks.indexOf(wave.week) - start, label: `${i + 1}` }))
    .filter((m) => m.index >= 0 && m.index < labels.length);

  const metricLabel = state.metric === 'deaths' ? t(state.lang, 'chart.seriesDeaths') : t(state.lang, 'chart.seriesCases');
  const finite = values.map((v) => v || 0);
  const peak = finite.indexOf(Math.max(...finite));
  canvas.setAttribute(
    'aria-label',
    t(state.lang, 'chart.aria', {
      metric: t(state.lang, `chart.${state.metric}`).toLowerCase(),
      from: fmt.date(labels[0]),
      to: fmt.date(labels[labels.length - 1]),
      max: fmt.n(finite[peak]),
      peak: fmt.date(labels[peak]),
    }),
  );
  renderTable(labels, values);

  return charts.mainChart(canvas, {
    theme,
    labels,
    values,
    average: average && !log ? average : null,
    averageLabel: t(state.lang, 'chart.avg'),
    metric: state.metric,
    label: metricLabel,
    log,
    markers: weekly ? waveMarkers : [],
    formatMonth: fmt.month,
    formatTooltipTitle: (iso) => `${t(state.lang, 'chart.week')} ${fmt.short(iso)}`,
    formatValue: (v) => fmt.n(Math.round(v)),
    formatAxis: fmt.compact,
  });
}

function renderTable(labels, values) {
  const offset = Math.max(0, labels.length - 12);
  const rows = labels.slice(offset).map((week, i) => [week, values[offset + i]]);
  const metric = t(state.lang, `chart.${state.metric}`);
  const table = $('#main-table');
  table.innerHTML = `<thead><tr><th scope="col">${t(state.lang, 'chart.week')}</th><th scope="col">${metric}</th></tr></thead>`;
  const body = document.createElement('tbody');
  rows.reverse().forEach(([week, value]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmt.short(week)}</td><td>${fmt.n(value)}</td>`;
    body.append(tr);
  });
  table.append(body);
}

function syncControls() {
  $$('[data-control]').forEach((group) => {
    const key = group.dataset.control;
    $$('button', group).forEach((button) => {
      const active = key === 'range' && focus ? false : state[key] === button.dataset.value;
      button.setAttribute('aria-pressed', String(active));
    });
  });
  $('#log-toggle').checked = state.scale === 'log';
}

function setupControls() {
  $$('[data-control]').forEach((group) => {
    group.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      const key = group.dataset.control;
      state[key] = button.dataset.value;
      if (key === 'range') focus = null;
      syncControls();
      syncUrl();
      if (key === 'compare') {
        builders.compareBar?.();
        builders.compareLine?.();
      } else {
        builders.main?.();
      }
    });
  });
  $('#log-toggle').addEventListener('change', (event) => {
    state.scale = event.target.checked ? 'log' : 'linear';
    syncUrl();
    builders.main?.();
  });
}

// ---------------------------------------------------------------- sections

function kpi(label, value, note = '') {
  return `<div class="card kpi reveal"><div class="kpi-value">${value}</div>
    <div class="kpi-label">${label}</div>${note ? `<div class="kpi-note">${note}</div>` : ''}</div>`;
}

function renderKPIs() {
  const s = data.greece.summary;
  const week = (iso) => t(state.lang, 'kpi.weekOf', { date: fmt.short(iso) });
  $('#kpi-grid').innerHTML = [
    kpi(t(state.lang, 'kpi.casesPerMillion'), fmt.n(s.cases_per_million)),
    kpi(t(state.lang, 'kpi.deathsPerMillion'), fmt.n(s.deaths_per_million)),
    kpi(t(state.lang, 'kpi.cfr'), fmt.pct(s.case_fatality, 2), t(state.lang, 'kpi.cfrNote')),
    kpi(t(state.lang, 'kpi.peakCases'), fmt.n(s.peak_cases.value), week(s.peak_cases.week)),
    kpi(t(state.lang, 'kpi.peakDeaths'), fmt.n(s.peak_deaths.value), week(s.peak_deaths.week)),
    kpi(t(state.lang, 'kpi.population'), fmt.n(s.population)),
  ].join('');
}

function renderWaves() {
  const { waves } = data.greece;
  const biggest = Math.max(...waves.map((w) => w.cases));
  $('#wave-list').innerHTML = waves
    .map(
      (wave, i) => `
      <li class="card wave">
        <span class="wave-index">${t(state.lang, 'chart.wave', { n: i + 1 })}</span>
        <span class="wave-date">${fmt.monthLong(wave.week)}</span>
        <span class="wave-num">${fmt.n(wave.cases)}</span>
        <span class="wave-sub">${t(state.lang, 'waves.peak')}</span>
        <div class="wave-bar" aria-hidden="true"><span style="--w:${(wave.cases / biggest).toFixed(3)}"></span></div>
        <span class="wave-sub">${fmt.n(wave.deaths)} ${t(state.lang, 'waves.deaths')}</span>
        <button class="text-btn" type="button" data-wave="${i}">${t(state.lang, 'waves.focus')} →</button>
      </li>`,
    )
    .join('');
}

function focusWave(index) {
  const { weeks } = data.greece.series;
  const center = weeks.indexOf(data.greece.waves[index].week);
  focus = { start: Math.max(0, center - 16), end: Math.min(weeks.length, center + 17) };
  state.metric = 'cases';
  state.mode = 'weekly';
  syncControls();
  syncUrl();
  builders.main();
  $('#chart-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Trim a set of series to the span where at least one has data. */
function span(weeks, ...series) {
  const has = (i) => series.some((s) => s[i] !== null && s[i] !== undefined);
  let first = 0;
  let last = weeks.length - 1;
  while (first < last && !has(first)) first += 1;
  while (last > first && !has(last)) last -= 1;
  return { labels: weeks.slice(first, last + 1), cut: (s) => s.slice(first, last + 1) };
}

function renderVaccination() {
  const s = data.greece.summary;
  $('#vax-lead').textContent = t(state.lang, 'vax.lead', { date: fmt.date(s.fully_vaccinated.week) });
  const rows = [
    { label: t(state.lang, 'vax.one'), value: s.vaccinated.value },
    { label: t(state.lang, 'vax.full'), value: s.fully_vaccinated.value },
    { label: t(state.lang, 'vax.booster'), value: s.boosters.value, note: t(state.lang, 'vax.boosterNote') },
  ];
  $('#vax-bars').innerHTML = rows
    .map(
      (row) => `
      <div class="vax-row">
        <header><span class="vax-name">${row.label}</span><span class="vax-value">${row.note ? fmt.n(row.value) : fmt.pct(row.value)}</span></header>
        ${row.note ? `<div class="vax-note">${row.note}</div>` : ''}
        <div class="vax-track" role="presentation"><span style="--w:${Math.min(1, row.value / 100).toFixed(3)}"></span></div>
      </div>`,
    )
    .join('');
}

const timeFormatters = () => ({
  theme,
  formatMonth: fmt.month,
  formatTooltipTitle: (iso) => `${t(state.lang, 'chart.week')} ${fmt.short(iso)}`,
  formatValue: (v) => fmt.n(Math.round(v)),
  formatAxis: fmt.compact,
  formatPercent: (v) => fmt.pct(v),
});

function buildVax(canvas) {
  const sr = data.greece.series;
  const { labels, cut } = span(sr.weeks, sr.vaccinated, sr.fully_vaccinated, sr.boosters);
  canvas.setAttribute('aria-label', t(state.lang, 'vax.title'));
  return charts.vaxChart(canvas, {
    ...timeFormatters(),
    labels,
    series: [
      { label: t(state.lang, 'vax.one'), values: cut(sr.vaccinated) },
      { label: t(state.lang, 'vax.full'), values: cut(sr.fully_vaccinated) },
      { label: t(state.lang, 'vax.booster'), values: cut(sr.boosters) },
    ],
  });
}

function buildHealth(canvas) {
  const sr = data.greece.series;
  const { labels, cut } = span(sr.weeks, sr.hosp_admissions, sr.icu_admissions);
  canvas.setAttribute('aria-label', t(state.lang, 'health.title'));
  return charts.healthChart(canvas, {
    ...timeFormatters(),
    labels,
    hosp: cut(sr.hosp_admissions),
    icu: cut(sr.icu_admissions),
    hospLabel: t(state.lang, 'health.hosp'),
    icuLabel: t(state.lang, 'health.icu'),
  });
}

function buildExcess(canvas) {
  const sr = data.greece.series;
  const { labels, cut } = span(sr.weeks, sr.excess_mortality);
  canvas.setAttribute('aria-label', t(state.lang, 'excess.title'));
  return charts.excessChart(canvas, {
    ...timeFormatters(),
    labels,
    values: cut(sr.excess_mortality),
    label: t(state.lang, 'excess.series'),
  });
}

function buildCompareBar(canvas) {
  const key = state.compare;
  const rows = data.compare.countries
    .filter((c) => c[key] !== null && c[key] !== undefined)
    .sort((a, b) => b[key] - a[key]);
  canvas.setAttribute('aria-label', `${t(state.lang, 'compare.title')}: ${t(state.lang, `compare.${key}`)}`);
  const isPct = key === 'fully_vaccinated';
  return charts.compareBar(canvas, {
    theme,
    labels: rows.map((c) => countryName(c.name)),
    values: rows.map((c) => c[key]),
    highlight: rows.map((c) => c.name === 'Greece'),
    formatValue: (v) => (isPct ? fmt.pct(v) : fmt.n(v)),
    formatAxis: (v) => (isPct ? `${v}%` : fmt.compact(v)),
  });
}

function buildCompareLine(canvas) {
  const key = state.compare;
  const isPct = key === 'fully_vaccinated';
  const title = t(state.lang, `compare.trend.${key}`);
  $('#compare-trend-title').textContent = title;
  canvas.setAttribute('aria-label', title);

  // drop countries without data for this metric, then trim empty weeks
  const entries = Object.entries(data.compare.series[key] || {}).filter(([, values]) =>
    values.some((v) => v !== null),
  );
  const { labels, cut } = span(data.compare.weeks, ...entries.map(([, values]) => values));
  return charts.compareLine(canvas, {
    ...timeFormatters(),
    labels,
    formatValue: (v) => (isPct ? fmt.pct(v) : fmt.n(Math.round(v))),
    formatAxis: (v) => (isPct ? `${v}%` : fmt.compact(v)),
    series: entries.map(([name, values]) => ({
      label: countryName(name),
      values: cut(values),
      highlight: name === 'Greece',
      dashed: name === 'European Union (27)',
    })),
  });
}

function renderTimeline() {
  $('#timeline-list').innerHTML = data.milestones
    .map(
      (m) => `
      <li class="reveal">
        <time datetime="${m.date}">${fmt.date(m.date)}</time>
        <p>${m[state.lang] || m.el}</p>
        <a href="${m.source}" rel="noopener">${t(state.lang, 'timeline.source')} ↗</a>
      </li>`,
    )
    .join('');
}

// ---------------------------------------------------------------- actions

function download(filename, href) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function setupActions() {
  $('#download-png').addEventListener('click', () => {
    if (instances.main) download(`covid-greece-${state.metric}-${state.mode}.png`, instances.main.toBase64Image('image/png', 1));
  });
  $('#download-csv').addEventListener('click', () => {
    const s = data.greece.series;
    const header = ['week_ending', 'new_cases', 'new_deaths', 'total_cases', 'total_deaths', 'fully_vaccinated_pct'];
    const rows = s.weeks.map((w, i) => [w, s.cases[i], s.deaths[i], s.total_cases[i], s.total_deaths[i], s.fully_vaccinated[i]]);
    const blob = new Blob([`${toCSV(header, rows)}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    download('covid-greece-weekly.csv', url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('#share').addEventListener('click', async () => {
    const shareData = { title: document.title, text: t(state.lang, 'meta.description'), url: location.href };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // dismissed by the user
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(location.href);
      toast(t(state.lang, 'action.copied'));
    } catch {
      prompt('URL', location.href);
    }
  });

  $('#wave-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-wave]');
    if (button) focusWave(Number(button.dataset.wave));
  });

  $('#lang-toggle').addEventListener('click', () => {
    state.lang = state.lang === 'el' ? 'en' : 'el';
    storage('lang', state.lang);
    syncUrl();
    renderAll();
    rebuildCharts();
  });

  $('#theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storage('theme', next);
    rebuildCharts();
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) rebuildCharts();
  });
}

// ---------------------------------------------------------------- boot

function renderAll() {
  applyTranslations(state.lang);
  renderHero();
  renderKPIs();
  renderWaves();
  renderVaccination();
  renderTimeline();
  syncControls();
  setupReveal();
}

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  applyTranslations(state.lang);
  syncControls();
  setupReveal();
  const status = $('#chart-status');
  status.textContent = '…';

  try {
    const [greece, compare, milestones] = await Promise.all([
      loadJSON('data/greece.json'),
      loadJSON('data/compare.json'),
      loadJSON('data/milestones.json'),
    ]);
    data = { greece, compare, milestones: milestones.milestones };
  } catch (error) {
    console.error(error);
    status.textContent = t(state.lang, 'error');
    return;
  }
  status.textContent = '';

  theme = charts.applyChartTheme();
  renderAll();
  setupControls();
  setupActions();

  registerChart('main', $('#main-chart'), buildMain);
  registerChart('vax', $('#vax-chart'), buildVax);
  registerChart('health', $('#health-chart'), buildHealth);
  registerChart('excess', $('#excess-chart'), buildExcess);
  registerChart('compareBar', $('#compare-bar'), buildCompareBar);
  registerChart('compareLine', $('#compare-line'), buildCompareLine);

  if (!navigator.onLine) toast(t(state.lang, 'offline'));
}

main();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
