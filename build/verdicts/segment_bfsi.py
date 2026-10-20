"""Slice bfsi_nbfc's 185 names into peer sets that a superlative can be true of.

Why this exists: pass 2 checks claims like "cheapest of the cluster". Across
185 names that mixes a gold-loan lender, an AMC and a shell holding company,
and the claim means nothing. The peer set has to be an actual peer set.

Rules are ordered — the FIRST match wins — because descriptions overlap
("housing finance company... also offers gold loans"). The order encodes which
business defines the name. Everything that matches nothing lands in UNSORTED
and gets read by hand; that bucket is the output that matters, not the tidy
ones, so it is printed in full rather than counted.
"""
import re
import sys
from collections import defaultdict

SRC = "build/verdicts/bfsi_desc.txt"

# (bucket, regex) — first match wins. Written against the lowercased
# "core business" + business_summary concatenation.
RULES = [
    ("amc_wealth",   r"\basset management|mutual fund|portfolio management|wealth management|\bamc\b"),
    ("broker",       r"stock brok|share brok|broking|depository participant|trading member"),
    ("exchange_infra", r"stock exchange|clearing corp|depositor(y|ies)\b|credit rating|rating agency|registrar and (share )?transfer"),
    ("insurance",    r"\binsurance\b|insurer|reinsur"),
    ("housing_fin",  r"housing finance|home loans?\b|mortgage"),
    ("gold_loan",    r"gold loans?|loans? against gold|jewell?ery as collateral"),
    ("microfinance", r"microfinance|micro-finance|\bmfi\b|joint liability group|self-help group"),
    ("vehicle_fin",  r"vehicle financ|auto financ|commercial vehicle|two-wheeler loan|tractor financ"),
    ("infra_fin",    r"infrastructure financ|power sector financ|railway financ|\bpfc\b|\birfc\b"),
    ("msme_fin",     r"\bmsme\b|small and medium enterprise|sme loans?|business loans?|working capital loan"),
    ("consumer_fin", r"consumer financ|personal loans?|consumer durable loan|education loans?|credit card"),
    ("holding_cic",  r"core investment company|\bcic\b|holding company|investment holding|group entities"),
    ("diversified",  r"diversified financial|financial services (group|company)|lending and investment"),
    ("investment",   r"invest(ment|s) in (shares|securities)|securities trading|proprietary investment|\bnbfc\b"),
]


def main():
    rows = []
    for line in open(SRC, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line:
            continue
        parts = line.split("|", 2)
        sym = parts[0]
        core = parts[1] if len(parts) > 1 else ""
        summ = parts[2] if len(parts) > 2 else ""
        rows.append((sym, core, summ))

    if len(rows) != 185:
        raise SystemExit(f"expected 185 rows, read {len(rows)} — the export is wrong, "
                         f"not the rules")

    buckets = defaultdict(list)
    for sym, core, summ in rows:
        text = f"{core} {summ}".lower()
        hit = None
        if not text.strip():
            hit = "NO_DESCRIPTION"
        else:
            for name, pat in RULES:
                if re.search(pat, text):
                    hit = name
                    break
        buckets[hit or "UNSORTED"].append((sym, core or summ[:70]))

    order = [b for b, _ in RULES] + ["NO_DESCRIPTION", "UNSORTED"]
    total = 0
    for b in order:
        if b not in buckets:
            continue
        n = len(buckets[b])
        total += n
        print(f"\n== {b}  ({n})")
        if b in ("UNSORTED", "NO_DESCRIPTION") or n <= 40:
            for sym, desc in sorted(buckets[b]):
                print(f"   {sym:<12} {desc[:84]}")
        else:
            print("   " + " ".join(s for s, _ in sorted(buckets[b])))
    print(f"\ntotal {total} of {len(rows)}")
    if total != len(rows):
        raise SystemExit("bucket counts do not sum to the input — a row was dropped")


if __name__ == "__main__":
    main()
