/**
 * Rendering. Builds HTML strings and wires interaction through event delegation,
 * so re-rendering a section never leaves dangling listeners.
 */

import {
  money, number, dateShort,
  escapeHtml, plural, agoLabel, daysBetween, slug,
} from './format.js';
import { periodChart, donutChart, barList, sparkline } from './charts.js';
import {
  computeTotals, buildSeries, breakdown, referrers, clientSpark,
  lastFullPeriods, computeWins, churnRate, comparePrevious,
} from './metrics.js';
import { formatBucket, dayCount } from './period.js';
import { runInsights, buildEscalationText, LEAD_ROWS } from './insights.js';
import { UNLOCKS, FIELDS } from './schema.js';
import { term, glossaryPanel, wireGlossary } from './glossary.js';
import { mountDetail, openDetail, closeDetail } from './detail.js';
import { reportKey, getHandled, setHandled, setPref, getOwnerName, setOwnerName } from './storage.js';

const STATUS_COPY = {
  active: { label: 'Still paying', tone: 'good', term: 'still paying' },
  lapsing: { label: 'Payment late', tone: 'warn', term: 'payment late' },
  lapsed: { label: 'Stopped', tone: 'bad', term: 'stopped' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  'no-commission': { label: 'Never earned', tone: 'muted', term: 'never earned' },
  ending: { label: 'Ending', tone: 'warn', term: 'ending' },
  'one-time': { label: 'One purchase', tone: 'muted' },
};

const SEVERITY_COPY = {
  high: { label: 'Worth asking about', tone: 'bad' },
  medium: { label: 'Worth a look', tone: 'warn' },
  info: { label: 'Just so you know', tone: 'muted' },
};

/* ------------------------------------------------------------------ shell */

export function renderDashboard(ds, caps, root, opts = {}) {
  // A table currently living in the modal is about to be destroyed with the
  // rest of root's HTML, so put it back (and shut the modal) first.
  closeDetail(root);
  ds.ownerName = getOwnerName();

  const totals = computeTotals(ds);
  const series = buildSeries(ds, opts.granularity);
  const cards = runInsights(ds, caps);
  const periods = lastFullPeriods(series);
  const wins = computeWins(ds, series, totals);
  const churn = churnRate(ds);
  const previous = opts.fullDataset && opts.resolvedRange
    ? comparePrevious(opts.fullDataset, opts.resolvedRange)
    : null;
  const report = reportKey(ds);
  const handled = getHandled(report);

  root.innerHTML = `
    ${renderHeader(ds, totals, opts)}
    ${renderKpis(ds, caps, totals, periods, previous, opts)}
    ${renderWins(wins, ds, churn)}
    ${renderTrend(series, caps, totals)}
    ${renderInsights(cards, ds, handled)}
    ${renderMix(ds, caps, totals)}
    ${caps.clients ? renderClients(ds, series) : ''}
    ${renderTransactions(ds, caps)}
    ${renderImprove(ds, caps)}
    ${glossaryPanel()}
  `;

  wireInteractions(root, ds, cards, report);
  wireGlossary();
  markScrollableTables(root);
  return { totals, series, cards, periods, wins, churn, previous };
}

/**
 * The heading never guesses whose report this is — the export has no such field.
 * The reader names it once and we remember; until then it is simply "your report".
 */
function renderHeader(ds, totals, opts) {
  const owner = ds.ownerName;
  const ranges = opts.ranges || [];
  const active = opts.range || 'all';
  const custom = opts.custom || {};
  const iso = (d) => d.toISOString().slice(0, 10);

  return `
  <header class="report-head">
    <div class="report-head-main">
      <p class="eyebrow">Commission report</p>
      <h1>
        <span class="owner-name" data-action="edit-owner" role="button" tabindex="0"
              title="Click to change">${owner ? escapeHtml(owner) : 'Your commission report'}</span>
        <button type="button" class="owner-edit" data-action="edit-owner"
                aria-label="${owner ? 'Change the name on this report' : 'Add your name to this report'}">
          ${owner ? 'edit' : '+ add your name'}
        </button>
      </h1>
      <p class="muted">
        ${escapeHtml(dateShort(ds.range.first))} to ${escapeHtml(dateShort(ds.range.asOf))}
        · ${escapeHtml(plural(totals.transactions, 'payment'))}
      </p>
    </div>

    <div class="head-actions">
      <label class="range-picker">
        <span class="range-label">Showing</span>
        <select data-action="range" aria-label="Choose a time period">
          ${ranges.map(
            (r) => `<option value="${escapeHtml(r.id)}"${r.id === active ? ' selected' : ''}>${escapeHtml(r.label)}</option>`
          ).join('')}
        </select>
      </label>
      <button type="button" class="btn btn-quiet" data-action="print">Print or save as PDF</button>
      <button type="button" class="btn btn-quiet" data-action="reset">Use a different file</button>
    </div>
  </header>

  ${active === 'custom' ? `
    <div class="custom-dates">
      <label>From <input type="date" data-action="custom-from"
        value="${escapeHtml(custom.from || iso(ds.range.first))}"
        min="${escapeHtml(iso(opts.bounds.first))}" max="${escapeHtml(iso(opts.bounds.asOf))}"></label>
      <label>To <input type="date" data-action="custom-to"
        value="${escapeHtml(custom.to || iso(ds.range.asOf))}"
        min="${escapeHtml(iso(opts.bounds.first))}" max="${escapeHtml(iso(opts.bounds.asOf))}"></label>
    </div>` : ''}`;
}

/* ------------------------------------------------------------------- KPIs */

function kpi({ label, value, sub, tone = '', spark = '' }) {
  return `
  <div class="kpi ${tone}">
    <p class="kpi-label">${escapeHtml(label)}</p>
    <p class="kpi-value">${escapeHtml(value)}</p>
    <p class="kpi-sub">${sub ?? ''}</p>
    ${spark ? `<div class="kpi-spark">${spark}</div>` : ''}
  </div>`;
}

/**
 * Tiles are chosen by what the export actually supports, and each one describes
 * a single period. The old "This month" tile paired the current part-month total
 * with a percentage comparing the two months before it — two different periods
 * in one tile, which read as a collapse that had not happened.
 */
function renderKpis(ds, caps, t, periods, previous, opts) {
  const tiles = [];
  const noun = periods.granularity || 'month';

  // Headline: what the chosen window earned, compared to the window before it.
  tiles.push(kpi({
    label: "You've earned",
    value: money(t.net),
    sub: previous
      ? comparisonCopy(t.net, previous.net, opts.rangeLabel)
      : t.clawback < 0
        ? `<span class="muted">${escapeHtml(money(t.gross))} earned, ${escapeHtml(money(Math.abs(t.clawback)))} ${term('taken back')}</span>`
        : `<span class="muted">over ${escapeHtml(plural(dayCount(ds.range.first, ds.range.asOf), 'day'))}</span>`,
  }));

  // Day-to-day swings are noise: a single quiet day reads as "-100%" and means
  // nothing. On a daily view show the average and the best day instead of
  // comparing yesterday to the day before.
  if (noun === 'day') {
    const complete = periods.complete || [];
    if (complete.length > 1) {
      const avg = complete.reduce((a, b) => a + b.net, 0) / complete.length;
      tiles.push(kpi({
        label: 'Average per day',
        value: money(avg),
        sub: `<span class="muted">over ${escapeHtml(plural(complete.length, 'day'))} of activity</span>`,
      }));
      const best = complete.reduce((a, b) => (b.net > a.net ? b : a));
      tiles.push(kpi({
        label: 'Best day',
        value: money(best.net),
        sub: `<span class="muted">${escapeHtml(formatBucket(best.date, 'day'))}</span>`,
      }));
    }
  } else {
    if (periods.recent && periods.prior) {
      const d = periods.delta;
      tiles.push(kpi({
        label: `${escapeHtml(formatBucket(periods.recent.date, noun))} — last full ${escapeHtml(noun)}`,
        value: money(periods.recent.net),
        sub: d === null
          ? '<span class="muted">nothing earlier to compare</span>'
          : `<span class="${d >= 0 ? 'good' : 'bad'}">${d >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(d) * 100)}%</span>
             <span class="muted">vs ${escapeHtml(formatBucket(periods.prior.date, noun))}</span>`,
      }));
    }
    if (periods.current) {
      tiles.push(kpi({
        label: `${escapeHtml(formatBucket(periods.current.date, noun))} so far`,
        value: money(periods.current.net),
        sub: `<span class="muted">this ${escapeHtml(noun)} is still running</span>`,
      }));
    }
  }

  if (t.hasPaid) {
    tiles.push(kpi({
      label: 'Not paid to you yet',
      value: money(t.unpaid),
      tone: t.unpaid > 0 ? 'tone-warn' : '',
      sub: `<span class="muted">${t.unpaid > 0 ? 'still on its way to you' : 'nothing outstanding'}</span>`,
    }));
  }

  if (t.clawback < 0) {
    tiles.push(kpi({
      label: 'Taken back',
      value: money(Math.abs(t.clawback)),
      tone: 'tone-bad',
      sub: '<span class="muted">refunds and corrections</span>',
    }));
  }

  if (caps.clients) {
    tiles.push(kpi({
      label: 'Clients',
      value: number(t.clients),
      sub: previous
        ? `<span class="muted">${escapeHtml(number(previous.clients))} in the period before</span>`
        : `<span class="muted">${escapeHtml(number(t.earningClients))} earned you something</span>`,
    }));
  }

  tiles.push(kpi({
    label: 'Average payment',
    value: money(t.avgPerTransaction),
    sub: `<span class="muted">across ${escapeHtml(plural(t.transactions, 'payment'))}</span>`,
  }));

  return `
    <section class="kpis">${tiles.join('')}</section>
    ${caps.clients ? `<p class="kpi-note muted">${clientSummary(ds, t)}</p>` : ''}`;
}

/**
 * Whether a client counts as "still paying" depends on seeing a couple of
 * billing cycles. Over a two-week window almost everyone looks like a one-off,
 * so that breakdown is withheld rather than reported as fact.
 */
function clientSummary(ds, t) {
  const span = dayCount(ds.range.first, ds.range.asOf);
  const earned = `<strong>${escapeHtml(number(t.earningClients))}</strong> earned you something`;

  if (span < 45) {
    return `<strong>${escapeHtml(number(t.clients))}</strong> clients in this period · ${earned} ·
      <span class="muted">choose a longer period to see who is still active</span>`;
  }
  return `<strong>${escapeHtml(number(t.clients))}</strong> clients in this period ·
    <strong>${escapeHtml(number(t.activeClients))}</strong> ${term('still paying')} you ·
    <strong>${escapeHtml(number(t.clients - t.earningClients))}</strong> earned you nothing`;
}

/** "▲ 12% vs the previous 30 days" — always naming what it compares against. */
function comparisonCopy(now, before, rangeLabel) {
  if (!before) return '<span class="muted">nothing in the period before</span>';
  const d = (now - before) / Math.abs(before);
  const dir = d >= 0 ? 'good' : 'bad';
  const arrow = d >= 0 ? '▲' : '▼';
  const what = rangeLabel ? `the previous ${rangeLabel.replace(/^(Last|This) /i, '').toLowerCase()}` : 'the period before';
  return `<span class="${dir}">${arrow} ${Math.round(Math.abs(d) * 100)}%</span>
          <span class="muted">vs ${escapeHtml(what)} (${escapeHtml(money(before))})</span>`;
}

/* ------------------------------------------------------------------ wins */

/**
 * Opening the report every month should not feel like a telling-off. These are
 * the same numbers read the encouraging way, and they come first.
 */
function renderWins(w, ds, churn) {
  if (!w.best) return '';
  const noun = w.granularity || 'month';
  const items = [];

  items.push(`<li><span class="win-value">${escapeHtml(money(w.total))}</span>
    <span class="win-label">earned in this period</span></li>`);

  items.push(`<li><span class="win-value">${escapeHtml(money(w.best.net))}</span>
    <span class="win-label">your best ${escapeHtml(noun)} — ${escapeHtml(formatBucket(w.best.date, noun))}</span></li>`);

  if (w.top) {
    items.push(`<li><span class="win-value">${escapeHtml(money(w.top.total))}</span>
      <span class="win-label">from ${escapeHtml(w.top.name)}, your top client</span></li>`);
  }

  // Only a compliment worth making on a monthly-or-longer view.
  if (w.loyal > 0) {
    items.push(`<li><span class="win-value">${escapeHtml(number(w.loyal))}</span>
      <span class="win-label">${w.loyal === 1 ? 'client has' : 'clients have'} paid every single ${escapeHtml(noun)}</span></li>`);
  } else if (w.longest) {
    items.push(`<li><span class="win-value">${escapeHtml(dateShort(w.longest.first))}</span>
      <span class="win-label">with you longest — ${escapeHtml(w.longest.name)}</span></li>`);
  }

  return `
  <section class="panel panel-wins">
    <div class="panel-head"><h2>What's going well</h2></div>
    <ul class="wins">${items.join('')}</ul>
    ${churn ? `<p class="muted churn-note">
      Of your ${escapeHtml(number(churn.regulars))} regular clients,
      <strong>${escapeHtml(number(churn.stopped))}</strong> have gone quiet in the last two months —
      about <strong>${Math.round(churn.rate * 100)}%</strong>.
    </p>` : ''}
  </section>`;
}

/* ----------------------------------------------------------------- trend */

const GRAN_TITLE = {
  day: 'Earnings by day',
  week: 'Earnings by week',
  month: 'Earnings by month',
  quarter: 'Earnings by quarter',
};

function renderTrend(series, caps, totals) {
  const gran = series.granularity || 'month';
  const legend = [
    caps.paid ? '<li><i class="swatch sw-paid"></i>Paid to you</li>'
              : '<li><i class="swatch sw-paid"></i>Earned</li>',
    caps.paid ? '<li><i class="swatch sw-unpaid"></i>Not paid to you yet</li>' : '',
    totals.clawback < 0 ? '<li><i class="swatch sw-clawback"></i>Taken back</li>' : '',
    series.length > 3 ? '<li><i class="swatch sw-trend"></i>Average trend</li>' : '',
  ].filter(Boolean).join('');

  return `
  <section class="panel">
    <div class="panel-head">
      <h2>${escapeHtml(GRAN_TITLE[gran] || 'Earnings over time')}</h2>
      <ul class="legend">${legend}</ul>
    </div>
    <div class="chart-box">${periodChart(series)}</div>
  </section>`;
}

/* --------------------------------------------------------------- insights */

/**
 * Findings, split into what still needs looking at, what has been handled, and
 * what this file cannot answer yet.
 *
 * The money figures are deliberately NOT added together: what was taken back,
 * what might be owed, and monthly income that stopped are three different kinds
 * of number, and one combined "at stake" total misrepresents all three.
 */
function renderInsights(cards, ds, handled) {
  const usable = cards.filter((c) => !c.locked && !c.needsMoreHistory);
  const open = usable.filter((c) => !handled.has(c.id));
  const done = usable.filter((c) => handled.has(c.id));
  const locked = cards.filter((c) => c.locked);
  const tooShort = cards.filter((c) => c.needsMoreHistory);

  const needsAction = open.filter((c) => c.rows.length && c.severity !== 'info');
  const headline = needsAction.length
    ? `${plural(needsAction.length, 'thing')} worth looking at`
    : 'Nothing needs your attention in this period';

  return `
  <section class="panel" id="issues">
    <div class="panel-head">
      <h2>What to look at</h2>
      <p class="muted">${escapeHtml(headline)}</p>
    </div>
    ${needsAction.length ? renderMoneyLines(needsAction) : ''}
    <div class="issue-grid">
      ${open.map((c) => renderIssueCard(c, ds, false)).join('')}
    </div>

    ${done.length ? `
      <details class="handled-group">
        <summary>${escapeHtml(plural(done.length, 'item'))} you have already handled</summary>
        <div class="issue-grid">${done.map((c) => renderIssueCard(c, ds, true)).join('')}</div>
      </details>` : ''}

    ${tooShort.length ? `
      <details class="handled-group">
        <summary>${escapeHtml(plural(tooShort.length, 'check'))} that need a longer time period</summary>
        <div class="issue-grid">${tooShort.map((c) => renderIssueCard(c, ds, false)).join('')}</div>
      </details>` : ''}

    ${locked.length ? `
      <details class="handled-group">
        <summary>${escapeHtml(plural(locked.length, 'check'))} that need an extra column</summary>
        <div class="issue-grid">${locked.map((c) => renderIssueCard(c, ds, false)).join('')}</div>
      </details>` : ''}
  </section>`;
}

/** Three separate figures, because they mean three different things. */
function renderMoneyLines(cards) {
  const sum = (ids) =>
    cards.filter((c) => ids.includes(c.id)).reduce((s, c) => s + Math.abs(c.impact), 0);

  const takenBack = sum(['clawbacks']);
  const mayBeOwed = sum(['gaps', 'duplicates']);
  const stopped = sum(['lapses', 'final-billing']);

  const lines = [
    takenBack > 0 && `<li><strong>${escapeHtml(money(takenBack))}</strong> was ${term('taken back')}</li>`,
    mayBeOwed > 0 && `<li><strong>${escapeHtml(money(mayBeOwed))}</strong> might be owed to you</li>`,
    stopped > 0 && `<li><strong>${escapeHtml(money(stopped))} a month</strong> has stopped coming in</li>`,
  ].filter(Boolean);

  return lines.length ? `<ul class="money-lines">${lines.join('')}</ul>` : '';
}

function renderIssueCard(card, ds, isHandled) {
  const sev = SEVERITY_COPY[card.severity];

  if (card.locked) {
    const cols = card.unmet.map((u) => (u === 'clients' ? 'Client Email' : labelFor(u)));
    return `
    <article class="issue issue-locked">
      <div class="issue-head"><h3>${escapeHtml(card.title)}</h3></div>
      <p class="muted">To turn this on, add the
      <strong>${escapeHtml(cols.join('</strong> and <strong>'))}</strong>
      column${cols.length > 1 ? 's' : ''} to your report before you download it.</p>
    </article>`;
  }

  // A check that cannot run yet must say so, rather than reporting "all clear"
  // and implying it looked and found nothing.
  if (card.needsMoreHistory) {
    return `
    <article class="issue issue-locked">
      <div class="issue-head">
        <h3>${escapeHtml(card.title)}</h3>
        <span class="pill pill-muted">Needs more history</span>
      </div>
      <p class="muted">${escapeHtml(card.historyMessage)}</p>
    </article>`;
  }

  const empty = card.rows.length === 0;
  const lead = card.rows.slice(0, LEAD_ROWS);
  const rest = card.rows.length - lead.length;

  return `
  <article class="issue ${empty ? 'issue-clear' : `issue-${card.severity}`}" data-card="${escapeHtml(card.id)}"
           data-detail-title="${escapeHtml(card.title)}"
           data-detail-sub="${escapeHtml(plural(card.rows.length, 'row'))} · ${escapeHtml(card.summary)}">
    <div class="issue-head">
      <h3>${escapeHtml(card.title)}</h3>
      ${empty ? '<span class="pill pill-good">All clear</span>'
              : `<span class="pill pill-${sev.tone}">${escapeHtml(sev.label)}</span>`}
    </div>
    <p class="issue-summary">${escapeHtml(card.summary)}</p>
    ${empty ? '' : `<p class="issue-detail">${escapeHtml(card.detail)}</p>`}
    ${empty ? '' : `
      ${rest > 0 ? `<p class="lead-note">Start with these ${lead.length}:</p>` : ''}
      ${renderFindingRows(card, lead)}
      <div class="issue-actions">
        <button type="button" class="btn btn-quiet btn-sm" data-action="open-detail">See all the details</button>
        ${card.mailto ? `<a class="btn btn-sm" href="${card.mailto}" data-action="ask">Ask about this</a>` : ''}
        <button type="button" class="btn btn-quiet btn-sm" data-action="copy-card" data-card="${escapeHtml(card.id)}">Copy the details</button>
        <label class="handled-toggle">
          <input type="checkbox" data-action="handled" data-card="${escapeHtml(card.id)}"${isHandled ? ' checked' : ''}>
          <span>I've handled this</span>
        </label>
      </div>`}
  </article>`;
}

/**
 * Findings render as a summary on the page — the first few columns only — and
 * as stacked label/value cards on narrow screens. The full table, every column
 * and every row, opens in the detail modal.
 *
 * SUMMARY_COLS is why the old layout broke: these tables were rendering all of
 * their 5-6 nowrap columns inside a 355px card with nothing to contain them, so
 * the text painted straight over the card next door.
 */
const SUMMARY_COLS = 3;

function renderFindingRows(card, rows) {
  const extra = card.columns.length - SUMMARY_COLS;
  const hidden = Math.max(0, card.rows.length - rows.length);

  return `
    <div class="findings" data-detail-body>
      <div class="table-scroll">
        <table class="mini findings-table">
          <thead><tr>${card.columns
            .map((c, i) => `<th${i >= SUMMARY_COLS ? ' class="col-extra"' : ''}>${escapeHtml(c)}</th>`)
            .join('')}</tr></thead>
          <tbody data-rows="${escapeHtml(card.id)}">${rows.map(issueRow).join('')}</tbody>
        </table>
      </div>
      <ul class="findings-cards" data-cards="${escapeHtml(card.id)}">
        ${rows.map((r) => findingCard(card, r)).join('')}
      </ul>
      ${extra > 0 || hidden > 0
        ? `<p class="detail-note">${escapeHtml(
            [
              hidden > 0 ? `${number(hidden)} more ${hidden === 1 ? 'row' : 'rows'}` : '',
              extra > 0 ? `${number(extra)} more ${extra === 1 ? 'column' : 'columns'}` : '',
            ].filter(Boolean).join(' and ')
          )} in the full table.</p>`
        : ''}
    </div>`;
}

const findingCard = (card, row) => `
  <li class="finding">
    <p class="finding-title">${escapeHtml(row.cells[0])}</p>
    <dl>
      ${row.cells.slice(1).map((c, i) => `
        <div${i + 1 >= SUMMARY_COLS ? ' class="col-extra"' : ''}><dt>${escapeHtml(card.columns[i + 1] ?? '')}</dt><dd>${escapeHtml(c)}</dd></div>
      `).join('')}
    </dl>
  </li>`;

// Long values are clipped on an inner <span>, not on the <td>. max-width and
// text-overflow are ignored on an auto-layout table cell, which is why the
// "Reason given" and "Note" columns used to run past the edge of the card.
const issueRow = (r) =>
  `<tr>${r.cells
    .map(
      (c, i) =>
        `<td${i >= SUMMARY_COLS ? ' class="col-extra"' : ''}><span class="cell-clip" title="${escapeHtml(c)}">${escapeHtml(c)}</span></td>`
    )
    .join('')}</tr>`;

const labelFor = (key) => FIELDS.find((f) => f.key === key)?.label ?? key;

/* -------------------------------------------------------------------- mix */

function renderMix(ds, caps, totals) {
  const panels = [];

  if (caps.campaign) {
    panels.push(donutPanel('Where it comes from', breakdown(ds, 'campaign', 7), totals.net));
  }
  if (caps.product) {
    panels.push(donutPanel('What sells', breakdown(ds, 'product', 7, 'productKey'), totals.net));
  }
  if (caps.referral) {
    const people = referrers(ds);
    panels.push(`
      <section class="panel">
        <div class="panel-head"><h2>Who referred these clients</h2></div>
        ${people.length > 1
          ? `<p class="muted">${escapeHtml(plural(people.length, 'person', 'people'))} referred the clients in this report.</p>${barList(people)}`
          : people.length === 1
            ? `<p class="muted">Every client here was referred by ${escapeHtml(people[0].label)}.</p>`
            : '<p class="muted">No referral information in this file.</p>'}
      </section>`);
  }

  return panels.length ? `<div class="grid-2">${panels.join('')}</div>` : '';
}

function donutPanel(title, items, total) {
  return `
  <section class="panel">
    <div class="panel-head"><h2>${escapeHtml(title)}</h2></div>
    <div class="donut-row">
      <div class="donut-wrap">${donutChart(items, { total })}</div>
      <ul class="legend legend-stack">
        ${items.map((it, i) => `<li><i class="swatch sw-${i % 8}"></i>
          <span class="legend-label" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</span>
          <span class="legend-value">${escapeHtml(money(it.value))}</span></li>`).join('')}
      </ul>
    </div>
  </section>`;
}

/* ---------------------------------------------------------------- clients */

function renderClients(ds, series) {
  // Same reasoning as the transaction table: show the biggest earners first and
  // defer the long tail, so a 941-client export stays responsive.
  const INITIAL_CLIENTS = 100;
  const capped = ds.clients.length > INITIAL_CLIENTS;
  const shown = capped ? ds.clients.slice(0, INITIAL_CLIENTS) : ds.clients;
  const rest = capped ? ds.clients.slice(INITIAL_CLIENTS) : [];

  return `
  <section class="panel" id="clients"
           data-detail-title="Your clients"
           data-detail-sub="${escapeHtml(plural(ds.clients.length, 'client'))} · every column">
    <div class="panel-head">
      <h2>Your clients</h2>
      <div class="panel-tools">
        <input type="search" class="search" data-search="clients" placeholder="Search by name or email…" aria-label="Search clients">
        <button type="button" class="btn btn-quiet btn-sm" data-action="open-detail">See the full table</button>
      </div>
    </div>
    <p class="muted legend-note">Tap a name to see everything they have paid you.
      ${term('still paying')} · ${term('payment late')} · ${term('stopped')} · ${term('ending')} · ${term('never earned')}</p>
    ${capped ? `<p class="muted count-note">Showing your top ${escapeHtml(number(INITIAL_CLIENTS))} of ${escapeHtml(number(ds.clients.length))} clients, biggest earners first.</p>` : ''}
    <div data-detail-body>
      <div class="table-scroll">
        <table class="data" id="clients-table">
          <thead>
            <tr>
              ${th('Client', 'name', 'text')}
              ${th('How they are doing', 'status', 'text')}
              ${th('First paid', 'first', 'num', false, true)}
              ${th('Last paid', 'last', 'num')}
              ${th('Payments', 'charges', 'num')}
              ${th('Per month', 'rate', 'num', false, true)}
              ${th('Total earned', 'total', 'num', true)}
              <th class="col-spark col-extra">Over time</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map((c) => clientRow(c, series)).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${capped ? `
      <button type="button" class="btn btn-quiet btn-sm" data-action="show-all-clients">
        Show all ${escapeHtml(number(ds.clients.length))} clients
      </button>
      <template data-clients-rest>${rest.map((c) => clientRow(c, series)).join('')}</template>` : ''}
  </section>`;
}

// `extra` columns are part of the full table only. Sorting still works on them
// from inside the modal, because it reads the row's data-* attributes, not the
// cells, so hiding a column never hides the data behind it.
const th = (label, key, type, active = false, extra = false) =>
  `<th class="sortable ${type === 'num' ? 'num' : ''} ${active ? 'sorted-desc' : ''} ${extra ? 'col-extra' : ''}" data-sort="${key}" data-type="${type}" tabindex="0" role="button">${escapeHtml(label)}</th>`;

/**
 * Detail tables are built on first expand, not up front. A 941-client export
 * would otherwise put every client's full history into the DOM immediately —
 * ~14,000 rows and 4MB of HTML before the affiliate has clicked anything.
 */
function clientDetailHtml(c) {
  return `
    <div class="detail-box">
      <h4>${escapeHtml(c.name)} — ${escapeHtml(plural(c.records.length, 'record'))}</h4>
      <table class="mini">
        <thead><tr><th>Date</th><th>Type</th><th>What they bought</th><th class="num">You earned</th><th>Paid to you</th><th>Note</th></tr></thead>
        <tbody>
          ${c.records
            .slice()
            .reverse()
            .map(
              (r) => `<tr class="${r.amount < 0 ? 'row-neg' : ''}">
                <td>${escapeHtml(dateShort(r.created))}</td>
                <td>${escapeHtml(r.campaign || '—')}</td>
                <td><span class="cell-clip" title="${escapeHtml(r.product || '')}">${escapeHtml(r.product || '—')}</span></td>
                <td class="num">${escapeHtml(r.isLifecycle ? '—' : money(r.amount))}</td>
                <td>${escapeHtml(r.paidLabel)}</td>
                <td class="note"><span class="cell-clip" title="${escapeHtml(r.note || '')}">${escapeHtml(r.note || '')}</span></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function clientRow(c, series) {
  const s = STATUS_COPY[c.status] ?? STATUS_COPY['one-time'];
  return `
  <tr class="client-row" data-client="${escapeHtml(c.key)}"
      data-name="${escapeHtml(c.name.toLowerCase())} ${escapeHtml(c.email)}"
      data-status="${escapeHtml(s.label)}" data-first="${c.first.getTime()}" data-last="${c.last.getTime()}"
      data-charges="${c.charges}" data-rate="${c.rate}" data-total="${c.total}" tabindex="0">
    <td class="col-client">
      <button type="button" class="linkish" data-action="toggle-client" aria-expanded="false">
        <span class="cell-clip">${escapeHtml(c.name)}</span><span class="chev" aria-hidden="true">›</span>
      </button>
      ${c.email ? `<span class="sub cell-clip" title="${escapeHtml(c.email)}">${escapeHtml(c.email)}</span>` : ''}
    </td>
    <td><span class="pill pill-${s.tone}">${escapeHtml(s.label)}</span></td>
    <td class="num col-extra">${escapeHtml(dateShort(c.first))}</td>
    <td class="num">${escapeHtml(dateShort(c.last))}<span class="sub">${escapeHtml(agoLabel(daysBetween(c.last, new Date())))}</span></td>
    <td class="num">${escapeHtml(number(c.charges))}</td>
    <td class="num col-extra">${escapeHtml(money(c.rate))}</td>
    <td class="num strong">${escapeHtml(money(c.total))}</td>
    <td class="col-spark col-extra">${sparkline(clientSpark(c, series), { width: 100, height: 24 })}</td>
  </tr>
  <tr class="client-detail" data-detail="${escapeHtml(c.key)}" hidden><td colspan="8"></td></tr>`;
}

/* ----------------------------------------------------------- transactions */

function renderTransactions(ds, caps) {
  // [label, key, extra] — `extra` columns appear only in the full table. The
  // summary keeps the three a coach actually scans: when, who, how much.
  const cols = [
    ['Date', 'created'],
    caps.campaign && ['Type', 'campaign', true],
    caps.clientLabel && ['Client', 'clientLabel'],
    caps.product && ['Product', 'product', true],
    caps.referral && ['Referred by', 'referral', true],
    ['You earned', 'amount'],
    caps.paid && ['Paid to you', 'paidLabel', true],
    caps.note && ['Note', 'note', true],
  ].filter(Boolean);

  // Large exports run to thousands of rows. Render a window by default and let
  // the affiliate ask for the rest; search always runs over the full set.
  const INITIAL_ROWS = 250;
  const ordered = ds.records.slice().reverse();
  const capped = ordered.length > INITIAL_ROWS;

  const rowHtml = (r) => {
    const haystack = [r.clientLabel, r.campaign, r.product, r.referral, r.note, r.orderId]
      .join(' ')
      .toLowerCase();
    return `<tr data-hay="${escapeHtml(haystack)}" class="${r.amount < 0 ? 'row-neg' : ''} ${r.isZero ? 'row-zero' : ''}">
        ${cols
          .map(([label, key, extra]) => {
            const cls = extra ? ' col-extra' : '';
            if (key === 'created') return `<td class="nowrap${cls}">${escapeHtml(dateShort(r.created))}</td>`;
            if (key === 'amount')
              return `<td class="num${cls}">${escapeHtml(r.isLifecycle ? '—' : money(r.amount))}</td>`;
            // Free text (product names, notes) is clipped on an inner span so a
            // long value can never stretch the column past its container.
            return `<td class="${cls.trim()}"><span class="cell-clip" title="${escapeHtml(r[key] || '')}">${escapeHtml(r[key] || '—')}</span></td>`;
          })
          .join('')}
      </tr>`;
  };

  const rows = (capped ? ordered.slice(0, INITIAL_ROWS) : ordered).map(rowHtml).join('');
  const restHtml = capped ? ordered.slice(INITIAL_ROWS).map(rowHtml).join('') : '';

  return `
  <section class="panel" id="transactions"
           data-detail-title="Every payment"
           data-detail-sub="${escapeHtml(plural(ordered.length, 'payment'))} · every column">
    <div class="panel-head">
      <h2>Every payment</h2>
      <div class="panel-tools">
        <input type="search" class="search" data-search="transactions" placeholder="Search by client, product or note…" aria-label="Search payments">
        <button type="button" class="btn btn-quiet btn-sm" data-action="open-detail">See the full table</button>
        <button type="button" class="btn btn-quiet btn-sm" data-action="export-csv">Download what I'm seeing</button>
      </div>
    </div>
    <p class="muted count-note" data-count-note></p>
    <div data-detail-body>
      <div class="table-scroll table-tall">
        <table class="data" id="tx-table">
          <thead><tr>${cols
            .map(([l, k, extra]) => `<th class="${k === 'amount' ? 'num' : ''} ${extra ? 'col-extra' : ''}">${escapeHtml(l)}</th>`)
            .join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    ${capped ? `
      <button type="button" class="btn btn-quiet btn-sm" data-action="show-all-tx">
        Show all ${escapeHtml(number(ordered.length))} payments
      </button>
      <template data-tx-rest>${restHtml}</template>` : ''}
  </section>`;
}

/* --------------------------------------------------------- improve panel */

function renderImprove(ds, caps) {
  const missing = ds.schema.missing.filter((f) => UNLOCKS[f.key]);
  if (!missing.length) {
    return `
    <section class="panel panel-soft">
      <h2>Your report has everything</h2>
      <p class="muted">Every column this dashboard can use is in your file, so every check is running.</p>
    </section>`;
  }

  return `
  <section class="panel panel-soft" id="improve">
    <h2>See more next time</h2>
    <p class="muted">Your file is missing ${escapeHtml(plural(missing.length, 'column'))}. Switch ${missing.length > 1 ? 'them' : 'it'} on before you download your report next time, and you will also get:</p>
    <ul class="unlock-list">
      ${missing
        .map(
          (f) => `<li>
            <strong>${escapeHtml(f.label)}</strong>
            <ul>${UNLOCKS[f.key].map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
          </li>`
        )
        .join('')}
    </ul>
    <p class="muted fine">Not sure where to find these? They are usually a "columns" or "customise"
      option on the report screen before you download.</p>
  </section>`;
}

/* ------------------------------------------------------------ interaction */

/**
 * The dashboard's current data, read by the delegated handlers below.
 *
 * The handlers are bound to #dashboard, which survives every re-render —
 * replacing its innerHTML does not remove listeners attached to the element
 * itself. Binding per render therefore stacked a duplicate handler each time,
 * so after loading a second file one click ran two toggles (netting out to
 * nothing) and "Copy the details" copied twice. Bind once; keep the data here.
 */
let ctx = null;

function wireInteractions(root, ds, cards, report) {
  ctx = { ds, cards, report };
  mountDetail(root);
  wireSorting(root);
  if (root.dataset.wired === '1') {
    updateCount(root);
    return;
  }
  root.dataset.wired = '1';

  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'print') window.print();
    if (action === 'reset') root.dispatchEvent(new CustomEvent('dashboard:reset', { bubbles: true }));

    if (action === 'copy-card') copyCard(btn, ctx.ds, ctx.cards);
    if (action === 'open-detail') {
      // The summary views are all windowed. Fill in the rows they left out
      // before showing the full table — lazily, so the cost is only paid by
      // someone who actually asks to see everything.
      const article = btn.closest('.issue');
      if (article) expandCard(article, ctx.cards);
      if (btn.closest('#clients')) showAllClients(root, root.querySelector('[data-action="show-all-clients"]'));
      if (btn.closest('#transactions')) showAllTransactions(root, root.querySelector('[data-action="show-all-tx"]'));
      openDetail(root, btn.closest('[data-detail-title]'));
    }
    if (action === 'close-detail') closeDetail(root);
    if (action === 'toggle-client') toggleClient(btn, ctx.ds);
    if (action === 'export-csv') exportVisible(ctx.ds);
    if (action === 'show-all-tx') showAllTransactions(root, btn);
    if (action === 'show-all-clients') showAllClients(root, btn);
    if (action === 'edit-owner') editOwner(root);
  });

  root.addEventListener('keydown', (ev) => {
    const el = ev.target.closest('[data-action="edit-owner"]');
    if (el && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      editOwner(root);
    }
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'handled') {
      setHandled(ctx.report, el.dataset.card, el.checked);
      setPref('lastReport', ctx.report);
      // Re-render so the card moves into (or out of) the handled group.
      root.dispatchEvent(new CustomEvent('dashboard:rerender', { bubbles: true }));
    }
    if (el.dataset.action === 'range') {
      setPref('range', el.value);
      root.dispatchEvent(new CustomEvent('dashboard:range', { bubbles: true, detail: { range: el.value } }));
    }
    if (el.dataset.action === 'custom-from' || el.dataset.action === 'custom-to') {
      const which = el.dataset.action === 'custom-from' ? 'from' : 'to';
      root.dispatchEvent(new CustomEvent('dashboard:custom', { bubbles: true, detail: { [which]: el.value } }));
    }
  });

  root.addEventListener('input', (ev) => {
    const field = ev.target.closest('[data-search]');
    if (!field) return;
    if (field.dataset.search === 'clients') filterClients(root, field.value);
    else filterTransactions(root, field.value);
  });

  updateCount(root);
}

