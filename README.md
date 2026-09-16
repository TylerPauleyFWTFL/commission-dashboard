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

## Hosting it on GitHub Pages

1. Push this folder to a repository.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/<repo>/`.

No build step. The site is plain HTML, CSS, and native ES modules, which GitHub Pages serves
with the correct MIME types out of the box. All asset paths are relative, so it works from a
project subpath as well as a custom domain.

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

### Time periods

Reports arrive at wildly different scales — one real export covered 12 days, another three and
a half years. `js/period.js` owns all of it:

- **Ranges**: last 7 / 14 / 30 days, this month, last month, last 3 / 6 / 12 months, this year,
  all time, and custom start/end dates. Only ranges the loaded file can fill are offered.
- **Granularity follows the span**, rather than being fixed: ≤31 days buckets by day, ≤120 days
  by week, ≤800 days by month, longer by quarter. A 12-day file gets 13 daily bars instead of
  one useless monthly one.
- **Everything anchors to the report's own "as of" date**, never to today, so a file downloaded
  last month filters the same way it did when it was fresh.
- **Comparison** is against the equally long window immediately before the current one, taken
  from the unfiltered dataset.

Copy follows the bucket size too — "your best quarter", "average per day". At daily granularity
the last-full-period tile is suppressed: one quiet day reads as "−100%" and means nothing.

### Five rules worth knowing before changing the analysis

These were derived from real exports and quietly prevent a large class of false positives
and overclaims.

**1. Clients are identified by email, never by name or campaign.**

The source data contains a platform migration: order IDs change format
(`1450299` → `7378641911863(1)`) and campaigns are renamed mid-subscription
(`Coach: Client Membership Discount` → `VIP Membership Scholarship Rate`) while the
subscription itself runs uninterrupted. Grouping recurring activity by client *and campaign*
reports 12 churned clients in the sample file; grouping by email reports 7, and the five that
disappear are pure migration artifacts. The same email also appears under different name
spellings ("Lizzy Gray" / "Elizabeth Gray").

**2. A recurring stream must be regular before a gap means anything.**

Streams are keyed on the client's email plus the charge amount, and a stream only counts as
monthly when its intervals are genuinely consistent — every gap has to be explainable as a whole
number of cycles. Without that check, a client holding two same-priced subscriptions a few days
apart looks like one subscription on a chaotic schedule, and its perfectly normal short gaps get
reported as skipped billing cycles.

**3. Never guess whose report it is.**

An earlier version inferred the owner from the most frequent Referral Source. That is wrong:
Referral Source names whoever referred each client, which in a team report is a downline coach.
One real export proved it — the most frequent referrer *also appeared as a client in the same
file*, under a different referrer, so the dashboard displayed a name belonging to someone who
was not the reader. The owner is simply not in the data. The heading asks for a name and
remembers it (`getOwnerName` in `js/storage.js`); until then it reads "Your commission report".

**4. Never report an absence as evidence when the column that would show it is missing.**

Cancellations arrive as $0 rows identified by an Order ID prefix (`cancel_`, `failed_`) or the
"Membership cancellations" campaign. In the standard export neither column exists, so *every*
lapsed client trivially has "no cancellation on record" — the phrase is meaningless there, and
most of that list is ordinary churn. So the lapse check runs in two modes: with cancellation
visibility it reports high severity and an estimated amount missing; without it, it drops to
medium, renames itself "Clients who stopped paying", reports lost monthly income instead of
money owed, and says plainly that the two cannot be told apart without the Order ID column.
The same rule covers short files. Checks declare a minimum span in `MIN_HISTORY_DAYS`
(`js/insights.js`) — spotting a client who stopped needs about 90 days — and below that they
render as "needs more history" with an explanation, instead of a reassuring "all clear" for a
question nobody was able to ask. Apply the same discipline to anything new: state what the data
supports, not what it implies.

**5. Bulk posting runs are not duplicates.**

The platform posts batches of makeup payments with an identical timestamp — 32 rows inside
three seconds in one sample. Rows repeating inside such a batch are corrections, not double
credits, so duplicate detection ignores any second that carries four or more rows. Duplicate
detection also runs in two modes: with `Order ID` the same order credited twice in a day is
unambiguous and reported as high severity; without it, the strongest available signal is an
identical client/product/amount/second, which could equally be two units of one item — so it is
reported at medium severity and labelled unconfirmed.

### Summary tables and the full table

Every table renders twice over: a **summary** on the page — a few essential columns and a few
rows — and the **full table** in a modal, with every column and every row.

`js/detail.js` *moves* the live table node into the `<dialog>` rather than cloning it. Sort
order, the active search filter and any lazily-built rows carry straight over, and the browser
never holds two copies of a 941-client table. A placeholder marks where it came from; closing
puts it back.

Two rules worth keeping:

- **Secondary columns are marked `.col-extra`,** hidden by CSS on the page and revealed by
  `.is-detail`. Nothing about the data changes, so sorting a hidden column from inside the modal
  still works — it reads each row's `data-*` attributes, not its cells.
- **The dialog lives inside `#dashboard`,** not `<body>`. `showModal()` promotes it to the
  browser's top layer either way, and keeping it inside the root means the delegated click and
  input handlers still reach the table while it is in the modal.

