"""COVID-19 dashboard for Greece.

Originally built around api.covid19api.com, which shut down in 2023.
This version uses disease.sh for live data and falls back to a bundled
snapshot (static/data/*.json) whenever the API is unreachable, so the
page always renders.
"""

import json
import os
import time

import requests
from flask import Flask, render_template

app = Flask(__name__)

SUMMARY_URL = "https://disease.sh/v3/covid-19/countries/greece"
HISTORY_URL = "https://disease.sh/v3/covid-19/historical/greece?lastdays=all"
REQUEST_TIMEOUT = 10  # seconds
CACHE_TTL = 60 * 60  # re-fetch live data at most once an hour

DATA_DIR = os.path.join(app.static_folder, "data")
FALLBACK_SUMMARY = os.path.join(DATA_DIR, "summary.json")
FALLBACK_HISTORY = os.path.join(DATA_DIR, "history.json")

_cache = {}  # url -> (timestamp, parsed_json)


def _load_snapshot(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def fetch_json(url, fallback_path):
    """Return live JSON for ``url``, using a cached or bundled copy on failure."""
    cached = _cache.get(url)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return cached[1]

    try:
        response = requests.get(url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        _cache[url] = (time.time(), data)
        return data
    except (requests.RequestException, ValueError):
        # API down or returned junk: serve the snapshot shipped with the app.
        return _load_snapshot(fallback_path)


def build_context():
    """Assemble the template context from the summary + historical endpoints."""
    summary = fetch_json(SUMMARY_URL, FALLBACK_SUMMARY)
    history = fetch_json(HISTORY_URL, FALLBACK_HISTORY)

    # historical endpoint may nest data under "timeline" (single province).
    timeline = history.get("timeline", history)
    cases = timeline.get("cases", {})
    deaths = timeline.get("deaths", {})
    recovered = timeline.get("recovered", {})

    dates = list(cases.keys())  # already chronological from the API
    recovered_series = [recovered.get(day, 0) for day in dates]

    # Recoveries stopped being tracked globally in 2021, so the live summary
    # reports 0. Fall back to the peak cumulative figure from the timeline.
    total_recovered = summary.get("recovered", 0) or (
        max(recovered_series) if recovered_series else 0
    )

    greekcases = {
        "country": summary.get("country", "Greece"),
        "TotalConfirmed": summary.get("cases", 0),
        "TotalDeaths": summary.get("deaths", 0),
        "TotalRecovered": total_recovered,
        "Newcases": summary.get("todayCases", 0),
    }

    return {
        "greekcases": greekcases,
        "dates": dates,
        "cases_series": [cases.get(day, 0) for day in dates],
        "deaths_series": [deaths.get(day, 0) for day in dates],
        "recovered_series": recovered_series,
        "updated": summary.get("updated"),
    }


@app.route("/")
def index():
    return render_template("index.html", **build_context())


if __name__ == "__main__":
    app.run(debug=True)