/**
 * Sorting binds directly to the <th>s, which are rebuilt on every render, so
 * unlike the delegated handlers this does need re-running each time.
 */
function wireSorting(root) {
  const clientTable = root.querySelector('#clients-table');
  if (!clientTable) return;
  const onSort = (thEl) => {
    showAllClients(root, root.querySelector('[data-action="show-all-clients"]'));
    sortClients(clientTable, thEl);
  };
  clientTable.querySelectorAll('th.sortable').forEach((thEl) => {
    thEl.addEventListener('click', () => onSort(thEl));
    thEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSort(thEl);
      }
    });
  });
}

/**
 * Tables that genuinely overflow get a fade edge and a hint. Without this a
 * table looks complete while its rightmost column sits off-screen unread.
 */
let scrollWatchBound = false;
function markScrollableTables(root) {
  const check = () => {
    for (const box of root.querySelectorAll('.table-scroll')) {
      const scrolls = box.scrollWidth > box.clientWidth + 2;
      box.classList.toggle('can-scroll', scrolls);
      let hint = box.nextElementSibling;
      const isHint = hint && hint.classList.contains('scroll-hint');
      if (scrolls && !isHint) {
        hint = document.createElement('p');
        hint.className = 'scroll-hint';
        hint.textContent = 'Scroll sideways to see more →';
        box.after(hint);
      } else if (!scrolls && isHint) {
        hint.remove();
      }
    }
  };
  check();
  // Bind the resize listener once; the report re-renders on filter changes and
  // would otherwise accumulate a handler per render.
  if (!scrollWatchBound) {
    scrollWatchBound = true;
    window.addEventListener('resize', () => markScrollableTables(document), { passive: true });
  }
}

