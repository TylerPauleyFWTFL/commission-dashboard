/**
 * Aggregate figures and chart-ready series.
 *
 * All money excludes $0 lifecycle rows. Nothing here assumes a particular time
 * scale — buckets come from js/period.js, so the same code serves a 12-day
 * export and a three-year one.
 */

import {
  bucketKey, bucketStart, nextBucket, chooseGranularity,
  isPartialBucket, dayCount, previousRange,
} from './period.js';

export function computeTotals(ds) {
  const e = ds.earnings;
  const gross = e.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const clawback = e.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  const net = gross + clawback;

  // Payout figures only mean something when the export carries a Paid column.
  // Without it these stay null so the UI omits the tiles rather than showing $0.
  const hasPaid = ds.schema.present.has('paid');
  const paid = hasPaid ? e.filter((r) => r.isPaid).reduce((s, r) => s + r.amount, 0) : null;
  const unpaid = hasPaid ? e.filter((r) => r.isUnpaid).reduce((s, r) => s + r.amount, 0) : null;

  const activeClients = ds.clients.filter(
    (c) => c.status === 'active' || c.status === 'lapsing' || c.status === 'ending'
  ).length;
  const earningClients = ds.clients.filter((c) => c.total > 0).length;

  return {
    gross,
    clawback,
    net,
    paid,
    unpaid,
    hasPaid,
    transactions: e.length,
    zeroRows: ds.zeroRows.length,
    clients: ds.clients.length,
    earningClients,
    activeClients,
    avgPerClient: earningClients ? net / earningClients : 0,
    avgPerTransaction: e.length ? net / e.length : 0,
  };
}

/**
 * Continuous buckets across the report's span, at whatever granularity suits it.
 * Empty buckets are kept so gaps in activity are visible rather than collapsed.
 */
export function buildSeries(ds, granularity = null) {
  const from = ds.range.first;
  const asOf = ds.range.asOf;
  const gran = granularity || chooseGranularity(from, asOf);

  const buckets = new Map();
  let cursor = bucketStart(from, gran);
  // Guard against a pathological range producing an unbounded loop.
  for (let i = 0; cursor <= asOf && i < 2000; i++) {
    const key = bucketKey(cursor, gran);
    buckets.set(key, {
      key,
      date: cursor,
      gran,
      paid: 0,
      unpaid: 0,
      clawback: 0,
      net: 0,
      count: 0,
      cancellations: 0,
      partial: isPartialBucket(cursor, gran, asOf),
    });
    cursor = nextBucket(cursor, gran);
  }

  const hasPaid = ds.schema.present.has('paid');
  for (const r of ds.earnings) {
    const b = buckets.get(bucketKey(r.created, gran));
    if (!b) continue;
    if (r.amount < 0) b.clawback += r.amount;
    else if (hasPaid && r.isUnpaid) b.unpaid += r.amount;
    else b.paid += r.amount; // without a Paid column this is simply "earned"
    b.net += r.amount;
    b.count++;
  }

  for (const r of ds.lifecycle) {
    const b = buckets.get(bucketKey(r.created, gran));
    if (b && r.lifecycle?.type === 'cancel') b.cancellations++;
  }

  const series = [...buckets.values()];

  // Trailing average over roughly a third of the visible span, so the trend line
  // means the same thing whether buckets are days or quarters.
  const window = Math.max(2, Math.min(6, Math.round(series.length / 4)));
  series.forEach((b, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1);
    b.rolling = slice.reduce((s, x) => s + x.net, 0) / slice.length;
  });

  series.granularity = gran;
  return series;
}

/**
 * The last two COMPLETE buckets, and the change between them.
 *
 * Returns the buckets themselves rather than a bare percentage, because the UI
 * must be able to name the periods it is comparing. Pairing a part-period total
 * with a comparison of two earlier ones is what made the old tile read as a
 * collapse that had not happened.
 */
export function lastFullPeriods(series) {
  const complete = series.filter((b) => !b.partial);
  const current = series[series.length - 1]?.partial ? series[series.length - 1] : null;
  const recent = complete[complete.length - 1] ?? null;
  const prior = complete[complete.length - 2] ?? null;
  const delta = recent && prior && prior.net ? (recent.net - prior.net) / Math.abs(prior.net) : null;
  return { recent, prior, delta, current, complete, granularity: series.granularity };
}

/**
 * Totals for the equivalent window immediately before this one.
 *
 * Rows come from the UNFILTERED dataset, because the filtered one by definition
 * contains nothing from before the window.
 */
