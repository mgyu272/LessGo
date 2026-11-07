"""Request three proposed ORS walking routes for review; never stores the API key."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from src.routing import fetch_walking_route_points

OUT = Path(__file__).resolve().parent / "raw"


def point(name: str, lon: float, lat: float) -> dict:
    return {"name": name, "longitude": lon, "latitude": lat}


ROUTES = {
    "simujang-10km-high-new-start": [
        point("심우장 10km Low와 동일한 출발점", 127.0503144, 37.5536277),
        point("기존 High 경유점 1", 127.0355672, 37.5897163),
        point("기존 High 경유점 2", 127.0056556, 37.5887132),
        point("심우장", 126.9916662, 37.5936268),
    ],
    "simujang-5km-low-seongbukcheon": [
        point("성신여대입구역 1번 출구", 127.0168732, 37.5926517),
        point("성북천 하류 접근 후보", 127.0224687, 37.58227718),
        point("성북천 분수광장 인근", 127.00666, 37.58819),
        point("심우장", 126.9916662, 37.5936268),
    ],
    "simujang-5km-low-seongbukcheon-v2": [
        point("성신여대입구역 1번 출구", 127.0168732, 37.5926517),
        point("성북천 산책로 접근 후보", 127.019, 37.5845),
        point("성북천 분수광장 인근", 127.00666, 37.58819),
        point("심우장", 126.9916662, 37.5936268),
    ],
    "simujang-5km-low-seongbukcheon-v3": [
        point("성신여대입구역 1번 출구", 127.0168732, 37.5926517),
        point("성북천 산책로 접근 후보", 127.020, 37.5837),
        point("성북천 분수광장 인근", 127.00666, 37.58819),
        point("심우장", 126.9916662, 37.5936268),
    ],
    "uiryeong-5km-low-imun-park": [
        point("이문수변공원 이화교 서편 접근 후보", 127.0718293, 37.6023066),
        point("중랑천 북쪽 수변길 후보", 127.07309, 37.615),
        point("의릉", 127.058716558469, 37.6044099656019),
    ],
    "uiryeong-5km-low-imun-park-v2": [
        point("이문수변공원 이화교 서편 접근 후보", 127.0718293, 37.6023066),
        point("중랑천 북쪽 수변길 후보", 127.07309, 37.618),
        point("의릉", 127.058716558469, 37.6044099656019),
    ],
    "uiryeong-5km-low-imun-park-v3": [
        point("이문수변공원 이화교 서편 접근 후보", 127.0718293, 37.6023066),
        point("중랑천 북쪽 수변길 후보", 127.07309, 37.620),
        point("의릉", 127.058716558469, 37.6044099656019),
    ],
    "uiryeong-5km-low-imun-park-v4": [
        point("이문수변공원 이화교 서편 접근 후보", 127.0718293, 37.6023066),
        point("중랑천 북쪽 수변길 후보", 127.0705, 37.610),
        point("의릉 북서쪽 보행 연결 후보", 127.052, 37.614),
        point("의릉", 127.058716558469, 37.6044099656019),
    ],
}
for source_id in (
    "simujang-10km-high-new-start",
    "simujang-5km-low-seongbukcheon-v3",
    "uiryeong-5km-low-imun-park-v3",
):
    ROUTES[source_id + "-no-steps"] = ROUTES[source_id]


def main() -> None:
    key = os.environ.get("ORS_API_KEY", "").strip()
    if not key:
        raise SystemExit("ORS_API_KEY is required in the server environment")
    OUT.mkdir(parents=True, exist_ok=True)
    for route_id, stops in ROUTES.items():
        path = OUT / f"{route_id}.json"
        if path.exists():
            print(f"{route_id}: cached; no request")
            continue
        try:
            route = fetch_walking_route_points(
                stops, key, route_id, max_retries=0,
                avoid_steps=route_id.endswith("-no-steps"),
            )
        except Exception as exc:
            print(f"{route_id}: {type(exc).__name__}: {exc}")
            continue
        path.write_text(json.dumps(route, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        summary = route["summary"]
        print(f"{route_id}: {summary['distance_km']:.3f} km, ascent {summary.get('ascent_m')} m, ORS calls {route.get('ors_request_attempts')}")


if __name__ == "__main__":
    main()