/**
 * Whose report this is. Asked for, never inferred — the export contains no such
 * field, and guessing it from the most frequent referrer produced names that
 * belonged to other people entirely.
 */
function editOwner(root) {
  const current = getOwnerName();
  const next = window.prompt(
    'Whose report is this? Your name appears at the top and on anything you print.',
    current
  );
  if (next === null) return; // cancelled
  setOwnerName(next);
  root.dispatchEvent(new CustomEvent('dashboard:owner', { bubbles: true }));
}

function toggleClient(btn, ds) {
  const row = btn.closest('tr');
  const detail = row.nextElementSibling;
  if (!detail || !detail.classList.contains('client-detail')) return;

  const cell = detail.firstElementChild;
  if (!cell.hasChildNodes()) {
    const client = ds.clients.find((c) => c.key === row.dataset.client);
    if (client) cell.innerHTML = clientDetailHtml(client);
  }
  detail.hidden = !detail.hidden;
  row.classList.toggle('is-open', !detail.hidden);
  btn.setAttribute('aria-expanded', String(!detail.hidden));
}

/**
 * Fill in the rows the summary left out, just before the modal opens. Doing it
 * lazily keeps the page light: a card with 300 findings puts 5 rows in the DOM
 * until someone actually asks to see the rest.
 */
