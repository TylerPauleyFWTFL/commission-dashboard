/**
 * Turns raw CSV cells into a typed dataset: records, clients, recurring streams.
 *
 * Two rules here are load-bearing and were derived from real exports:
 *   1. Client identity is the EMAIL, never the name. The same email appears under
 *      multiple name spellings ("Lizzy Gray" / "Elizabeth Gray").
 *   2. $0 rows never count as earnings. Only some of them are subscription
 *      lifecycle events (cancellations, failed payments), and we can only know
 *      that when Order ID or Campaign Name is in the export. In the default
 *      affiliate view neither is, so the honest classification is simply
 *      "earned nothing" — see `isZero` vs `isLifecycle`.
 */

import { monthKey, monthsBetween } from './format.js';

/** Rows whose Order ID starts with one of these are lifecycle events, not earnings. */
const LIFECYCLE_PREFIXES = { cancel_: 'cancel', failed_: 'failed' };

function parseDate(value) {
  if (!value) return null;
  // "2026-09-13 16:50:28" — parsed as local time deliberately; these are billing
  // timestamps the affiliate reads in their own timezone. new Date(str) would
  // treat the ISO-ish form inconsistently across browsers, so build it explicitly.
  const m = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const fallback = new Date(value);
  return isNaN(fallback) ? null : fallback;
}

