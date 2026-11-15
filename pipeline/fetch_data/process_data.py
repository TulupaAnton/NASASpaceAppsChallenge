"""Entrypoint for cleaning NASA POWER data and generating Finland Data Center metrics/ranking files."""

import argparse
import sys
from pathlib import Path

_THIS_DIR = str(Path(__file__).resolve().parent)
_ROOT_DIR = str(Path(__file__).resolve().parent.parent)
if _THIS_DIR in sys.path:
    sys.path.remove(_THIS_DIR)
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)

from fetch_data.src.clean import DEFAULT_CLEAN_DIR, DEFAULT_RAW_DIR, clean_all


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Clean NASA POWER raw JSONs and compute Data Center suitability metrics for Finland."
    )
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR, help="Input directory with raw JSONs")
    parser.add_argument("--clean-dir", type=Path, default=DEFAULT_CLEAN_DIR, help="Output directory for CSV/JSON/MD files")
    args = parser.parse_args()

    ranking = clean_all(raw_dir=args.raw_dir, clean_dir=args.clean_dir)
    if not ranking.empty:
        print("\nTop 5 regions for Data Centers in Finland:")
        cols = ["rank", "name_uk", "datacenter_suitability_score", "cooling_score", "renewables_score", "risk_safety_score", "suitability_tier"]
        print(ranking[cols].head(5).to_string(index=False))


if __name__ == "__main__":
    main()
