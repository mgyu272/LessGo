"""Export saved Less GO routes to the run (성북 런트립) React app's public/data files."""

import argparse
import json
import sys
from pathlib import Path

from src.runtrip_export import DEFAULT_INDEX, build_runtrip_data, merge_into_run


ROOT = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description="Less GO 경로를 run 앱 데이터(courses.geojson, spots.json)로 변환")
    parser.add_argument("--run-data-dir", type=Path,
                        help="run 앱의 public/data 폴더. 지정하면 기존 파일에 병합하고, 없으면 outputs/runtrip에 새로 저장")
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX, help=f"대표 경로 인덱스 (기본값: {DEFAULT_INDEX})")
    args = parser.parse_args()

    courses, spots = build_runtrip_data(ROOT, args.index)
    if args.run_data_dir:
        if not (args.run_data_dir / "courses.geojson").is_file() or not (args.run_data_dir / "spots.json").is_file():
            print("run 앱의 public/data 폴더(courses.geojson, spots.json 포함)를 지정하세요.", file=sys.stderr)
            return 1
        counts = merge_into_run(args.run_data_dir, courses, spots)
        print(f"병합 완료: 코스 {counts['courses_added']}개 추가(기존 {counts['courses_kept']}개 유지), "
              f"스팟 {counts['spots_added']}개 추가(기존 {counts['spots_kept']}개 유지)")
        return 0

    out_dir = ROOT / "outputs" / "runtrip"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "courses.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": courses},
                                                        ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "spots.json").write_text(json.dumps({"spots": spots}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"저장 완료: {out_dir} (코스 {len(courses)}개, 스팟 {len(spots)}개)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
