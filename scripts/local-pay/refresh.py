#!/usr/bin/env python3
"""
Refresh the local UN salary scales (General Service and National Officers) for every duty station.

Reads the public UN salary scale site (https://onehr.un.org/salary-survey/#/salary_scale): its list
of duty stations, and the newest published scale files (Excel) for each. For each station it keeps
the newest General Service scale and the newest National Officer scale, reads each grade's annual
net salary from the first to the highest step, and writes scripts/local-pay/local-pay.json. Then:

    npx tsx --tsconfig tsconfig.json scripts/local-pay/write-data.ts

writes src/lib/local-pay-data.ts from it. Check the diff (a station whose figures jump or vanish
deserves a look at its file) before committing.

Needs: pip install pandas openpyxl xlrd msoffcrypto-tool
Usage: python3 -I scripts/local-pay/refresh.py WORK_DIR   (downloads go to WORK_DIR, not the repo)
"""
import collections
import concurrent.futures as cf
import io
import json
import os
import re
import subprocess
import sys
import unicodedata
import warnings

import msoffcrypto
import pandas as pd

warnings.filterwarnings("ignore")
API = "https://onehr.un.org/salary_survey/api"
FILES = "https://onehr.un.org"
HERE = os.path.dirname(os.path.abspath(__file__))
MAX_FILES_PER_STATION = 12  # how far back to look for a station's GS and NO scales


# Scale currency codes that differ from the UN operational rates' codes. BGN: Bulgaria's lev, now
# converted at the euro's fixed conversion rate.
RATE_CODES = {"BAH": "BSD", "CFA": "XOF", "SOL": "PEN"}
FIXED_PER_EUR = {"BGN": 1.95583}


def usd_rates():
    """UN operational rates of exchange: units of each currency per US dollar, and their date."""
    import xml.etree.ElementTree as ET
    xml = subprocess.run(["curl", "-sS", "-m", "60", "https://treasury.un.org/operationalrates/xsql2XML.php"], capture_output=True, check=True).stdout
    rows = [{c.tag: c.text for c in r} for r in ET.fromstring(xml).iter("UN_OPERATIONAL_RATES")]
    rates = {r["f_curr_code"]: float(r["rate"]) for r in rows if r.get("rate")}
    dates = sorted({r["eff_date"] for r in rows if r.get("eff_date")})
    return rates, dates[-1] if dates else None


def get_json(url):
    out = subprocess.run(["curl", "-sS", "-m", "60", url], capture_output=True, check=True).stdout
    return json.loads(out)["data"]


def download(path, out):
    if not os.path.exists(out):
        subprocess.run(["curl", "-sS", "-m", "60", "-o", out, FILES + path], check=True)
    # Many .xls scales carry Excel's default write-protection, which Excel opens without a password.
    with open(out, "rb") as fh:
        try:
            office = msoffcrypto.OfficeFile(fh)
            if not office.is_encrypted():
                return
            office.load_key(password="VelvetSweatshop")
            buf = io.BytesIO()
            office.decrypt(buf)
        except Exception:
            return
    with open(out, "wb") as fh:
        fh.write(buf.getvalue())


GRADE_RE = re.compile(r"^(?:GS|G|NO|NOA)?-?([1-9]|[A-E])$", re.I)


