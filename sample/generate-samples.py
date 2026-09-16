"""Generate fully synthetic affiliate commission exports.

Nothing here derives from real data: names, emails, order IDs, products,
commission amounts and dates are all invented. Dates fall inside the last year.

The generator deliberately plants the patterns each detector looks for, so the
demo files exercise the dashboard end to end:
  recurring subscriptions, lapses, mid-stream gaps, rate changes, reversals
  matched to an original, same-second duplicates, a bulk makeup batch, $0 comped
  accounts, final billings, cancellations and open failed payments.
"""
import csv, random, sys
from datetime import datetime, timedelta

TODAY = datetime(2026, 9, 13, 18, 0, 0)
YEAR_AGO = TODAY - timedelta(days=364)

FIRST = """Avery Harper Rowan Quinn Emerson Sloane Reese Marlowe Teagan Blair Delaney Sutton
Everly Maren Palmer Wren Hollis Nova Sawyer Elliot Brooks Camden Declan Finley Grayson Hayes
Jonah Keaton Landon Miles Nolan Owen Parker Rory Silas Tatum Vaughn Wesley Zane Iris Juniper
Linnea Mabel Odette Priya Rosalind Sabine Thea Verity Willa Anouk Beatrix Clover Esme Freya""".split()

LAST = """Whitfield Ashcroft Brennan Calloway Dunmore Ellsworth Fairbanks Granger Hollister
Ingram Jessup Kingsley Lockhart Merrick Northcott Oakley Prescott Radcliffe Sterling Thackeray
Underwood Vandermeer Winslow Yarrow Ainsworth Blackwood Cartwright Delacroix Fitzgerald
Harrington Larkspur Montrose Pemberton Quillon Ravenscroft Sinclair Trenholm Wycliffe""".split()

DOMAINS = ["example.com", "example.net", "example.org"]

# Invented catalogue. Amounts are made up and consistent per product so recurring
# streams look like real subscriptions.
SUBSCRIPTIONS = [
    ("Pseudo VIP Monthly", 39.50),
    ("Pseudo VIP Discounted", 24.50),
    ("Pseudo VIP Scholarship", 19.50),
    ("Pseudo Coach VIP", 4.95),
    ("Pseudo VIP Starter Rate", 7.90),
]
# Two spellings of one product, to exercise the chart's name-merging.
SUB_VARIANTS = [
    ("Pseudo VIP Mensual - (renovación)", 29.50),
    ("Pseudo VIP Mensual (renovación)", 29.50),
]
CONSUMABLES = [
    ("Pseudo Protein Blend", 14.87),
    ("Pseudo Hydration Mix", 10.62),
    ("Pseudo Collagen Powder", 8.49),
    ("Pseudo Creatine Scoop", 8.75),
]
ONE_OFFS = [
    ("Pseudo Starter Program", 87.00),
    ("Pseudo 14-Day Reset", 20.00),
    ("Pseudo Meal Guide", 7.50),
]
FINAL_BILLING = ("Pseudo VIP (last billing)", 39.50)

CAMPAIGNS = {
    "Pseudo VIP Monthly": "VIP Membership",
    "Pseudo VIP Discounted": "VIP Membership",
    "Pseudo VIP Scholarship": "VIP Membership Scholarship Rate",
    "Pseudo Coach VIP": "Coach Discounted VIP",
    "Pseudo VIP Starter Rate": "VIP Membership",
    "Pseudo VIP Mensual - (renovación)": "VIP Membership",
    "Pseudo VIP Mensual (renovación)": "VIP Membership",
    "Pseudo Protein Blend": "Coach: Wellness",
    "Pseudo Hydration Mix": "Coach: Consumables",
    "Pseudo Collagen Powder": "Coach: Wellness",
    "Pseudo Creatine Scoop": "Coach: Wellness",
    "Pseudo Starter Program": "Coach: New Clients",
    "Pseudo 14-Day Reset": "Coach: 5 day product",
    "Pseudo Meal Guide": "Coach: Consumables",
    "Pseudo VIP (last billing)": "VIP Membership",
}


