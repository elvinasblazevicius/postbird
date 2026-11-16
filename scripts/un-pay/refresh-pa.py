#!/usr/bin/env python3
"""
Refresh the post adjustment multipliers in src/lib/un-pay.ts from the ICSC.

Takes the newest Consolidated Post Adjustment Circular on the ICSC post adjustment data page
(https://icsc.un.org/Home/DataPostAdjustment), applies every monthly memo published after it, and
rewrites the PA_EFFECTIVE, PA_CIRCULAR, PA_MEMO and PA_ROWS block in src/lib/un-pay.ts. Prints the
duty stations whose multiplier changed. Check the diff before committing.

Needs: pdftotext (poppler-utils) and pip install pdfplumber
Usage: python3 -I scripts/un-pay/refresh-pa.py WORK_DIR   (downloads go to WORK_DIR, not the repo)
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime

import pdfplumber

BASE = "https://icsc.un.org"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UN_PAY = os.path.join(REPO, "src", "lib", "un-pay.ts")

# Names as the site shows them; the circular's own spelling otherwise.
TIDY = {
    "West Bank & the Gaza Strip,The": "West Bank and Gaza Strip", "Naoero, Republic of": "Nauru", "Jerusalem, Jerusalem": "Jerusalem",
    "Cote d Ivoire": "Côte d'Ivoire", "Central African Rep.": "Central African Republic", "Congo, Dem. Rep.": "Congo, Democratic Republic of the",
    "Korea, Dem. Peo. Rep. of": "Korea, Democratic People's Republic of", "Lao Peo. Dem. Rep.": "Lao People's Democratic Republic",
    "Tanzania, United Rep. of": "Tanzania", "Micronesia, Fed States of": "Micronesia", "Croatia, Republic of": "Croatia",
    "Slovenia, Republic of": "Slovenia", "Georgia, Republic of": "Georgia", "Palau, Republic of": "Palau",
    "South Sudan, Republic of": "South Sudan", "Yemen, Republic of": "Yemen", "Guinea Bissau": "Guinea-Bissau", "Cape Verde": "Cabo Verde",
    "St. Lucia": "Saint Lucia", "St. Kitts and Nevis": "Saint Kitts and Nevis", "St. Vincent and the Grenadines": "Saint Vincent and the Grenadines",
    "USA, Washington D.C.": "USA, Washington, D.C.",
}
# Spellings in the memos that differ from the circular's.
MEMO_NAMES = {"Algeri": "Algeria"}


def fetch(url, out=None):
    args = ["curl", "-sS", "-m", "60", url] + (["-o", out] if out else [])
    return subprocess.run(args, capture_output=True, check=True).stdout.decode("utf-8", "replace")


def month(text):
    return datetime.strptime(text.strip(), "%B %Y")


def links(page):
    # Each circular is listed twice: the PDF (opens in a new tab) and a zip of spreadsheets.
    found = re.findall(r'GetDataFile/(\d+)"\s+target="_blank"[^>]*>\s*([^<]+?)\s*<', page)
    circulars = [(month(m.group(2)), fid, name) for fid, name in found if (m := re.match(r"CIRC/PAC/(\d+),\s*(\w+ \d{4})$", name))]
    memos = [(month(m.group(1)), fid, name) for fid, name in found if (m := re.match(r"PA Memo,\s*(\w+ \d{4})$", name))]
    return sorted(circulars, reverse=True), sorted(memos)


def circular_rows(pdf, txt):
    subprocess.run(["pdftotext", "-layout", pdf, txt], check=True)
    lines = open(txt, encoding="utf-8").read().split("\n")
    start = next(i for i, l in enumerate(lines) if "CONSOLIDATED POST ADJUSTMENT CIRCULAR" in l)
    effective = re.search(r"Effective (\d+ \w+ \d{4})", "\n".join(lines[start : start + 3])).group(1)
    # The table ends where the French/English country index begins.
    end = next((i for i, l in enumerate(lines) if i > start and re.search(r"\bAutriche\b|Afghanistan\s{3,}Afghanistan", l)), len(lines))
    rows, pending = {}, ""
    for l in lines[start:end]:
        m = re.match(r"^(\S.*?)?\s{2,}([\d.,]+)\s+([\d.]+)\s+([\d.]+)\s", l)
        if m and (re.match(r"^\S", l) or pending):
            name = m.group(1) or ""
            if pending and not re.match(r"^[A-Za-z]", l):
                name = pending
            name = re.sub(r"\s*(/W\d+|\d+/|\*)", "", name).strip()
            if name:
                rows[name] = float(m.group(4))
            pending = ""
        else:
            # A long name on a line of its own, its figures on the next ("St. Vincent and the Grenadines /W40").
            bare = re.sub(r"\s*(/W\d+|\d+/|\*)", "", l.strip())
            if re.match(r"^[A-Z][A-Za-z]", bare) and not re.search(r"\d", bare) and len(bare) < 60 and "CONSOLIDATED" not in l and "Effective" not in l:
                pending = bare
    return effective, rows


def memo_changes(pdf):
    """Every "duty station, multiplier" pair in the memo's multiplier tables."""
    changes = {}
    with pdfplumber.open(pdf) as doc:
        for page in doc.pages:
            for table in page.extract_tables():
                head = " ".join(c or "" for c in table[0])
                if "MULTIPLIER" not in head or "RENTAL" in head or "PTA" in head:
                    continue
                step = 3 if "REASON" in head else 2
                for row in table[1:]:
                    for k in range(0, len(row) - 1, step):
                        name, value = row[k], row[k + 1]
                        if not name or not value:
                            continue
                        name = re.sub(r"\s+", " ", name.replace("*", "")).strip()
                        changes[MEMO_NAMES.get(name, name)] = float(value)
    return changes


