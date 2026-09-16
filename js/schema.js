/**
 * Column detection and the capability map that drives graceful degradation.
 *
 * Affiliate exports differ in which "view" columns the user has enabled, so we
 * detect what is present and let the UI lock the features that need what is missing.
 */

/**
 * Canonical fields. `aliases` are matched case-insensitively after collapsing
 * whitespace and punctuation, so "Client E-mail" and "client email" both land.
 */
/**
 * Canonical fields and the header spellings that map to them.
 *
 * Aliases are matched case-insensitively after stripping punctuation, and cover
 * the wording used by several affiliate platforms — not just one — so any
 * commission export with a date and an amount can be read.
 */
export const FIELDS = [
  {
    key: 'created', label: 'Date', required: true,
    aliases: ['created', 'createdat', 'createddate', 'date', 'saledate', 'orderdate',
      'transactiondate', 'datetime', 'timestamp', 'when', 'purchasedate'],
  },
  {
    key: 'amount', label: 'Commission', required: true,
    aliases: ['commission', 'commissionamount', 'amount', 'earnings', 'earned', 'payout',
      'payoutamount', 'revenue', 'total', 'value'],
  },
  {
    key: 'orderId', label: 'Order ID',
    aliases: ['orderid', 'order', 'ordernumber', 'orderno', 'transactionid', 'reference',
      'referenceid', 'invoice', 'invoiceid'],
  },
  {
    key: 'campaign', label: 'Campaign Name',
    aliases: ['campaignname', 'campaign', 'program', 'offer', 'type', 'category'],
  },
  { key: 'status', label: 'Status', aliases: ['status', 'state', 'approvalstatus'] },
  {
    key: 'paid', label: 'Paid',
    aliases: ['paid', 'paidstatus', 'payoutstatus', 'ispaid', 'settled', 'paymentstatus'],
  },
  {
    key: 'clientName', label: 'Client Name',
    aliases: ['clientname', 'customername', 'customer', 'client', 'name', 'buyer', 'membername'],
  },
  {
    key: 'clientEmail', label: 'Client Email',
    aliases: ['clientemail', 'customeremail', 'email', 'emailaddress', 'buyeremail'],
  },
  {
    key: 'product', label: 'Product',
    aliases: ['product', 'productname', 'item', 'itemname', 'plan', 'subscription', 'sku'],
  },
  {
    key: 'referral', label: 'Referral Source',
    aliases: ['referralsource', 'referrer', 'referredby', 'source', 'affiliate',
      'affiliatename', 'coach', 'salesrep', 'rep'],
  },
  {
    key: 'note', label: 'Note',
    aliases: ['noteforthefasterwayteam', 'note', 'notes', 'comment', 'comments',
      'reason', 'memo', 'description'],
  },
];

/**
 * What each optional column unlocks. Surfaced verbatim in the
 * "Improve this report" panel and on locked cards, so the affiliate knows
 * exactly which view column to switch on before re-exporting.
 */
export const UNLOCKS = {
  orderId: [
    'Spotting when you were paid twice for the same thing',
    'Matching money taken back to the original payment',
    'Seeing who cancelled, and whose payment failed',
  ],
  clientEmail: [
    'A full history for each client',
    'Knowing when a regular client stops paying',
    'Spotting months that never paid you',
  ],
  paid: ['What you are still owed, and how long you have waited'],
  campaign: ['Seeing which kinds of membership earn you most'],
  product: ['Seeing which products earn you most', 'A warning when a membership is ending'],
  referral: ['Seeing what your team brings in'],
  note: ['The reason behind any change to your commission'],
  status: ['Whether each payment has been approved'],
  clientName: ['Client names instead of email addresses'],
};

const normalize = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Map detected headers onto canonical fields.
 * @returns {{index: Object, present: Set<string>, missing: Array, unknown: Array, headers: string[]}}
 */
export function detectSchema(headers) {
  const normalized = headers.map(normalize);
  const index = {};
  const claimed = new Set();

  for (const field of FIELDS) {
    // Exact alias match first, then a prefix/contains fallback for lightly renamed columns.
    let at = normalized.findIndex((h, i) => !claimed.has(i) && field.aliases.includes(h));
    if (at === -1) {
      at = normalized.findIndex(
        (h, i) => !claimed.has(i) && field.aliases.some((a) => h === a || h.startsWith(a) || a.startsWith(h))
      );
    }
    if (at !== -1) {
      index[field.key] = at;
      claimed.add(at);
    }
  }

  const present = new Set(Object.keys(index));
  const missing = FIELDS.filter((f) => !present.has(f.key));
  const unknown = headers.filter((_, i) => !claimed.has(i));

  return { index, present, missing, unknown, headers };
}

/** Fields without which we cannot render anything at all. */
export function missingRequired(schema) {
  return FIELDS.filter((f) => f.required && !schema.present.has(f.key));
}

/** Capability flags consumed by metrics, insights, and the UI. */
export function capabilities(schema) {
  const has = (k) => schema.present.has(k);
  return {
    orderId: has('orderId'),
    // Client-level analysis is gated on the EMAIL, which is the only reliable
    // identity in these exports. Simply *naming* the client in a table needs
    // far less, so it gets its own flag.
    clients: has('clientEmail'),
    clientLabel: has('clientEmail') || has('clientName'),
    paid: has('paid'),
    campaign: has('campaign'),
    product: has('product'),
    referral: has('referral'),
    note: has('note'),
    status: has('status'),
  };
}
