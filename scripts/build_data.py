"""Build the JSON files that power the COVID-GREECE dashboard.

Downloads Our World in Data's compact COVID-19 dataset (which carries the
WHO case/death reports plus vaccination, hospital and excess-mortality
series), reduces it to weekly series for Greece and a handful of European
comparison countries, detects the pandemic waves, validates the result and
writes it to ``docs/data``.

Only the standard library is used so the script runs anywhere, including
the scheduled GitHub Actions job that keeps the site fresh.

Usage:
    python scripts/build_data.py                  # download + build
    python scripts/build_data.py --csv local.csv  # build from a local file
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import tempfile
import time
import urllib.request
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from itertools import pairwise
from pathlib import Path

SOURCE_URL = "https://catalog.ourworldindata.org/garden/covid/latest/compact/compact.csv"
SOURCE_PAGE = "https://ourworldindata.org/coronavirus"
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "data"

COUNTRY = "Greece"
COMPARE = [
    "Greece",
    "Cyprus",
    "Italy",
    "Spain",
    "Portugal",
    "Bulgaria",
    "France",
    "Germany",
    "European Union (27)",
]

# Columns copied into the weekly series. "sum" adds up the reports that fall
# inside a week, "last" keeps the most recent value reported in that week.
WEEKLY_FIELDS = OrderedDict(
    [
        ("cases", ("new_cases", "sum")),
        ("deaths", ("new_deaths", "sum")),
        ("total_cases", ("total_cases", "last")),
        ("total_deaths", ("total_deaths", "last")),
        ("vaccinated", ("people_vaccinated_per_hundred", "last")),
        ("fully_vaccinated", ("people_fully_vaccinated_per_hundred", "last")),
        ("boosters", ("total_boosters_per_hundred", "last")),
        ("hosp_admissions", ("weekly_hosp_admissions", "last")),
        ("icu_admissions", ("weekly_icu_admissions", "last")),
        ("excess_mortality", ("excess_mortality", "last")),
        ("positive_rate", ("positive_rate", "last")),
        ("stringency", ("stringency_index", "last")),
    ]
)

# Per-capita comparison metrics: output key -> OWID column. Each one has a
# latest value per country and a weekly time series for the trend chart.
COMPARE_METRICS = OrderedDict(
    [
        ("deaths_per_million", "total_deaths_per_million"),
        ("cases_per_million", "total_cases_per_million"),
        ("fully_vaccinated", "people_fully_vaccinated_per_hundred"),
        ("excess_per_million", "excess_mortality_cumulative_per_million"),
    ]
)

# Fields that are rates (rounded to 2 decimals) rather than counts.
RATE_FIELDS = {
    "vaccinated",
    "fully_vaccinated",
    "boosters",
    "excess_mortality",
    "positive_rate",
    "stringency",
}

# A wave is a peak in weekly cases at least WAVE_RATIO times higher than the
# troughs on both sides, and at least WAVE_FLOOR of the all-time peak.
WAVE_RATIO = 2.0
WAVE_FLOOR = 0.02


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------


def download(url: str, dest: Path, attempts: int = 4) -> Path:
    """Download ``url`` to ``dest`` with exponential back-off."""
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "covidgreece-data-bot"})
            with urllib.request.urlopen(request, timeout=120) as response, open(dest, "wb") as fh:
                while chunk := response.read(1 << 20):
                    fh.write(chunk)
            return dest
        except OSError as exc:
            if attempt == attempts - 1:
                raise
            wait = 2 ** (attempt + 1)
            print(f"download failed ({exc}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    return dest


def to_float(value: str | None) -> float | None:
    """Parse a CSV cell; empty or non-numeric cells become ``None``."""
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def read_rows(path: Path, countries: set[str]) -> dict[str, list[dict]]:
    """Stream the CSV and keep only the rows of ``countries``, sorted by date."""
    by_country: dict[str, list[dict]] = {name: [] for name in countries}
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row.get("country") in by_country:
                by_country[row["country"]].append(row)
    for rows in by_country.values():
        rows.sort(key=lambda r: r["date"])
    return by_country


# --------------------------------------------------------------------------
# Transformations
# --------------------------------------------------------------------------


def week_ending(day: date) -> date:
    """Return the Sunday that closes the reporting week of ``day``.

    WHO publishes weekly figures dated either on the Sunday that ends the week
    or on the following Monday, so a report is shifted back by one day before
    snapping forward to Sunday. Both conventions land in the same week.
    """
    shifted = day - timedelta(days=1)
    return shifted + timedelta(days=6 - shifted.weekday())


def weekly_series(rows: list[dict]) -> OrderedDict[str, dict]:
    """Collapse daily rows into weeks keyed by the ISO date of their Sunday."""
    weeks: OrderedDict[str, dict] = OrderedDict()
    for row in rows:
        key = week_ending(date.fromisoformat(row["date"])).isoformat()
        bucket = weeks.setdefault(key, {name: None for name in WEEKLY_FIELDS})
        for name, (column, how) in WEEKLY_FIELDS.items():
            value = to_float(row.get(column))
            if value is None:
                continue
            if how == "sum":
                bucket[name] = (bucket[name] or 0) + value
            else:
                bucket[name] = value
    return weeks


def trim_weeks(weeks: OrderedDict[str, dict]) -> OrderedDict[str, dict]:
    """Drop the empty weeks before the first case and after the last report.

    The source pads the daily rows with zeros up to its export date, so a
    trailing week with no cases and no deaths is a week whose report has not
    been published yet, not a week without infections.
    """
    keys = list(weeks)
    reported = [k for k in keys if (weeks[k]["total_cases"] or 0) > 0]
    if not reported:
        return OrderedDict()
    start, end = keys.index(reported[0]), keys.index(reported[-1])
    while end > start and not weeks[keys[end]]["cases"] and not weeks[keys[end]]["deaths"]:
        end -= 1
    return OrderedDict((k, weeks[k]) for k in keys[start : end + 1])


def round_value(name: str, value: float | None) -> float | int | None:
    if value is None:
        return None
    if name in RATE_FIELDS:
        return round(value, 2)
    return round(value)


def to_columns(weeks: OrderedDict[str, dict]) -> dict[str, list]:
    """Turn ``{week: {field: v}}`` into compact parallel arrays."""
    columns: dict[str, list] = {"weeks": list(weeks)}
    for name in WEEKLY_FIELDS:
        columns[name] = [round_value(name, weeks[k][name]) for k in weeks]
    return columns


def detect_waves(
    values: list[float | None],
    ratio: float = WAVE_RATIO,
    floor: float = WAVE_FLOOR,
) -> list[int]:
    """Return the indices of the peaks that qualify as epidemic waves.

    For every local maximum we walk left and right until a higher value is
    found, recording the lowest trough on each side (classic topographic
    prominence). The peak counts as a wave when it is ``ratio`` times larger
    than the higher of the two troughs, i.e. cases at least doubled on the
    way up and halved on the way down, and is not negligible compared with
    the largest peak. Working with ratios instead of absolute differences
    keeps the small 2020 waves visible next to the huge Omicron wave.
    """
    series = [v or 0.0 for v in values]
    if not series:
        return []
    highest = max(series)
    if highest <= 0:
        return []

    peaks = []
    n = len(series)
    for i, value in enumerate(series):
        if value < highest * floor:
            continue
        left = series[i - 1] if i > 0 else -1
        right = series[i + 1] if i < n - 1 else -1
        # plateau handling: the first point of a flat top is the peak
        if not (value > left and value >= right):
            continue

        left_min = value
        j = i - 1
        while j >= 0 and series[j] <= value:
            left_min = min(left_min, series[j])
            j -= 1
        right_min = value
        j = i + 1
        while j < n and series[j] <= value:
            right_min = min(right_min, series[j])
            j += 1

        base = max(left_min, right_min, 1.0)
        if value / base >= ratio:
            peaks.append(i)
    return peaks


def latest(values: list, weeks: list[str]) -> tuple[float | None, str | None]:
    """Return the most recent non-null value of a series and its week."""
    for value, week in zip(reversed(values), reversed(weeks), strict=True):
        if value is not None:
            return value, week
    return None, None


def pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or not previous:
        return None
    return round((current - previous) / previous * 100, 1)


def build_greece(rows: list[dict]) -> dict:
    weeks = trim_weeks(weekly_series(rows))
    if not weeks:
        raise ValueError(f"no reported cases found for {COUNTRY}")
    series = to_columns(weeks)
    keys = series["weeks"]
    population = to_float(rows[-1].get("population"))

    total_cases, _ = latest(series["total_cases"], keys)
    total_deaths, _ = latest(series["total_deaths"], keys)

    def stat(name: str) -> dict:
        value, week = latest(series[name], keys)
        return {"value": value, "week": week}

    waves = []
    for index in detect_waves(series["cases"]):
        waves.append(
            {
                "week": keys[index],
                "cases": series["cases"][index],
                "deaths": max(series["deaths"][max(0, index - 2) : index + 5], default=None),
            }
        )

    summary = {
        "week": keys[-1],
        "previous_week": keys[-2] if len(keys) > 1 else None,
        "cases": series["cases"][-1],
        "previous_cases": series["cases"][-2] if len(keys) > 1 else None,
        "cases_change": pct_change(
            series["cases"][-1], series["cases"][-2] if len(keys) > 1 else None
        ),
        "deaths": series["deaths"][-1],
        "previous_deaths": series["deaths"][-2] if len(keys) > 1 else None,
        "total_cases": total_cases,
        "total_deaths": total_deaths,
        "population": int(population) if population else None,
        "cases_per_million": round(total_cases / population * 1e6) if population else None,
        "deaths_per_million": round(total_deaths / population * 1e6) if population else None,
        "case_fatality": round(total_deaths / total_cases * 100, 2) if total_cases else None,
        "vaccinated": stat("vaccinated"),
        "fully_vaccinated": stat("fully_vaccinated"),
        "boosters": stat("boosters"),
        "peak_cases": {
            "value": max(v or 0 for v in series["cases"]),
            "week": keys[max(range(len(keys)), key=lambda i: series["cases"][i] or 0)],
        },
        "peak_deaths": {
            "value": max(v or 0 for v in series["deaths"]),
            "week": keys[max(range(len(keys)), key=lambda i: series["deaths"][i] or 0)],
        },
    }
    return {"country": COUNTRY, "summary": summary, "waves": waves, "series": series}


def build_compare(by_country: dict[str, list[dict]], weeks_axis: list[str]) -> dict:
    """Latest per-capita indicators plus a weekly series for every metric.

    All series share ``weeks_axis`` (the Greek reporting weeks) so the front
    end can plot any metric for any country without realigning dates.
    """
    countries = []
    series: dict[str, dict[str, list]] = {metric: {} for metric in COMPARE_METRICS}
    for name in COMPARE:
        rows = by_country.get(name) or []
        if not rows:
            continue
        population = to_float(rows[-1].get("population"))

        def last(column: str, digits: int = 0, rows: list[dict] = rows) -> float | int | None:
            for row in reversed(rows):
                value = to_float(row.get(column))
                if value is not None:
                    return round(value, digits) if digits else round(value)
            return None

        countries.append(
            {
                "name": name,
                "code": rows[-1].get("code") or "",
                "population": int(population) if population else None,
                "cases_per_million": last("total_cases_per_million"),
                "deaths_per_million": last("total_deaths_per_million"),
                "vaccinated": last("people_vaccinated_per_hundred", 1),
                "fully_vaccinated": last("people_fully_vaccinated_per_hundred", 1),
                "boosters": last("total_boosters_per_hundred", 1),
                "excess_per_million": last("excess_mortality_cumulative_per_million"),
            }
        )

        weekly: dict[str, dict[str, float]] = {metric: {} for metric in COMPARE_METRICS}
        for row in rows:
            key = week_ending(date.fromisoformat(row["date"])).isoformat()
            for metric, column in COMPARE_METRICS.items():
                value = to_float(row.get(column))
                if value is not None:
                    weekly[metric][key] = round(value, 1)
        for metric in COMPARE_METRICS:
            series[metric][name] = [weekly[metric].get(k) for k in weeks_axis]

    return {"countries": countries, "weeks": weeks_axis, "series": series}


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


class ValidationError(Exception):
    pass


def validate(greece: dict, compare: dict) -> list[str]:
    """Raise on broken data, return a list of non-fatal data-quality warnings."""
    warnings = []
    series = greece["series"]
    weeks = series["weeks"]
    if len(weeks) < 100:
        raise ValidationError(f"only {len(weeks)} weeks of data for {COUNTRY}")
    lengths = {name: len(values) for name, values in series.items()}
    if len(set(lengths.values())) != 1:
        raise ValidationError(f"series lengths differ: {lengths}")
    if weeks != sorted(weeks) or len(set(weeks)) != len(weeks):
        raise ValidationError("weeks are not strictly increasing")

    summary = greece["summary"]
    if not summary["total_cases"] or summary["total_cases"] < 1_000_000:
        raise ValidationError(f"implausible total cases: {summary['total_cases']}")
    if not summary["total_deaths"] or summary["total_deaths"] < 10_000:
        raise ValidationError(f"implausible total deaths: {summary['total_deaths']}")

    totals = [v for v in series["total_cases"] if v is not None]
    drops = sum(1 for a, b in pairwise(totals) if b < a)
    if drops:
        warnings.append(f"cumulative cases decrease {drops} time(s) (source revisions)")
    negatives = sum(1 for v in series["cases"] if v is not None and v < 0)
    if negatives:
        warnings.append(f"{negatives} week(s) with negative case corrections")

    if not any(c["name"] == COUNTRY for c in compare["countries"]):
        raise ValidationError(f"{COUNTRY} missing from comparison data")
    return warnings


def staleness(latest_week: str, today: date | None = None, limit: int = 120) -> str | None:
    """Warn when the source has stopped publishing (kept out of the JSON files)."""
    age = ((today or date.today()) - date.fromisoformat(latest_week)).days
    return f"latest report is {age} days old" if age > limit else None


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def previous_timestamp(path: Path, payload: dict) -> str | None:
    """Return the old ``generated_at`` if ``path`` already holds the same data.

    Keeping the timestamp stable makes rebuilds idempotent, so the scheduled
    workflow only commits when the numbers actually changed.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            old = json.load(fh)
    except (OSError, ValueError):
        return None
    old_meta = old.pop("meta", {})
    new = {key: value for key, value in payload.items() if key != "meta"}
    same_meta = {k: v for k, v in old_meta.items() if k != "generated_at"} == {
        k: v for k, v in payload.get("meta", {}).items() if k != "generated_at"
    }
    return old_meta.get("generated_at") if old == new and same_meta else None


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")