function parseAmount(value) {
  if (value === '' || value == null) return 0;
  // Tolerate "$1,234.56" and "1.234,56" style inputs.
  let s = String(value).trim().replace(/[$\s]/g, '');
  if (/,\d{1,2}$/.test(s) && !/\./.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** `cancel_4493732_2026-05-01` -> { type:'cancel', subscriptionId:'4493732' } */
function parseLifecycle(orderId) {
  if (!orderId) return null;
  for (const [prefix, type] of Object.entries(LIFECYCLE_PREFIXES)) {
    if (orderId.startsWith(prefix)) {
      const rest = orderId.slice(prefix.length).split('_');
      return { type, subscriptionId: rest[0] || orderId };
    }
  }
  return null;
}

/**
 * Normalized product key for grouping.
 *
 * Catalogues drift in punctuation: "VIP Mujeres en Español - (renovación
 * automática)" and "VIP Mujeres en Español (renovación automática)" are one
 * product recorded two ways, and charting them apart splits 521 rows in half.
 * Accents are preserved so genuinely different Spanish products stay distinct.
 */
export function productKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Strip the `(1)` / `(2)` line-item suffix to get the order-level id. */
export const baseOrderId = (id) => String(id || '').replace(/\(\d+\)\s*$/, '');

const PAID_LABELS = { P: 'Paid', U: 'Unpaid', A: 'Approved', D: 'Declined' };
const STATUS_LABELS = { A: 'Approved', P: 'Pending', D: 'Declined', R: 'Rejected' };

export function buildDataset(parsed, schema, fileMeta = {}) {
  const { index } = schema;
  const cell = (row, key) => (index[key] === undefined ? '' : row[index[key]] ?? '');

  const records = parsed.rows.map((row, i) => {
    const created = parseDate(cell(row, 'created'));
    const amount = parseAmount(cell(row, 'amount'));
    const orderId = String(cell(row, 'orderId')).trim();
    const email = String(cell(row, 'clientEmail')).trim().toLowerCase();
    const name = String(cell(row, 'clientName')).trim();
    const lifecycle = parseLifecycle(orderId);
    const paidCode = String(cell(row, 'paid')).trim().toUpperCase();
    const statusCode = String(cell(row, 'status')).trim().toUpperCase();

    return {
      i,
      created,
      monthKey: created ? monthKey(created) : null,
      amount,
      orderId,
      baseOrderId: baseOrderId(orderId),
      campaign: String(cell(row, 'campaign')).trim(),
      product: String(cell(row, 'product')).trim(),
      referral: String(cell(row, 'referral')).trim(),
      note: String(cell(row, 'note')).trim(),
      clientName: name,
      clientEmail: email,
      // Display key: prefer email identity, fall back to name when the column is absent.
      clientKey: email || name.toLowerCase(),
      clientLabel: name || email || 'Unknown client',
      paidCode,
      paidLabel: PAID_LABELS[paidCode] || paidCode || '—',
      isPaid: paidCode === 'P',
      isUnpaid: paidCode === 'U',
      statusCode,
      statusLabel: STATUS_LABELS[statusCode] || statusCode || '—',
      lifecycle,
      productKey: productKey(cell(row, 'product')),
      // Classification used everywhere downstream. A row is a lifecycle event
      // only when something in the data actually says so; a bare $0 row is just
      // a row that earned nothing, and must not be reported as a cancellation.
      isLifecycle: Boolean(lifecycle) || (amount === 0 && /cancellation/i.test(cell(row, 'campaign'))),
      isZero: amount === 0,
      isClawback: amount < 0,
      isEarning: amount !== 0,
      raw: row,
    };
  });

  const dated = records.filter((r) => r.created);
  if (dated.length === 0) {
    throw new Error('No rows had a readable date in the "Created" column.');
  }

  dated.sort((a, b) => a.created - b.created);

  const earnings = dated.filter((r) => r.isEarning && !r.isLifecycle);
  const lifecycle = dated.filter((r) => r.isLifecycle);
  // $0 rows that carry no lifecycle evidence: real activity that paid nothing.
  const zeroRows = dated.filter((r) => r.isZero && !r.isLifecycle);

  const first = dated[0].created;
  const last = dated[dated.length - 1].created;

  // "As of" comes from the export filename when available; the newest row otherwise.
  const asOf = fileMeta.exportedAt && fileMeta.exportedAt > last ? fileMeta.exportedAt : last;

  return {
    records: dated,
    earnings,
    lifecycle,
    zeroRows,
    clients: buildClients(dated, earnings, lifecycle, asOf),
    range: { first, last, asOf },
    fileMeta,
    schema,
  };
}

/*
 * Deliberately NOT inferred: whose report this is.
 *
 * An earlier version guessed the owner from the most frequent Referral Source.
 * That is wrong — Referral Source names whoever referred each client, which in a
 * team report is a downline coach, not the reader. One real export proved it:
 * the most frequent referrer also appeared as a CLIENT in the same file, under a
 * different referrer. The owner is simply not present in the data, so the UI asks
 * for a name instead of guessing one.
 */

/**
 * Group everything by client email.
 *
 * Deliberately NOT keyed on campaign or product: the platform migration in the
 * source data renames campaigns mid-stream (e.g. "Coach: Client Membership
 * Discount" -> "VIP Membership Scholarship Rate") while the subscription itself
 * continues uninterrupted. Keying on campaign reports those clients as churned.
 */
function buildClients(all, earnings, lifecycle, asOf) {
  const byClient = new Map();

  const ensure = (rec) => {
    const key = rec.clientKey || 'unknown';
    if (!byClient.has(key)) {
      byClient.set(key, {
        key,
        email: rec.clientEmail,
        name: rec.clientLabel,
        records: [],
        earnings: [],
        lifecycle: [],
      });
    }
    return byClient.get(key);
  };

  for (const rec of all) {
    const c = ensure(rec);
    c.records.push(rec);
    if (rec.isLifecycle) c.lifecycle.push(rec);
    else if (rec.isEarning) c.earnings.push(rec);
    // Latest non-empty name spelling wins.
    if (rec.clientName) c.name = rec.clientName;
  }

  for (const c of byClient.values()) {
    const positives = c.earnings.filter((r) => r.amount > 0);
    c.zeroRows = c.records.filter((r) => r.isZero && !r.isLifecycle);
    // A client who has only ever produced $0 rows is generating activity but no
    // income — a distinct situation from having stopped, and worth its own flag.
    c.zeroOnly = positives.length === 0 && c.zeroRows.length > 0;
    c.total = c.earnings.reduce((s, r) => s + r.amount, 0);
    c.clawback = c.earnings.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
    c.hasClawback = c.clawback < 0;
    c.cancelled = c.lifecycle.some((r) => r.lifecycle?.type === 'cancel');
    c.failedPayments = c.lifecycle.filter((r) => r.lifecycle?.type === 'failed');
    c.first = positives.length ? positives[0].created : c.records[0].created;
    c.last = positives.length ? positives[positives.length - 1].created : c.records[0].created;
    c.charges = positives.length;
    c.monthsActive = monthsBetween(c.first, c.last) + 1;
    c.rate = positives.length ? positives[positives.length - 1].amount : 0;
    c.finalBilling = positives.some((r) => /last billing/i.test(r.product));
    c.streams = buildStreams(positives);
    c.monthsSinceLast = monthsBetween(c.last, asOf);
    c.status = clientStatus(c);
  }

  return [...byClient.values()].sort((a, b) => b.total - a.total);
}

/**
 * Split a client's charges into recurring streams keyed by amount.
 *
 * Amount is a far more stable identifier of "which subscription is this" than
 * campaign or product, both of which were renamed by the platform migration.
 */
function buildStreams(positives) {
  const byAmount = new Map();
  for (const r of positives) {
    const key = r.amount.toFixed(2);
    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key).push(r);
  }

  return [...byAmount.entries()].map(([amountKey, recs]) => {
    const gaps = [];
    for (let i = 1; i < recs.length; i++) {
      gaps.push(Math.round((recs[i].created - recs[i - 1].created) / 86400000));
    }
    // Cadence = shortest realistic interval. Using the minimum (rather than the
    // median) keeps a stream with a missed month from inflating its own cadence
    // and hiding the very gap we are looking for.
    const realistic = gaps.filter((g) => g >= 15);
    const cadence = realistic.length ? Math.min(...realistic) : null;

    // A stream only counts as monthly if its intervals are actually regular.
    // Every gap must be explainable as roughly N whole cycles: a clean cycle,
    // or a cycle that was missed N-1 times. Without this, a client holding two
    // same-priced subscriptions offset by a few days looks like one subscription
    // with a chaotic schedule, and its normal short gaps get misread as skips.
    const explained = cadence
      ? gaps.filter((g) => {
          const cycles = Math.round(g / cadence);
          return cycles >= 1 && Math.abs(g - cycles * cadence) <= cadence * 0.25;
        }).length
      : 0;
    const regular = gaps.length > 0 && explained / gaps.length >= 0.7;

    return {
      amount: parseFloat(amountKey),
      records: recs,
      gaps,
      cadence,
      isMonthly:
        cadence !== null && cadence >= 20 && cadence <= 40 && recs.length >= 3 && regular,
    };
  });
}

function clientStatus(c) {
  if (c.zeroOnly) return 'no-commission';
  if (c.cancelled) return 'cancelled';
  if (c.finalBilling) return 'ending';
  if (c.charges < 2) return 'one-time';
  if (c.monthsSinceLast >= 2) return 'lapsed';
  const monthly = c.streams.find((s) => s.isMonthly);
  if (monthly) {
    const overdueBy = Math.round((Date.now() - c.last) / 86400000) - monthly.cadence;
    if (c.monthsSinceLast >= 1 && overdueBy > 7) return 'lapsing';
  }
  return 'active';
}

/** Pull the export timestamp out of `grid_2026-09-13_17-09-00_330595319.csv`. */
export function exportTimestampFromFilename(filename) {
  const m = String(filename).match(/(\d{4})-(\d{2})-(\d{2})[_ ](\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
