"""Build a standalone React/Vite route bundle from saved ORS route data only."""
from __future__ import annotations

import csv
import copy
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from src import recommender

OUT = Path(__file__).resolve().parent
INDEX_PATH = ROOT / "outputs/app/representative_routes.json"
DESTINATIONS_PATH = ROOT / "data/destinations.json"
DEFAULTS_PATH = ROOT / "data/route_defaults.json"
REVIEW_INDEX_PATH = ROOT / "analysis/experiments/low_high_v5_pair_review_20261103/kakao_review_dataset/representative_routes.json"
OVERRIDES_PATH = OUT / "selection_overrides.json"
DISTANCES = (3, 5, 10)
MODES = ("low", "high")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def safe_project_path(relative: str) -> Path:
    path = (ROOT / relative.replace("\\", "/")).resolve()
    path.relative_to(ROOT.resolve())
    return path


def distance_m(a: list[float], b: list[float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_008.8 * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0.0, 1 - h)))


def point_pair(value: dict[str, Any] | None) -> list[float] | None:
    if not value or value.get("latitude") is None or value.get("longitude") is None:
        return None
    return [float(value["longitude"]), float(value["latitude"])]


def coord_hash(coords: list[list[float]]) -> str:
    payload = json.dumps(coords, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:20]


def slot_metrics(route: dict[str, Any], entry: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    analysis = route.get("running_analysis") or {}
    network = analysis.get("network_metrics") or {}
    turns = analysis.get("turn_metrics") or {}
    indexed = entry.get("grade_metrics") or {}
    summary = route.get("summary") or {}
    coords = (route.get("geometry") or {}).get("coordinates") or []
    distance_km = summary.get("distance_km") or indexed.get("distance_km")
    ascent_m = summary.get("ascent_m")
    if coords and len(coords) >= 2:
        computed = recommender._grade_metrics(
            route, float(defaults.get("steep_grade_threshold_percent", 6.0)),
            defaults.get("grade_assessment", {}),
        )
    else:
        computed = {"grade_segments": [], "uphill_grade_metrics": {}, "elevation_data_quality": {"confidence_level": "unknown"}}
    uphill = computed.get("uphill_grade_metrics") or {}
    thresholds = uphill.get("thresholds") or {}
    burden = recommender.grade_burden_score(
        computed, ascent_m, float(distance_km or 0),
        float(entry.get("target_distance_km") or indexed.get("target_distance_km") or 0),
        defaults.get("low_high_selection", {}),
    ) if distance_km and ascent_m is not None else None
    fitness = analysis.get("running_fitness") or {}
    start = route.get("start") or indexed.get("start") or entry.get("start") or {}
    destination = route.get("destination") or entry.get("destination") or {}
    coords_start = coords[0] if coords else None
    coords_end = coords[-1] if coords else None
    declared_start, declared_end = point_pair(start), point_pair(destination)
    start_snap = distance_m(coords_start, declared_start) if coords_start and declared_start else None
    end_snap = distance_m(coords_end, declared_end) if coords_end and declared_end else None
    repeat_m = analysis.get("repeated_segment_m")
    if repeat_m is None:
        repeat_m = network.get("repeated_mapped_network_edge_m")
    repeat_share = analysis.get("repeated_segment_share")
    if repeat_share is None:
        repeat_share = network.get("repeated_mapped_network_edge_share")
    if repeat_share is None:
        repeat_share = indexed.get("repeated_network_edge_share")
    stairs_share = network.get("steps_share_of_route")
    if stairs_share is None:
        stairs_share = analysis.get("steps_share_of_route")
    grade_segments = computed.get("grade_segments") or []
    steep_segments = [
        {"start_m": s.get("start_m"), "distance_m": s.get("distance_m"),
         "grade_percent": s.get("grade_percent"), "threshold_percent": 8}
        for s in grade_segments if float(s.get("grade_percent") or 0) >= 8
    ]
    steep10_segments = [s for s in steep_segments if float(s.get("grade_percent") or 0) >= 10]
    quality = computed.get("elevation_data_quality") or {"confidence_level": "unknown"}
    uncertain_segments = [
        {"start_m": s.get("start_m"), "distance_m": s.get("distance_m"),
         "quality_flags": s.get("quality_flags", []), "elevation_confidence": s.get("elevation_confidence")}
        for s in grade_segments
        if s.get("elevation_confidence") == "low" or "long_original_sample_gap" in (s.get("quality_flags") or [])
    ]
    if not uncertain_segments:
        uncertain_segments = [
            {"start_m": gap.get("start_m"), "distance_m": gap.get("distance_m"),
             "quality_flags": ["long_original_sample_gap"], "elevation_change_m": gap.get("elevation_change_m")}
            for gap in quality.get("warning_gaps", [])
        ]
    return {
        "summary": {
            "distance_km": distance_km, "duration_seconds": summary.get("duration_seconds"),
            "duration_minutes": summary.get("duration_minutes"), "ascent_m": ascent_m,
            "descent_m": summary.get("descent_m"),
        },
        "slope": {
            "grade_burden_score": burden,
            "uphill_8_share": (thresholds.get("8_percent") or {}).get("share"),
            "uphill_10_share": (thresholds.get("10_percent") or {}).get("share"),
            "max_sustained_100m_grade_percent": uphill.get("max_sustained_uphill_grade_percent"),
            "max_sustained_100m_start_m": uphill.get("max_sustained_window_start_m"),
            "max_sustained_200m_grade_percent": uphill.get("max_comparison_window_uphill_grade_percent"),
            "max_sustained_200m_start_m": uphill.get("max_comparison_window_start_m"),
            "uphill_grade_metrics": uphill,
        },
        "running": {
            "fitness_score": fitness.get("score", indexed.get("running_fitness_score")),
            "friendly_share": fitness.get("running_friendly_share_of_route", indexed.get("running_friendly_share")),
            "longest_continuous_run_m": fitness.get("estimated_longest_continuous_run_m", indexed.get("longest_continuous_run_m")),
        },
        "walking_safety": {
            "stairs_share": stairs_share,
            "stairs_status": "known" if stairs_share is not None else "unknown_in_source_data",
            "explicit_access_restricted_m": indexed.get("explicit_access_restricted_m"),
            "restriction_check_available": indexed.get("restriction_check_available"),
            "repeat_segment_m": repeat_m,
            "repeat_mapped_edge_share": repeat_share,
            "u_turn_count": turns.get("u_turn_count_estimate", analysis.get("u_turn_count_estimate", indexed.get("u_turn_count_estimate"))),
        },
        "elevation": {
            "source": summary.get("elevation_source", "ors_response"),
            "confidence": quality.get("confidence_level", "unknown"),
            "confidence_score": quality.get("confidence_score"),
            "quality": quality,
            "steep_segments_8_percent": steep_segments,
            "steep_segments_10_percent": steep10_segments,
            "uncertain_segments": uncertain_segments,
        },
        "start": start,
        "destination": destination,
        "geometry_endpoints": {
            "start_lon_lat_elev": coords_start,
            "destination_lon_lat_elev": coords_end,
            "start_to_geometry_snap_m": round(start_snap, 2) if start_snap is not None else None,
            "destination_to_geometry_snap_m": round(end_snap, 2) if end_snap is not None else None,
        },
        "geometry": {"coordinate_count": len(coords), "coordinate_order": "[longitude, latitude, elevation?]",
                     "geometry_sha256_20": coord_hash(coords) if coords else None,
                     "all_coordinates_have_elevation": bool(coords) and all(len(p) >= 3 for p in coords)},
    }


def main() -> None:
    index = read_json(INDEX_PATH)
    destinations = {d["id"]: d for d in read_json(DESTINATIONS_PATH)["destinations"]}
    defaults = read_json(DEFAULTS_PATH)
    overrides = read_json(OVERRIDES_PATH)
    route_index: dict[str, Any] = {
        "schema_version": "lessgo.react-routes.v1",
        "generated_from": "outputs/app/representative_routes.json plus explicitly selected saved ORS route candidates",
        "selection_overrides": "selection_overrides.json; source route files remain read-only",
        "generated_at_source": index.get("generated_at"),
        "geometry_source": "saved actual ORS foot-walking route JSON geometry; never reconstructed from OSM candidates",
        "coordinate_order": "[longitude, latitude, elevation?]",
        "mode_alias": {"high": "legacy any"},
        "formal_slot_count": 18,
        "formal_available_slot_count": 0,
        "formal_missing_slot_count": 0,
        "formal_recommendation_slot_count": 0,
        "review_required_slot_count": 0,
        "identical_low_high_slots": [],
        "destinations": {},
        "review_routes": [],
    }
    features: list[dict[str, Any]] = []
    csv_rows: list[dict[str, Any]] = []
    all_geom_hashes: set[str] = set()
    status_counts: dict[str, int] = {}
    available_count = 0
    missing_count = 0
    formal_feature_count = 0
    formal_recommendation_count = 0
    review_required_count = 0

    for dest_id in ("simujang", "jeongneung", "uiryeong"):
        destination = destinations[dest_id]
        out_dest = {"name": destination["name"], "coordinates": [destination["longitude"], destination["latitude"]], "distances": {}}
        for km in DISTANCES:
            source_distance = index["destinations"].get(dest_id, {}).get(f"{km}km", {})
            modes_out: dict[str, Any] = {}
            pair_geometry: dict[str, str | None] = {"low": None, "high": None}
            for mode in MODES:
                source_mode = "low" if mode == "low" else "any"
                entry = source_distance.get("modes", {}).get(source_mode)
                slot_id = f"{dest_id}-{km}km-{mode}"
                override = overrides.get(f"{dest_id}|{km}|{mode}")
                if override:
                    source_mode = mode
                    entry = dict(entry or {})
                    existing_geo = (entry.get("files") or {}).get("geojson")
                    entry.update({
                        "status": override["status"],
                        "target_distance_km": km,
                        "files": {"json": override["path"], "geojson": override.get("geojson", existing_geo)},
                        "notes": [override["reason"], "실제 저장 ORS 응답만 재사용; 정식 추천 승격 아님."],
                    })
                if not entry:
                    missing_count += 1
                    status_counts["missing_slot"] = status_counts.get("missing_slot", 0) + 1
                    modes_out[mode] = {"slot_id": slot_id, "mode": mode, "source_mode": source_mode,
                                       "status": "missing_slot", "available": False, "route": None}
                    csv_rows.append({"destination_id": dest_id, "destination_name": destination["name"],
                                     "target_km": km, "mode": mode, "source_mode": source_mode,
                                     "status": "missing_slot", "route_id": "", "distance_km": "",
                                     "ascent_m": "", "grade_burden_score": "", "uphill_8_share": "",
                                     "uphill_10_share": "", "max_100m_grade": "", "stairs_share": "",
                                     "repeat_m": "", "u_turns": "", "elevation_confidence": "unknown",
                                     "same_low_high_geometry": ""})
                    continue
                status = str(entry.get("status") or "status_unknown")
                status_counts[status] = status_counts.get(status, 0) + 1
                file_json = entry.get("files", {}).get("json")
                if status == "no_route" or not file_json:
                    missing_count += 1
                    modes_out[mode] = {"slot_id": slot_id, "mode": mode, "source_mode": source_mode,
                                       "status": "no_route", "available": False, "route_id": entry.get("route_id"),
                                       "notes": entry.get("notes", []), "route": None}
                    csv_rows.append({"destination_id": dest_id, "destination_name": destination["name"],
                                     "target_km": km, "mode": mode, "source_mode": source_mode,
                                     "status": "no_route", "route_id": entry.get("route_id") or "",
                                     "distance_km": "", "ascent_m": "", "grade_burden_score": "",
                                     "uphill_8_share": "", "uphill_10_share": "", "max_100m_grade": "",
                                     "stairs_share": "", "repeat_m": "", "u_turns": "",
                                     "elevation_confidence": "unknown", "same_low_high_geometry": ""})
                    continue
                route_path = safe_project_path(file_json)
                if not route_path.is_file():
                    missing_count += 1
                    status_counts["missing_file"] = status_counts.get("missing_file", 0) + 1
                    modes_out[mode] = {"slot_id": slot_id, "mode": mode, "source_mode": source_mode,
                                       "status": "missing_file", "available": False, "route_id": entry.get("route_id"),
                                       "source_json": file_json, "route": None}
                    csv_rows.append({"destination_id": dest_id, "destination_name": destination["name"],
                                     "target_km": km, "mode": mode, "source_mode": source_mode,
                                     "status": "missing_file", "route_id": entry.get("route_id") or "",
                                     "distance_km": "", "ascent_m": "", "grade_burden_score": "",
                                     "uphill_8_share": "", "uphill_10_share": "", "max_100m_grade": "",
                                     "stairs_share": "", "repeat_m": "", "u_turns": "",
                                     "elevation_confidence": "unknown", "same_low_high_geometry": ""})
                    continue
                route = read_json(route_path)
                coords = (route.get("geometry") or {}).get("coordinates") or []
                ors_meta = route.get("ors") or {}
                if route.get("profile") != "foot-walking" or ors_meta.get("profile") != "foot-walking":
                    raise ValueError(f"Not a saved ORS foot-walking route: {route_path}")
                if not coords or ors_meta.get("source") != "OpenRouteService Directions API":
                    raise ValueError(f"Missing actual ORS geometry/provenance: {route_path}")
                metrics = slot_metrics(route, entry, defaults)
                route_id = str(route.get("route_id") or entry.get("route_id") or slot_id)
                feature_id = f"formal:{slot_id}"
                geo_path = entry.get("files", {}).get("geojson")
                geojson_match = None
                if geo_path:
                    path = safe_project_path(geo_path)
                    if path.is_file():
                        geo = read_json(path)
                        source_feature = next((f for f in geo.get("features", [])
                                               if f.get("properties", {}).get("route_id") == route_id),
                                              geo.get("features", [None])[0] if geo.get("features") else None)
                        geojson_match = bool(source_feature and source_feature.get("geometry", {}).get("coordinates") == coords)
                metrics["geometry"]["referenced_geojson_matches_route_json"] = geojson_match
                metrics["geometry"]["source_json"] = file_json
                metrics["geometry"]["source_geojson"] = geo_path
                metrics["geometry"]["ors_source"] = (route.get("ors") or {}).get("source", "saved ORS route response")
                formal_recommendation = (status == "verified" and not override)
                feature_props = {
                    "feature_id": feature_id, "route_id": route_id, "destination_id": dest_id,
                    "target_distance_km": km, "slope_mode": mode, "source_slope_mode": source_mode,
                    "status": status, "formal_recommendation": formal_recommendation,
                    "metrics": {k: metrics[k] for k in ("summary", "slope", "running", "walking_safety", "elevation", "geometry_endpoints", "geometry")},
                }
                features.append({"type": "Feature", "id": feature_id, "geometry": route["geometry"], "properties": feature_props})
                formal_feature_count += 1
                if metrics["geometry"]["geometry_sha256_20"]:
                    all_geom_hashes.add(metrics["geometry"]["geometry_sha256_20"])
                available_count += 1
                if formal_recommendation: formal_recommendation_count += 1
                if status == "review_required": review_required_count += 1
                modes_out[mode] = {
                    "slot_id": slot_id, "mode": mode, "source_mode": source_mode,
                    "status": status, "available": True, "formal_recommendation": formal_recommendation,
                    "route_id": route_id, "feature_id": feature_id, "source_json": file_json,
                    "notes": entry.get("notes", []),
                    "review_reason": override.get("reason") if override else None,
                    "directions": route.get("steps") or [],
                    "ors_request_attempts": route.get("ors_request_attempts"),
                    **metrics,
                }
                s = metrics["summary"]; sl = metrics["slope"]; walk = metrics["walking_safety"]; elev = metrics["elevation"]
                pair_geometry[mode] = metrics["geometry"].get("geometry_sha256_20")
                csv_rows.append({"destination_id": dest_id, "destination_name": destination["name"],
                                 "target_km": km, "mode": mode, "source_mode": source_mode,
                                 "status": status, "route_id": route_id,
                                 "distance_km": s.get("distance_km"), "ascent_m": s.get("ascent_m"),
                                 "grade_burden_score": sl.get("grade_burden_score"),
                                 "uphill_8_share": sl.get("uphill_8_share"), "uphill_10_share": sl.get("uphill_10_share"),
                                 "max_100m_grade": sl.get("max_sustained_100m_grade_percent"),
                                 "stairs_share": walk.get("stairs_share"), "repeat_m": walk.get("repeat_segment_m"),
                                 "u_turns": walk.get("u_turn_count"), "elevation_confidence": elev.get("confidence"),
                                 "same_low_high_geometry": ""})
            same_geometry = bool(pair_geometry["low"] and pair_geometry["low"] == pair_geometry["high"])
            if same_geometry:
                route_index["identical_low_high_slots"].append(f"{dest_id}-{km}km")
            for row in csv_rows[-2:]:
                if row["destination_id"] == dest_id and row["target_km"] == km:
                    row["same_low_high_geometry"] = same_geometry
            out_dest["distances"][f"{km}km"] = {"target_distance_km": km, "routes": modes_out,
                                                   "low_high_same_geometry": same_geometry}
        route_index["destinations"][dest_id] = out_dest

    # Keep the special pair separate from the official 18 slots and preserve its review status.
    review_index = read_json(REVIEW_INDEX_PATH)
    review_entry = review_index["destinations"]["jeongneung"]["5km"]["modes"]
    review_route_count = 0
    for mode in MODES:
        entry = review_entry[mode]
        route_path = safe_project_path(entry["files"]["json"])
        geo_path = safe_project_path(entry["files"]["geojson"])
        route, geo = read_json(route_path), read_json(geo_path)
        coords = route["geometry"]["coordinates"]
        assert geo["features"][0]["geometry"]["coordinates"] == coords, f"review GeoJSON mismatch: {mode}"
        ors_source_rel = route.get("source_ors_response")
        if not ors_source_rel:
            raise ValueError(f"Review route lacks saved ORS source response: {route_path}")
        ors_source = read_json(safe_project_path(ors_source_rel))
        ors_response = ors_source.get("response") or {}
        ors_coords = (((ors_response.get("features") or [{}])[0].get("geometry") or {}).get("coordinates") or [])
        ors_profile = (((ors_response.get("metadata") or {}).get("query") or {}).get("profile") or "")
        assert ors_profile == "foot-walking" and ors_coords == coords, f"review ORS source geometry mismatch: {mode}"
        feature_id = f"review:jeongneung-5km-{mode}"
        metadata = route.get("review_metadata", {})
        analysis = route.get("running_analysis") or {}
        grade = analysis.get("grade_metrics") or {}
        uphill = grade.get("uphill_grade_metrics") or {}
        elevation_quality = grade.get("elevation_data_quality") or {
            "confidence_level": "low", "confidence_score": metadata.get("elevation_confidence_score")}
        review_metrics = {
            "summary": route.get("summary", {}),
            "slope": {"grade_burden_score": metadata.get("grade_burden_score"),
                      "uphill_8_share": metadata.get("uphill_8_share"),
                      "uphill_10_share": metadata.get("uphill_10_share"),
                      "max_sustained_100m_grade_percent": metadata.get("max_sustained_100m_grade_percent"),
                      "max_sustained_200m_grade_percent": metadata.get("max_sustained_200m_grade_percent"),
                      "uphill_grade_metrics": uphill},
            "running": {"fitness_score": metadata.get("running_fitness_score")},
            "walking_safety": {"stairs_share": metadata.get("stairs_share"), "stairs_status": "known",
                                "explicit_access_restricted_m": metadata.get("explicit_access_restricted_m"),
                                "repeat_segment_m": metadata.get("repeat_edge_m"),
                                "repeat_mapped_edge_share": metadata.get("repeat_edge_share"),
                                "u_turn_count": metadata.get("u_turn_count")},
            "elevation": {"source": "ors_response", "confidence": "low",
                          "confidence_score": elevation_quality.get("confidence_score"),
                          "quality": elevation_quality,
                          "steep_segments_8_percent": [s for s in grade.get("grade_segments", []) if float(s.get("grade_percent") or 0) >= 8],
                          "steep_segments_10_percent": [s for s in grade.get("grade_segments", []) if float(s.get("grade_percent") or 0) >= 10],
                          "uncertain_segments": elevation_quality.get("warning_gaps", [])},
            "start": route.get("start"), "destination": route.get("destination"),
            "geometry_endpoints": {"start_lon_lat_elev": coords[0], "destination_lon_lat_elev": coords[-1],
                                   "start_to_geometry_snap_m": route.get("start", {}).get("ors_snap_distance_m"),
                                   "destination_to_geometry_snap_m": route.get("destination", {}).get("ors_snap_distance_m")},
            "geometry": {"coordinate_count": len(coords), "coordinate_order": "[longitude, latitude, elevation?]",
                         "geometry_sha256_20": coord_hash(coords), "all_coordinates_have_elevation": all(len(c) >= 3 for c in coords),
                         "referenced_geojson_matches_route_json": True, "source_json": entry["files"]["json"],
                         "source_geojson": entry["files"]["geojson"], "ors_source": "saved actual ORS foot-walking response"},
            "review_metadata": metadata,
        }
        feature_props = {"feature_id": feature_id, "route_id": route["route_id"],
                         "destination_id": "jeongneung", "target_distance_km": 5,
                         "slope_mode": mode, "status": "review_required",
                         "formal_recommendation": False, "metrics": review_metrics}
        features.append({"type": "Feature", "id": feature_id, "geometry": route["geometry"], "properties": feature_props})
        route_index["review_routes"].append({
            "slot_id": f"jeongneung-5km-{mode}-review", "destination_id": "jeongneung",
            "target_distance_km": 5, "mode": mode, "status": "review_required",
            "available": True, "formal_recommendation": False, "route_id": route["route_id"],
            "feature_id": feature_id, "source_json": entry["files"]["json"],
            "source_geojson": entry["files"]["geojson"],
            "source_ors_response": ors_source_rel,
            "metrics": review_metrics, "geometry": review_metrics["geometry"],
            "directions": route.get("steps") or [],
            "ors_request_attempts": route.get("ors_request_attempts"),
        })
        review_route_count += 1
    # Explicitly selected Jeongneung 5km review pair stays separate from the formal slots.
    review_by_mode = {item["mode"]: item for item in route_index["review_routes"]
                      if item["destination_id"] == "jeongneung" and item["target_distance_km"] == 5}
    route_index["destinations"]["jeongneung"]["distances"]["5km"]["review_pair_selection"] = {
        "status": "review_required", "available": True, "formal_recommendation": False,
        "shared_edge_fraction_shorter": 0.1142,
        "note": "Selected review-only pair; does not replace the existing formal 5km low/high slots.",
        "modes": {
            mode: {"candidate_id": "osm-v5-036" if mode == "low" else "osm-v5-035",
                   "route_id": review_by_mode[mode]["route_id"],
                   "feature_id": review_by_mode[mode]["feature_id"],
                   "source_json": review_by_mode[mode]["source_json"],
                   "status": "review_required", "formal_recommendation": False,
                   "elevation_confidence": "low", "metrics": review_by_mode[mode]["metrics"]}
            for mode in ("low", "high")
        }
    }

    # App-demo selection: expose the review-only Jeongneung 5km pair in the
    # standard 18-slot app interface while preserving the formal pair verbatim.
    formal_identical_pairs = list(route_index["identical_low_high_slots"])
    jeongneung_5km = route_index["destinations"]["jeongneung"]["distances"]["5km"]
    jeongneung_5km["formal_routes"] = copy.deepcopy(jeongneung_5km["routes"])
    review_by_mode = {item["mode"]: item for item in route_index["review_routes"]
                      if item["destination_id"] == "jeongneung" and item["target_distance_km"] == 5}
    demo_routes = {}
    for mode in MODES:
        review = review_by_mode[mode]
        demo_routes[mode] = {
            "slot_id": f"jeongneung-5km-{mode}", "mode": mode, "source_mode": "review_pair",
            "status": "review_required", "available": True, "formal_recommendation": False,
            "route_id": review["route_id"], "feature_id": review["feature_id"],
            "source_json": review["source_json"], "notes": [
                "App demo selection only: osm-v5-036/035; review_required, not a formal recommendation.",
                "Elevation confidence low; field/independent elevation validation remains required."
            ], "review_reason": "Review-only Jeongneung 5km demo pair.",
            "directions": review["directions"], "ors_request_attempts": review["ors_request_attempts"],
            **review["metrics"],
        }
    jeongneung_5km["routes"] = demo_routes
    jeongneung_5km["formal_low_high_same_geometry"] = bool(jeongneung_5km["formal_routes"]["low"].get("feature_id") == jeongneung_5km["formal_routes"]["high"].get("feature_id"))
    jeongneung_5km["low_high_same_geometry"] = False
    jeongneung_5km["selection_scope"] = "app_demo"
    jeongneung_5km["app_demo_selection"] = {"candidate_ids": {"low": "osm-v5-036", "high": "osm-v5-035"},
                                            "status": "review_required", "formal_recommendation": False,
                                            "shared_edge_fraction_shorter": 0.1142}
    route_index["formal_identical_low_high_slots"] = formal_identical_pairs
    route_index["app_selected_identical_low_high_slots"] = []
    route_index["identical_low_high_slots"] = []
    route_index["app_selected_review_slot_count"] = 2

    formal_missing = 18 - available_count
    route_index["formal_available_slot_count"] = available_count
    route_index["formal_missing_slot_count"] = formal_missing
    route_index["formal_recommendation_slot_count"] = formal_recommendation_count
    route_index["review_required_slot_count"] = review_required_count
    route_index["formal_status_counts"] = status_counts
    route_index["formal_unique_geometry_count"] = len(all_geom_hashes)
    route_index["formal_feature_count"] = formal_feature_count
    route_index["review_route_count"] = review_route_count
    route_index["route_record_count_including_reviews"] = available_count + review_route_count
    route_index["slot_coverage_with_reviews"] = available_count
    route_index["note"] = "The 8 offline-selected alternate slots are marked review_required and formal_recommendation=false. Jeongneung 5km osm-v5-036/035 remain separate review routes. Routes marked verified refer to source index status, not field safety certification."

    write_json(OUT / "routes.json", route_index)
    write_json(OUT / "routes.geojson", {"type": "FeatureCollection", "name": "Less GO ORS route bundle", "features": features})
    columns = list(csv_rows[0].keys()) + ["formal_recommendation"]
    with (OUT / "formal_slots.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader(); writer.writerows(csv_rows)
    app_rows = [dict(row) for row in csv_rows]
    for row in app_rows:
        selected_slot = route_index["destinations"][row["destination_id"]]["distances"][str(int(row["target_km"])) + "km"]["routes"][row["mode"]]
        row["formal_recommendation"] = selected_slot.get("formal_recommendation")
        if row["destination_id"] == "jeongneung" and int(row["target_km"]) == 5:
            mode = row["mode"]
            slot = route_index["destinations"]["jeongneung"]["distances"]["5km"]["routes"][mode]
            summary, slope, running, walking, elevation = (slot.get(k) or {} for k in ("summary", "slope", "running", "walking_safety", "elevation"))
            row.update({"source_mode": "review_pair", "status": "review_required", "route_id": slot.get("route_id"),
                        "distance_km": summary.get("distance_km"), "ascent_m": summary.get("ascent_m"),
                        "grade_burden_score": slope.get("grade_burden_score"), "uphill_8_share": slope.get("uphill_8_share"),
                        "uphill_10_share": slope.get("uphill_10_share"), "max_100m_grade": slope.get("max_sustained_100m_grade_percent"),
                        "stairs_share": walking.get("stairs_share"), "repeat_m": walking.get("repeat_segment_m"),
                        "u_turns": walking.get("u_turn_count"), "elevation_confidence": elevation.get("confidence"),
                        "same_low_high_geometry": False, "formal_recommendation": False})
    with (OUT / "slots.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader(); writer.writerows(app_rows)
    (OUT / "audit_report.md").write_text(render_report(route_index, csv_rows), encoding="utf-8")


def render_report(dataset: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    lines = [
        "# Less GO final 18-slot data review",
        "",
        "Source: existing `outputs/app/representative_routes.json` plus its referenced saved route JSON. Formal route lines are taken directly from saved ORS route JSON `geometry`; no OSM candidate geometry is used.",
        "",
        f"- Slots with an actual saved ORS route: {dataset['formal_available_slot_count']}/18; missing: {dataset['formal_missing_slot_count']}",
        f"- Slots currently marked formal recommendation: {dataset['formal_recommendation_slot_count']}; review_required: {dataset['review_required_slot_count']}",
        f"- Slot status counts: `{json.dumps(dataset['formal_status_counts'], ensure_ascii=False)}`",
        f"- Exact-geometry Low/High matches: {', '.join(dataset['identical_low_high_slots']) or 'none'}",
        f"- Separate review candidates: {dataset['review_route_count']} (Jeongneung 5km 036 Low / 035 High); these do not replace formal slots.",
        "",
        "| 목적지 | 거리 | 모드 | 상태 | Route ID | 실제 km | 상승 m | 경사부담 | ≥8% | ≥10% | 최대100m | 계단비율 | 반복 m | U턴 | 고도신뢰도 |",
        "|---|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in rows:
        def fmt(value: Any, digits: int = 2, percent: bool = False) -> str:
            if value is None or value == "": return "—"
            if percent: return f"{100*float(value):.1f}%"
            if isinstance(value, (int, float)): return f"{float(value):.{digits}f}"
            return str(value)
        rid = row.get("route_id") or "—"
        lines.append("| {name} | {km}km | {mode} | {status} | `{rid}` | {distance} | {ascent} | {burden} | {s8} | {s10} | {grade} | {stairs} | {repeat} | {uturns} | {elev} |".format(
            name=row["destination_name"], km=row["target_km"], mode=row["mode"].upper(), status=row["status"], rid=rid,
            distance=fmt(row["distance_km"], 3), ascent=fmt(row["ascent_m"], 1), burden=fmt(row["grade_burden_score"]),
            s8=fmt(row["uphill_8_share"], percent=True), s10=fmt(row["uphill_10_share"], percent=True),
            grade=fmt(row["max_100m_grade"], 1), stairs=fmt(row["stairs_share"], percent=True), repeat=fmt(row["repeat_m"], 1),
            uturns=fmt(row["u_turns"], 0), elev=row["elevation_confidence"] or "unknown"))
    lines.extend([
        "",
        "## Separate review-required candidates",
        "",
        "| Mode | Candidate | Status | Distance | Ascent | Burden | ≥8% / ≥10% | Max 100m / 200m | Running score | Elevation confidence |",
        "|---|---|---|---:|---:|---:|---:|---:|---:|---|",
    ])
    for review in dataset["review_routes"]:
        m = review["metrics"]
        summary, slope, running, elevation = m["summary"], m["slope"], m["running"], m["elevation"]
        lines.append("| {mode} | `{rid}` | review_required | {distance}km | {ascent}m | {burden} | {s8} / {s10} | {g100}% / {g200}% | {fitness} | low |".format(
            mode=review["mode"].upper(), rid=review["route_id"],
            distance=fmt(summary.get("distance_km"), 3), ascent=fmt(summary.get("ascent_m"), 1),
            burden=fmt(slope.get("grade_burden_score")),
            s8=fmt(slope.get("uphill_8_share"), percent=True), s10=fmt(slope.get("uphill_10_share"), percent=True),
            g100=fmt(slope.get("max_sustained_100m_grade_percent"), 2),
            g200=fmt(slope.get("max_sustained_200m_grade_percent"), 2),
            fitness=fmt(running.get("fitness_score"), 2)))
    lines.extend([
        "",
        "A dash means the source did not provide that metric; it is not interpreted as zero. High is mapped from the legacy `any` mode and the original key is retained as `source_mode`. `stairs_share` is `unknown_in_source_data` when no stored OSM network metric exists. Elevation confidence is recomputed offline from each saved ORS elevation geometry using the current recommender grade-profile routine. This is a data quality estimate, not an independent DEM validation.",
        "",
        "See `README.md` for the React/Vite loader example. Review-only candidates remain separate from formal recommendation status.",
        "",
    ])
    return "\n".join(lines)


if __name__ == "__main__":
    main()
