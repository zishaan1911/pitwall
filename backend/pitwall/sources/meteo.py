"""Open-Meteo: hourly reanalysis weather at the circuit coordinates.

The trackside station in the F1 feed reports temperatures, humidity, wind and a
rain flag. Open-Meteo adds what drives those numbers: cloud cover and solar
radiation (track temperature), precipitation amounts and gusts.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from .http import get_json

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"  # serves the last ~3 months too
HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "cloud_cover",
    "shortwave_radiation",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
]


def hourly(lat: float, lon: float, start_utc: datetime, end_utc: datetime) -> dict:
    """Hourly series covering [start - 1h, end + 1h], timestamps in UTC."""
    first: date = (start_utc - timedelta(hours=1)).date()
    last: date = (end_utc + timedelta(hours=1)).date()
    # The archive lags real time by about five days.
    url = ARCHIVE if (datetime.now(UTC).date() - last).days > 6 else FORECAST
    data = get_json(url, params={
        "latitude": lat,
        "longitude": lon,
        "start_date": first.isoformat(),
        "end_date": last.isoformat(),
        "hourly": ",".join(HOURLY),
        "timezone": "UTC",
        "wind_speed_unit": "ms",
    })
    h = data["hourly"]
    lo = (start_utc - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    hi = end_utc + timedelta(hours=1)
    keep = [i for i, t in enumerate(h["time"]) if lo <= datetime.fromisoformat(t) <= hi]
    out = {"time": [h["time"][i] + "Z" for i in keep]}
    for key in HOURLY:
        out[key] = [h[key][i] for i in keep]
    out["source"] = "archive" if url == ARCHIVE else "forecast-api (recent past)"
    return out