function expandCard(article, cards) {
  const card = cards.find((c) => c.id === article.dataset.card);
  if (!card || article.dataset.expanded === '1') return;
  article.dataset.expanded = '1';

  const tbody = article.querySelector(`tbody[data-rows="${CSS.escape(card.id)}"]`);
  if (tbody) tbody.innerHTML = card.rows.map(issueRow).join('');
  // The narrow-screen view is a separate list, so it needs filling too.
  const list = article.querySelector(`ul[data-cards="${CSS.escape(card.id)}"]`);
  if (list) list.innerHTML = card.rows.map((r) => findingCard(card, r)).join('');
}

async function copyCard(btn, ds, cards) {
  const card = cards.find((c) => c.id === btn.dataset.card);
  const text = card ? buildEscalationText(ds, [card]) : buildEscalationText(ds, cards);
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    // Clipboard API needs a secure context; fall back to a selectable prompt.
    window.prompt('Copy the text below:', text);
    btn.textContent = original;
    return;
  }
  setTimeout(() => {
    btn.textContent = original;
  }, 1800);
}

function sortClients(table, thEl) {
  const key = thEl.dataset.sort;
  const type = thEl.dataset.type;
  const desc = !thEl.classList.contains('sorted-desc');

  table.querySelectorAll('th.sortable').forEach((h) => h.classList.remove('sorted-desc', 'sorted-asc'));
  thEl.classList.add(desc ? 'sorted-desc' : 'sorted-asc');

  const tbody = table.tBodies[0];
  // Keep each client row glued to its own detail row while reordering.
  const pairs = [...tbody.querySelectorAll('tr.client-row')].map((row) => [row, row.nextElementSibling]);

  pairs.sort(([a], [b]) => {
    const av = a.dataset[key] ?? '';
    const bv = b.dataset[key] ?? '';
    const cmp = type === 'num' ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
    return desc ? -cmp : cmp;
  });

  const frag = document.createDocumentFragment();
  for (const [row, detail] of pairs) {
    frag.append(row);
    if (detail) frag.append(detail);
  }
  tbody.append(frag);
}