def build(csv_path: Path, out_dir: Path = OUT_DIR, today: date | None = None) -> dict:
    by_country = read_rows(csv_path, set(COMPARE) | {COUNTRY})
    greece = build_greece(by_country[COUNTRY])
    compare = build_compare(by_country, greece["series"]["weeks"])
    warnings = validate(greece, compare)

    meta = {
        "source": "Our World in Data - COVID-19 dataset (WHO, ECDC & national sources)",
        "source_url": SOURCE_PAGE,
        "license": "CC BY 4.0",
        "latest_week": greece["summary"]["week"],
        "warnings": warnings,
    }
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for name, payload in (("greece.json", greece), ("compare.json", compare)):
        payload["meta"] = dict(meta)
        path = out_dir / name
        payload["meta"]["generated_at"] = previous_timestamp(path, payload) or now
        write_json(path, payload)

    stale = staleness(greece["summary"]["week"], today)
    return {
        "greece": greece,
        "compare": compare,
        "warnings": warnings + ([stale] if stale else []),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--csv", type=Path, help="use a local copy of the OWID compact CSV")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="output directory")
    args = parser.parse_args(argv)

    with tempfile.TemporaryDirectory() as tmp:
        csv_path = args.csv or download(SOURCE_URL, Path(tmp) / "compact.csv")
        try:
            result = build(csv_path, args.out)
        except (ValidationError, ValueError) as exc:
            print(f"data validation failed: {exc}", file=sys.stderr)
            return 1

    summary = result["greece"]["summary"]
    print(
        f"OK: week {summary['week']} · {summary['total_cases']:,} cases · "
        f"{summary['total_deaths']:,} deaths · {len(result['greece']['waves'])} waves"
    )
    for warning in result["warnings"]:
        print(f"warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
