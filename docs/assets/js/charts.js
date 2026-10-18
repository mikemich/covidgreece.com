// Chart.js setup: theme-aware defaults, two small plugins and chart builders.
// Chart.js is loaded as a classic deferred script and exposed as window.Chart.

const { Chart } = window;

export const COLORS = {
  blue: 'rgb(51, 122, 219)',
  blueFill: 'rgba(51, 122, 219, 0.12)',
  red: 'rgb(219, 88, 51)',
  redFill: 'rgba(219, 88, 51, 0.12)',
  green: 'rgb(63, 163, 77)',
  grey: 'rgba(140, 150, 165, 0.55)',
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Read the current theme tokens and push them into Chart.js defaults. */
export function applyChartTheme() {
  const theme = {
    ink: cssVar('--ink'),
    muted: cssVar('--muted'),
    line: cssVar('--line'),
    bg: cssVar('--bg'),
    surface: cssVar('--surface'),
  };
  Chart.defaults.font.family = "'Roboto', system-ui, sans-serif";
  Chart.defaults.color = theme.muted;
  Chart.defaults.borderColor = theme.line;
  Chart.defaults.animation = prefersReducedMotion ? false : { duration: 900, easing: 'easeOutQuart' };
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(20, 28, 40, 0.92)';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = { weight: '500' };
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  return theme;
}

// Paints the canvas background so downloaded PNGs are not transparent.
const background = {
  id: 'background',
  beforeDraw(chart, _args, options) {
    if (!options.color) return;
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = options.color;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

// Dashed vertical markers with a small label, used for waves.
const markers = {
  id: 'markers',
  afterDatasetsDraw(chart, _args, options) {
    const items = options.items || [];
    if (!items.length) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.font = `500 10px ${Chart.defaults.font.family}`;
    ctx.textAlign = 'center';
    items.forEach((item) => {
      const x = scales.x.getPixelForValue(item.index);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.strokeStyle = options.color;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top + 14);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.fillStyle = options.color;
      ctx.fillText(item.label, x, chartArea.top + 8);
    });
    ctx.restore();
  },
};

Chart.register(background, markers);

/**
 * Draw a chart, updating the existing instance on this canvas when there is
 * one. Updating in place (instead of destroy + new Chart) keeps the same
 * canvas backing store, which Safari reliably repaints, and lets Chart.js
 * animate between states.
 */
function render(canvas, config) {
  const existing = Chart.getChart(canvas);
  if (existing && existing.config.type === config.type) {
    existing.data = config.data;
    existing.options = config.options;
    existing.update();
    return existing;
  }
  existing?.destroy();
  return new Chart(canvas, config);
}

function monthTick(labels, formatDate) {
  return function tick(value) {
    const label = labels[value];
    return label ? formatDate(label) : '';
  };
}

function baseOptions(theme) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { background: { color: theme.surface } },
    scales: {
      x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 8, maxRotation: 0 } },
      y: { beginAtZero: true, grid: { color: theme.line }, border: { display: false } },
    },
  };
}

/** Main time-series chart in the hero panel. */
export function mainChart(canvas, cfg) {
  const options = baseOptions(cfg.theme);
  options.scales.x.ticks.callback = monthTick(cfg.labels, cfg.formatMonth);
  options.scales.y.type = cfg.log ? 'logarithmic' : 'linear';
  options.scales.y.beginAtZero = !cfg.log;
  options.scales.y.ticks = { callback: (v) => cfg.formatAxis(v), maxTicksLimit: 7 };
  options.plugins.legend = { position: 'top', align: 'end' };
  options.plugins.markers = { items: cfg.markers, color: cfg.theme.muted };
  options.plugins.background = { color: cfg.theme.bg }; // the hero panel uses the page background
  options.plugins.tooltip = {
    callbacks: {
      title: (items) => cfg.formatTooltipTitle(cfg.labels[items[0].dataIndex]),
      label: (item) => ` ${item.dataset.label}: ${cfg.formatValue(item.parsed.y)}`,
    },
  };

  const color = cfg.metric === 'deaths' ? COLORS.red : COLORS.blue;
  const fill = cfg.metric === 'deaths' ? COLORS.redFill : COLORS.blueFill;
  const datasets = [
    {
      label: cfg.label,
      data: cfg.values,
      borderColor: color,
      backgroundColor: fill,
      fill: true,
      tension: 0.25,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
    },
  ];
  if (cfg.average) {
    datasets.push({
      label: cfg.averageLabel,
      data: cfg.average,
      borderColor: cfg.theme.ink,
      borderDash: [5, 4],
      borderWidth: 1.25,
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    });
  }
  return render(canvas, { type: 'line', data: { labels: cfg.labels, datasets }, options });
}

/** Vaccination coverage over time (three lines, percent of population). */
export function vaxChart(canvas, cfg) {
  const options = baseOptions(cfg.theme);
  options.scales.x.ticks.callback = monthTick(cfg.labels, cfg.formatMonth);
  options.scales.y.max = 100;
  options.scales.y.ticks = { callback: (v) => `${v}%` };
  options.plugins.legend = { position: 'bottom' };
  options.plugins.tooltip = {
    callbacks: {
      title: (items) => cfg.formatTooltipTitle(cfg.labels[items[0].dataIndex]),
      label: (item) => ` ${item.dataset.label}: ${cfg.formatPercent(item.parsed.y)}`,
    },
  };
  const palette = [COLORS.blue, '#7fb0f0', COLORS.green];
  const datasets = cfg.series.map((s, i) => ({
    label: s.label,
    data: s.values,
    borderColor: palette[i],
    backgroundColor: palette[i],
    borderWidth: 2,
    pointRadius: 0,
    spanGaps: true,
    tension: 0.3,
  }));
  return render(canvas, { type: 'line', data: { labels: cfg.labels, datasets }, options });
}

