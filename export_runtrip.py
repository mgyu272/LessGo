"""Export saved Less GO routes to the app/ (성북 런트립) React app's public/data files."""

import argparse
import sys
from pathlib import Path

from src.runtrip_export import DEFAULT_INDEX, build_runtrip_data, merge_into_run


ROOT = Path(__file__).resolve().parent
APP_DATA_DIR = ROOT / "app" / "public" / "data"


def main() -> int:
    parser = argparse.ArgumentParser(description="Less GO 경로를 앱 데이터(courses.geojson, spots.json)로 변환")
    parser.add_argument("--run-data-dir", type=Path, default=APP_DATA_DIR,
                        help=f"앱의 public/data 폴더 (기본값: {APP_DATA_DIR.relative_to(ROOT)}). 기존 파일에 병합")
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX, help=f"대표 경로 인덱스 (기본값: {DEFAULT_INDEX})")
    args = parser.parse_args()

    if not (args.run_data_dir / "courses.geojson").is_file() or not (args.run_data_dir / "spots.json").is_file():
        print("앱의 public/data 폴더(courses.geojson, spots.json 포함)를 지정하세요.", file=sys.stderr)
        return 1
    courses, spots = build_runtrip_data(ROOT, args.index)
    counts = merge_into_run(args.run_data_dir, courses, spots)
    print(f"병합 완료: 코스 {counts['courses_added']}개 추가(기존 {counts['courses_kept']}개 유지), "
          f"스팟 {counts['spots_added']}개 추가(기존 {counts['spots_kept']}개 유지)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