class Gen:
    def __init__(self, seed, affiliate, downline):
        self.r = random.Random(seed)
        self.affiliate = affiliate
        self.downline = downline
        self.rows = []
        self.used_emails = set()
        self.order_seq = self.r.randint(1000, 9000)

    # -- identities ---------------------------------------------------------
    def person(self):
        while True:
            name = f"{self.r.choice(FIRST)} {self.r.choice(LAST)}"
            local = name.lower().replace(" ", ".")
            email = f"{local}@{self.r.choice(DOMAINS)}"
            if email not in self.used_emails:
                self.used_emails.add(email)
                return name, email

    def order_id(self, line=1):
        self.order_seq += self.r.randint(7, 900)
        return f"75{self.order_seq:011d}({line})"

    def referrer(self):
        # The affiliate sources most of their own clients; the rest come from downline.
        return self.affiliate if self.r.random() < 0.72 else self.r.choice(self.downline)

    # -- row emitter --------------------------------------------------------
    def add(self, when, amount, name, email, product, referrer,
            order=None, note="", paid=None, campaign=None):
        if paid is None:
            # Recent commissions have not been paid out yet.
            paid = "U" if (TODAY - when).days <= 14 else "P"
        self.rows.append({
            "Created": when.strftime("%Y-%m-%d %H:%M:%S"),
            "Commission": f"{amount:g}",
            "Order ID": order if order is not None else self.order_id(),
            "Campaign Name": campaign or CAMPAIGNS.get(product, "VIP Membership"),
            "Status": "A",
            "Paid": paid,
            "Client Name": name,
            "Client Email": email,
            "Product": product,
            "Referral Source": referrer,
            "Note": note,
        })

    # -- helpers ------------------------------------------------------------
    def month_steps(self, start, count):
        """Monthly-ish billing dates anchored to one day of the month."""
        out, cur = [], start
        for _ in range(count):
            out.append(cur)
            month = cur.month + 1
            year = cur.year + (month > 12)
            month = month - 12 if month > 12 else month
            day = min(cur.day, 28)
            cur = cur.replace(year=year, month=month, day=day) + timedelta(
                minutes=self.r.randint(-90, 90))
        return out

    def month_steps_to(self, end, count):
        """Monthly billing dates ending on `end` (used so active subscriptions
        run right up to today, leaving recent rows still awaiting payout)."""
        out, cur = [], end
        for _ in range(count):
            out.append(cur)
            month = cur.month - 1
            year = cur.year - (month < 1)
            month = month + 12 if month < 1 else month
            cur = cur.replace(year=year, month=month, day=min(cur.day, 28)) + timedelta(
                minutes=self.r.randint(-90, 90))
        return sorted(out)

    def recent_end(self, max_days=12):
        return (TODAY - timedelta(days=self.r.randint(0, max_days))).replace(
            hour=self.r.randint(0, 22), minute=self.r.randint(0, 59),
            second=self.r.randint(0, 59))

    def start_date(self, months_back):
        d = TODAY - timedelta(days=months_back * 30 + self.r.randint(0, 20))
        return max(d, YEAR_AGO + timedelta(days=1)).replace(
            hour=self.r.randint(0, 22), minute=self.r.randint(0, 59),
            second=self.r.randint(0, 59))


