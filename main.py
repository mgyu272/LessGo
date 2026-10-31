"""Generate the first Less GO walking route: Hansung Univ. Station to Simujang."""

import json
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from src.osm_data import OSMDataError
from src.recommender import DEFAULTS_PATH, MAX_ORS_CALLS, recommend_courses
from src.routing import RouteError, fetch_walking_route, save_route_files


ROOT = Path(__file__).resolve().parent


def main() -> int:
    defaults = json.loads((ROOT / DEFAULTS_PATH).read_text(encoding="utf-8"))
    destinations_data = json.loads((ROOT / "data" / "destinations.json").read_text(encoding="utf-8"))
    destinations = {item["id"]: item for item in destinations_data.get("destinations", [])}
    if not destinations:
        raise ValueError("data/destinations.json에 목적지를 하나 이상 등록하세요.")
    parser = argparse.ArgumentParser(description="Less GO ORS route tools")
    parser.add_argument("--recommend", "--recommend-3km", dest="recommend", action="store_true", help="입력 목적지와 목표 거리로 러닝 코스 자동 탐색")
    parser.add_argument("--max-ors-calls", type=int, default=MAX_ORS_CALLS, help=f"탐색 중 최대 ORS 호출 수 (기본값: {MAX_ORS_CALLS})")
    parser.add_argument("--search-radius-m", type=float,
                        help="선택 OSM 검색 반경(m). 검증된 기존 캐시 재사용 시 기본 반경보다 작게 지정할 수 있음")
    parser.add_argument("--destination-id", choices=sorted(destinations), help="data/destinations.json에 등록된 목적지 ID")
    parser.add_argument("--destination-name", help="목적지 이름 (위도·경도와 함께 지정)")
    parser.add_argument("--destination-latitude", type=float, help="목적지 위도")
    parser.add_argument("--destination-longitude", type=float, help="목적지 경도")
    parser.add_argument("--target-distance-km", type=float, help="목표 코스 거리(km)")
    parser.add_argument("--slope-preference", choices=("low", "any"), help="경사 선호: low=완만한 경로 우선, any=거리 위주")
    parser.add_argument("--running-focused", action="store_true",
                        help="지하철역 우선도를 제거하고 OSM 러닝 친화 보행망 중심 탐색 결과를 기존 파일과 분리 저장")
    parser.add_argument("--access-focused", action="store_true",
                        help="OSM 보행 그래프로 검증된 지하철 출구 400m 이내 러닝 시작점을 이용해 별도 결과 저장")
    args = parser.parse_args()
    default_destination = destinations.get(defaults.get("default_destination_id"))
    if default_destination is None:
        parser.error("route_defaults.json의 기본 목적지 ID가 destinations.json에 없습니다.")
    provided = [args.destination_name, args.destination_latitude, args.destination_longitude]
    if any(value is not None for value in provided) and not all(value is not None for value in provided):
        parser.error("목적지를 바꿀 때는 --destination-name, --destination-latitude, --destination-longitude를 모두 지정하세요.")
    selected_destination = destinations.get(args.destination_id or defaults["default_destination_id"])
    if args.destination_id and any(value is not None for value in provided):
        parser.error("--destination-id와 직접 목적지 좌표 입력은 동시에 사용할 수 없습니다.")
    destination = (dict(selected_destination) if not any(value is not None for value in provided) else {
        "id": args.destination_name,
        "name": args.destination_name,
        "latitude": args.destination_latitude,
        "longitude": args.destination_longitude,
        "entrance_verified": False,
    })
    target_distance_km = args.target_distance_km if args.target_distance_km is not None else defaults["target_distance_km"]
    slope_preference = args.slope_preference or defaults.get("slope_preference", "low")

    load_dotenv(ROOT / ".env")
    api_key = os.getenv("ORS_API_KEY", "").strip()
    if not api_key:
        print("ORS_API_KEY가 없습니다. .env.example을 .env로 복사하고 API 키를 입력하세요.", file=sys.stderr)
        return 2
    if not api_key.isascii():
        print("ORS_API_KEY 형식 오류: .env의 값에 한글 등 ASCII가 아닌 문자가 있습니다. 발급받은 키 문자열만 입력하세요.", file=sys.stderr)
        return 2

    if args.recommend:
        print(f"{destination['name']} 목적지 {target_distance_km:g}km 편도 코스를 탐색합니다...")
        try:
            result = recommend_courses(ROOT, api_key, destination, target_distance_km,
                                       max_ors_calls=args.max_ors_calls, slope_preference=slope_preference,
                                       running_focused=args.running_focused,
                                       access_focused=args.access_focused,
                                       search_radius_override_m=args.search_radius_m)
        except (RouteError, OSMDataError, ValueError, OSError) as exc:
            print(f"코스 탐색 실패: {exc}", file=sys.stderr)
            return 1
        search = result["search"]
        print(f"ORS 신규 호출: {search['ors_api_calls']}회, 캐시 재사용: {search['ors_cache_hits']}회")
        print(f"후보 경로 계산: {search['routes_evaluated']}개")
        if "slope_assessment" not in result:
            print(f"탐색 단계: {search.get('failure_stage', 'unknown')}", file=sys.stderr)
            print(f"탐색 실패 사유: {search.get('route_failure_reason') or '원인을 확인할 수 없습니다.'}", file=sys.stderr)
            print(f"요약 파일: {ROOT / result['summary_file']}", file=sys.stderr)
            return 1
        print(result["slope_assessment"]["message"])
        if not result["recommendations"]:
            print(f"조건에 맞는 경로를 계산하지 못했습니다: {search.get('route_failure_reason') or '거리 조건을 만족하는 ORS 후보가 없습니다.'}", file=sys.stderr)
            print(f"요약 파일: {result['summary_file']}")
            return 1
        if not any(item["within_tolerance"] for item in result["recommendations"]):
            print("허용 오차 내 코스가 없어 가장 가까운 경로를 표시합니다. 각 거리 오차를 확인하세요.")
        elif len(result["recommendations"]) < 3:
            print(f"현재 후보 중 거리 허용 범위(±{result['distance_tolerance_km']:.2f}km)에 든 추천 코스는 {len(result['recommendations'])}개입니다.")
        for item in result["recommendations"]:
            stops = [item["start"]["name"]]
            stops.extend(waypoint["name"] for waypoint in item["waypoints"])
            stops.append(item["destination"]["name"])
            status = "허용 오차 내" if item["within_tolerance"] else "목표 오차 초과"
            ascent_text = f"{item['ascent_m']:.1f}m" if item["ascent_m"] is not None else "정보 없음"
            print(f"\n추천 {item['rank']} ({status}): {' → '.join(stops)}")
            print(f"  실제 거리 {item['distance_km']:.3f}km / 목표 차이 {item['distance_error_m']:.0f}m")
            descent_text = f"{item['descent_m']:.1f}m" if item["descent_m"] is not None else "정보 없음"
            steep = item["steep_segment_ratio"]
            steep_text = f"{steep * 100:.1f}%" if steep is not None else "정보 없음"
            print(f"  예상 시간 {item['duration_minutes']:.1f}분 / 상승 {ascent_text} / 하강 {descent_text}")
            slope_score = f"{item['slope_score']:.1f}" if item["slope_score"] is not None else "데이터 없음"
            print(f"  점수 {item['total_score']:.1f} / 거리 {item['distance_score']:.1f} / 경사 {slope_score} / 급경사 구간 {steep_text}")
            print(f"  OSM 매핑 횡단: 첫 300m {item['mapped_crossings_first_300m']}회, 전체 {item['mapped_crossings_total']}회 (완전한 실측 아님)")
            print(f"  반복 구간 {item['repeated_network_edge_share'] if item['repeated_network_edge_share'] is not None else '데이터 없음'} / U턴 추정 {item['u_turn_count_estimate']}회 / 급회전 추정 {item['sharp_turn_count_estimate']}회")
            fitness = item.get("running_fitness")
            if fitness:
                print(f"  러닝 적합도 {fitness['score']} / 친화 구간 {fitness['running_friendly_share_of_route']} / 차량분리 대리지표 {fitness['vehicle_separation_proxy_share_of_route']} / 연속구간 추정 {fitness['estimated_longest_continuous_run_m']}m")
                print(f"  OSM 미확인·미매칭 {fitness['unknown_or_unmatched_share_of_route']} / 불확실 cycleway {fitness['uncertain_cycleway_share_of_route']}")
            print(f"  추천 이유: {item['recommendation_reason']}")
            print(f"  지도: {ROOT / item['files']['html']}")
        print(f"전체 추천 요약: {ROOT / result['summary_file']}")
        print("출입구와 실제 보행 가능 여부는 별도 검증이 필요합니다.")
        return 0

    locations = json.loads((ROOT / "data" / "locations.json").read_text(encoding="utf-8"))
    start = locations["start"]
    destination = locations["destination"]
    print("ORS foot-walking 경로를 요청합니다...")
    try:
        route = fetch_walking_route(start, destination, api_key)
        saved = save_route_files(route, start, destination, ROOT / "outputs")
    except RouteError as exc:
        print(f"경로 요청 실패: {exc}", file=sys.stderr)
        return 1

    summary = route["summary"]
    print(f"거리: {summary['distance_km']:.2f} km")
    print(f"예상 소요 시간: {summary['duration_minutes']:.0f}분")
    elevation_label = "(좌표 기반 추정)" if summary.get("elevation_is_estimate") else "(ORS 응답)"
    ascent = summary.get("ascent_m")
    descent = summary.get("descent_m")
    print(f"총상승고도{elevation_label}: {ascent:.1f} m" if ascent is not None else "총상승고도: 정보 없음")
    print(f"총하강고도{elevation_label}: {descent:.1f} m" if descent is not None else "총하강고도: 정보 없음")
    print("좌표 정확성 안내: 출발·도착 좌표는 사용자 제공값이며 실제 출입구와 일치하는지 검증되지 않았습니다.")
    print("생성 파일:")
    for path in saved:
        print(f"- {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