/** Weekly hospital and ICU admissions on two axes. */
export function healthChart(canvas, cfg) {
  const options = baseOptions(cfg.theme);
  options.scales.x.ticks.callback = monthTick(cfg.labels, cfg.formatMonth);
  options.scales.y.ticks = { callback: (v) => cfg.formatAxis(v) };
  options.scales.y1 = {
    position: 'right',
    beginAtZero: true,
    grid: { display: false },
    border: { display: false },
    ticks: { callback: (v) => cfg.formatAxis(v), color: COLORS.red },
  };
  options.plugins.legend = { position: 'bottom' };
  options.plugins.tooltip = {
    callbacks: {
      title: (items) => cfg.formatTooltipTitle(cfg.labels[items[0].dataIndex]),
      label: (item) => ` ${item.dataset.label}: ${cfg.formatValue(item.parsed.y)}`,
    },
  };
  const datasets = [
    {
      type: 'bar',
      label: cfg.hospLabel,
      data: cfg.hosp,
      backgroundColor: COLORS.blueFill.replace('0.12', '0.55'),
      borderRadius: 2,
      yAxisID: 'y',
    },
    {
      type: 'line',
      label: cfg.icuLabel,
      data: cfg.icu,
      borderColor: COLORS.red,
      backgroundColor: COLORS.red,
      borderWidth: 2,
      pointRadius: 0,
      spanGaps: true,
      tension: 0.3,
      yAxisID: 'y1',
    },
  ];
  return render(canvas, { type: 'bar', data: { labels: cfg.labels, datasets }, options });
}

/** Excess mortality: bars above zero in red, below zero in blue. */
export function excessChart(canvas, cfg) {
  const options = baseOptions(cfg.theme);
  options.scales.x.ticks.callback = monthTick(cfg.labels, cfg.formatMonth);
  options.scales.y.beginAtZero = false;
  options.scales.y.ticks = { callback: (v) => `${v}%` };
  options.plugins.legend = { display: false };
  options.plugins.tooltip = {
    callbacks: {
      title: (items) => cfg.formatTooltipTitle(cfg.labels[items[0].dataIndex]),
      label: (item) => ` ${cfg.label}: ${item.parsed.y > 0 ? '+' : ''}${cfg.formatPercent(item.parsed.y)}`,
    },
  };
  const datasets = [
    {
      label: cfg.label,
      data: cfg.values,
      backgroundColor: cfg.values.map((v) => (v >= 0 ? 'rgba(219, 88, 51, 0.75)' : 'rgba(51, 122, 219, 0.75)')),
      borderRadius: 2,
      barPercentage: 1,
      categoryPercentage: 0.9,
    },
  ];
  return render(canvas, { type: 'bar', data: { labels: cfg.labels, datasets }, options });
}

/** Horizontal ranking with the highlighted country in brand blue. */
export function compareBar(canvas, cfg) {
  const options = baseOptions(cfg.theme);
  options.indexAxis = 'y';
  options.interaction = { mode: 'nearest', axis: 'y', intersect: false };
  options.scales = {
    x: { beginAtZero: true, grid: { color: cfg.theme.line }, border: { display: false }, ticks: { callback: (v) => cfg.formatAxis(v), maxTicksLimit: 6 } },
    y: { grid: { display: false }, ticks: { color: cfg.theme.ink } },
  };
  options.plugins.legend = { display: false };
  options.plugins.tooltip = { callbacks: { label: (item) => ` ${cfg.formatValue(item.parsed.x)}` } };
  const datasets = [
    {
      data: cfg.values,
      backgroundColor: cfg.highlight.map((h) => (h ? COLORS.blue : COLORS.grey)),
      borderRadius: 6,
      barPercentage: 0.75,
    },
  ];
  return render(canvas, { type: 'bar', data: { labels: cfg.labels, datasets }, options });
}

/** Cumulative deaths per million: every country thin, Greece bold. */
export function compareLine(canvas, cfg) {
  const options = baseOptions(cfg.theme);
  options.scales.x.ticks.callback = monthTick(cfg.labels, cfg.formatMonth);
  options.scales.y.ticks = { callback: (v) => cfg.formatAxis(v) };
  options.interaction = { mode: 'nearest', intersect: false };
  options.plugins.legend = { position: 'bottom', labels: { boxWidth: 8, font: { size: 11 } } };
  options.plugins.tooltip = {
    callbacks: {
      title: (items) => cfg.formatTooltipTitle(cfg.labels[items[0].dataIndex]),
      label: (item) => ` ${item.dataset.label}: ${cfg.formatValue(item.parsed.y)}`,
    },
  };
  const datasets = cfg.series.map((s) => ({
    label: s.label,
    data: s.values,
    borderColor: s.highlight ? COLORS.blue : s.dashed ? cfg.theme.ink : COLORS.grey,
    backgroundColor: s.highlight ? COLORS.blue : s.dashed ? cfg.theme.ink : COLORS.grey,
    borderWidth: s.highlight ? 3 : 1.25,
    borderDash: s.dashed ? [5, 4] : [],
    pointRadius: 0,
    spanGaps: true,
    tension: 0.2,
    order: s.highlight ? 0 : 1,
  }));
  return render(canvas, { type: 'line', data: { labels: cfg.labels, datasets }, options });
}
