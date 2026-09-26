"""Pre-build bundles for the static site.

    python -m pitwall.export --out ../frontend/public/data --season 2025 --season 2026

Sessions that already have a bundle are skipped unless --force is given, so a
scheduled run only builds the races that happened since the last one.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from . import catalog, config
from .bundle import build
from .sources import f1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--out", type=Path, default=config.DATA_DIR)
    ap.add_argument("--season", type=int, action="append", help="repeatable; default: last two")
    ap.add_argument("--round", type=int, action="append", help="limit to these rounds")
    ap.add_argument("--kinds", default="R,S", help="session kinds, e.g. R or R,S")
    ap.add_argument("--force", action="store_true", help="rebuild existing bundles")
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
                build(year, round_, kind, out)
                built += 1
                print(f"built   {label}  ({time.monotonic() - t:.0f}s)", flush=True)
            except Exception as exc:  # noqa: BLE001 - keep going, report at the end
                retry.append((year, round_, kind, name))
                print(f"failed  {label} (pass {attempt}): {type(exc).__name__}: {exc}", flush=True)
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


if __name__ == "__main__":
    sys.exit(main())
