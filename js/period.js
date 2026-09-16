/**
 * Time handling: ranges, bucketing and period comparison.
 *
 * Reports arrive at wildly different scales — one file covers 12 days, another
 * covers two years. Bucketing everything by month made the short one a single
 * bar and the long one unreadable, so granularity is chosen from the span
 * rather than fixed.
 *
 * Everything is anchored to the report's own "as of" date, not today's date, so
 * a file downloaded last month filters the same way it did when it was fresh.
 */

const DAY = 86400000;

/* --------------------------------------------------------------- ranges */

export const RANGES = [
  { id: 'last7', label: 'Last 7 days', days: 7 },
  { id: 'last14', label: 'Last 14 days', days: 14 },
  { id: 'last30', label: 'Last 30 days', days: 30 },
  { id: 'mtd', label: 'This month' },
  { id: 'lastmonth', label: 'Last month' },
  { id: 'last90', label: 'Last 3 months', days: 90 },
  { id: 'last180', label: 'Last 6 months', days: 180 },
  { id: 'ytd', label: 'This year' },
  { id: 'last365', label: 'Last 12 months', days: 365 },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom dates…' },
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/**
 * Resolve a range id into concrete bounds.
 * `asOf` is the report's newest data point; `bounds` is the full data extent.
 */
export function resolveRange(id, asOf, bounds, custom = {}) {
  const to = endOfDay(asOf);

  if (id === 'all') return { id, from: bounds.first, to, label: 'All time' };

  if (id === 'custom') {
    const from = custom.from ? startOfDay(new Date(`${custom.from}T00:00:00`)) : bounds.first;
    const cTo = custom.to ? endOfDay(new Date(`${custom.to}T00:00:00`)) : to;
    return { id, from, to: cTo, label: 'Custom dates', custom: true };
  }

  if (id === 'mtd') {
    return { id, from: new Date(asOf.getFullYear(), asOf.getMonth(), 1), to, label: 'This month' };
  }

  if (id === 'lastmonth') {
    const from = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
    const end = new Date(asOf.getFullYear(), asOf.getMonth(), 0, 23, 59, 59, 999);
    return { id, from, to: end, label: 'Last month' };
  }

  if (id === 'ytd') {
    return { id, from: new Date(asOf.getFullYear(), 0, 1), to, label: 'This year' };
  }

  const spec = RANGES.find((r) => r.id === id);
  const days = spec?.days ?? 30;
  // Inclusive of today, so "last 7 days" is 7 calendar days, not 8.
  return { id, from: startOfDay(new Date(to.getTime() - (days - 1) * DAY)), to, label: spec?.label ?? id };
}

/** The equally-long window immediately before this one, for comparison. */
export function previousRange(range) {
  const length = range.to - range.from;
  const to = new Date(range.from.getTime() - 1);
  return { from: new Date(range.from.getTime() - length - 1), to };
}

/** Ranges the data can actually support, so the picker never offers an empty view. */
export function availableRanges(bounds) {
  const spanDays = Math.max(1, Math.round((bounds.asOf - bounds.first) / DAY) + 1);
  return RANGES.filter((r) => {
    if (r.id === 'all' || r.id === 'custom') return true;
    if (r.days) return r.days <= spanDays + 45; // allow a little headroom
    return true; // mtd / lastmonth / ytd are always meaningful
  });
}

/* ---------------------------------------------------------- granularity */

export const GRANULARITIES = ['day', 'week', 'month', 'quarter'];

/**
 * Pick a bucket size that yields a readable number of columns.
 * Roughly 7–30 bars is comfortable at any screen width.
 */
export function chooseGranularity(fromDate, toDate) {
  const days = Math.max(1, Math.round((toDate - fromDate) / DAY) + 1);
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  if (days <= 800) return 'month';
  return 'quarter';
}

const pad = (n) => String(n).padStart(2, '0');

/** Monday-anchored week start. */
function weekStart(d) {
  const s = startOfDay(d);
  const shift = (s.getDay() + 6) % 7; // Sunday(0) -> 6
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - shift);
}

export function bucketStart(date, gran) {
  if (gran === 'day') return startOfDay(date);
  if (gran === 'week') return weekStart(date);
  if (gran === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

export function bucketKey(date, gran) {
  const s = bucketStart(date, gran);
  if (gran === 'quarter') return `${s.getFullYear()}-Q${Math.floor(s.getMonth() / 3) + 1}`;
  if (gran === 'month') return `${s.getFullYear()}-${pad(s.getMonth() + 1)}`;
  return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
}

export function nextBucket(date, gran) {
  const s = bucketStart(date, gran);
  if (gran === 'day') return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
  if (gran === 'week') return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
  if (gran === 'month') return new Date(s.getFullYear(), s.getMonth() + 1, 1);
  return new Date(s.getFullYear(), s.getMonth() + 3, 1);
}

/** True once the bucket containing `asOf` is still running. */
export function isPartialBucket(bucketDate, gran, asOf) {
  return nextBucket(bucketDate, gran) > asOf && bucketStart(asOf, gran) <= bucketDate;
}

/* ------------------------------------------------------------- labelling */

const MON = { month: 'short' };
const MD = { month: 'short', day: 'numeric' };

export function formatBucket(date, gran, { long = false } = {}) {
  if (gran === 'quarter') return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
  if (gran === 'month') {
    return new Intl.DateTimeFormat('en-US', long ? { month: 'long', year: 'numeric' } : { ...MON, year: 'numeric' }).format(date);
  }
  if (gran === 'week') return `Week of ${new Intl.DateTimeFormat('en-US', MD).format(date)}`;
  return new Intl.DateTimeFormat('en-US', long ? { weekday: 'short', ...MD } : MD).format(date);
}

/**
 * Short axis label. `withYear` is set by the chart at year boundaries, so a
 * multi-year axis does not read "Q1 Q3 Q1 Q3" with no way to tell them apart.
 */
export function formatBucketShort(date, gran, { withYear = false } = {}) {
  const yy = `'${String(date.getFullYear()).slice(2)}`;
  if (gran === 'quarter') return `Q${Math.floor(date.getMonth() / 3) + 1} ${yy}`;
  if (gran === 'month') {
    const m = new Intl.DateTimeFormat('en-US', MON).format(date);
    return withYear ? `${m} ${yy}` : m;
  }
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(date);
}

/** What one bucket is called in prose: "day", "week", "month", "quarter". */
export const granularityNoun = (gran) => gran;

export const dayCount = (from, to) => Math.max(1, Math.round((to - from) / DAY) + 1);
