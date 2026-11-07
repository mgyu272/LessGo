"""Apply reviewed ORS routes to three app slots; requires a local cached OSM network."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from src import recommender, running_metrics

HERE = Path(__file__).resolve().parent
APP = ROOT / "app/public/data/lessgo"
CHOICES = (
    ("simujang", "10km", "high", "simujang-10km-high-new-start-no-steps"),
    ("simujang", "5km", "low", "simujang-5km-low-seongbukcheon-v3-no-steps"),
    ("uiryeong", "5km", "low", "uiryeong-5km-low-imun-park-v3-no-steps"),
)
GRADE_CFG = {
    "profile_sample_m": 20.0, "smoothing_window_m": 60.0,
    "sustained_window_m": 100.0, "elevation_gap_warning_m": 100.0,
    "uphill_thresholds_percent": [8.0, 10.0],
}


def burden(g: dict, ascent: float, distance: float, target: int) -> float:
    u = g["uphill_grade_metrics"]
    t = u["thresholds"]
    components = (
        (min(1, t["8_percent"]["share"] / .2), .25),
        (min(1, t["10_percent"]["share"] / .15), .25),
        (min(1, u["max_sustained_uphill_grade_percent"] / 18), .20),
        (min(1, t["8_percent"]["longest_continuous_m"] / (target * 100)), .20),
        (min(1, ascent / max(distance, .1) / 100), .10),
    )
    return round(100 * sum(value * weight for value, weight in components), 2)


def distance_m(a: list, b: list) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12742017.6 * math.atan2(math.sqrt(h), math.sqrt(max(0, 1-h)))


def main(cache_path: str) -> None:
    osm = json.loads(Path(cache_path).read_text(encoding="utf-8"))
    index_path, geo_path = APP / "routes.json", APP / "routes.geojson"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    features = {feature["id"]: feature for feature in geo["features"]}
    report = []
    for place, distance, mode, name in CHOICES:
        source = HERE / "raw" / f"{name}.json"
        route = json.loads(source.read_text(encoding="utf-8"))
        coords = route["geometry"]["coordinates"]
        target = int(distance[:-2])
        grade = recommender._grade_metrics(route, 6.0, GRADE_CFG)
        uphill = grade["uphill_grade_metrics"]
        thresholds = uphill["thresholds"]
        quality = grade["elevation_data_quality"]
        running = running_metrics.evaluate_route_geometry(route, osm)
        net, fitness, turns = running["network"], running["running_fitness"], running["turns"]
        summary = route["summary"]
        score = burden(grade, summary["ascent_m"], summary["distance_km"], target)
        assert abs(summary["distance_km"] - target) <= .3
        assert uphill["max_sustained_uphill_grade_percent"] <= 18
        assert net["explicit_access_restricted_m"] == 0
        assert net["steps_share_of_route"] == 0
        assert net["repeated_mapped_network_edge_share"] <= .15
        assert turns["u_turn_count_estimate"] <= 3
        old = index["destinations"][place]["distances"][distance]["routes"][mode]
        pair = index["destinations"][place]["distances"][distance]["routes"]
        other = pair["low" if mode == "high" else "high"]
        if mode == "low":
            assert score <= other["slope"]["grade_burden_score"]
            assert thresholds["8_percent"]["share"] <= other["slope"]["uphill_8_share"]
            assert thresholds["10_percent"]["share"] <= other["slope"]["uphill_10_share"]
        else:
            assert other["slope"]["grade_burden_score"] <= score
            assert other["slope"]["uphill_8_share"] <= thresholds["8_percent"]["share"]
            assert other["slope"]["uphill_10_share"] <= thresholds["10_percent"]["share"]
        slot = copy.deepcopy(old)
        slot["route_id"] = route["route_id"]
        slot["status"] = "review_required"
        slot["formal_recommendation"] = False
        slot["review_reason"] = "새 ORS 경로; 수변길 실제 접근·현장 안전과 고도 신뢰도 확인 필요"
        slot["notes"] = ["실제 ORS foot-walking 응답; steps 회피 옵션 적용", slot["review_reason"]]
        slot["directions"] = route["steps"]
        slot["ors_request_attempts"] = route["ors_request_attempts"]
        slot["summary"] = {key: summary.get(key) for key in ("distance_km", "duration_seconds", "duration_minutes", "ascent_m", "descent_m")}
        slot["slope"] = {
            "grade_burden_score": score,
            "uphill_8_share": thresholds["8_percent"]["share"],
            "uphill_10_share": thresholds["10_percent"]["share"],
            "max_sustained_100m_grade_percent": uphill["max_sustained_uphill_grade_percent"],
            "max_sustained_100m_start_m": uphill["max_sustained_window_start_m"],
            "max_sustained_200m_grade_percent": uphill.get("max_comparison_window_uphill_grade_percent"),
            "max_sustained_200m_start_m": uphill.get("max_comparison_window_start_m"),
            "uphill_grade_metrics": uphill,
        }
        slot["running"] = {
            "fitness_score": fitness["score"],
            "friendly_share": fitness["running_friendly_share_of_route"],
            "longest_continuous_run_m": fitness["estimated_longest_continuous_run_m"],
        }
        slot["walking_safety"] = {
            "stairs_share": net["steps_share_of_route"], "stairs_status": "known",
            "explicit_access_restricted_m": net["explicit_access_restricted_m"],
            "restriction_check_available": True,
            "repeat_segment_m": net["repeated_mapped_network_edge_m"],
            "repeat_mapped_edge_share": net["repeated_mapped_network_edge_share"],
            "u_turn_count": turns["u_turn_count_estimate"],
        }
        segments = grade["grade_segments"]
        steep8 = [{"start_m": s["start_m"], "distance_m": s["distance_m"],
                   "grade_percent": s["grade_percent"], "threshold_percent": 8}
                  for s in segments if s.get("grade_percent", 0) >= 8]
        slot["elevation"] = {
            "source": summary.get("elevation_source", "ors_response"),
            "confidence": quality.get("confidence_level", "unknown"),
            "confidence_score": quality.get("confidence_score"),
            "quality": quality, "steep_segments_8_percent": steep8,
            "steep_segments_10_percent": [s for s in steep8 if s["grade_percent"] >= 10],
            "uncertain_segments": [
                {"start_m": s["start_m"], "distance_m": s["distance_m"],
                 "quality_flags": s.get("quality_flags", []),
                 "elevation_confidence": s.get("elevation_confidence")}
                for s in segments if s.get("elevation_confidence") == "low"
            ],
        }
        start = route["stops"][0]
        slot["start"] = {"id": name + "-start", "name": start["name"],
                         "longitude": start["longitude"], "latitude": start["latitude"],
                         "access_type": "riverside_path" if place == "uiryeong" or distance == "10km" else "subway_exit",
                         "coordinate_source": "saved ORS request; access point not field-verified",
                         "coordinate_verified": False, "entrance_verified": False}
        slot["geometry_endpoints"] = {
            "start_lon_lat_elev": coords[0], "destination_lon_lat_elev": coords[-1],
            "start_to_geometry_snap_m": round(distance_m(coords[0], [start["longitude"], start["latitude"]]), 2),
            "destination_to_geometry_snap_m": round(distance_m(coords[-1], [slot["destination"]["longitude"], slot["destination"]["latitude"]]), 2),
        }
        relative = source.relative_to(ROOT).as_posix()
        slot["source_json"] = relative
        slot["geometry"] = {
            "coordinate_count": len(coords), "coordinate_order": "[longitude, latitude, elevation?]",
            "geometry_sha256_20": hashlib.sha256(json.dumps(coords, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()[:20],
            "all_coordinates_have_elevation": all(len(c) >= 3 for c in coords),
            "referenced_geojson_matches_route_json": True,
            "source_json": relative, "source_geojson": None,
            "ors_source": "OpenRouteService Directions API",
        }
        pair[mode] = slot
        features[slot["feature_id"]] = {
            "type": "Feature", "id": slot["feature_id"],
            "geometry": route["geometry"],
            "properties": {
                "feature_id": slot["feature_id"], "route_id": slot["route_id"],
                "destination_id": place, "target_distance_km": target,
                "slope_mode": mode, "source_slope_mode": mode,
                "status": slot["status"], "formal_recommendation": False,
                "metrics": {"summary": slot["summary"], "slope": slot["slope"],
                            "running": slot["running"], "walking_safety": slot["walking_safety"],
                            "elevation": slot["elevation"]},
            },
        }
        report.append({"slot": slot["slot_id"], "route_id": name, "summary": slot["summary"],
                       "slope": slot["slope"], "running": slot["running"],
                       "walking_safety": slot["walking_safety"],
                       "elevation_confidence": slot["elevation"]["confidence"],
                       "old_route_id": old["route_id"]})
    geo["features"] = list(features.values())
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    geo_path.write_text(json.dumps(geo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (HERE / "selected_metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Updated 3 app route slots from saved ORS responses")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python apply_app_bundle.py LOCAL_OSM_CACHE.json")
    main(sys.argv[1])