def main(work):
    os.makedirs(work, exist_ok=True)
    page = fetch(f"{BASE}/Home/DataPostAdjustment")
    circulars, memos = links(page)
    c_month, c_id, c_name = circulars[0]
    pdf = os.path.join(work, f"circular-{c_id}.pdf")
    fetch(f"{BASE}/Home/GetDataFile/{c_id}", pdf)
    if open(pdf, "rb").read(5) != b"%PDF-":
        sys.exit(f"{c_name} did not download as a PDF; check the ICSC data page's links.")
    effective, rows = circular_rows(pdf, pdf + ".txt")
    if len(rows) < 200:
        sys.exit(f"Only {len(rows)} duty stations read from {c_name}; check the circular's layout.")

    later = [m for m in memos if m[0] > c_month]
    unknown = []
    for _, m_id, m_name in later:
        mpdf = os.path.join(work, f"memo-{m_id}.pdf")
        fetch(f"{BASE}/Home/GetDataFile/{m_id}", mpdf)
        for name, value in memo_changes(mpdf).items():
            if name in rows:
                rows[name] = value
            else:
                unknown.append((m_name, name))
    if unknown:
        sys.exit(f"Memo names not in the circular (add them to MEMO_NAMES): {unknown}")

    as_of = later[-1][0] if later else c_month
    items = sorted(((TIDY.get(n, n), v) for n, v in rows.items()), key=lambda x: x[0].replace("Côte", "Cote"))
    src = open(UN_PAY, encoding="utf-8").read()
    old = dict(re.findall(r'^  \["(.+?)", ([\d.]+)\],$', src, re.M))
    changed = [f"{n}: {old.get(n)} -> {v}" for n, v in items if old.get(n) is None or float(old[n]) != v]

    memo_line = (
        f'export const PA_MEMO: {{ label: string; href: string }} | null = {{ label: "ICSC post adjustment classification memo for {as_of:%B %Y}", href: "{BASE}/Home/GetDataFile/{later[-1][1]}" }};'
        if later else "export const PA_MEMO: { label: string; href: string } | null = null;"
    )
    block = "\n".join([
        f'export const PA_EFFECTIVE = "{as_of:%B %Y}";',
        f'export const PA_CIRCULAR = {{ label: "ICSC Consolidated Post Adjustment Circular ICSC/{c_name.split(",")[0]} (effective {effective})", href: "{BASE}/Home/GetDataFile/{c_id}" }};',
        memo_line,
        'export const PA_DATA_PAGE = "https://icsc.un.org/Home/DataPostAdjustment";',
        "const PA_ROWS: [string, number][] = [",
        *[f"  [{json.dumps(n, ensure_ascii=False)}, {v}]," for n, v in items],
        "];",
    ])
    new = re.sub(r"export const PA_EFFECTIVE = .*?\nconst PA_ROWS: \[string, number\]\[\] = \[\n.*?\n\];", lambda _: block, src, count=1, flags=re.S)
    open(UN_PAY, "w", encoding="utf-8").write(new)
    print(f"{len(items)} duty stations, as of {as_of:%B %Y} ({c_name} + {len(later)} memo(s)). Changed: {len(changed)}")
    for c in changed:
        print("  " + c)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
