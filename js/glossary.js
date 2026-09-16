/**
 * Plain-English definitions for the handful of terms this report cannot avoid.
 *
 * Anything a coach might not recognise is wrapped with `term()` and explained on
 * tap. The same definitions render as a full list at the bottom of the report,
 * so the popovers are a convenience rather than the only way to find them.
 */

export const TERMS = {
  commission: {
    label: 'commission',
    def: 'The money you earn when someone you referred buys or renews something.',
  },
  'taken back': {
    label: 'taken back',
    def: 'A commission you were paid that was later removed — usually a refund, or a client moving to a different coach.',
  },
  refund: {
    label: 'refund',
    def: 'The client got their money back, so the commission you earned on it is removed too.',
  },
  subscription: {
    label: 'subscription',
    def: 'A membership that bills automatically every month.',
  },
  'billing cycle': {
    label: 'billing cycle',
    def: 'One month of a subscription. A cycle that never charged means no commission for that month.',
  },
  'still paying': {
    label: 'still paying',
    def: 'This client has been charged within the last month or so, so their subscription looks live.',
  },
  stopped: {
    label: 'stopped',
    def: 'No charge from this client for two months or more. They may have cancelled, or a commission may be missing.',
  },
  'payment late': {
    label: 'payment late',
    def: 'This client normally pays by now and has not. It may just be timing, or their payment may have failed.',
  },
  ending: {
    label: 'ending',
    def: 'The most recent charge was marked as this subscription’s final one, so it will not bill again.',
  },
  'never earned': {
    label: 'never earned',
    def: 'This client has activity on your account but has never produced any commission — often a comped or staff account.',
  },
  'not paid yet': {
    label: 'not paid yet',
    def: 'You have earned this money but it has not reached you yet. Commissions normally wait for the next payout run.',
  },
  'final billing': {
    label: 'final billing',
    def: 'The last charge of a subscription. Expect this monthly income to stop.',
  },
  'order id': {
    label: 'Order ID',
    def: 'A reference number for each purchase. Adding this column to your export lets the report match refunds to the original charge and spot true duplicates.',
  },
  'referred by': {
    label: 'referred by',
    def: 'Who brought this client in. Usually you, but it can be a coach on your team.',
  },
  export: {
    label: 'export',
    def: 'Downloading your report from the portal as a spreadsheet file so you can open it here.',
  },
  csv: {
    label: 'CSV',
    def: 'A plain spreadsheet file. It is what the portal gives you when you download your report.',
  },
};

/** Wrap a word so it shows its definition on tap. */
export function term(key, text) {
  const entry = TERMS[String(key).toLowerCase()];
  if (!entry) return text ?? key;
  const shown = text ?? entry.label;
  return `<button type="button" class="term" data-term="${escapeAttr(key)}" aria-label="What does ${escapeAttr(shown)} mean?">${escapeAttr(shown)}</button>`;
}

function escapeAttr(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Full definition list, rendered at the bottom of the report. */
export function glossaryPanel() {
  const items = Object.values(TERMS)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (t) => `<div class="gloss-item">
        <dt>${escapeAttr(t.label)}</dt>
        <dd>${escapeAttr(t.def)}</dd>
      </div>`
    )
    .join('');

  return `
  <section class="panel panel-soft" id="glossary">
    <h2>What do these words mean?</h2>
    <p class="muted">Plain-English definitions for anything in this report that is not obvious.</p>
    <dl class="gloss">${items}</dl>
  </section>`;
}

/**
 * One popover, reused across the whole page.
 *
 * The document-level listeners are attached once, not per render — the report
 * re-renders whenever a finding is marked handled or the date range changes, and
 * re-binding each time would stack duplicate handlers for the life of the session.
 */
let pop = null;
let bound = false;

function closePop() {
  if (pop) {
    pop.remove();
    pop = null;
  }
}

function openPop(btn) {
  const entry = TERMS[String(btn.dataset.term).toLowerCase()];
  if (!entry) return;

  const sameTerm = pop && pop.dataset.for === btn.dataset.term;
  closePop();
  if (sameTerm) return; // tapping the same word twice closes it

  pop = document.createElement('div');
  pop.className = 'term-pop';
  pop.dataset.for = btn.dataset.term;
  pop.setAttribute('role', 'tooltip');
  pop.innerHTML = `<strong>${escapeAttr(entry.label)}</strong><span>${escapeAttr(entry.def)}</span>`;
  document.body.append(pop);

  const r = btn.getBoundingClientRect();
  const width = Math.min(280, window.innerWidth - 24);
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.min(Math.max(12, r.left), window.innerWidth - width - 12)}px`;
  pop.style.top = `${window.scrollY + r.bottom + 8}px`;
}

export function wireGlossary() {
  if (bound) return;
  bound = true;

  // Any click anywhere either opens a definition or dismisses the open one.
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.term');
    if (btn) {
      ev.preventDefault();
      openPop(btn);
    } else if (!ev.target.closest('.term-pop')) {
      closePop();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePop();
  });
  window.addEventListener('scroll', closePop, { passive: true });
  window.addEventListener('resize', closePop, { passive: true });
}