function showAllClients(root, btn) {
  const tpl = root.querySelector('template[data-clients-rest]');
  const tbody = root.querySelector('#clients-table tbody');
  if (tpl && tbody) {
    tbody.append(tpl.content.cloneNode(true));
    tpl.remove();
    root.querySelector('#clients .count-note')?.remove();
  }
  if (btn) btn.remove();
}

function filterClients(root, term) {
  const q = term.trim().toLowerCase();
  // Searching should look across every client, not just the rendered window.
  if (q) showAllClients(root, root.querySelector('[data-action="show-all-clients"]'));
  root.querySelectorAll('tr.client-row').forEach((row) => {
    const hit = !q || row.dataset.name.includes(q);
    row.hidden = !hit;
    const detail = row.nextElementSibling;
    if (detail && detail.classList.contains('client-detail') && !hit) {
      detail.hidden = true;
      row.classList.remove('is-open');
    }
  });
}

/** Move the deferred rows out of their <template> and into the table. */
function showAllTransactions(root, btn) {
  const tpl = root.querySelector('template[data-tx-rest]');
  const tbody = root.querySelector('#tx-table tbody');
  if (tpl && tbody) {
    tbody.append(tpl.content.cloneNode(true));
    tpl.remove();
  }
  if (btn) btn.remove();
  updateCount(root);
}

