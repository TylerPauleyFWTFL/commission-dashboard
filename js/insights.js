/**
 * Issue detection. Every detector is a pure function of the dataset and returns
 * a card descriptor, so they are trivially testable and independently lockable.
 *
 * Card shape:
 *   { id, severity, title, summary, impact, requires[], rows[], columns[], help }
 *
 * `requires` names capability keys; when unmet the UI renders a locked card
 * telling the affiliate which export column to switch on.
 */

import { daysBetween, money, dateShort, dateTime } from './format.js';

const HIGH = 'high';
const MEDIUM = 'medium';
const INFO = 'info';

/* ------------------------------------------------------------------ 1. duplicates */

/**
 * Two modes, because confidence depends entirely on whether Order ID is present.
 *
 * With Order ID the same order credited twice in a day is unambiguous. Without
 * it, the strongest available signal is an identical client/product/amount at an
 * identical second — which can equally be two units of one item. So that mode
 * reports at lower severity and says plainly what would settle it.
 *
 * Either way, bulk posting runs are excluded: when many rows share one exact
 * timestamp the platform was posting a batch of corrections, and repeated rows
 * inside it are makeup payments rather than double credits.
 */
function duplicateCredits(ds) {
  const precise = ds.schema.present.has('orderId');

  // A second that carries this many rows is a batch job, not organic activity.
  const BULK_AT = 4;
  const perSecond = new Map();
  for (const r of ds.records) {
    const k = r.created.getTime();
    perSecond.set(k, (perSecond.get(k) || 0) + 1);
  }
  const inBulkRun = (r) => (perSecond.get(r.created.getTime()) || 0) >= BULK_AT;

  const groups = new Map();
  for (const r of ds.earnings) {
    if (r.amount <= 0) continue;
    if (inBulkRun(r)) continue;
    const key = precise
      ? `${r.orderId}|${r.amount.toFixed(2)}|${r.created.toISOString().slice(0, 10)}`
      : `${r.clientKey}|${r.productKey}|${r.amount.toFixed(2)}|${r.created.getTime()}`;
    if (precise && !r.orderId) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const dupes = [...groups.values()].filter((g) => g.length > 1);
  const rows = dupes.map((g) => ({
    record: g[0],
    cells: precise
      ? [dateShort(g[0].created), g[0].clientLabel, g[0].orderId, money(g[0].amount), `${g.length}x same day`]
      : [dateTime(g[0].created), g[0].clientLabel, g[0].product || '—', money(g[0].amount), `${g.length}x identical`],
  }));
  const impact = dupes.reduce((s, g) => s + g[0].amount * (g.length - 1), 0);

  return {
    id: 'duplicates',
    severity: precise ? HIGH : MEDIUM,
    requires: [],
    title: precise ? 'Paid twice for the same thing' : 'Possibly paid twice for the same thing',
    summary: rows.length
      ? precise
        ? `${rows.length} purchase${rows.length === 1 ? ' was' : 's were'} paid out twice on the same day — about ${money(impact)} extra.`
        : `${rows.length} charge${rows.length === 1 ? '' : 's'} showed up twice at exactly the same second — about ${money(impact)} that might be counted twice.`
      : 'No duplicate credits found.',
    detail: precise
      ? 'The same purchase paid you twice on the same day. That is usually a mistake on their side, and it often gets ' +
        'taken back later — so it is worth checking before you count it as yours.'
      : 'These have the same client, same product, same amount and the same moment. Either she bought two of them in one ' +
        'order, which is perfectly normal, or you were paid twice by mistake. There is no way to tell which from this ' +
        'export. Adding the Order ID column and downloading again would settle it.',
    impact,
    rows,
    columns: precise
      ? ['Date', 'Client', 'Order ID', 'Amount', 'What happened']
      : ['Date', 'Client', 'Product', 'Amount', 'What happened'],
  };
}

/**
 * Activity that produced no commission at all. Without Campaign Name or Order ID
 * we cannot say *why* (comped, scholarship, cancellation), only that it happened
 * — so this reports the fact and leaves the interpretation to the affiliate.
 */
function zeroCommission(ds) {
  const zeroClients = ds.clients.filter((c) => c.zeroOnly);
  const rows = zeroClients
    .sort((a, b) => b.zeroRows.length - a.zeroRows.length)
    .map((c) => ({
      client: c,
      cells: [
        c.name,
        c.zeroRows[c.zeroRows.length - 1].product || '—',
        String(c.zeroRows.length),
        dateShort(c.zeroRows[0].created),
        dateShort(c.zeroRows[c.zeroRows.length - 1].created),
      ],
    }));

  return {
    id: 'zero-commission',
    severity: rows.length ? MEDIUM : INFO,
    requires: ['clients'],
    title: 'Clients who never earn you commission',
    summary: rows.length
      ? `${rows.length} client${rows.length === 1 ? ' has' : 's have'} activity on your account but ${rows.length === 1 ? 'has' : 'have'} never earned you anything.`
      : 'Every client has earned you something at least once.',
    detail:
      'These are real memberships showing under your name that pay you nothing. Usually that is on purpose — free, ' +
      'discounted or staff accounts. But a commission accidentally set to zero looks exactly the same. If you expected ' +
      'to be earning from anyone on this list, ask about it.',
    impact: 0,
    rows,
    columns: ['Client', 'Most recent product', 'Times billed', 'First seen', 'Last seen'],
  };
}

/* ------------------------------------------------------------- 2. clawbacks */

function clawbacks(ds) {
  const negatives = ds.earnings.filter((r) => r.amount < 0);

  // Match each reversal to the most recent prior positive of equal magnitude
  // on the same order. Consumed originals are not reused, so two reversals of
  // the same recurring order pair with two different charges.
  const consumed = new Set();
  const rows = negatives.map((neg) => {
    let match = null;
    if (neg.orderId) {
      const candidates = ds.earnings.filter(
        (r) =>
          r.amount > 0 &&
          r.orderId === neg.orderId &&
          Math.abs(r.amount - Math.abs(neg.amount)) < 0.005 &&
          r.created <= neg.created &&
          !consumed.has(r.i)
      );
      match = candidates[candidates.length - 1] || null;
      if (match) consumed.add(match.i);
    }
    return {
      record: neg,
      cells: [
        dateShort(neg.created),
        neg.clientLabel,
        money(neg.amount),
        match ? dateShort(match.created) : 'Not found',
        neg.note || '—',
      ],
    };
  });

  const impact = negatives.reduce((s, r) => s + r.amount, 0);
  const unmatched = rows.filter((r) => r.cells[3] === 'Not found').length;

  return {
    id: 'clawbacks',
    severity: HIGH,
    requires: [],
    title: 'Money taken back',
    summary: rows.length
      ? `${money(Math.abs(impact))} you had earned was taken back, across ${rows.length} ${rows.length === 1 ? 'change' : 'changes'}.`
      : 'Nothing was taken back. ',
    detail:
      'Sometimes commission you were already paid gets removed — a client got a refund, moved to another coach, or was ' +
      'credited to you by mistake. Read the reason on each one. If any look wrong to you, this is the list to ask about.' +
      (unmatched
        ? ` We could not tell which original payment ${unmatched === 1 ? 'one of these relates' : `${unmatched} of these relate`} to${ds.schema.present.has('orderId') ? '' : ', because this export does not include the Order ID column'}.`
        : ''),
    impact,
    rows,
    columns: ['Taken back on', 'Client', 'Amount', 'Original payment', 'Reason given'],
  };
}

/* --------------------------------------------------- 3. unexplained lapses */

/**
 * Clients who billed reliably and then stopped.
 *
 * How much this is worth depends entirely on whether cancellations are visible.
 * Cancellations arrive as $0 rows identified by Order ID prefix or the
 * "Membership cancellations" campaign — so without either column, EVERY lapsed
 * client trivially has "no cancellation on record" and most are simply normal
 * churn. Reporting an amount owed in that case would be inventing a number, so
 * the unverified mode reports lost monthly income instead and says why.
 */
function unexplainedLapses(ds) {
  const canSeeCancellations =
    ds.schema.present.has('orderId') || ds.schema.present.has('campaign');

  const lapsed = ds.clients
    .filter(
      (c) =>
        c.charges >= 3 &&
        c.monthsSinceLast >= 2 &&
        !c.cancelled && // an explicit cancellation explains the stop
        !c.hasClawback && // a coaching change already explains the stop
        !c.finalBilling
    )
    .sort((a, b) => b.rate - a.rate);

  const rows = lapsed.map((c) => ({
    client: c,
    cells: canSeeCancellations
      ? [c.name, dateShort(c.last), `${c.monthsSinceLast} months`, money(c.rate), money(c.rate * c.monthsSinceLast)]
      : [c.name, dateShort(c.last), `${c.monthsSinceLast} months`, money(c.rate), String(c.charges)],
  }));

  // Verified: commission plausibly owed. Unverified: monthly income that stopped.
  const impact = canSeeCancellations
    ? rows.reduce((s, r) => s + r.client.rate * r.client.monthsSinceLast, 0)
    : rows.reduce((s, r) => s + r.client.rate, 0);

  return {
    id: 'lapses',
    severity: canSeeCancellations ? HIGH : MEDIUM,
    requires: ['clients'],
    title: canSeeCancellations
      ? 'Clients who stopped paying with no cancellation on record'
      : 'Clients who stopped paying you',
    summary: rows.length
      ? canSeeCancellations
        ? `${rows.length} long-standing client${rows.length === 1 ? '' : 's'} stopped generating commission, and nothing in this report explains why.`
        : `${rows.length} regular client${rows.length === 1 ? '' : 's'} stopped paying — about ${money(impact)} a month you were earning that has stopped.`
      : 'None of your regular clients have gone quiet.',
    detail: canSeeCancellations
      ? 'Each of these paid you reliably for at least three months, then stopped — and nothing in your report explains ' +
        'why. There is no cancellation, no refund, no change of coach. Either she cancelled and it was not recorded, or ' +
        'your commission stopped by mistake. Worth asking about each one.'
      : 'Each of these paid you reliably for at least three months, then stopped. This export does not show cancellations, ' +
        'so there is no way to tell who simply cancelled from who stopped paying you by mistake — most of this list will be ' +
        'people who left, which is normal. Adding the Order ID column separates the two and shortens this list to the ones ' +
        'genuinely worth chasing.',
    impact,
    rows,
    columns: canSeeCancellations
      ? ['Client', 'Last paid you', 'Quiet for', 'Was paying', 'Might be owed']
      : ['Client', 'Last paid you', 'Quiet for', 'Was paying', 'Months billed'],
  };
}

/* --------------------------------------- 4. gaps inside a recurring stream */

function missingRecurring(ds) {
  const rows = [];

  for (const c of ds.clients) {
    for (const stream of c.streams) {
      if (!stream.isMonthly) continue;
      const { records, gaps, cadence } = stream;
      for (let i = 0; i < gaps.length; i++) {
        const gap = gaps[i];
        // A real miss is meaningfully longer than the stream's own cadence.
        if (gap > cadence * 1.6 && gap >= 45) {
          const missed = Math.max(1, Math.round(gap / cadence) - 1);
          rows.push({
            client: c,
            record: records[i + 1],
            missed,
            value: missed * stream.amount,
            cells: [
              c.name,
              records[i].product || records[i].campaign || '—',
              `${dateShort(records[i].created)} → ${dateShort(records[i + 1].created)}`,
              `${missed} month${missed === 1 ? '' : 's'}`,
              money(missed * stream.amount),
            ],
          });
        }
      }
    }
  }

  rows.sort((a, b) => b.value - a.value);
  const impact = rows.reduce((s, r) => s + r.value, 0);

  return {
    id: 'gaps',
    severity: HIGH,
    requires: ['clients'],
    title: 'Months that never paid you',
    summary: rows.length
      ? `${rows.length} monthly membership${rows.length === 1 ? '' : 's'} skipped a month and then carried on — about ${money(impact)} that never reached you.`
      : 'No monthly membership skipped a payment.',
    detail:
      'The client was paying before and after, so she never actually cancelled — but one month in between paid you nothing. ' +
      'This is exactly the kind of gap that gets corrected with a catch-up payment once someone points it out — ' +
      'but it will not fix itself. Send whoever runs your affiliate program this list.',
    impact,
    rows,
    columns: ['Client', 'Membership', 'Missing between', 'Months missed', 'Might be owed'],
  };
}

/* ------------------------------------------- 5. failed payments still open */

function recoverableFailures(ds) {
  const cancelled = new Set(
    ds.lifecycle.filter((r) => r.lifecycle?.type === 'cancel').map((r) => r.lifecycle.subscriptionId)
  );

  const bySub = new Map();
  for (const r of ds.lifecycle) {
    if (r.lifecycle?.type !== 'failed') continue;
    const id = r.lifecycle.subscriptionId;
    if (cancelled.has(id)) continue; // already churned; nothing to recover
    if (!bySub.has(id)) bySub.set(id, []);
    bySub.get(id).push(r);
  }

  const rows = [...bySub.entries()].map(([id, recs]) => {
    const latest = recs[recs.length - 1];
    return {
      record: latest,
      cells: [
        latest.clientLabel,
        latest.product || '—',
        `${recs.length} attempt${recs.length === 1 ? '' : 's'}`,
        dateShort(latest.created),
        `${daysBetween(latest.created, ds.range.asOf)} days ago`,
      ],
    };
  });

  return {
    id: 'failed-payments',
    severity: HIGH,
    requires: ['orderId'],
    title: 'Payments that failed — you can still save these',
    summary: rows.length
      ? `${rows.length} client${rows.length === 1 ? "'s" : "s'"} payment${rows.length === 1 ? '' : 's'} failed and ${rows.length === 1 ? 'she has' : 'they have'} not cancelled — you can still keep this income.`
      : 'No failed payments waiting.',
    detail:
      'Her card was declined but she has not cancelled, so she probably does not know. Payments that keep failing almost ' +
      'always end in a cancellation within a few weeks. A quick message now is usually the difference between keeping ' +
      'her and losing her.',
    impact: 0,
    rows,
    columns: ['Client', 'Membership', 'Times failed', 'Last tried', 'How long ago'],
  };
}

/* ------------------------------------------------------- 6. final billing */

function finalBilling(ds) {
  const rows = ds.earnings
    .filter((r) => /last billing/i.test(r.product))
    .sort((a, b) => b.created - a.created)
    .map((r) => ({
      record: r,
      cells: [r.clientLabel, dateShort(r.created), money(r.amount), r.campaign || '—'],
    }));

  const impact = rows.reduce((s, r) => s + r.record.amount, 0);

  return {
    id: 'final-billing',
    severity: MEDIUM,
    requires: ['product'],
    title: 'Memberships that are ending',
    summary: rows.length
      ? `${rows.length} client${rows.length === 1 ? ' was' : 's were'} billed for the last time — about ${money(impact)} a month is about to stop.`
      : 'No memberships are ending.',
    detail:
      'These charges are marked as the final one for the membership, so it will not bill again. Nothing has gone wrong — ' +
      'but plan for this income to stop next month, and it may be worth reaching out before it does.',
    impact,
    rows,
    columns: ['Client', 'Last charge', 'Amount', 'Type'],
  };
}

/* --------------------------------------------------------- 7. unpaid aging */

function unpaidAging(ds) {
  const unpaid = ds.earnings.filter((r) => r.isUnpaid);
  const rows = unpaid
    .slice()
    .sort((a, b) => a.created - b.created)
    .map((r) => {
      const age = daysBetween(r.created, ds.range.asOf);
      return {
        record: r,
        age,
        cells: [
          dateShort(r.created),
          r.clientLabel,
          money(r.amount),
          `${age} days`,
          age > 60 ? 'Over 60 days' : age > 30 ? '31–60 days' : 'Under 30 days',
        ],
      };
    });

  const impact = unpaid.reduce((s, r) => s + r.amount, 0);
  const stale = rows.filter((r) => r.age > 60).length;

  return {
    id: 'unpaid',
    severity: stale > 0 ? MEDIUM : INFO,
    requires: ['paid'],
    title: 'Earned, but not paid to you yet',
    summary: rows.length
      ? `${money(impact)} you have earned has not reached you yet, across ${rows.length} ${rows.length === 1 ? 'payment' : 'payments'}.`
      : 'You have been paid everything you have earned.',
    detail: stale
      ? `${stale} of these ${stale === 1 ? 'has' : 'have'} been waiting more than 60 days, which is longer than normal. Worth asking about ${stale === 1 ? 'it' : 'them'}.`
      : 'This is normal — commission usually waits here a short while until the next payout goes out.',
    impact,
    rows,
    columns: ['Date', 'Client', 'Amount', 'Waiting', 'How long'],
  };
}

/* ---------------------------------------------------------- 8. rate change */

function rateChanges(ds) {
  const rows = [];

  for (const c of ds.clients) {
    // Group by product so two different subscriptions are never compared to each other.
    const byProduct = new Map();
    for (const r of c.earnings) {
      if (r.amount <= 0) continue;
      const key = (r.product || r.campaign || '').toLowerCase();
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(r);
    }

    for (const recs of byProduct.values()) {
      for (let i = 1; i < recs.length; i++) {
        const prev = recs[i - 1];
        const cur = recs[i];
        const gap = daysBetween(prev.created, cur.created);
        if (gap < 20 || gap > 45) continue;
        if (Math.abs(prev.amount - cur.amount) < 0.005) continue;
        const down = cur.amount < prev.amount;
        rows.push({
          client: c,
          record: cur,
          down,
          delta: cur.amount - prev.amount,
          cells: [
            c.name,
            cur.product || cur.campaign || '—',
            `${money(prev.amount)} → ${money(cur.amount)}`,
            down ? 'Went down' : 'Went up',
            dateShort(cur.created),
          ],
        });
      }
    }
  }

  rows.sort((a, b) => a.delta - b.delta);
  const decreases = rows.filter((r) => r.down);

  return {
    id: 'rate-changes',
    severity: decreases.length ? MEDIUM : INFO,
    requires: ['clients'],
    title: 'Your commission amount changed',
    summary: rows.length
      ? `${rows.length} membership${rows.length === 1 ? '' : 's'} started paying you a different amount` +
        (decreases.length ? `, and ${decreases.length} of those went down.` : ' — all of them went up.')
      : 'Your commission amounts have stayed the same.',
    detail: decreases.length
      ? 'A drop is worth a look. If she moved to a cheaper membership that is expected — but if nothing changed on her side, your rate may have been altered by mistake.'
      : 'These all went up, usually because a client came off an introductory price onto the full one. Nothing to do.',
    impact: decreases.reduce((s, r) => s + r.delta, 0),
    rows,
    columns: ['Client', 'Membership', 'Change', 'Up or down', 'From'],
  };
}

/* ------------------------------------------------------ 9. makeup payments */

function makeupPayments(ds) {
  const rows = ds.earnings
    .filter((r) => /to account for missing/i.test(r.note))
    .sort((a, b) => b.created - a.created)
    .map((r) => ({
      record: r,
      cells: [dateShort(r.created), r.clientLabel, money(r.amount), r.note],
    }));

  const impact = rows.reduce((s, r) => s + r.record.amount, 0);

  return {
    id: 'makeups',
    severity: INFO,
    requires: ['note'],
    title: 'Already fixed for you',
    summary: rows.length
      ? `${money(impact)} was paid to you to make up for ${rows.length} commission${rows.length === 1 ? '' : 's'} that had been missed earlier.`
      : 'No catch-up payments this period.',
    detail:
      'These were already spotted and paid to you as a correction. Nothing for you to do — they are here so you can ' +
      'see that past gaps were sorted out.',
    impact,
    rows,
    columns: ['Paid on', 'Client', 'Amount', 'What it was for'],
  };
}

/* ----------------------------------------------------- 10. cancellations */

function cancellations(ds) {
  const rows = ds.lifecycle
    .filter((r) => r.lifecycle?.type === 'cancel')
    .sort((a, b) => b.created - a.created)
    .map((r) => ({
      record: r,
      cells: [dateShort(r.created), r.clientLabel, r.product || '—'],
    }));

  return {
    id: 'cancellations',
    severity: INFO,
    requires: ['orderId'],
    title: 'Cancellations',
    summary: rows.length
      ? `${rows.length} client${rows.length === 1 ? '' : 's'} cancelled during this period.`
      : 'Nobody cancelled during this period.',
    detail:
      'Cancellations earn nothing, so they are left out of your totals. They are listed here so that if your income dipped ' +
      'in a particular month, you can see why.',
    impact: 0,
    rows,
    columns: ['Cancelled on', 'Client', 'Membership'],
  };
}

/* ------------------------------------------------------------- assembly */

/**
 * Minimum span, in days, before a check can say anything meaningful.
 *
 * A 12-day export cannot tell you whether a client has stopped paying — two
 * months of silence is the signal, and there are not two months in the file.
 * Reporting "all clear" in that situation would be a confident lie, so these
 * checks declare what they need and the UI explains the gap instead.
 */
const MIN_HISTORY_DAYS = {
  lapses: 90,
  gaps: 75,
  'rate-changes': 60,
  'zero-commission': 45,
};

const HISTORY_REASON = {
  lapses: 'Spotting a client who has stopped needs at least a couple of months of history to compare against.',
  gaps: 'Finding a skipped month means seeing the months either side of it.',
  'rate-changes': 'Comparing what someone paid you month to month needs more than one month.',
  'zero-commission': 'Telling a genuinely non-earning client apart from a brand new one takes a longer view.',
};

const DETECTORS = [
  duplicateCredits,
  zeroCommission,
  clawbacks,
  unexplainedLapses,
  missingRecurring,
  recoverableFailures,
  finalBilling,
  unpaidAging,
  rateChanges,
  makeupPayments,
  cancellations,
];

const SEVERITY_RANK = { high: 0, medium: 1, info: 2 };

/** Dollar weight of a single row, used to lead with what matters most. */
function rowWeight(row) {
  if (typeof row.value === 'number') return Math.abs(row.value);
  if (row.client) return Math.abs(row.client.rate || row.client.total || 0);
  if (row.record) return Math.abs(row.record.amount || 0);
  return 0;
}

/**
 * How many rows to surface before "show the rest". A long list is paralysing;
 * five concrete names is something she can act on this afternoon.
 */
export const LEAD_ROWS = 5;

/**
 * Run every detector. Cards whose capabilities are unmet come back `locked`
 * rather than being dropped, so the UI can explain what is missing and why.
 */
export function runInsights(ds, caps) {
  const cards = DETECTORS.map((fn) => {
    const unmet = [];
    try {
      const card = fn(ds);
      for (const req of card.requires || []) if (!caps[req]) unmet.push(req);
      if (unmet.length) return { ...card, locked: true, unmet, rows: [], impact: 0 };
      return { ...card, locked: false, unmet: [] };
    } catch (err) {
      console.error('Detector failed:', fn.name, err);
      return null;
    }
  }).filter(Boolean);

  // Flag checks the loaded period is too short to answer.
  const spanDays = Math.max(
    1,
    Math.round((ds.range.asOf - ds.range.first) / 86400000) + 1
  );
  for (const card of cards) {
    const need = MIN_HISTORY_DAYS[card.id];
    if (need && spanDays < need && !card.locked) {
      card.needsMoreHistory = true;
      card.historyMessage =
        `${HISTORY_REASON[card.id]} This report covers ${spanDays} day${spanDays === 1 ? '' : 's'} — ` +
        `choose a longer time period, or load a report covering at least ${Math.round(need / 30)} months.`;
      card.rows = [];
      card.impact = 0;
    }
  }

  // Biggest-impact rows first, so "start with these" really is the top five.
  for (const card of cards) {
    if (card.rows.length > 1) card.rows.sort((x, y) => rowWeight(y) - rowWeight(x));
    card.mailto = buildCardMail(ds, card);
  }

  cards.sort((a, b) => {
    const aside = (c) => (c.locked ? 2 : c.needsMoreHistory ? 1 : 0);
    if (aside(a) !== aside(b)) return aside(a) - aside(b);
    const empA = a.rows.length === 0;
    const empB = b.rows.length === 0;
    if (empA !== empB) return empA ? 1 : -1;
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return Math.abs(b.impact) - Math.abs(a.impact);
  });

  return cards;
}

/**
 * Address that "Ask about this" writes to.
 * TODO: put your affiliate support address here. Left blank,
 * the email still opens fully written — she just picks the recipient herself.
 */
export const SUPPORT_EMAIL = '';

/**
 * A ready-to-send email for one finding.
 *
 * The body is deliberately written in her voice, not the dashboard's: she is the
 * one sending it, and it has to read like a person asking a reasonable question.
 */
function buildCardMail(ds, card) {
  if (card.locked || card.needsMoreHistory || !card.rows.length || card.severity === 'info') return null;

  const who = ds.ownerName ? ` — ${ds.ownerName}` : '';
  const subject = `Question about my commissions${who}: ${card.title}`;

  const lines = [
    'Hi,',
    '',
    `I was reviewing my commission report for ${dateShort(ds.range.first)} to ${dateShort(ds.range.asOf)} and had a question.`,
    '',
    card.summary,
    '',
    'Here are the details:',
    '',
    `${card.columns.join(' | ')}`,
    ...card.rows.slice(0, 40).map((r) => r.cells.join(' | ')),
  ];
  if (card.rows.length > 40) lines.push(`...and ${card.rows.length - 40} more.`);
  lines.push('', 'Could you take a look and let me know? Thank you!');

  const body = lines.join('\n');
  return `mailto:${encodeURIComponent(SUPPORT_EMAIL)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Plain-text summary an affiliate can paste into a support request. */
export function buildEscalationText(ds, cards) {
  const lines = [];
  lines.push(ds.ownerName ? `Commission report review — ${ds.ownerName}` : 'Commission report review');
  lines.push(`Period: ${dateShort(ds.range.first)} to ${dateShort(ds.range.asOf)}`);
  lines.push('');

  const actionable = cards.filter((c) => !c.locked && c.rows.length && c.severity !== 'info');
  if (!actionable.length) {
    lines.push('No issues found in this report.');
    return lines.join('\n');
  }

  for (const card of actionable) {
    lines.push(`## ${card.title}`);
    lines.push(card.summary);
    for (const row of card.rows.slice(0, 25)) {
      lines.push(`  - ${row.cells.join(' | ')}`);
    }
    if (card.rows.length > 25) lines.push(`  ...and ${card.rows.length - 25} more`);
    lines.push('');
  }
  return lines.join('\n').trim();
}
