/** Presentation helpers. Pure, no DOM. */

const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CURRENCY_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const money = (n) => CURRENCY.format(n || 0);
export const moneyCompact = (n) =>
  Math.abs(n) >= 1000 ? CURRENCY_WHOLE.format(n) : CURRENCY.format(n || 0);

/** Signed money, used for deltas and clawbacks. */
export function moneySigned(n) {
  const v = n || 0;
  return (v > 0 ? '+' : '') + CURRENCY.format(v);
}

export const number = (n) => new Intl.NumberFormat('en-US').format(n || 0);

export function pct(n) {
  if (!isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`;
}

const DATE_SHORT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const dateShort = (d) => (d instanceof Date && !isNaN(d) ? DATE_SHORT.format(d) : '—');
export const dateTime = (d) => (d instanceof Date && !isNaN(d) ? DATE_TIME.format(d) : '—');

/** "2026-03" -> "Mar 2026" */
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(
    new Date(y, m - 1, 1)
  );
}

/** "2026-03" -> "Mar" (for dense axes) */
export function monthLabelShort(key) {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(y, m - 1, 1));
}

export const monthKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const plural = (n, one, many) => `${number(n)} ${n === 1 ? one : many ?? one + 's'}`;

export function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

/** Calendar-month difference; matches how billing cycles are reasoned about. */
export function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function agoLabel(days) {
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  return `${months} months ago`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Deterministic slug for DOM ids. */
export const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
