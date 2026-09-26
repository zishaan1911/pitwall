"""Pre-build bundles for the static site.

    python -m pitwall.export --season 2025 --season 2026     # writes ../data

Sessions that already have a bundle are skipped unless --force is given, so a
run after a race weekend only builds the new sessions. Publish the result
with `python -m pitwall.publish`.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

from fastf1.req import RateLimitExceededError

from . import catalog, config
from .bundle import build
from .sources import f1

RATE_LIMIT_WAIT = 15 * 60  # FastF1 allows 500 requests in any rolling hour


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--out", type=Path, default=config.DATA_DIR)
    ap.add_argument("--season", type=int, action="append", help="repeatable; default: last two")
    ap.add_argument("--round", type=int, action="append", help="limit to these rounds")
    ap.add_argument("--kinds", default="R,S", help="session kinds, e.g. R or R,S")
    ap.add_argument("--force", action="store_true", help="rebuild existing bundles")
    ap.add_argument("--keep-cache", action="store_true",
                    help="keep FastF1's parsed session cache (~100 MB per session)")
    args = ap.parse_args(argv)

    seasons = args.season or config.SEASONS
    kinds = set(args.kinds.split(","))
    out: Path = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    f1.enable_cache(config.CACHE_DIR)

    todo = []
    for year in seasons:
        for ev in f1.schedule(year):
            if args.round and ev["round"] not in args.round:
                continue
            todo += [(year, ev["round"], k, ev["name"]) for k in ev["sessions"] if k in kinds]

    built, skipped = 0, 0
    pending = []
    for year, round_, kind, name in todo:
        if catalog.built(out, year, round_, kind) and not args.force:
            skipped += 1
        else:
            pending.append((year, round_, kind, name))

    # Upstream archives fail transiently; give failures a second pass at the end.
    for attempt in (1, 2):
        retry = []
        for year, round_, kind, name in pending:
            label = f"{year} R{round_:02d} {kind} {name}"
            t = time.monotonic()
            try:
                _build_waiting_out_rate_limit(year, round_, kind, out, label)
                built += 1
                print(f"built   {label}  ({time.monotonic() - t:.0f}s)", flush=True)
            except Exception as exc:  # noqa: BLE001 - keep going, report at the end
                retry.append((year, round_, kind, name))
                print(f"failed  {label} (pass {attempt}): {type(exc).__name__}: {exc}", flush=True)
            if not args.keep_cache:
                _prune_cache(config.CACHE_DIR)
        pending = retry
        if not pending:
            break
        if attempt == 1:
            time.sleep(60)
    failed = [f"{y} R{r:02d} {k} {n}" for y, r, k, n in pending]

    catalog.write_index(out, seasons)
    print(f"\n{built} built, {skipped} already present, {len(failed)} failed")
    for label in failed:
        print(f"  - {label}")
    return 1 if failed and not (built or skipped) else 0


def _prune_cache(cache: Path) -> None:
    """Drop FastF1's parsed session data once a bundle is written.

    Those pickles take ~100 MB per session and are only useful for rebuilding
    the same session. The raw HTTP cache (much smaller) is kept.
    """
    for year_dir in cache.iterdir():
        if year_dir.is_dir() and year_dir.name.isdigit():
            shutil.rmtree(year_dir, ignore_errors=True)


def _build_waiting_out_rate_limit(year: int, round_: int, kind: str, out: Path, label: str) -> None:
    for _ in range(8):
        try:
            build(year, round_, kind, out)
            return
        except RateLimitExceededError:
            print(f"waiting {label}: FastF1 request limit reached, retrying in "
                  f"{RATE_LIMIT_WAIT // 60} min", flush=True)
            time.sleep(RATE_LIMIT_WAIT)
    build(year, round_, kind, out)


if __name__ == "__main__":
    sys.exit(main())