`renderDashboard()` calls `closeDetail()` before it replaces the root's HTML. Without that, a
table sitting in the modal would be destroyed mid-flight and never find its way home.

### Why tables do not overflow any more

Three rules, and they matter more than they look:

1. **Every table sits inside a `.table-scroll`.** The findings tables previously did not, so
   five `white-space: nowrap` columns in a 355px card painted straight over the card next door.
2. **Long text is clipped on an inner `.cell-clip` span, never on the `<td>`.** `max-width` and
   `text-overflow` are ignored on an auto-layout table cell — the old `max-width: 240px` on the
   last cell of every issue table never did anything at all.
3. **`max-width: min(30ch, 100%)`** covers both table layouts: under `table-layout: fixed` the
   `100%` wins and text clips to whatever width the column actually got; under auto layout the
   `30ch` cap stops one long value from widening the column. Inside the modal the clip is lifted
   entirely — showing everything is the point of the full table.

When changing table CSS, check `document.body.scrollWidth === document.body.clientWidth` at
390px. Do **not** compare against `window.innerWidth`: a preview pane reports the unscaled
window, and that is exactly how a broken mobile layout once passed its check.

### Event listeners are bound once

`#dashboard` survives every re-render — replacing its `innerHTML` does not remove listeners
attached to the element itself. `wireInteractions()` therefore guards on `root.dataset.wired`
and keeps the current dataset in a module-level `ctx`. Binding per render used to stack a
duplicate handler each time, so after loading a second file one click ran two toggles (netting
out to nothing) and "Copy the details" copied twice.

Sorting is the exception: it binds directly to the `<th>`s, which are rebuilt every render, so
`wireSorting()` does re-run each time.

### Performance

Large exports are common — one sample carries 5,539 rows across 941 clients. Three things keep
the first render light (about 4,000 DOM nodes rather than 100,000):

- client detail tables are built on first expand, not up front;
- the transaction table renders 250 rows and defers the rest to a `<template>`;
- the client table renders the top 100 by total earned and defers the rest.

Searching or sorting transparently pulls in the deferred rows first, so no result is ever
hidden by the windowing.

### Wording you need to fill in

Three constants carry placeholder text that only your team can write correctly. Each is at the
top of its file with a `TODO` comment, and nothing else needs editing:

| Where | Constant | What to put there |
|---|---|---|
| `js/onboarding.js` | `PORTAL_NAME`, `EXPORT_STEPS` | The real click-path for downloading the commission report |
| `js/onboarding.js` | `EXTRA_COLUMNS` | Confirm these column names match your export exactly |
| `js/insights.js` | `SUPPORT_EMAIL` | The address "Ask about this" should write to. Left blank, the email still opens fully written and the coach picks the recipient. |

### Writing for this audience

Coaches are not analysts, and most will open this on a phone. Two rules keep it usable:

- **Say what a person would say.** "Money taken back", not "reversals". "Months that never paid
  you", not "skipped billing cycles". Anything unavoidable goes through `term()` in
  `js/glossary.js` so it can be tapped for a definition.
- **Never state an absence as a finding when the column that would prove it is missing.** The
  lapse check already does this: without cancellation data it renames itself, drops severity, and
  reports lost monthly income rather than money owed. Follow that pattern.

### Adding a detector

Write a pure function in `js/insights.js` that takes the dataset and returns:

```js
{ id, severity, title, summary, detail, impact, rows, columns, requires }
```

`requires` lists capability keys (`orderId`, `clients`, `paid`, `product`, `note`, …). If the
export lacks one, the card renders locked automatically — no extra handling needed. Add the
function to the `DETECTORS` array and it appears, ranked by severity and dollar impact.