export function comparePrevious(fullDs, range) {
  const prev = previousRange(range);
  const rows = fullDs.earnings.filter((r) => r.created >= prev.from && r.created <= prev.to);
  if (!rows.length) return null;

  const net = rows.reduce((s, r) => s + r.amount, 0);
  const clients = new Set(rows.map((r) => r.clientKey)).size;
  return { from: prev.from, to: prev.to, net, clients, transactions: rows.length };
}

/** Group earnings by a field, largest first, with a rolled-up "Other". */
export function breakdown(ds, field, limit = 8, groupBy = null) {
  const map = new Map();
  const spellings = new Map();

  for (const r of ds.earnings) {
    const label = r[field] || '(none)';
    // `groupBy` lets near-identical catalogue spellings collapse into one slice
    // while still showing a label the reader recognises.
    const key = groupBy ? r[groupBy] || label : label;
    if (!map.has(key)) map.set(key, { key, label, value: 0, count: 0 });
    const b = map.get(key);
    b.value += r.amount;
    b.count++;

    if (groupBy) {
      if (!spellings.has(key)) spellings.set(key, new Map());
      const tally = spellings.get(key);
      tally.set(label, (tally.get(label) || 0) + 1);
    }
  }

  if (groupBy) {
    for (const [key, tally] of spellings) {
      map.get(key).label = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  const all = [...map.values()].filter((b) => b.value !== 0).sort((a, b) => b.value - a.value);
  if (all.length <= limit) return all;

  const head = all.slice(0, limit - 1);
  const tail = all.slice(limit - 1);
  head.push({
    key: '__other__',
    label: `Other (${tail.length})`,
    value: tail.reduce((s, b) => s + b.value, 0),
    count: tail.reduce((s, b) => s + b.count, 0),
  });
  return head;
}

/** Who referred the clients in this report, and what each brought in. */
export function referrers(ds) {
  return breakdown(ds, 'referral', 12).filter((r) => r.key !== '(none)');
}

/** Per-client sparkline values over the bucket axis. */
export function clientSpark(client, series) {
  const gran = series.granularity || 'month';
  const byBucket = new Map(series.map((b) => [b.key, 0]));
  for (const r of client.earnings) {
    const k = bucketKey(r.created, gran);
    if (byBucket.has(k)) byBucket.set(k, byBucket.get(k) + r.amount);
  }
  return [...byBucket.values()];
}

/* ------------------------------------------------------------------ churn */

/** Enough history to say anything about clients leaving. */
export const CHURN_MIN_DAYS = 90;

/**
 * Share of once-regular clients who have gone quiet.
 *
 * Deliberately narrow: only clients with at least three charges are counted, so
 * one-off purchasers cannot inflate the figure, and it returns null rather than
 * a misleading zero when the window is too short to judge.
 */
export function churnRate(ds) {
  const span = dayCount(ds.range.first, ds.range.asOf);
  if (span < CHURN_MIN_DAYS) return null;

  const regulars = ds.clients.filter((c) => c.charges >= 3);
  if (regulars.length < 5) return null;

  const stopped = regulars.filter((c) => c.monthsSinceLast >= 2);
  return {
    rate: stopped.length / regulars.length,
    stopped: stopped.length,
    regulars: regulars.length,
    spanDays: span,
  };
}

/* ------------------------------------------------------------------- wins */

/** The encouraging facts. Same data, read the other way round. */
export function computeWins(ds, series, totals) {
  const complete = series.filter((b) => !b.partial && b.count > 0);
  const best = complete.length ? complete.reduce((a, b) => (b.net > a.net ? b : a)) : null;

  const earners = ds.clients.filter((c) => c.total > 0);
  const longest = earners.length ? earners.reduce((a, c) => (c.first < a.first ? c : a)) : null;
  const top = earners.length ? earners.reduce((a, c) => (c.total > a.total ? c : a)) : null;

  const gran = series.granularity;
  // "Paid every period" is only a meaningful compliment on a monthly-or-longer
  // view; on a daily chart nobody bills every single day.
  let loyal = null;
  if (gran === 'month' || gran === 'quarter') {
    const keys = complete.map((b) => b.key);
    loyal = earners.filter((c) => {
      const seen = new Set(c.earnings.filter((r) => r.amount > 0).map((r) => bucketKey(r.created, gran)));
      const eligible = keys.filter((k) => k >= bucketKey(c.first, gran));
      return eligible.length >= 3 && eligible.every((k) => seen.has(k));
    }).length;
  }

  return { best, longest, top, loyal, earners: earners.length, total: totals.net, granularity: gran };
}