def cell(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def num(v):
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None


def grade_key(g):
    return re.sub(r"^(GS?-?|NO-?)", "", g, flags=re.I).upper()


def read_sheet(df):
    """Each grade's "Total Net" row: the grade label is on that row or on the block's first row."""
    rows, grade = {}, None
    for r in range(df.shape[0]):
        vals = [cell(v) for v in df.iloc[r]]
        lab = next((c for c, v in enumerate(vals) if re.search(r"total\s*net|^\(?net\)?$|net\s*salary", v, re.I) and "pens" not in v.lower()), None)
        for v in vals[: lab if lab is not None else len(vals)]:
            vv = v.replace(" ", "")
            if GRADE_RE.match(vv) and not (vv.isdigit() and int(vv) > 9):
                grade = vv
                break
        if lab is not None and grade:
            nums = [n for n in (num(v) for v in vals[lab + 1 :]) if n and n > 0]
            if nums:
                rows.setdefault(grade, nums)
    return rows


def category(df):
    head = re.sub(r"\s+", " ", " ".join(cell(v) for v in df.iloc[:16].values.ravel() if cell(v)).lower())
    if "national officer" in head or "national professional" in head:
        return "NO"
    for word in ("language teacher", "security", "trades and crafts", "public information", "field service"):
        if word in head:
            return "other"
    return "GS" if "general service" in head else "?"


def read_file(path):
    xl = pd.ExcelFile(path)
    for sheet in xl.sheet_names:
        df = pd.read_excel(path, sheet_name=sheet, header=None)
        rows = read_sheet(df)
        if len(rows) >= 3:
            return category(df), rows
    return None, {}


def sane(rows, cat):
    """Grades in an unbroken run, each higher than the last, with a real range of steps."""
    keys = sorted(grade_key(g) for g in rows)
    run = "".join(keys)
    if run not in ("123456789" if cat == "GS" else "ABCDE") or len(keys) < 2:
        return False
    lows = [min(rows[g]) for g in sorted(rows, key=grade_key)]
    return all(b > a for a, b in zip(lows, lows[1:])) and all(len(v) >= 5 and max(v) > min(v) * 1.05 for v in rows.values())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-")


# Names the site's country matcher reads differently.
COUNTRY_NAMES = {
    "Antigua": "Antigua and Barbuda", "Cote d' Ivoire": "Côte d'Ivoire", "Lao": "Lao People's Democratic Republic",
    "St. Kitts and Nevis": "Saint Kitts and Nevis", "St. Lucia": "Saint Lucia", "St. Vincent and Grenadines": "Saint Vincent and the Grenadines",
    "Timor": "Timor-Leste", "USA": "United States", "Dem. Rep. of the Congo": "Democratic Republic of the Congo", "Turkey": "Türkiye",
}


def main(work):
    os.makedirs(os.path.join(work, "files"), exist_ok=True)
    stations = get_json(f"{API}/site/salaryScaleList/salary_scale")
    files = get_json(f"{API}/salaryScale/latestscaleslist?limit=5000")
    meta = {s["dutyStationId"]["countryId"]["name"] + "|" + s["dutyStationId"]["name"]: s for s in stations}

    by = collections.defaultdict(list)
    for f in files:
        by[f["country"]["name"] + "|" + f["dutystation_info"]["name"]].append(f)

    def station(k):
        """Walk the station's files from the newest until both a GS and an NO scale are found."""
        v = sorted(by[k], key=lambda x: (x.get("effective") or "", x.get("promulgated") or "", x.get("createdDate") or ""), reverse=True)
        chosen = {}
        for f in v[:MAX_FILES_PER_STATION]:
            if len(chosen) == 2:
                break
            local = os.path.join(work, "files", f["_id"] + "." + f["fileOriginalName"].strip().rsplit(".", 1)[-1])
            try:
                download(f["filePath"], local)
                cat, rows = read_file(local)
            except Exception:
                continue
            if cat in (None, "other"):
                continue
            if cat == "?":  # no title: go by the grades
                cat = "NO" if all(grade_key(g) in "ABCDE" for g in rows) else "GS"
            if cat in chosen or not sane(rows, cat):
                continue
            note = f.get("fileName") or ""
            chosen[cat] = {
                "effective": f.get("effective"),
                "grades": {("G-" if cat == "GS" else "NO-") + grade_key(g): [round(min(n)), round(max(n))] for g, n in sorted(rows.items(), key=lambda kv: grade_key(kv[0]))},
                **({"note": re.sub(r"^.*?\(|\)$", "", note)} if re.search(r"applicable|only", note, re.I) else {}),
            }
        return k, chosen

    keys = sorted(k for k in by if k in meta)
    with cf.ThreadPoolExecutor(6) as ex:
        results = list(ex.map(station, keys))

    out, missing = [], []
    for k, chosen in results:
        if not chosen:
            missing.append(k)
            continue
        country, name = k.split("|")
        m = meta[k]
        entry = {
            "station": name, "country": COUNTRY_NAMES.get(country, country), "slug": slug(name),
            "currency": m["currencyofScale"].strip(), "paidIn": m["currencyofDisbursement"].strip(),
        }
        if "apply to all duty stations" in (m.get("countryDescription") or ""):
            entry["countryWide"] = True
        if "GS" in chosen:
            entry["gs"] = chosen["GS"]
        if "NO" in chosen:
            entry["no"] = chosen["NO"]
        out.append(entry)

    rates, rate_date = usd_rates()
    no_rate = []
    for e in out:
        cur = e["currency"]
        if cur == "USD":
            continue
        code = RATE_CODES.get(cur, cur)
        rate = rates.get(code) or (FIXED_PER_EUR[code] * rates["EUR"] if code in FIXED_PER_EUR else None)
        if rate:
            e["usdRate"] = round(rate, 6)
        else:
            no_rate.append(f"{e['station']} ({cur})")
    if no_rate:
        print("No UN rate for:", ", ".join(no_rate))

    names = [e["slug"] for e in out]
    for e in out:
        if names.count(e["slug"]) > 1:
            e["slug"] += "-" + slug(e["country"])
    out.sort(key=lambda e: (e["country"], e["station"]))
    with open(os.path.join(HERE, "local-pay.json"), "w") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=0)
    with open(os.path.join(HERE, "rates-date.txt"), "w") as fh:
        fh.write(rate_date or "")
    print(f"{len(out)} stations; GS {sum('gs' in e for e in out)}, NO {sum('no' in e for e in out)}; none readable: {missing}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