function filterTransactions(root, term) {
  const q = term.trim().toLowerCase();
  // Searching implies wanting the whole set, not just the rendered window.
  if (q) showAllTransactions(root, root.querySelector('[data-action="show-all-tx"]'));
  root.querySelectorAll('#tx-table tbody tr').forEach((row) => {
    row.hidden = Boolean(q) && !row.dataset.hay.includes(q);
  });
  updateCount(root);
}

function updateCount(root) {
  const note = root.querySelector('[data-count-note]');
  if (!note) return;
  const rows = [...root.querySelectorAll('#tx-table tbody tr')];
  const shown = rows.filter((r) => !r.hidden).length;
  const deferred = root.querySelector('template[data-tx-rest]');
  const total = rows.length + (deferred ? deferred.content.childElementCount : 0);
  note.textContent =
    shown === total
      ? `${number(total)} rows`
      : `Showing ${number(shown)} of ${number(total)} rows`;
}

/** Re-export exactly what the user is looking at, as a clean comma CSV. */
function exportVisible(ds) {
  const table = document.querySelector('#tx-table');
  if (!table) return;
  const headers = [...table.tHead.rows[0].cells].map((c) => c.textContent.trim());
  const body = [...table.tBodies[0].rows]
    .filter((r) => !r.hidden)
    .map((r) => [...r.cells].map((c) => c.textContent.trim()));

  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...body].map((row) => row.map(esc).join(',')).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `commissions-${slug(ds.ownerName || 'report')}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
