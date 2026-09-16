# Commission Dashboard

A static dashboard that turns any affiliate or partner commission export (CSV) into a readable
report — earnings at a glance, a trend chart at whatever time scale suits the data, and
automated checks for the problems that are easy to miss in a flat transaction log.

**Everything runs in the browser.** The CSV is read with the File API and analysed on the
user's own device. There is no backend, no upload, and no network request carrying their
data — which matters, because these exports contain client names and email addresses.

Column names are detected, not assumed: `Date`/`Created`/`Sale Date`, `Commission`/`Earnings`/
`Payout` and so on all map to the same canonical fields, so exports from different platforms
work without configuration. Only a date and an amount are strictly required.

---

### Running it locally

```bash
python3 -m http.server 8777
```

Then open <http://localhost:8777>. A server is needed only so ES modules and the bundled
sample files can load; opening `index.html` straight off the filesystem will not work.

---

## What it checks

Everything in this first group works with the **standard affiliate export** — no extra
view columns needed:

| Check | What it looks for |
|---|---|
| **Clients who stopped paying** | Clients who billed 3+ cycles then went quiet |
| **Skipped billing cycles** | A subscription that kept running but missed a cycle in the middle |
| **Reversals** | Negative rows, and what they cost you |
| **Clients earning you nothing** | Activity on your account that carries $0 commission |
| **Possible duplicates** | The same charge credited twice |
| **Rate changes** | A subscription's commission amount moving between cycles |
| **Final billing** | Charges flagged as a subscription's last |

Switching on extra view columns adds these, and sharpens several of the above:

| Extra column | Adds |
|---|---|
| `Order ID` | Cancellation and failed-payment analysis; refund matching; confirms duplicates |
| `Paid` | Paid/awaiting-payout tiles and payout aging |
| `Campaign Name` | Earnings by campaign; lets cancellations be recognised |
| `Note for the FASTer Way Team` | Reasons behind adjustments; makeup payments already applied |

Each finding comes with a **Copy issue summary** button that produces plain text an affiliate
can paste straight into a support request.

---

## Export columns

Affiliate exports differ depending on which columns the user has switched on in their report
view. The dashboard detects what is present, adapts, and tells the affiliate what they are
missing rather than failing.

**The standard view** ships these seven, and is the baseline the dashboard is built around:

`Created` · `Commission` · `Status` · `Client Name` · `Client Email` · `Product` · `Referral Source`

Of those, only `Created` and `Commission` are strictly required to render anything at all.

**Optional columns**, each of which unlocks more:

| Column | Unlocks |
|---|---|
| `Order ID` | Duplicate confirmation, reversal matching, cancellation and failed-payment analysis |
| `Client Email` | Per-client history, retention, lapse alerts, skipped-cycle detection |
| `Paid` | Unpaid balance and payout aging |
| `Product` | Product mix, final-billing warnings |
| `Campaign Name` | Earnings by campaign |
| `Note for the FASTer Way Team` | Reasons behind adjustments and makeup payments |
| `Status` | Approval status breakdown |
| `Client Name` | Readable names (falls back to the email address) |

Anything missing appears as a locked card naming the exact column to enable, plus a
"Get more from this report" panel at the bottom.

Both comma- and semicolon-delimited exports are handled; the delimiter is detected, not assumed.

---

## How it works

```
index.html      landing page, file picker, dashboard shell
styles.css      design tokens, light/dark, print stylesheet
js/
  app.js        entry point: file → parse → analyse → render
  csv.js        RFC 4180 parser, delimiter sniffing, BOM handling
  schema.js     column detection and the capability map
  model.js      typed records, client grouping, recurring streams
  metrics.js    totals and chart series
  insights.js   the detectors
  charts.js     SVG bar / line / donut / sparkline
  ui.js         rendering and interaction
  detail.js     the summary → full-table modal
  format.js     currency, dates, escaping
  period.js     ranges, adaptive bucketing, period comparison
sample/         synthetic demo data + the generator that makes it
```

### About the sample files

The three files in `sample/` are **entirely synthetic**. Nothing in them derives from a real
export: names, email addresses, product names, commission amounts, order IDs, coach names and
dates are all generated. Emails use the reserved `example.com` / `.net` / `.org` domains and
every product is prefixed `Pseudo`, so nothing can be mistaken for or traced to a real
affiliate, client or catalogue item. All dates fall within the last year.

They are produced by `sample/generate-samples.py`, which deliberately plants the pattern each
detector looks for — recurring subscriptions, lapses, mid-stream gaps, rate changes, reversals
matched to an original charge, same-second duplicates, a bulk makeup batch, $0 comped accounts,
final billings, cancellations, open failed payments and aged unpaid commissions. Regenerate
them with:

```bash
python3 sample/generate-samples.py sample
```

The generator is seeded, so the output is identical every run. Between them the three files
cover all three export shapes:

| File | Shape | Exercises |
|---|---|---|
| `sample-default-view.csv` | 7 columns, comma | The standard view: 1,776 rows, 326 clients. Four cards correctly locked, and enough rows to show the table windowing |
| `sample-extended.csv` | 11 columns, comma | Every view column switched on — all detectors fire, nothing locked |
| `sample-semicolon.csv` | 10 columns, semicolon | Delimiter sniffing and a partially-locked dashboard |

**Never replace these with unmodified real exports.** A GitHub Pages site is public, and a real
commission export contains hundreds of clients' names and email addresses.

### Performance

Large exports are common — one sample carries 5,539 rows across 941 clients. Three things keep
the first render light (about 4,000 DOM nodes rather than 100,000):

- client detail tables are built on first expand, not up front;
- the transaction table renders 250 rows and defers the rest to a `<template>`;
- the client table renders the top 100 by total earned and defers the rest.

Searching or sorting transparently pulls in the deferred rows first, so no result is ever
hidden by the windowing.


`requires` lists capability keys (`orderId`, `clients`, `paid`, `product`, `note`, …). If the
export lacks one, the card renders locked automatically — no extra handling needed. Add the
function to the `DETECTORS` array and it appears, ranked by severity and dollar impact.