def build(gen, n_clients, archetypes):
    """Create clients across the given archetype weights."""
    kinds = [k for k, w in archetypes.items() for _ in range(w)]
    subs = SUBSCRIPTIONS + SUB_VARIANTS

    for i in range(n_clients):
        kind = kinds[i % len(kinds)]
        name, email = gen.person()
        ref = gen.referrer()
        product, amount = gen.r.choice(subs)

        if kind == "active":
            months = gen.r.randint(4, 11)
            for d in gen.month_steps_to(gen.recent_end(), months):
                if d >= YEAR_AGO:
                    gen.add(d, amount, name, email, product, ref)

        elif kind == "lapsed":
            months = gen.r.randint(3, 6)
            start = gen.start_date(months + gen.r.randint(2, 5))
            for d in gen.month_steps(start, months):
                gen.add(d, amount, name, email, product, ref)

        elif kind == "gap":
            months = gen.r.randint(6, 9)
            skip = gen.r.randint(2, months - 3)
            for idx, d in enumerate(gen.month_steps(gen.start_date(months), months)):
                if idx == skip or d > TODAY:
                    continue  # the missing cycle
                gen.add(d, amount, name, email, product, ref)

        elif kind == "rate_change":
            months = gen.r.randint(6, 9)
            dates = gen.month_steps(gen.start_date(months), months)
            switch = months // 2
            lower = round(amount * gen.r.choice([0.62, 0.75]), 2)
            for idx, d in enumerate(dates):
                if d > TODAY:
                    continue
                gen.add(d, amount if idx < switch else lower, name, email, product, ref)

        elif kind == "final":
            months = gen.r.randint(4, 7)
            dates = gen.month_steps(gen.start_date(months), months)
            for idx, d in enumerate(dates):
                if d > TODAY:
                    continue
                last = idx == len(dates) - 1
                gen.add(d, FINAL_BILLING[1] if last else amount, name, email,
                        FINAL_BILLING[0] if last else product, ref)

        elif kind == "reversed":
            months = gen.r.randint(3, 6)
            dates = [d for d in gen.month_steps(gen.start_date(months), months) if d <= TODAY]
            orders = []
            for d in dates:
                oid = gen.order_id()
                orders.append((d, oid))
                gen.add(d, amount, name, email, product, ref, order=oid)
            when, oid = orders[-1]
            reversal = min(when + timedelta(days=gen.r.randint(3, 20)), TODAY)
            gen.add(reversal, -amount, name, email, product, ref, order=oid,
                    note=gen.r.choice([
                        "Commission granted in error.",
                        "Client switched coaches, please adjust records accordingly.",
                        "Refunded.",
                    ]))

        elif kind == "zero":
            months = gen.r.randint(3, 8)
            for d in gen.month_steps(gen.start_date(months), months):
                if d <= TODAY:
                    gen.add(d, 0, name, email, product, ref)

        elif kind == "duplicate":
            months = gen.r.randint(3, 6)
            dates = [d for d in gen.month_steps(gen.start_date(months), months) if d <= TODAY]
            prod, amt = gen.r.choice(CONSUMABLES)
            for d in dates:
                gen.add(d, amount, name, email, product, ref)
            # One consumable credited twice at the identical second.
            dup_at = dates[len(dates) // 2] + timedelta(days=gen.r.randint(1, 9))
            if dup_at <= TODAY:
                oid = gen.order_id()
                gen.add(dup_at, amt, name, email, prod, ref, order=oid)
                gen.add(dup_at, amt, name, email, prod, ref, order=oid)

        elif kind == "consumables":
            for k in range(gen.r.randint(2, 6)):
                prod, amt = gen.r.choice(CONSUMABLES)
                if k == 0 and gen.r.random() < 0.45:
                    d = gen.recent_end(10)
                else:
                    d = YEAR_AGO + timedelta(days=gen.r.randint(1, 360),
                                             hours=gen.r.randint(0, 23),
                                             minutes=gen.r.randint(0, 59))
                if d <= TODAY:
                    gen.add(d, amt, name, email, prod, ref)

        elif kind == "one_time":
            prod, amt = gen.r.choice(ONE_OFFS)
            d = YEAR_AGO + timedelta(days=gen.r.randint(1, 355),
                                     hours=gen.r.randint(0, 23))
            gen.add(d, amt, name, email, prod, ref)
    return gen


def add_makeup_batch(gen, count=6):
    """A batch of corrections posted at one identical second."""
    when = TODAY - timedelta(days=64)
    when = when.replace(hour=10, minute=54, second=0)
    for _ in range(count):
        name, email = gen.person()
        prod, amt = gen.r.choice(CONSUMABLES)
        missed = (when - timedelta(days=gen.r.randint(40, 200))).strftime("%Y-%m-%d")
        gen.add(when, amt, name, email, prod, gen.affiliate,
                note=f"To account for missing {prod} commission from {missed} - Affiliate Team")


def add_stuck_payouts(gen, count=2):
    """Commissions that were never paid out and have aged past the normal
    window — the case the payout-aging check exists to surface."""
    for _ in range(count):
        name, email = gen.person()
        product, amount = gen.r.choice(SUBSCRIPTIONS)
        months = gen.r.randint(3, 5)
        dates = gen.month_steps_to(TODAY - timedelta(days=gen.r.randint(68, 96)), months)
        for i, d in enumerate(dates):
            if d < YEAR_AGO:
                continue
            # Everything paid except the final one, which got stuck.
            gen.add(d, amount, name, email, product, gen.affiliate,
                    paid="U" if i == len(dates) - 1 else "P")


def add_lifecycle(gen, cancels=5, failed_open=2, failed_then_cancel=2):
    """$0 cancellation and failed-payment rows (Order ID / Campaign only)."""
    def emit(kind, sub, when, name, email, product):
        gen.add(when, 0, name, email, product, gen.affiliate,
                order=f"{kind}_{sub}_{when.strftime('%Y-%m-%d')}",
                campaign="Membership cancellations")

    for _ in range(cancels):
        name, email = gen.person()
        product, amount = gen.r.choice(SUBSCRIPTIONS)
        sub = gen.r.randint(100000, 999999)
        months = gen.r.randint(3, 5)
        dates = gen.month_steps(gen.start_date(months + 3), months)
        for d in dates:
            gen.add(d, amount, name, email, product, gen.affiliate, order=str(sub))
        emit("cancel", sub, dates[-1] + timedelta(days=28), name, email, product)

    for _ in range(failed_open):  # declined, not yet cancelled -> recoverable
        name, email = gen.person()
        product, amount = gen.r.choice(SUBSCRIPTIONS)
        sub = gen.r.randint(100000, 999999)
        dates = gen.month_steps(gen.start_date(4), 3)
        for d in dates:
            gen.add(d, amount, name, email, product, gen.affiliate, order=str(sub))
        base = min(dates[-1] + timedelta(days=29), TODAY - timedelta(days=6))
        for k in range(gen.r.randint(2, 3)):
            emit("failed", sub, base + timedelta(days=k * 2), name, email, product)

    for _ in range(failed_then_cancel):  # dunning that ended in churn
        name, email = gen.person()
        product, amount = gen.r.choice(SUBSCRIPTIONS)
        sub = gen.r.randint(100000, 999999)
        dates = gen.month_steps(gen.start_date(7), 4)
        for d in dates:
            gen.add(d, amount, name, email, product, gen.affiliate, order=str(sub))
        base = dates[-1] + timedelta(days=29)
        for k in range(3):
            emit("failed", sub, base + timedelta(days=k * 2), name, email, product)
        emit("cancel", sub, base + timedelta(days=7), name, email, product)


def write(path, rows, columns, delimiter=","):
    rows = sorted(rows, key=lambda r: r["Created"], reverse=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter=delimiter, quoting=csv.QUOTE_ALL)
        w.writerow(columns)
        for r in rows:
            # Long platform-specific header maps back to the canonical "Note".
            w.writerow([r.get(c, r.get("Note", "")) for c in columns])
    print(f"{path}: {len(rows)} rows, {len(columns)} cols, delim={delimiter!r}")


DEFAULT_COLS = ["Created", "Commission", "Status", "Client Name", "Client Email",
                "Product", "Referral Source"]
EXTENDED_COLS = ["Created", "Commission", "Order ID", "Campaign Name", "Status", "Paid",
                 "Client Name", "Client Email", "Product", "Referral Source", "Note"]

# The semicolon sample deliberately keeps a long, platform-specific header. Real
# exports carry headers like this, and it proves the alias matching in
# js/schema.js maps them onto the canonical field rather than dropping them.
SEMI_COLS = ["Created", "Commission", "Campaign Name", "Status", "Paid", "Client Name",
             "Client Email", "Product", "Referral Source", "Note for the FASTer Way Team"]

out = sys.argv[1]

# --- A: the standard affiliate view, large ---------------------------------
a = Gen(20260913, "Marlowe Ashcroft",
        ["Teagan Vandermeer", "Silas Oakley", "Nova Brennan", "Rory Delacroix",
         "Iris Pemberton", "Hollis Trenholm", "Juniper Larkspur"])
build(a, 320, {"active": 9, "lapsed": 3, "gap": 2, "rate_change": 2, "final": 1,
               "reversed": 2, "zero": 2, "duplicate": 1, "consumables": 3, "one_time": 4})
add_makeup_batch(a, 6)
write(f"{out}/sample-default-view.csv", a.rows, DEFAULT_COLS)

# --- B: every view column switched on, medium ------------------------------
b = Gen(77712, "Sutton Kingsley",
        ["Wren Calloway", "Blair Montrose", "Elliot Fairbanks", "Maren Sinclair"])
build(b, 46, {"active": 7, "lapsed": 2, "gap": 2, "rate_change": 2, "final": 2,
              "reversed": 3, "zero": 1, "duplicate": 2, "consumables": 3, "one_time": 2})
add_makeup_batch(b, 5)
add_stuck_payouts(b, 2)
add_lifecycle(b, cancels=5, failed_open=2, failed_then_cancel=2)
write(f"{out}/sample-extended.csv", b.rows, EXTENDED_COLS)

# --- C: semicolon-delimited, no Order ID, small ----------------------------
c = Gen(31337, "Everly Northcott", ["Parker Hollister", "Odette Winslow"])
build(c, 9, {"active": 4, "gap": 1, "final": 1, "consumables": 2, "one_time": 1})
write(f"{out}/sample-semicolon.csv", c.rows, SEMI_COLS, delimiter=";")
