"""Offline re-ranking of already saved Less GO route candidates.

This utility deliberately does not call ORS or fetch/build OSM data. It reads
existing recommendation summaries and route JSONs, scores their stored route
geometry/elevation/OSM metrics, backs up the app representative index, then
updates only the app-facing representative index and additive route metadata.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from src.recommender import _grade_metrics


INDEX_PATH = ROOT / "outputs/app/representative_routes.json"
DESTINATIONS_PATH = ROOT / "data/destinations.json"
DEFAULTS_PATH = ROOT / "data/route_defaults.json"
REPORT_PATH = ROOT / "outputs/app/offline_rerank_report.json"
MODES = ("low", "any")
DISTANCES = (3, 5, 10)
DEST_IDS = ("simujang", "jeongneung", "uiryeong")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def relative_path(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def resolve_route_path(value: str) -> Path:
    return (ROOT / Path(value)).resolve()


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(h))


def geometry_fingerprint(route: dict[str, Any]) -> str:
    coords = route.get("geometry", {}).get("coordinates", [])
    normalized = [[round(float(p[0]), 5), round(float(p[1]), 5)] for p in coords if len(p) >= 2]
    # Treat a route traversed in reverse as the same road geometry.
    forward = json.dumps(normalized, separators=(",", ":"))
    reverse = json.dumps(list(reversed(normalized)), separators=(",", ":"))
    return hashlib.sha256(min(forward, reverse).encode("utf-8")).hexdigest()[:20]


def grade_summary(route: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    settings = defaults.get("grade_assessment", {})
    measured = _grade_metrics(route, float(defaults.get("steep_grade_threshold_percent", 6.0)), settings)
    uphill = measured.get("uphill_grade_metrics") or {}
    thresholds = uphill.get("thresholds") or {}
    g8 = thresholds.get("8_percent") or {}
    g10 = thresholds.get("10_percent") or {}
    max_grade = uphill.get("max_sustained_uphill_grade_percent")
    longest8 = g8.get("longest_continuous_m")
    measured["uphill_grade_metrics"] = uphill
    return {
        "metrics": measured,
        "share8": g8.get("share"), "share10": g10.get("share"),
        "max_sustained": max_grade, "longest8": longest8,
    }


def low_slope_score(candidate: dict[str, Any]) -> float | None:
    """100-point diagnostic; steep-uphill exposure dominates ascent by design."""
    g = candidate["grade"]
    if any(g.get(key) is None for key in ("share8", "share10", "max_sustained", "longest8")):
        return None
    distance_km = max(float(candidate["distance_km"]), 0.1)
    ascent_per_km = float(candidate.get("ascent_m") or 0) / distance_km
    penalty = (
        1.60 * float(g["share10"]) * 100
        + 0.80 * float(g["share8"]) * 100
        + 0.60 * max(0.0, float(g["max_sustained"]) - 8.0)
        + 1.50 * min(100.0, float(g["longest8"]) / 100.0)
        + 0.02 * min(100.0, ascent_per_km)
    )
    return round(max(0.0, min(100.0, 100.0 - penalty)), 2)


def any_slope_score(candidate: dict[str, Any]) -> float | None:
    """Running environment score, deliberately insensitive to elevation burden."""
    fitness = candidate.get("fitness") or {}
    fitness_score = fitness.get("score")
    network = candidate.get("network") or {}
    turns = candidate.get("turns") or {}
    fitness_source = "saved_running_fitness"
    if fitness_score is None:
        # Some recovered route JSONs predate the aggregate fitness field but do
        # retain OSM edge shares. Build a transparent proxy from those saved
        # metrics only; never fetch or rematch OSM here.
        dedicated = network.get("dedicated_pedestrian_way_share_of_route")
        steps = network.get("steps_share_of_route")
        mapped = network.get("matched_osm_network_share")
        sidewalk = network.get("mapped_sidewalk_share_of_route")
        if dedicated is None and sidewalk is None:
            return None
        dedicated = float(dedicated or 0)
        sidewalk = float(sidewalk or 0)
        steps = float(steps or 0)
        mapped = float(mapped if mapped is not None else 0)
        fitness_score = max(0.0, min(100.0, 100 * (
            0.45 * dedicated + 0.20 * sidewalk + 0.20 * max(0.0, mapped - dedicated - sidewalk)
            + 0.15 * (1 - steps)
        )))
        fitness = {
            "score": fitness_score,
            "running_friendly_share_of_route": max(0.0, min(1.0, dedicated + 0.6 * sidewalk)),
            "estimated_longest_continuous_run_m": None,
            "score_source": "saved_osm_network_metrics_proxy",
        }
        fitness_source = "saved_osm_network_metrics_proxy"
    repeated = network.get("repeated_mapped_network_edge_share")
    if repeated is None:
        repeated = candidate.get("repeated_segment_share")
    repeated = float(repeated or 0)
    u_turns = float(turns.get("u_turn_count_estimate") or 0)
    sharp_turns = float(turns.get("sharp_turn_count_estimate") or 0)
    run = float(fitness.get("estimated_longest_continuous_run_m") or 0)
    continuity = max(0.0, min(100.0, 100.0 - repeated * 70.0 - u_turns * 20.0 - sharp_turns * 1.2 + min(run / 1000.0, 1.0) * 15.0))
    # Fitness is dominant; route continuity and backtracking are meaningful,
    # while distance accuracy is handled first as an eligibility band.
    score = 0.72 * float(fitness_score) + 0.28 * continuity
    candidate["any_score_source"] = fitness_source
    return round(max(0.0, min(100.0, score)), 2)


def get_summary_files(destination_id: str, distance: int) -> list[Path]:
    candidates = []
    base = ROOT / "outputs/recommendations"
    patterns = [
        f"{destination_id}/**/recommendations-{distance}km*.json",
        f"recommendations/{distance}km/recommendations-{distance}km*.json",
    ]
    for pattern in patterns:
        candidates.extend(base.glob(pattern))
    # The root-level historic summary applies to Simujang only.
    if destination_id == "simujang":
        old = base / f"{distance}km" / f"recommendations-{distance}km.json"
        if old.exists():
            candidates.append(old)
    return sorted({p.resolve() for p in candidates if p.is_file()})


def collect_candidates(destination_id: str, distance: int, destination: dict[str, Any], defaults: dict[str, Any], index: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_geometry: dict[str, dict[str, Any]] = {}
    source_counts: dict[str, int] = {}
    missing_files = 0
    summaries = get_summary_files(destination_id, distance)
    for summary_path in summaries:
        summary = load_json(summary_path)
        recs = summary.get("recommendations") or []
        source_counts[relative_path(summary_path)] = len(recs)
        # Keep old-coordinate candidates in the inventory, but never make them eligible.
        summary_dest = summary.get("destination") or {}
        for rec in recs:
            file_value = (rec.get("files") or {}).get("json")
            if not file_value:
                missing_files += 1
                continue
            path = resolve_route_path(str(file_value))
            if not path.is_file():
                missing_files += 1
                continue
            route = load_json(path)
            summary_data = route.get("summary") or {}
            dist_km = summary_data.get("distance_km", rec.get("distance_km"))
            if dist_km is None:
                continue
            dest = route.get("destination") or {}
            endpoint_delta = None
            if dest.get("latitude") is not None and dest.get("longitude") is not None:
                endpoint_delta = haversine_m((float(dest["latitude"]), float(dest["longitude"])),
                                              (float(destination["latitude"]), float(destination["longitude"])))
            elif summary_dest.get("latitude") is not None and summary_dest.get("longitude") is not None:
                endpoint_delta = haversine_m((float(summary_dest["latitude"]), float(summary_dest["longitude"])),
                                              (float(destination["latitude"]), float(destination["longitude"])))
            fp = geometry_fingerprint(route)
            if fp not in by_geometry:
                analysis = route.get("running_analysis") or {}
                network = analysis.get("network_metrics") or {}
                saved_network = network or rec.get("network_metrics") or {}
                candidate = {
                    "fingerprint": fp, "route_id": route.get("route_id") or rec.get("route_id"),
                    "route_path": path, "route": route, "distance_km": float(dist_km),
                    "distance_error_m": abs(float(dist_km) - distance) * 1000,
                    "duration_minutes": float(summary_data.get("duration_minutes", rec.get("duration_minutes", 0)) or 0),
                    "ascent_m": summary_data.get("ascent_m", rec.get("ascent_m")),
                    "descent_m": summary_data.get("descent_m", rec.get("descent_m")),
                    "start": route.get("start") or rec.get("start") or {},
                    "destination": route.get("destination") or rec.get("destination") or destination,
                    "files": {k: str(v) for k, v in (rec.get("files") or {}).items()},
                    "analysis": analysis, "network": saved_network,
                    "fitness": analysis.get("running_fitness") or rec.get("running_fitness") or {},
                    "turns": analysis.get("turn_metrics") or {"u_turn_count_estimate": rec.get("u_turn_count_estimate"), "sharp_turn_count_estimate": rec.get("sharp_turn_count_estimate")},
                    "repeated_segment_share": analysis.get("repeated_segment_share", rec.get("repeated_network_edge_share")),
                    "summary_sources": [], "old_route_ids": set(), "access_restriction_m": float(saved_network.get("explicit_access_restricted_m") or 0),
                    "advisory_areas": analysis.get("advisory_area_intersections") or [],
                    "origin_mode": set(),
                    "current_destination_match": endpoint_delta is not None and endpoint_delta <= 25,
                    "destination_endpoint_delta_m": endpoint_delta,
                    "restriction_check_available": ("explicit_access_restricted_m" in saved_network) or bool((summary.get("search", {}).get("restricted_area_filter") or {}).get("enabled")),
                }
                candidate["grade"] = grade_summary(route, defaults)
                candidate["low_score"] = low_slope_score(candidate)
                candidate["any_score"] = any_slope_score(candidate)
                by_geometry[fp] = candidate
            c = by_geometry[fp]
            c["summary_sources"].append(relative_path(summary_path))
            c["old_route_ids"].add(str(rec.get("route_id", "")))
            c["origin_mode"].add(str(summary.get("slope_preference", "unknown")))
            c["current_destination_match"] = c["current_destination_match"] or (endpoint_delta is not None and endpoint_delta <= 25)
            c["restriction_check_available"] = c.get("restriction_check_available", False) or ("explicit_access_restricted_m" in c.get("network", {})) or bool((summary.get("search", {}).get("restricted_area_filter") or {}).get("enabled"))
            if not c.get("fitness") and rec.get("running_fitness"):
                c["fitness"] = rec["running_fitness"]
                c["any_score"] = any_slope_score(c)
            if not c.get("network") and rec.get("network_metrics"):
                c["network"] = rec["network_metrics"]
                c["access_restriction_m"] = float(c["network"].get("explicit_access_restricted_m") or 0)
                c["any_score"] = any_slope_score(c)
            if c.get("files") == {} and rec.get("files"):
                c["files"] = {k: str(v) for k, v in rec["files"].items()}

    # Include every saved route JSON in the distance folders, not just the
    # top-three records retained by summary files. Old-coordinate routes remain
    # in the inventory but cannot be selected for the current destination.
    destination_root = ROOT / "outputs/recommendations" / destination_id
    route_json_files = set()
    if destination_root.exists():
        for path in destination_root.rglob("*.json"):
            if f"{distance}km" not in path.parts or path.name.startswith("recommendations-"):
                continue
            route_json_files.add(path.resolve())
    for path in sorted(route_json_files):
        try:
            route = load_json(path)
        except (OSError, ValueError):
            continue
        if "geometry" not in route or not route.get("route_id"):
            continue
        fp = geometry_fingerprint(route)
        if fp in by_geometry:
            continue
        summary_data = route.get("summary") or {}
        if summary_data.get("distance_km") is None:
            continue
        dest = route.get("destination") or {}
        endpoint_delta = None
        if dest.get("latitude") is not None and dest.get("longitude") is not None:
            endpoint_delta = haversine_m((float(dest["latitude"]), float(dest["longitude"])),
                                         (float(destination["latitude"]), float(destination["longitude"])))
        analysis = route.get("running_analysis") or {}
        network = analysis.get("network_metrics") or {}
        candidate = {
            "fingerprint": fp, "route_id": route["route_id"], "route_path": path, "route": route,
            "distance_km": float(summary_data["distance_km"]),
            "distance_error_m": abs(float(summary_data["distance_km"]) - distance) * 1000,
            "duration_minutes": float(summary_data.get("duration_minutes") or 0),
            "ascent_m": summary_data.get("ascent_m"), "descent_m": summary_data.get("descent_m"),
            "start": route.get("start") or {}, "destination": dest,
            "files": {"json": relative_path(path)}, "analysis": analysis, "network": network,
            "fitness": analysis.get("running_fitness") or {}, "turns": analysis.get("turn_metrics") or {},
            "repeated_segment_share": analysis.get("repeated_segment_share"), "summary_sources": [],
            "old_route_ids": {route["route_id"]}, "access_restriction_m": float(network.get("explicit_access_restricted_m") or 0),
            "advisory_areas": analysis.get("advisory_area_intersections") or [], "origin_mode": set(),
            "current_destination_match": endpoint_delta is not None and endpoint_delta <= 25,
            "destination_endpoint_delta_m": endpoint_delta,
            "restriction_check_available": "explicit_access_restricted_m" in network,
        }
        geojson_path = path.with_suffix(".geojson")
        html_path = path.with_suffix(".html")
        if geojson_path.is_file():
            candidate["files"]["geojson"] = relative_path(geojson_path)
        if html_path.is_file():
            candidate["files"]["html"] = relative_path(html_path)
        candidate["grade"] = grade_summary(route, defaults)
        candidate["low_score"] = low_slope_score(candidate)
        candidate["any_score"] = any_slope_score(candidate)
        by_geometry[fp] = candidate

    # Include existing representatives even if their original summary is gone.
    entry = index.get("destinations", {}).get(destination_id, {}).get(f"{distance}km", {})
    for mode in MODES:
        rep = entry.get("modes", {}).get(mode) or {}
        file_value = (rep.get("files") or {}).get("json")
        if not file_value:
            continue
        path = resolve_route_path(file_value)
        if not path.is_file():
            continue
        route = load_json(path)
        dest = route.get("destination") or {}
        if dest.get("latitude") is not None and haversine_m((float(dest["latitude"]), float(dest["longitude"])),
                                                             (float(destination["latitude"]), float(destination["longitude"]))) > 25:
            continue
        fp = geometry_fingerprint(route)
        if fp in by_geometry:
            continue
        analysis = route.get("running_analysis") or {}
        network = analysis.get("network_metrics") or {}
        candidate = {
            "fingerprint": fp, "route_id": route.get("route_id") or rep.get("route_id"),
            "route_path": path, "route": route,
            "distance_km": float((route.get("summary") or {}).get("distance_km", rep.get("distance_km", 0))),
            "distance_error_m": abs(float((route.get("summary") or {}).get("distance_km", rep.get("distance_km", 0))) - distance) * 1000,
            "duration_minutes": float((route.get("summary") or {}).get("duration_minutes", rep.get("duration_minutes", 0)) or 0),
            "ascent_m": (route.get("summary") or {}).get("ascent_m", rep.get("ascent_m")),
            "descent_m": (route.get("summary") or {}).get("descent_m", rep.get("descent_m")),
            "start": route.get("start") or rep.get("start") or {}, "destination": route.get("destination") or destination,
            "files": rep.get("files") or {}, "analysis": analysis, "network": network,
            "fitness": analysis.get("running_fitness") or {}, "turns": analysis.get("turn_metrics") or {},
            "repeated_segment_share": analysis.get("repeated_segment_share"), "summary_sources": [],
            "old_route_ids": {str(rep.get("route_id", ""))}, "access_restriction_m": float(network.get("explicit_access_restricted_m") or 0),
            "advisory_areas": analysis.get("advisory_area_intersections") or [], "origin_mode": {mode},
            "current_destination_match": True, "destination_endpoint_delta_m": 0.0,
            "restriction_check_available": ("explicit_access_restricted_m" in network) or rep.get("status") in {"verified", "alternative"},
        }
        candidate["grade"] = grade_summary(route, defaults)
        candidate["low_score"] = low_slope_score(candidate)
        candidate["any_score"] = any_slope_score(candidate)
        by_geometry[fp] = candidate

    candidates = list(by_geometry.values())
    for candidate in candidates:
        candidate["summary_sources"] = sorted(set(candidate["summary_sources"]))
        candidate["old_route_ids"] = sorted(v for v in candidate["old_route_ids"] if v)
        candidate["origin_mode"] = sorted(candidate["origin_mode"])
    count = {
        "summary_files": len(summaries), "recommendation_records_by_file": source_counts,
        "recommendation_records_total_with_duplicates": sum(source_counts.values()),
        "unique_saved_route_geometries_all_destination_coordinates": len(candidates),
        "unique_saved_route_geometries_current_destination": sum(c["current_destination_match"] for c in candidates),
        "missing_route_json_references": missing_files,
        "unique_geometries_within_100m": sum(c["current_destination_match"] and c["distance_error_m"] <= 100.0001 for c in candidates),
        "unique_geometries_within_200m": sum(c["current_destination_match"] and c["distance_error_m"] <= 200.0001 for c in candidates),
    }
    return candidates, count


def candidate_public(candidate: dict[str, Any], mode: str, rank: int | None = None) -> dict[str, Any]:
    grade = candidate["grade"]
    fitness = candidate.get("fitness") or {}
    return {
        "rank": rank, "route_id": candidate["route_id"], "distance_km": round(candidate["distance_km"], 4),
        "distance_error_m": round(candidate["distance_error_m"], 1),
        "distance_status": "within_100m" if candidate["distance_error_m"] <= 100.0001 else "alternative_within_200m",
        "start": {k: candidate["start"].get(k) for k in ("id", "name", "latitude", "longitude", "access_type", "station_access")},
        "ascent_m": candidate["ascent_m"],
        "uphill_8_percent_share": grade.get("share8"), "uphill_10_percent_share": grade.get("share10"),
        "max_sustained_uphill_grade_percent": grade.get("max_sustained"),
        "longest_continuous_8_percent_uphill_m": grade.get("longest8"),
        "running_fitness_score": fitness.get("score"),
        "running_friendly_share": fitness.get("running_friendly_share_of_route"),
        "longest_continuous_run_m": fitness.get("estimated_longest_continuous_run_m"),
        "repeated_network_edge_share": candidate.get("network", {}).get("repeated_mapped_network_edge_share", candidate.get("repeated_segment_share")),
        "u_turn_count_estimate": (candidate.get("turns") or {}).get("u_turn_count_estimate"),
        "final_score": candidate["low_score"] if mode == "low" else candidate["any_score"],
        "score_source": "grade_profile" if mode == "low" else candidate.get("any_score_source", "saved_running_fitness"),
        "explicit_access_restricted_m": candidate["access_restriction_m"],
        "restriction_check_available": candidate.get("restriction_check_available", False),
        "route_json": relative_path(candidate["route_path"]),
    }


def rank_for_mode(candidates: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    # Goal distance is a hard first band, followed by the mode-specific score.
    key = "low_score" if mode == "low" else "any_score"
    eligible = [c for c in candidates if c.get("current_destination_match")
                and c["distance_error_m"] <= 200.0001 and c["access_restriction_m"] <= 0
                and bool(c.get("files", {}).get("geojson"))
                and c.get("restriction_check_available")
                and c.get(key) is not None]
    eligible = [c for c in eligible if c["grade"].get("share8") is not None]
    preferred = [c for c in eligible if c["distance_error_m"] <= 100.0001]
    pool = preferred or eligible
    return sorted(pool, key=lambda c: (
        -(c.get(key) if c.get(key) is not None else -1),
        c["distance_error_m"],
        -(float((c.get("fitness") or {}).get("score") or -1)) if mode == "any" else float(c.get("grade", {}).get("share10") or 1),
    ))


def status_for_candidate(candidate: dict[str, Any], previous: dict[str, Any]) -> str:
    if candidate["distance_error_m"] > 100.0001:
        return "alternative"
    # Never upgrade an old, explicitly unresolved route solely from the re-rank.
    if str(previous.get("route_id")) == str(candidate["route_id"]):
        return previous.get("status", "needs_verification")
    return "needs_verification"


def update_index(index: dict[str, Any], report: dict[str, Any], backup_path: Path) -> None:
    for destination_id in DEST_IDS:
        for distance in DISTANCES:
            key = f"{distance}km"
            entry = index.get("destinations", {}).get(destination_id, {}).get(key)
            if entry is None:
                continue
            group = report["combinations"][destination_id][key]
            mode_lists = group.get("ranked_candidates_internal", {})
            old_modes = entry.get("modes", {})
            chosen: dict[str, dict[str, Any]] = {}
            for mode in MODES:
                ranked = mode_lists[mode]
                old = old_modes.get(mode, {})
                if not ranked:
                    # Preserve explicit no-route state when there is no offline-valid candidate.
                    chosen[mode] = old
                    continue
                best = ranked[0]
                score_key = "low_score" if mode == "low" else "any_score"
                old_candidate = next((c for c in group["candidates_internal"] if str(c["route_id"]) == str(old.get("route_id"))), None)
                if old_candidate is None and (old.get("files") or {}).get("json"):
                    old_path = resolve_route_path(old["files"]["json"])
                    if old_path.is_file():
                        old_fp = geometry_fingerprint(load_json(old_path))
                        old_candidate = next((c for c in group["candidates_internal"] if c["fingerprint"] == old_fp), None)
                same_old = bool(old_candidate and old_candidate["fingerprint"] == best["fingerprint"])
                old_score = old_candidate.get(score_key) if old_candidate else None
                new_score = best.get(score_key)
                is_better = (not old.get("route_id") or old.get("status") == "no_route" or
                             (new_score is not None and (old_score is None or new_score > old_score + 0.01)))
                if same_old and old_candidate is not None:
                    best = old_candidate
                elif not is_better:
                    # Existing representative remains if it is at least as good under the new score.
                    if old_candidate is not None:
                        best = old_candidate
                if best.get("access_restriction_m", 0) > 0:
                    chosen[mode] = old
                    continue
                route = best["route"]
                route_summary = route.get("summary") or {}
                route_analysis = route.setdefault("running_analysis", {})
                # Additive metadata only; underlying ORS/OSM route data is left intact.
                all_mode_scores = {"low": best.get("low_score"), "any": best.get("any_score")}
                route["final_grade_review"] = {
                    **(route.get("final_grade_review") or {}),
                    "model": "offline_saved_candidate_rerank_v1",
                    "slope_preference_diagnostic_scores": all_mode_scores,
                    "terrain_metrics": candidate_public(best, mode),
                    "note": "Re-scored from saved ORS route geometry/elevation and saved OSM metrics; no ORS request or OSM data fetch was made.",
                }
                route_analysis["grade_metrics"] = best["grade"]["metrics"]
                route_analysis["slope_diagnostic_scores"] = all_mode_scores
                route["offline_rerank"] = {"selected_preference": mode, "score": new_score,
                                           "scoring_model": "offline_saved_candidate_rerank_v1",
                                           "candidate_geometry_fingerprint": best["fingerprint"]}
                best["route_path"].write_text(json.dumps(route, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                # Preserve old status for the same candidate; newly selected files remain review-needed.
                status = status_for_candidate(best, old)
                if status == "needs_verification":
                    # If this exact saved candidate already carried a verified
                    # status in the other preference before re-ranking, retain
                    # that existing verification rather than downgrading it.
                    prior_same_route = next((prior for prior in old_modes.values()
                                             if prior.get("route_id") == best.get("route_id")
                                             and prior.get("status") in {"verified", "alternative"}), None)
                    if prior_same_route:
                        status = prior_same_route["status"]
                file_paths = dict(best.get("files") or old.get("files") or {})
                file_paths["json"] = relative_path(best["route_path"])
                selected = copy.deepcopy(old)
                selected.update({
                    "status": status, "route_id": best["route_id"], "target_distance_km": distance,
                    "distance_km": round(best["distance_km"], 4),
                    "distance_error_m": round(best["distance_error_m"], 1),
                    "duration_minutes": round(best["duration_minutes"], 2),
                    "ascent_m": best["ascent_m"], "descent_m": best["descent_m"],
                    "start": best["start"], "destination": best["destination"], "files": file_paths,
                    "grade_metrics": candidate_public(best, mode),
                    "slope_diagnostic_score": new_score,
                    "selection_score": new_score,
                    "selection_model": "offline_saved_candidate_rerank_v1",
                    "notes": list(old.get("notes") or []) if same_old else [
                        "저장된 ORS 경로·고도·OSM 지표를 새 선호도 점수로 오프라인 재평가해 선정했습니다.",
                        "출입구 위치·현장 통행 상태는 별도 확인이 필요합니다.",
                    ],
                })
                if status == "alternative":
                    selected["notes"] = list(selected["notes"]) + ["목표 거리 ±100m 밖이지만 ±200m 이내인 대안 경로입니다."]
                chosen[mode] = selected
                group["selection_outcomes"][mode] = {
                    "previous_route_id": old.get("route_id"), "selected_route_id": best["route_id"],
                    "replaced": not same_old, "previous_score": old_score, "new_score": new_score,
                    "selected_status": status,
                }
            entry["modes"] = chosen
            valid_route_ids = [r.get("route_id") for r in chosen.values() if r.get("status") not in {"no_route"} and r.get("route_id")]
            if valid_route_ids:
                low_route = chosen.get("low", {})
                any_route = chosen.get("any", {})
                low_edges: set[str] = set()
                any_edges: set[str] = set()
                for route_item, edge_set in ((low_route, low_edges), (any_route, any_edges)):
                    json_path = (route_item.get("files") or {}).get("json")
                    if json_path:
                        candidate_path = resolve_route_path(json_path)
                        if candidate_path.is_file():
                            route_blob = load_json(candidate_path)
                            edge_set.update((route_blob.get("running_analysis") or {}).get("network_metrics", {}).get("mapped_edge_ids") or [])
                low_json_path = (low_route.get("files") or {}).get("json")
                any_json_path = (any_route.get("files") or {}).get("json")
                same_geometry = False
                if low_json_path and any_json_path:
                    low_path = resolve_route_path(low_json_path)
                    any_path = resolve_route_path(any_json_path)
                    if low_path.is_file() and any_path.is_file():
                        same_geometry = geometry_fingerprint(load_json(low_path)) == geometry_fingerprint(load_json(any_path))
                if same_geometry:
                    group["shared_route_fraction_between_modes"] = 1.0
                else:
                    smaller = min(len(low_edges), len(any_edges))
                    group["shared_route_fraction_between_modes"] = round(len(low_edges & any_edges) / smaller, 4) if smaller else None
                rep_mode = "low" if chosen.get("low", {}).get("status") != "no_route" else "any"
                entry["representative"] = copy.deepcopy(chosen[rep_mode])
                entry["representative"]["shared_route_fraction_between_modes"] = group.get("shared_route_fraction_between_modes")
            entry["mode_routes_may_differ"] = not same_geometry if valid_route_ids else False
            for mode in MODES:
                chosen_route = chosen.get(mode, {})
                outcome = group["selection_outcomes"].get(mode)
                if outcome and chosen_route.get("route_id"):
                    group["selection_outcomes"][mode]["selected_route_json"] = chosen_route.get("files", {}).get("json")
            if chosen.get("low", {}).get("route_id") and chosen.get("any", {}).get("route_id"):
                group["same_route_selected"] = same_geometry
                if group["same_route_selected"]:
                    if not group["rankings"]["low"] or not group["rankings"]["any"]:
                        group["same_route_reason"] = "한 모드의 저장 지표가 부족해 새 순위를 계산하지 못해 기존 대표 경로를 유지했습니다."
                    elif group["mode_eligible_unique_geometry_count"]["low"] == 1 and group["mode_eligible_unique_geometry_count"]["any"] == 1:
                        group["same_route_reason"] = "저장 데이터·목적지 좌표·거리·통행 제한 조건을 모두 통과한 실제 경로 형상이 하나뿐이었습니다."
                    else:
                        group["same_route_reason"] = "두 모드가 독립 평가했으며, 각각의 최고 점수가 같은 경로에 돌아갔습니다."
            group.pop("candidates_internal", None)
            group.pop("ranked_candidates_internal", None)
    index["generated_at"] = datetime.now(timezone.utc).isoformat()
    index["offline_rerank"] = {
        "model": "offline_saved_candidate_rerank_v1", "generated_at": datetime.now(timezone.utc).isoformat(),
        "backup_file": relative_path(backup_path),
        "ors_requests": 0, "osm_network_fetch_or_rebuild": 0,
        "note": "Only saved route JSON geometry/elevation and saved OSM metrics were used. New picks without a prior verified status are marked needs_verification.",
    }


def main() -> None:
    index = load_json(INDEX_PATH)
    destination_data = load_json(DESTINATIONS_PATH)
    defaults = load_json(DEFAULTS_PATH)
    destinations = {item["id"]: item for item in destination_data.get("destinations", [])}
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = ROOT / "outputs/app/backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"representative_routes_before_offline_rerank_{timestamp}.json"
    shutil.copy2(INDEX_PATH, backup_path)
    report: dict[str, Any] = {
        "model": "offline_saved_candidate_rerank_v1", "generated_at": datetime.now(timezone.utc).isoformat(),
        "ors_requests": 0, "osm_network_fetch_or_rebuild": 0,
        "scoring": {
            "low": "100 - (1.60*10% uphill share pp + 0.80*8% uphill share pp + 0.60*max(0,max 100m sustained grade-8) + 1.50*longest 8% climb/100m + 0.02*ascent per km), clipped 0..100; grade exposure dominates cumulative ascent; distance band first.",
            "any": "0.72*saved running_fitness score + 0.28*continuity/backtracking score; elevation is not part of the score; distance band first.",
            "eligibility": "current destination endpoint within 25m; no saved explicit access restriction; ±100m preferred, otherwise ±200m alternative; no new status upgraded to verified.",
        },
        "backup_file": relative_path(backup_path), "combinations": {},
    }
    for destination_id in DEST_IDS:
        report["combinations"][destination_id] = {}
        destination = destinations[destination_id]
        for distance in DISTANCES:
            candidates, count = collect_candidates(destination_id, distance, destination, defaults, index)
            entry = index.get("destinations", {}).get(destination_id, {}).get(f"{distance}km", {})
            old_modes = entry.get("modes", {})
            ranked_low = rank_for_mode(candidates, "low")
            ranked_any = rank_for_mode(candidates, "any")
            report_group: dict[str, Any] = {
                "candidate_count": count, "eligible_unique_geometry_count": len(set(c["fingerprint"] for c in candidates if c.get("current_destination_match") and c.get("restriction_check_available") and c["distance_error_m"] <= 200.0001 and c["access_restriction_m"] <= 0 and c.get("files", {}).get("geojson") and c["grade"].get("share8") is not None)),
                "mode_eligible_unique_geometry_count": {
                    "low": len(set(c["fingerprint"] for c in candidates if c.get("current_destination_match") and c.get("restriction_check_available") and c["distance_error_m"] <= 200.0001 and c["access_restriction_m"] <= 0 and c.get("files", {}).get("geojson") and c.get("low_score") is not None)),
                    "any": len(set(c["fingerprint"] for c in candidates if c.get("current_destination_match") and c.get("restriction_check_available") and c["distance_error_m"] <= 200.0001 and c["access_restriction_m"] <= 0 and c.get("files", {}).get("geojson") and c.get("any_score") is not None)),
                },
                "rankings": {"low": [candidate_public(c, "low", i) for i, c in enumerate(ranked_low[:3], 1)],
                             "any": [candidate_public(c, "any", i) for i, c in enumerate(ranked_any[:3], 1)]},
                "ranked_candidates_internal": {"low": ranked_low, "any": ranked_any},
                "selection_outcomes": {},
                "old_representatives": {mode: {"route_id": r.get("route_id"), "distance_km": r.get("distance_km"), "status": r.get("status"), "start": r.get("start", {}).get("name")} for mode, r in old_modes.items()},
                "same_old_route": old_modes.get("low", {}).get("route_id") == old_modes.get("any", {}).get("route_id"),
                "ranking_unavailable_reason": {
                    "low": None if ranked_low else "현재 목적지 좌표 기준 ±200m 이내, 지도 파일이 있는 고도 경로 후보가 없습니다.",
                    "any": None if ranked_any else "현재 목적지 좌표·거리 조건을 만족하는 저장 경로에 러닝 점수 또는 저장 OSM 지표가 없어 새 순위를 산출하지 못했습니다. 기존 대표 경로를 유지합니다.",
                },
                "candidates_internal": candidates,
            }
            rep = entry.get("representative") or {}
            rep_edges = None
            if rep.get("route_id"):
                rep_candidate = next((c for c in candidates if c["route_id"] == rep["route_id"]), None)
                if rep_candidate:
                    rep_edges = set((rep_candidate.get("network") or {}).get("mapped_edge_ids") or [])
            if rep_edges is None:
                rep_edges = set()
            low_best, any_best = (ranked_low[0] if ranked_low else None), (ranked_any[0] if ranked_any else None)
            if low_best and any_best:
                low_edges = set((low_best.get("network") or {}).get("mapped_edge_ids") or [])
                any_edges = set((any_best.get("network") or {}).get("mapped_edge_ids") or [])
                smaller = min(len(low_edges), len(any_edges))
                report_group["shared_route_fraction_between_modes"] = round(len(low_edges & any_edges) / smaller, 4) if smaller else None
            else:
                report_group["shared_route_fraction_between_modes"] = None
            report["combinations"][destination_id][f"{distance}km"] = report_group
    update_index(index, report, backup_path)
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Convert report internals to JSON-safe summary once index mutation has finished.
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    for destination_id in DEST_IDS:
        for distance in DISTANCES:
            group = report["combinations"][destination_id][f"{distance}km"]
            group.pop("candidates_internal", None)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"backup": relative_path(backup_path), "index": relative_path(INDEX_PATH),
                      "report": relative_path(REPORT_PATH), "combinations": {
                          d: {k: {"candidate_count": v["candidate_count"],
                                  "eligible": v["eligible_unique_geometry_count"],
                                  "low": v["rankings"]["low"][:1], "any": v["rankings"]["any"][:1],
                                  "outcomes": v["selection_outcomes"]}
                              for k, v in vals.items()} for d, vals in report["combinations"].items()}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
