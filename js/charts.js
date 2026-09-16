/**
 * Zero-dependency SVG charts.
 *
 * Every chart returns an SVG string sized by viewBox with
 * preserveAspectRatio="none" avoided — they scale via CSS width:100% and a
 * fixed aspect, so they stay crisp in print and in both colour schemes.
 * Colours come from CSS custom properties so theming lives in one place.
 */

import { escapeHtml, money, moneyCompact } from './format.js';
import { formatBucket, formatBucketShort } from './period.js';

const svgWrap = (w, h, inner, cls = '') =>
  `<svg class="chart ${cls}" viewBox="0 0 ${w} ${h}" role="img" width="100%" height="100%">${inner}</svg>`;

/**
 * A round step size for gridlines. Choosing the STEP (rather than the maximum)
 * and multiplying up is what keeps every label a readable number — picking a
 * nice maximum and dividing it by four produced labels like $875 and $3,625.
 */
function niceStep(range, targetTicks = 4) {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const base = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}

/**
 * Stacked bars with a trend line, at whatever bucket size the series carries —
 * days for a two-week export, quarters for a multi-year one.
 */
export function periodChart(series, { height = 272 } = {}) {
  if (!series.length) return '<p class="muted">Not enough data to chart.</p>';

  const W = 800;
  const H = height;
  const pad = { top: 18, right: 16, bottom: 44, left: 60 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const maxStack = Math.max(...series.map((b) => b.paid + b.unpaid), 1);
  const minStack = Math.min(...series.map((b) => b.clawback), 0);
  const step = niceStep(maxStack - Math.min(minStack, 0));
  const top = Math.ceil(maxStack / step) * step;
  const bottom = minStack < 0 ? -Math.ceil(Math.abs(minStack) / step) * step : 0;
  const span = top - bottom || 1;

  const x = (i) => pad.left + (plotW / series.length) * (i + 0.5);
  const y = (v) => pad.top + plotH * (1 - (v - bottom) / span);
  const barW = Math.min(46, (plotW / series.length) * 0.62);

  const parts = [];

  // Gridlines + y axis labels, stepping in round amounts.
  for (let v = bottom; v <= top + 0.001; v += step) {
    const yy = y(v);
    parts.push(
      `<line class="grid" x1="${pad.left}" y1="${yy}" x2="${W - pad.right}" y2="${yy}"/>`,
      `<text class="axis" x="${pad.left - 8}" y="${yy + 4}" text-anchor="end">${escapeHtml(moneyCompact(v))}</text>`
    );
  }

  const zeroY = y(0);
  parts.push(`<line class="axis-line" x1="${pad.left}" y1="${zeroY}" x2="${W - pad.right}" y2="${zeroY}"/>`);

  // Bars
  series.forEach((b, i) => {
    const cx = x(i) - barW / 2;
    const payments = `${b.count} ${b.count === 1 ? 'payment' : 'payments'}`;
    const when = formatBucket(b.date, b.gran, { long: true });
    const tip = b.partial
      ? `${when} so far: ${money(b.net)} from ${payments}`
      : `${when}: ${money(b.net)} from ${payments}`;

    let cursor = 0;
    for (const [key, cls] of [['paid', 'bar-paid'], ['unpaid', 'bar-unpaid']]) {
      const v = b[key];
      if (v <= 0) continue;
      const yTop = y(cursor + v);
      const h = Math.max(1, y(cursor) - yTop);
      parts.push(
        `<rect class="bar ${cls}${b.partial ? ' bar-partial' : ''}" x="${cx}" y="${yTop}" width="${barW}" height="${h}" rx="3"><title>${escapeHtml(tip)}</title></rect>`
      );
      cursor += v;
    }
    if (b.clawback < 0) {
      const yTop = y(0);
      const h = Math.max(1, y(b.clawback) - yTop);
      parts.push(
        `<rect class="bar bar-clawback" x="${cx}" y="${yTop}" width="${barW}" height="${h}" rx="3"><title>${escapeHtml(
          `${formatBucket(b.date, b.gran, { long: true })}: ${money(b.clawback)} taken back`
        )}</title></rect>`
      );
    }
  });

  // Rolling average line
  const trendPoints = series.map((b, i) => ({ b, i })).filter(({ b }) => !b.partial);
  if (trendPoints.length > 2) {
    const d = trendPoints
      .map(({ b, i }, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b.rolling).toFixed(1)}`)
      .join(' ');
    parts.push(`<path class="trend" d="${d}"/>`);
    trendPoints.forEach(({ b, i }) => {
      parts.push(`<circle class="trend-dot" cx="${x(i).toFixed(1)}" cy="${y(b.rolling).toFixed(1)}" r="2.5"/>`);
    });
  }

  // X labels — thinned out when crowded
  const every = series.length > 12 ? Math.ceil(series.length / 10) : 1;
  series.forEach((b, i) => {
    if (i % every !== 0 && !b.partial) return;
    parts.push(
      `<text class="axis${b.partial ? ' axis-partial' : ''}" x="${x(i)}" y="${H - 12}" text-anchor="middle">${escapeHtml(
        // Name the year on the first bar and whenever a new one starts, so a
        // multi-year axis is never ambiguous.
        formatBucketShort(b.date, b.gran, {
          withYear: i === 0 || b.date.getFullYear() !== series[i - 1]?.date.getFullYear(),
        })
      )}</text>`
    );
    if (b.partial) {
      parts.push(
        `<text class="axis axis-partial" x="${x(i)}" y="${H - 1}" text-anchor="middle">so far</text>`
      );
    }
  });

  return svgWrap(W, H, parts.join(''), 'chart-monthly');
}

/** Donut with centre total; legend is rendered separately by the UI layer. */
export function donutChart(items, { size = 190, total = null } = {}) {
  const positive = items.filter((i) => i.value > 0);
  if (!positive.length) return '<p class="muted">No data.</p>';

  const sum = positive.reduce((s, i) => s + i.value, 0);
  const R = size / 2;
  const stroke = size * 0.17;
  const r = R - stroke / 2 - 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = positive.map((item, idx) => {
    const frac = item.value / sum;
    const len = frac * circumference;
    const el =
      `<circle class="slice slice-${idx % 8}" cx="${R}" cy="${R}" r="${r}" ` +
      `stroke-width="${stroke}" stroke-dasharray="${len - 1.5} ${circumference - len + 1.5}" ` +
      `stroke-dashoffset="${-offset}" transform="rotate(-90 ${R} ${R})">` +
      `<title>${escapeHtml(`${item.label}: ${money(item.value)} (${Math.round(frac * 100)}%)`)}</title></circle>`;
    offset += len;
    return el;
  });

  const centre = total != null
    ? `<text class="donut-total" x="${R}" y="${R - 2}" text-anchor="middle">${escapeHtml(moneyCompact(total))}</text>` +
      `<text class="donut-caption" x="${R}" y="${R + 16}" text-anchor="middle">total</text>`
    : '';

  return svgWrap(size, size, arcs.join('') + centre, 'chart-donut');
}

/** Horizontal ranked bars, used for the downline breakdown. */
export function barList(items, { max = null } = {}) {
  if (!items.length) return '<p class="muted">No data.</p>';
  const peak = max ?? Math.max(...items.map((i) => Math.abs(i.value)), 1);

  return `<ul class="barlist">${items
    .map(
      (i) => `<li>
        <span class="barlist-label" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}</span>
        <span class="barlist-track"><span class="barlist-fill" style="width:${Math.max(2, (Math.abs(i.value) / peak) * 100)}%"></span></span>
        <span class="barlist-value">${escapeHtml(money(i.value))}</span>
      </li>`
    )
    .join('')}</ul>`;
}

/** Compact inline sparkline for KPI tiles and client rows. */
export function sparkline(values, { width = 120, height = 28, area = true } = {}) {
  if (!values || values.length < 2) return '';
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i) => (width / (values.length - 1)) * i;
  const y = (v) => height - 2 - ((v - min) / span) * (height - 4);

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const fill = area
    ? `<path class="spark-area" d="${line} L${x(values.length - 1).toFixed(1)},${height} L0,${height} Z"/>`
    : '';

  return svgWrap(width, height, `${fill}<path class="spark-line" d="${line}"/>`, 'chart-spark');
}
