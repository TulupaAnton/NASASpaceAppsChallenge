"""Entrypoint for downloading NASA POWER data for all 19 regions of Finland (1984-2024)."""

import argparse
import sys
from pathlib import Path

_THIS_DIR = str(Path(__file__).resolve().parent)
_ROOT_DIR = str(Path(__file__).resolve().parent.parent)
if _THIS_DIR in sys.path:
    sys.path.remove(_THIS_DIR)
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)

from fetch_data.src.collect import (
    DATACENTER_PARAMETERS,
    DEFAULT_RAW_DIR,
    FINLAND_REGIONS,
    collect_all,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch NASA POWER monthly metrics (1984-2024) for 19 Finnish regions."
    )
    parser.add_argument("--start", type=int, default=1984, help="Start year (default: 1984)")
    parser.add_argument("--end", type=int, default=2024, help="End year (default: 2024)")
    parser.add_argument("--overwrite", action="store_true", help="Re-download existing files")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR, help="Output directory for raw JSONs")
    args = parser.parse_args()

    collect_all(
        locations=FINLAND_REGIONS,
        parameters=DATACENTER_PARAMETERS,
        start_year=args.start,
        end_year=args.end,
        raw_dir=args.raw_dir,
        overwrite=args.overwrite,
    )


if __name__ == "__main__":
    main()
