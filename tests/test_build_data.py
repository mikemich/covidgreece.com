"""Unit tests for the data pipeline (run with ``pytest``)."""

import csv
import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_data as bd

COLUMNS = [
    "country",
    "date",
    "new_cases",
    "new_deaths",
    "total_cases",
    "total_deaths",
    "total_cases_per_million",
    "total_deaths_per_million",
    "people_vaccinated_per_hundred",
    "people_fully_vaccinated_per_hundred",
    "total_boosters_per_hundred",
    "population",
    "code",
]


def make_csv(path, weeks=160, countries=("Greece", "Italy", "Narnia")):
    """Write a synthetic OWID-style CSV with weekly reports on Mondays."""
    start = date(2020, 3, 2)  # a Monday
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS)
        writer.writeheader()
        for country in countries:
            total_cases = total_deaths = 0
            for day in range(weeks * 7):
                current = start + timedelta(days=day)
                is_report = current.weekday() == 0
                week = day // 7
                cases = int(10_000 * (1.5 + math.sin(week / 8))) if is_report else 0
                deaths = cases // 100
                total_cases += cases
                total_deaths += deaths
                writer.writerow(
                    {
                        "country": country,
                        "date": current.isoformat(),
                        "new_cases": cases,
                        "new_deaths": deaths,
                        "total_cases": total_cases,
                        "total_deaths": total_deaths,
                        "total_cases_per_million": total_cases / 10,
                        "total_deaths_per_million": total_deaths / 10,
                        "people_vaccinated_per_hundred": min(week, 80) if week > 40 else "",
                        "people_fully_vaccinated_per_hundred": "",
                        "total_boosters_per_hundred": "",
                        "population": 10_000_000,
                        "code": country[:3].upper(),
                    }
                )
    return path


# --- helpers ---------------------------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [("12", 12.0), ("2.2467978e+07", 22467978.0), ("", None), (None, None), ("abc", None)],
)
def test_to_float(value, expected):
    assert bd.to_float(value) == expected


def test_week_ending_groups_sunday_and_monday_reports():
    sunday = date(2022, 1, 9)
    monday_after = date(2022, 1, 10)
    assert bd.week_ending(sunday) == sunday
    assert bd.week_ending(monday_after) == sunday
    assert bd.week_ending(date(2022, 1, 5)) == sunday


def test_weekly_series_sums_counts_and_keeps_last_rates():
    rows = [
        {"date": "2022-01-04", "new_cases": "5", "people_vaccinated_per_hundred": "60"},
        {"date": "2022-01-06", "new_cases": "7", "people_vaccinated_per_hundred": "61"},
        {"date": "2022-01-07", "new_cases": "", "people_vaccinated_per_hundred": ""},
    ]
    weeks = bd.weekly_series(rows)
    assert list(weeks) == ["2022-01-09"]
    assert weeks["2022-01-09"]["cases"] == 12
    assert weeks["2022-01-09"]["vaccinated"] == 61


def test_trim_weeks_drops_unreported_tail():
    weeks = bd.OrderedDict()
    for key, total, cases in [("a", 0, 0), ("b", 5, 5), ("c", 9, 4), ("d", 9, 0)]:
        weeks[key] = {name: None for name in bd.WEEKLY_FIELDS}
        weeks[key].update(total_cases=total, cases=cases, deaths=0)
    assert list(bd.trim_weeks(weeks)) == ["b", "c"]


def test_pct_change():
    assert bd.pct_change(150, 100) == 50.0
    assert bd.pct_change(50, 100) == -50.0
    assert bd.pct_change(10, 0) is None
    assert bd.pct_change(None, 10) is None


# --- wave detection --------------------------------------------------------


def test_detect_waves_finds_small_and_large_peaks():
    # a small early wave next to a huge one: both must be detected
    series = [1, 10, 2000, 100, 20, 50, 500, 5000, 50000, 3000, 400, 300]
    assert bd.detect_waves(series) == [2, 8]


def test_detect_waves_ignores_noise():
    series = [100, 110, 95, 105, 98, 102, 100]
    assert bd.detect_waves(series) == []


def test_detect_waves_handles_plateaus_and_empty_input():
    assert bd.detect_waves([]) == []
    assert bd.detect_waves([0, 0, 0]) == []
    assert bd.detect_waves([1, 50, 50, 1]) == [1]


def test_detect_waves_respects_floor():
    series = [1, 30, 1, 1, 10_000, 1]
    assert bd.detect_waves(series, floor=0.01) == [4]


# --- end-to-end ------------------------------------------------------------


def test_build_end_to_end(tmp_path):
    csv_path = make_csv(tmp_path / "compact.csv")
    out = tmp_path / "out"
    result = bd.build(csv_path, out, today=date(2023, 4, 1))

    greece = json.loads((out / "greece.json").read_text(encoding="utf-8"))
    compare = json.loads((out / "compare.json").read_text(encoding="utf-8"))

    series = greece["series"]
    assert len(series["weeks"]) == 160
    assert len({len(v) for v in series.values()}) == 1
    # Monday reports belong to the week that ended the day before
    assert series["weeks"][0] == "2020-03-01"
    assert greece["summary"]["total_cases"] == sum(series["cases"])
    assert greece["summary"]["case_fatality"] == pytest.approx(
        greece["summary"]["total_deaths"] / greece["summary"]["total_cases"] * 100, abs=0.01
    )
    assert greece["waves"], "the synthetic sine wave should produce waves"
    assert greece["meta"]["license"] == "CC BY 4.0"

    names = [c["name"] for c in compare["countries"]]
    assert names == ["Greece", "Italy"]  # unknown countries are ignored
    assert set(compare["series"]) == set(bd.COMPARE_METRICS)
    for metric, by_country in compare["series"].items():
        assert set(by_country) == {"Greece", "Italy"}, metric
        assert all(len(values) == len(compare["weeks"]) for values in by_country.values())
    assert compare["weeks"] == series["weeks"]
    assert compare["series"]["deaths_per_million"]["Greece"][-1] is not None
    assert result["warnings"] == []


def test_validate_rejects_short_series(tmp_path):
    csv_path = make_csv(tmp_path / "compact.csv", weeks=20)
    with pytest.raises(bd.ValidationError):
        bd.build(csv_path, tmp_path / "out")


def test_rebuild_is_idempotent(tmp_path):
    csv_path = make_csv(tmp_path / "compact.csv")
    out = tmp_path / "out"
    bd.build(csv_path, out)
    first = (out / "greece.json").read_bytes()
    bd.build(csv_path, out)
    assert (out / "greece.json").read_bytes() == first


def test_validate_warns_on_stale_data(tmp_path):
    csv_path = make_csv(tmp_path / "compact.csv")
    result = bd.build(csv_path, tmp_path / "out", today=date(2030, 1, 1))
    assert any("days old" in w for w in result["warnings"])
