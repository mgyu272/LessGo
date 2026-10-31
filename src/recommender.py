"""Explainable 3 km running-course search using OSM candidates and ORS routes."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.osm_data import (OSM_ATTRIBUTION, OSMDataError, build_osm_candidates,
                          build_advisory_areas, build_restricted_areas, build_station_accessible_running_starts,
                          fetch_osm_elements, fetch_restricted_area_elements,
                          point_in_restricted_area, route_intersects_restricted_area)
from src.running_metrics import (build_osm_edge_grid, build_riverside_walkable_edge_grid,
                                 build_waterway_edge_grid, evaluate_route_geometry)
from src.routing import RouteError, fetch_walking_route_points, save_route_files


MAX_ORS_CALLS = 18
MAX_WAYPOINTS_PER_ROUTE = 2
GRADE_SEGMENT_MIN_M = 20.0
ROUTE_CACHE_PATH = Path("outputs") / "cache" / "ors_routes.json"
DEFAULTS_PATH = Path("data") / "route_defaults.json"


def _write_route_cache(path: Path, cache: dict[str, Any]) -> None:
    """Atomically persist route responses so interrupted searches can resume."""
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    last_error: PermissionError | None = None
    # OneDrive or antivirus scanners may briefly hold the cache during sync.
    # Retry the atomic rename so a transient Windows file lock does not throw
    # away otherwise-valid ORS results or stop a long recommendation run.
    for attempt in range(6):
        try:
            temporary_path.replace(path)
            return
        except PermissionError as exc:
            last_error = exc
            if attempt == 5:
                break
            time.sleep(0.15 * (attempt + 1))
    if last_error is not None:
        raise last_error


def _read_candidates(path: Path) -> list[dict[str, Any]]:
    candidates = []
    with path.open(encoding="utf-8-sig", newline="") as csv_file:
        for row in csv.DictReader(csv_file):
            candidate = dict(row)
            candidate["latitude"] = float(candidate["latitude"])
            candidate["longitude"] = float(candidate["longitude"])
            for flag in ("entrance_verified", "coordinate_verified", "required_for_comparison"):
                candidate[flag] = candidate.get(flag, "").strip().lower() == "true"
            candidate.setdefault("accessibility_score", 1.0 if candidate.get("category", candidate.get("access_type")) in {"transit", "subway_exit"} else 0.7)
            candidate.setdefault("access_type", candidate.get("category", "mapped_location"))
            candidate.setdefault("coordinate_source", "existing project candidate CSV")
            candidate.setdefault("candidate_origin", "curated_candidate_list")
            candidates.append(candidate)
    return candidates


def _coordinate_key(stops: list[dict[str, Any]]) -> str:
    coordinates = [[round(float(p["longitude"]), 6), round(float(p["latitude"]), 6)] for p in stops]
    raw = json.dumps({"profile": "foot-walking", "elevation": True, "coordinates": coordinates}, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _route_geometry_signature(route: dict[str, Any]) -> str | None:
    """Return a stable geometry key for deduplicating the same routed path."""
    coordinates = (route.get("geometry") or {}).get("coordinates") or []
    if len(coordinates) < 2:
        return None
    normalized = []
    try:
        for point in coordinates:
            normalized.append([round(float(point[0]), 5), round(float(point[1]), 5)])
    except (TypeError, ValueError, IndexError):
        return None
    payload = json.dumps(normalized, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _route_origin_mode(route: dict[str, Any]) -> str:
    """Infer which preference produced a cached response, if its id records it."""
    suffix = str(route.get("route_id", "")).rsplit("-", 1)[-1]
    return suffix if suffix in {"low", "any"} else "unknown"


def _dedupe_route_candidates_by_geometry(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep one representative per actual geometry while preserving provenance."""
    unique: dict[str, dict[str, Any]] = {}

    def quality(item: dict[str, Any]) -> tuple[float, float, float, float]:
        start = item.get("start", {})
        running = start.get("running_fitness_access_score")
        if running is None:
            running = max((float(w.get("running_way_score", 50) or 50)
                           for w in item.get("waypoints", [])), default=50.0)
        access = float(start.get("accessibility_score", 0.5) or 0.5)
        verified = 2.0 * bool(start.get("entrance_verified")) + bool(start.get("coordinate_verified"))
        snap = float((item.get("geometry_metrics", {}).get("access_connections") or {}).get("max_stop_snap_m") or 50.0)
        return float(running), access, float(verified), -snap

    for item in candidates:
        signature = _route_geometry_signature(item.get("route", {}))
        if signature is None:
            continue
        item["common_pool_geometry_signature"] = signature
        existing = unique.get(signature)
        if existing is None:
            unique[signature] = item
            continue
        modes = set(existing.get("candidate_source_modes", [])) | set(item.get("candidate_source_modes", []))
        caches = set(existing.get("candidate_source_caches", [])) | set(item.get("candidate_source_caches", []))
        winner = item if quality(item) > quality(existing) else existing
        winner["candidate_source_modes"] = sorted(modes)
        winner["candidate_source_caches"] = sorted(caches)
        unique[signature] = winner
    return list(unique.values())


def _load_shared_route_cache(
    root: Path, active_cache: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, list[str]], dict[str, Any]]:
    """Read the active ORS cache and phase-6 experiment caches without modifying them.

    The active project cache takes precedence for duplicate coordinate keys. Cached
    routes are still untrusted here: callers must revalidate destination, distance,
    connectivity, OSM restrictions, and route metrics before ranking them.
    """
    cache_path = root / ROUTE_CACHE_PATH
    experiment_cache_paths = sorted(
        (root / "analysis" / "experiments").glob("phase6*/outputs/cache/ors_routes.json"),
        key=lambda path: (path.stat().st_mtime if path.exists() else 0, str(path)),
    ) if (root / "analysis" / "experiments").exists() else []
    lookup: dict[str, Any] = {}
    sources: dict[str, list[str]] = {}
    diagnostics: dict[str, Any] = {
        "cache_files_read": [], "cache_entries_read": 0,
        "duplicate_coordinate_keys": 0, "experiment_cache_entries": 0,
    }

    def add_cache(cache: dict[str, Any], label: str, *, prefer: bool = False) -> None:
        for stored_key, route in cache.items():
            if not isinstance(route, dict):
                continue
            diagnostics["cache_entries_read"] += 1
            if label != "active_project_cache":
                diagnostics["experiment_cache_entries"] += 1
            aliases = [str(stored_key)]
            stops = route.get("stops") or []
            if len(stops) >= 2:
                try:
                    aliases.append(_coordinate_key(stops))
                except (KeyError, TypeError, ValueError):
                    pass
            for key in dict.fromkeys(aliases):
                if key in lookup:
                    diagnostics["duplicate_coordinate_keys"] += 1
                    if label not in sources.setdefault(key, []):
                        sources[key].append(label)
                    if not prefer:
                        continue
                lookup[key] = route
                if label not in sources.setdefault(key, []):
                    sources[key].append(label)

    for path in experiment_cache_paths:
        try:
            cached = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        if isinstance(cached, dict):
            add_cache(cached, str(path.relative_to(root)))
            diagnostics["cache_files_read"].append(str(path.relative_to(root)))
    # The currently configured cache is freshest for this project and wins conflicts.
    add_cache(active_cache, "active_project_cache", prefer=True)
    if cache_path.exists() and "outputs/cache/ors_routes.json" not in diagnostics["cache_files_read"]:
        diagnostics["cache_files_read"].append("outputs/cache/ors_routes.json")
    return lookup, sources, diagnostics


def _cached_route_candidate(
    route_response: dict[str, Any], destination: dict[str, Any], target_distance_km: float,
    distance_tolerance_m: float, preference: str, running_focused: bool,
    osm: dict[str, Any], metric_index: dict[str, Any], fitness_config: dict[str, Any],
    riverside_index: dict[str, Any], waterway_index: dict[str, Any],
    restricted_areas: list[dict[str, Any]], advisory_areas: list[dict[str, Any]],
    exclusion_config: dict[str, Any], steep_grade_threshold_percent: float,
    grade_config: dict[str, Any], source_labels: list[str] | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    """Revalidate one shared cached ORS response against this run's current data."""
    if route_response.get("profile") != "foot-walking":
        return None, "not_foot_walking"
    stops = route_response.get("stops") or []
    coordinates = (route_response.get("geometry") or {}).get("coordinates") or []
    if len(stops) < 2 or len(coordinates) < 2:
        return None, "missing_stops_or_geometry"
    try:
        if _point_key(stops[-1]) != _point_key(destination):
            return None, "stale_destination_coordinate"
        if any(not all(field in stop for field in ("latitude", "longitude")) for stop in stops):
            return None, "invalid_stop_coordinate"
        start_snap = _haversine_m((coordinates[0][1], coordinates[0][0]), _stop_point(stops[0]))
        end_snap = _haversine_m((coordinates[-1][1], coordinates[-1][0]), _stop_point(stops[-1]))
    except (KeyError, TypeError, ValueError, IndexError):
        return None, "invalid_stop_or_geometry_coordinate"
    if start_snap > 50.0 or end_snap > 50.0:
        return None, "route_endpoint_disconnected"
    summary = dict(route_response.get("summary") or {})
    distance_km = summary.get("distance_km")
    if distance_km is None and summary.get("distance_m") is not None:
        distance_km = float(summary["distance_m"]) / 1000.0
    if distance_km is None or not _within_distance_tolerance(
            float(distance_km), target_distance_km, distance_tolerance_m):
        return None, "outside_distance_tolerance"
    if summary.get("duration_minutes") is None and summary.get("duration_seconds") is None:
        return None, "missing_route_summary"

    route = dict(route_response)
    route["summary"] = {**summary, "distance_km": float(distance_km)}
    route["stops"] = [dict(stop) for stop in stops]
    route["destination"] = dict(destination)
    start, waypoints = route["stops"][0], route["stops"][1:-1]
    route["route_id"] = _route_id(start, waypoints, destination, target_distance_km, preference)
    try:
        geometry_metrics = evaluate_route_geometry(
            route, osm, metric_index, fitness_config, riverside_index, waterway_index,
        )
    except (KeyError, TypeError, ValueError, IndexError):
        return None, "osm_metric_evaluation_failed"
    network_metrics = geometry_metrics.get("network") or {}
    if network_metrics.get("explicit_access_restricted_m") is None:
        return None, "restriction_status_unknown"
    if float(network_metrics.get("explicit_access_restricted_m") or 0) > 0:
        return None, "explicit_access_restriction"
    hard_area = route_intersects_restricted_area(
        route, restricted_areas,
        sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
    )
    if hard_area:
        return None, "hard_restricted_area"
    connections = geometry_metrics.get("access_connections") or {}
    if running_focused and not connections.get("all_stops_connected"):
        return None, "stop_connection_unverified"
    slope = _grade_metrics(route, steep_grade_threshold_percent, grade_config)
    if running_focused:
        running_metrics = geometry_metrics.get("running_fitness") or {}
        if running_metrics.get("score") is None:
            return None, "running_metrics_missing"
        if network_metrics.get("matched_osm_network_share") is None:
            return None, "osm_match_metric_missing"
    edges, repeated_m, measured_m = _edge_signatures(route)
    distance_error_m = abs(float(distance_km) * 1000 - target_distance_km * 1000)
    ascent = route["summary"].get("ascent_m")
    descent = route["summary"].get("descent_m")
    advisory = route_intersects_restricted_area(
        route, advisory_areas,
        sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
    )
    return {
        "route": route, "start": start, "waypoints": waypoints,
        "distance_error_m": distance_error_m, "edges": edges,
        "repeated_segment_m": repeated_m, "measured_distance_m": measured_m,
        "slope": slope, "ascent_m": float(ascent) if ascent is not None else None,
        "descent_m": float(descent) if descent is not None else None,
        "geometry_metrics": geometry_metrics,
        "search_stage": "shared_cached_candidate_pool",
        "candidate_source_modes": sorted({_route_origin_mode(route_response)} - {"unknown"}),
        "candidate_source_caches": sorted(set(source_labels or [])),
        "advisory_area_intersections": [advisory] if advisory else [],
        "elevation_data_quality": slope.get("elevation_data_quality"),
    }, None


def _point_key(point: dict[str, Any]) -> tuple[int, int]:
    """Match the six-decimal coordinate precision used by the ORS cache key."""
    return (round(float(point["longitude"]) * 1_000_000),
            round(float(point["latitude"]) * 1_000_000))


def _candidate_quality(item: dict[str, Any]) -> tuple[float, float, float, float]:
    """Return only observed candidate signals; missing OSM tags stay neutral."""
    running = item.get("running_way_score", item.get("running_fitness_access_score"))
    running_score = float(running) if running is not None else 50.0
    access = item.get("accessibility_score")
    access_score = float(access) * 100.0 if access is not None else 50.0
    verification = (10.0 if item.get("entrance_verified") else 0.0) + (
        5.0 if item.get("coordinate_verified") else 0.0)
    station_access = item.get("station_access") or {}
    access_score += 15.0 if station_access.get("route_verified") else 0.0
    access_score += 10.0 if station_access.get("osm_topology_verified") else 0.0
    return running_score, access_score, verification, float(item.get("distance_error_m", 0.0) or 0.0)


def _cached_start_route_quality(
    cache: dict[str, Any], starts: list[dict[str, Any]], destination: dict[str, Any],
    target_distance_km: float, tolerance_m: float, preference: str, steep_grade_threshold_percent: float,
    osm: dict[str, Any],
    metric_index: dict[str, Any], fitness_config: dict[str, Any],
    riverside_index: dict[str, Any], waterway_index: dict[str, Any],
    restricted_areas: list[dict[str, Any]], grade_config: dict[str, Any],
) -> tuple[dict[tuple[int, int], float], dict[str, int]]:
    """Build start hints only from cached ORS routes revalidated against current settings/data."""
    start_by_point = {_point_key(item): item for item in starts}
    quality_by_point: dict[tuple[int, int], float] = {}
    counts = {"cache_entries": 0, "matching_starts": 0, "valid_route_hints": 0,
              "rejected_distance": 0, "rejected_restriction": 0, "rejected_connection": 0}
    for cached in cache.values():
        counts["cache_entries"] += 1
        if not isinstance(cached, dict) or cached.get("profile") != "foot-walking":
            continue
        cached_stops = cached.get("stops") or []
        start_meta = cached.get("start") or (cached_stops[0] if cached_stops else {})
        destination_meta = cached.get("destination") or (cached_stops[-1] if cached_stops else {})
        if not all(key in start_meta for key in ("latitude", "longitude")):
            continue
        if not all(key in destination_meta for key in ("latitude", "longitude")):
            continue
        point_key = _point_key(start_meta)
        start = start_by_point.get(point_key)
        if start is None or _point_key(destination_meta) != _point_key(destination):
            continue
        counts["matching_starts"] += 1
        summary = cached.get("summary") or {}
        distance_km = summary.get("distance_km")
        if distance_km is None and summary.get("distance_m") is not None:
            distance_km = float(summary["distance_m"]) / 1000.0
        if distance_km is None or not _within_distance_tolerance(float(distance_km), target_distance_km, tolerance_m):
            counts["rejected_distance"] += 1
            continue
        coordinates = (cached.get("geometry") or {}).get("coordinates") or []
        if len(coordinates) < 2:
            continue
        cached_route = dict(cached)
        cached_route["stops"] = ([start, *cached_stops[1:-1], destination]
                                  if len(cached_stops) >= 2 else [start, destination])
        metrics = evaluate_route_geometry(cached_route, osm, metric_index, fitness_config,
                                          riverside_index, waterway_index)
        blocked_m = float((metrics.get("network") or {}).get("explicit_access_restricted_m") or 0.0)
        restricted_name = route_intersects_restricted_area(cached_route, restricted_areas)
        if blocked_m > 0 or restricted_name:
            counts["rejected_restriction"] += 1
            continue
        if not metrics.get("access_connections", {}).get("all_stops_connected", False):
            counts["rejected_connection"] += 1
            continue
        slope = _grade_metrics(cached_route, steep_grade_threshold_percent, grade_config)
        fitness = (metrics.get("running_fitness") or {}).get("score")
        if fitness is None:
            continue
        error_m = abs(float(distance_km) * 1000.0 - target_distance_km * 1000.0)
        distance_score = max(0.0, 100.0 - error_m / max(tolerance_m, 1.0) * 40.0)
        if preference == "low" and slope.get("uphill_grade_metrics"):
            uphill = slope["uphill_grade_metrics"]
            thresholds = uphill.get("thresholds", {})
            share8 = float(thresholds.get("8_percent", {}).get("share") or 0.0)
            share10 = float(thresholds.get("10_percent", {}).get("share") or 0.0)
            max_grade = float(uphill.get("max_sustained_uphill_grade_percent") or 0.0)
            long8 = float(thresholds.get("8_percent", {}).get("longest_continuous_m") or 0.0)
            ascent = float(summary.get("ascent_m") or 0.0)
            burden = (share10 * 400.0 + share8 * 200.0 + max_grade * 1.5
                      + long8 / max(target_distance_km * 10.0, 1.0)
                      + (ascent / max(target_distance_km, 0.1)) * 0.05)
            gentle = (share8 <= float(grade_config.get("gentle_max_uphill_8_share", 0.12))
                      and max_grade <= float(grade_config.get("gentle_max_sustained_grade_percent", 8.0)))
            quality = (100.0 if gentle else 0.0) + max(0.0, 100.0 - min(100.0, 0.85 * burden
                                                                       + 0.15 * (100.0 - float(fitness))))
        else:
            walkability = float((metrics.get("network") or {}).get("walkability_score") or 0.0)
            quality = (0.55 * float(fitness) + 0.20 * walkability + 0.20 * distance_score
                       + 0.05 * float(start.get("accessibility_score", 0.5) or 0.5) * 100.0)
        old = quality_by_point.get(point_key)
        quality_by_point[point_key] = max(old, quality) if old is not None else quality
        counts["valid_route_hints"] += 1
    return quality_by_point, counts


def _dedupe_candidates_by_coordinate(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse ID aliases at ORS cache precision, retaining the strongest observed metadata."""
    kept: dict[tuple[int, int], dict[str, Any]] = {}
    for item in candidates:
        key = _point_key(item)
        previous = kept.get(key)
        if previous is None or _candidate_quality(item) > _candidate_quality(previous):
            chosen = dict(item)
            if previous:
                chosen["coordinate_alias_ids"] = sorted(set(
                    [str(value) for value in previous.get("coordinate_alias_ids", [])]
                    + [str(previous.get("id", "")), str(item.get("id", ""))]
                ) - {""})
            kept[key] = chosen
        elif previous is not None:
            aliases = set(previous.get("coordinate_alias_ids", []))
            aliases.add(str(item.get("id", "")))
            previous["coordinate_alias_ids"] = sorted(aliases - {""})
    return list(kept.values())


def _slug(value: str) -> str:
    value = re.sub(r"[^\w-]+", "-", value.strip().lower(), flags=re.UNICODE).strip("-")
    return value or "destination"


def _distance_label(target_distance_km: float) -> str:
    return f"{target_distance_km:g}km"


def _within_distance_tolerance(distance_km: float, target_distance_km: float, tolerance_m: float) -> bool:
    """Use the actual routed distance for the configured absolute tolerance."""
    return abs(float(distance_km) - float(target_distance_km)) * 1000 <= float(tolerance_m) + 1e-7


def _route_id(start: dict[str, Any], waypoints: list[dict[str, Any]], destination: dict[str, Any], target_distance_km: float, slope_preference: str | None = None) -> str:
    parts = [_distance_label(target_distance_km), _slug(str(start["id"]))]
    if waypoints:
        parts.extend(["via", *[_slug(str(point["id"])) for point in waypoints]])
    parts.append(_slug(str(destination["id"])))
    if slope_preference:
        parts.append(slope_preference)
    return "-".join(str(part) for part in parts)


def _haversine_m(a: list[float] | tuple[float, float], b: list[float] | tuple[float, float]) -> float:
    lat1, lon1 = math.radians(float(a[0])), math.radians(float(a[1]))
    lat2, lon2 = math.radians(float(b[0])), math.radians(float(b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(value))


def _stop_point(point: dict[str, Any]) -> tuple[float, float]:
    return float(point["latitude"]), float(point["longitude"])


def _edge_signatures(route: dict[str, Any]) -> tuple[set[tuple[tuple[float, float], tuple[float, float]]], float, float]:
    coordinates = route.get("geometry", {}).get("coordinates", [])
    edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    seen: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    repeated_m = 0.0
    for a, b in zip(coordinates, coordinates[1:]):
        qa, qb = (round(float(a[0]), 5), round(float(a[1]), 5)), (round(float(b[0]), 5), round(float(b[1]), 5))
        edge = tuple(sorted((qa, qb)))
        length = _haversine_m((a[1], a[0]), (b[1], b[0]))
        edges.add(edge)
        if edge in seen:
            repeated_m += length
        seen.add(edge)
    return edges, repeated_m, float(route.get("summary", {}).get("distance_m") or 0)


def _route_overlap_fraction(left: dict[str, Any], right: dict[str, Any]) -> float | None:
    """Length-weighted share of the shorter route using the same mapped OSM edges."""
    left_lengths = left.get("geometry_metrics", {}).get("network", {}).get("mapped_edge_lengths_m", {})
    right_lengths = right.get("geometry_metrics", {}).get("network", {}).get("mapped_edge_lengths_m", {})
    left_total = sum(float(value) for value in left_lengths.values())
    right_total = sum(float(value) for value in right_lengths.values())
    if left_total > 0 and right_total > 0:
        shared = sum(min(float(left_lengths[key]), float(right_lengths[key]))
                     for key in left_lengths.keys() & right_lengths.keys())
        return min(1.0, shared / min(left_total, right_total))
    left_edges, right_edges = left.get("mapped_edge_ids", set()), right.get("mapped_edge_ids", set())
    if left_edges and right_edges:
        return len(left_edges & right_edges) / min(len(left_edges), len(right_edges))
    return None


def _smooth_elevations(values: list[float]) -> list[float]:
    """Median smooth adjacent elevation noise while preserving broad terrain changes."""
    if len(values) < 3:
        return values[:]
    return [statistics.median(values[max(0, i - 2):min(len(values), i + 3)]) for i in range(len(values))]


def _grade_metrics(
    route: dict[str, Any],
    steep_grade_threshold_percent: float,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Measure sustained uphill grades on a distance-resampled, smoothed profile."""
    config = config or {}
    sample_m = max(5.0, float(config.get("profile_sample_m", GRADE_SEGMENT_MIN_M)))
    smooth_window_m = max(sample_m, float(config.get("smoothing_window_m", 60.0)))
    sustained_window_m = max(sample_m, float(config.get("sustained_window_m", 100.0)))
    gap_warning_m = max(sample_m, float(config.get("elevation_gap_warning_m", max(100.0, sample_m * 5))))
    uphill_thresholds = [float(value) for value in config.get("uphill_thresholds_percent", [8.0, 10.0])]
    coordinates = route.get("geometry", {}).get("coordinates", [])
    points = [(float(p[0]), float(p[1]), float(p[2])) for p in coordinates if len(p) >= 3]
    if len(points) < 2 or len(points) != len(coordinates):
        return {
            "grade_segments": [], "steep_segment_ratio": None, "steep_distance_m": None,
            "uphill_grade_metrics": None, "grade_segment_min_m": sample_m,
            "elevation_data_quality": {"status": "unknown", "coordinate_count": len(coordinates),
                                       "warning_gap_threshold_m": gap_warning_m,
                                       "note": "Elevation coordinates are missing or incomplete; grade confidence cannot be assessed."},
        }

    chainage = [0.0]
    for a, b in zip(points, points[1:]):
        chainage.append(chainage[-1] + _haversine_m((a[1], a[0]), (b[1], b[0])))
    total = chainage[-1]
    if total <= 0:
        return {"grade_segments": [], "steep_segment_ratio": None, "steep_distance_m": None,
                "uphill_grade_metrics": None, "grade_segment_min_m": sample_m,
                "elevation_data_quality": {"status": "unknown", "coordinate_count": len(points),
                                           "warning_gap_threshold_m": gap_warning_m,
                                           "note": "Route distance is unavailable; grade confidence cannot be assessed."}}

    def raw_elevation_at(distance_m: float) -> float:
        import bisect
        right = min(len(chainage) - 1, bisect.bisect_left(chainage, distance_m))
        if right == 0:
            return points[0][2]
        left = right - 1
        span = chainage[right] - chainage[left]
        ratio = (distance_m - chainage[left]) / span if span > 0 else 0.0
        return points[left][2] + (points[right][2] - points[left][2]) * ratio

    # Resample in metres first; the median window then has consistent ground
    # coverage regardless of how densely ORS returned coordinates.
    positions = [0.0]
    cursor = sample_m
    while cursor < total:
        positions.append(cursor)
        cursor += sample_m
    if total - positions[-1] > sample_m * 0.5:
        positions.append(total)
    else:
        positions[-1] = total
    raw_profile = [raw_elevation_at(position) for position in positions]
    half_window = smooth_window_m / 2.0
    profile = []
    for position in positions:
        neighborhood = [z for chain, z in zip(chainage, [point[2] for point in points])
                        if abs(chain - position) <= half_window]
        profile.append(statistics.median(neighborhood) if len(neighborhood) >= 3
                       else raw_profile[len(profile)])

    segments: list[dict[str, float]] = []
    for index in range(len(positions) - 1):
        span = positions[index + 1] - positions[index]
        if span <= 0:
            continue
        dz = profile[index + 1] - profile[index]
        segments.append({"start_m": positions[index], "distance_m": span,
                         "elevation_change_m": dz, "grade_percent": dz / span * 100.0})

    def longest_contiguous(threshold: float) -> float:
        best = current = 0.0
        for segment in segments:
            if segment["grade_percent"] >= threshold:
                current += segment["distance_m"]
                best = max(best, current)
            else:
                current = 0.0
        return best

    def profile_at(distance_m: float) -> float:
        import bisect
        right = min(len(positions) - 1, bisect.bisect_left(positions, distance_m))
        if right == 0:
            return profile[0]
        left = right - 1
        span = positions[right] - positions[left]
        ratio = (distance_m - positions[left]) / span if span > 0 else 0.0
        return profile[left] + (profile[right] - profile[left]) * ratio

    actual_sustained_window = min(sustained_window_m, total)
    sustained_grades: list[tuple[float, float, float]] = []
    if actual_sustained_window > 0:
        start_positions = positions if actual_sustained_window >= total else [
            position for position in positions if position + actual_sustained_window <= total
        ]
        for start in start_positions:
            rise = profile_at(start + actual_sustained_window) - profile_at(start)
            sustained_grades.append((rise / actual_sustained_window * 100.0, start, rise))

    uphill_metrics = {}
    for threshold in uphill_thresholds:
        distance = sum(segment["distance_m"] for segment in segments if segment["grade_percent"] >= threshold)
        uphill_metrics[f"{int(threshold)}_percent"] = {
            "distance_m": round(distance, 1), "share": round(distance / total, 4),
            "longest_continuous_m": round(longest_contiguous(threshold), 1),
        }
    legacy_steep = sum(segment["distance_m"] for segment in segments
                       if abs(segment["grade_percent"]) >= steep_grade_threshold_percent)
    coordinate_gaps = [
        {"start_m": chainage[index], "end_m": chainage[index + 1],
         "distance_m": chainage[index + 1] - chainage[index],
         "elevation_change_m": points[index + 1][2] - points[index][2]}
        for index in range(len(chainage) - 1)
    ]
    max_gap = max(coordinate_gaps, key=lambda gap: gap["distance_m"], default=None)
    max_sustained = max(sustained_grades, key=lambda row: row[0], default=None)
    max_window_start = max_sustained[1] if max_sustained else None
    max_window_end = (max_window_start + actual_sustained_window) if max_window_start is not None else None
    max_window_gap = next((gap for gap in coordinate_gaps
                           if max_window_start is not None
                           and gap["start_m"] < max_window_end
                           and gap["end_m"] > max_window_start
                           and gap["distance_m"] > gap_warning_m), None)
    gap_lengths = [gap["distance_m"] for gap in coordinate_gaps]
    elevation_data_quality = {
        "status": ("warning" if max_gap and max_gap["distance_m"] > gap_warning_m else "ok"),
        "coordinate_count": len(points),
        "median_coordinate_spacing_m": round(statistics.median(gap_lengths), 1) if gap_lengths else None,
        "max_coordinate_spacing_m": round(max_gap["distance_m"], 1) if max_gap else None,
        "warning_gap_threshold_m": round(gap_warning_m, 1),
        "warning_gap_count": sum(gap["distance_m"] > gap_warning_m for gap in coordinate_gaps),
        "max_gap": ({key: round(float(value), 2) for key, value in max_gap.items()}
                    if max_gap else None),
        "max_sustained_window_overlaps_warning_gap": max_window_gap is not None,
        "max_sustained_window_warning_gap": ({key: round(float(value), 2) for key, value in max_window_gap.items()}
                                               if max_window_gap else None),
        "note": "Large ORS coordinate gaps can make interpolated elevation grades less reliable; elevations and grade values are preserved without correction.",
    }
    return {
        "grade_segments": [{key: round(value, 2) for key, value in segment.items()} for segment in segments],
        "steep_segment_ratio": legacy_steep / total if total else 0.0,
        "steep_distance_m": legacy_steep,
        "grade_segment_min_m": sample_m,
        "steep_grade_threshold_percent": steep_grade_threshold_percent,
        "elevation_smoothing": f"distance-resampled {sample_m:.0f}m profile; median over {smooth_window_m:.0f}m window",
        "uphill_grade_metrics": {
            "thresholds": uphill_metrics,
            "max_sustained_uphill_grade_percent": round(max_sustained[0], 2) if max_sustained else None,
            "max_sustained_window_start_m": round(max_window_start, 1) if max_window_start is not None else None,
            "max_sustained_window_end_m": round(max_window_end, 1) if max_window_end is not None else None,
            "max_sustained_window_elevation_gain_m": round(max_sustained[2], 2) if max_sustained else None,
            "sustained_window_m": round(actual_sustained_window, 1),
            "profile_sample_m": sample_m,
            "smoothing_window_m": smooth_window_m,
            "note": "Positive uphill grade only; ORS elevation coordinates resampled by route distance and median-smoothed. This is a terrain estimate, not a field slope survey.",
        },
        "elevation_data_quality": elevation_data_quality,
    }


def _score_route_candidate(
    item: dict[str, Any], destination: dict[str, Any], target_distance_km: float,
    distance_tolerance_m: float, preferred_distance_error_m: float, preference: str,
    running_focused: bool, defaults: dict[str, Any], fitness_config: dict[str, Any],
    direct_distance_km: float | None = None,
) -> dict[str, Any]:
    """Apply the common route scoring used for searched routes and saved baselines."""
    score_weights = dict(defaults.get("running_score_weights", {}).get(preference, {}))
    if running_focused:
        fitness_weight = float(fitness_config.get("route_score_weights", {}).get(preference, 0.30))
        base_total = sum(float(value) for value in score_weights.values())
        scale = max(0.0, 1.0 - fitness_weight) / base_total if base_total else 0.0
        score_weights = {key: float(value) * scale for key, value in score_weights.items()}
        score_weights["running_fitness"] = fitness_weight
    route = item["route"]
    distance_km = float(route["summary"]["distance_km"])
    start = item["start"]
    direct_km = (float(direct_distance_km) if direct_distance_km is not None else
                 max(_haversine_m(_stop_point(start), _stop_point(destination)) / 1000.0, 0.1))
    detour_ratio = distance_km / direct_km if direct_km else 1.0
    distance_score = max(0.0, 100.0 - (item["distance_error_m"] / max(distance_tolerance_m, 1)) * 40.0)
    if item["distance_error_m"] <= preferred_distance_error_m:
        distance_score = min(100.0, distance_score + 10.0 * (1.0 - item["distance_error_m"] / max(preferred_distance_error_m, 1)))
    slope = item["slope"]
    geometry_metrics = item["geometry_metrics"]
    crossing_metrics = geometry_metrics["crossings"]
    network_metrics = geometry_metrics["network"]
    uphill = slope.get("uphill_grade_metrics") or {}
    thresholds = uphill.get("thresholds", {})
    uphill_8_share = float(thresholds.get("8_percent", {}).get("share") or 0.0)
    uphill_10_share = float(thresholds.get("10_percent", {}).get("share") or 0.0)
    longest_8_m = float(thresholds.get("8_percent", {}).get("longest_continuous_m") or 0.0)
    max_sustained_grade = float(uphill.get("max_sustained_uphill_grade_percent") or 0.0)
    ascent = item.get("ascent_m")
    slope_score = None
    if slope.get("uphill_grade_metrics") is not None:
        mode_penalties = defaults.get("grade_assessment", {}).get("mode_penalties", {}).get(preference, {})
        uphill8_weight = float(mode_penalties.get("uphill_8_share", 35.0 if preference == "low" else 12.0))
        uphill10_weight = float(mode_penalties.get("uphill_10_share", 25.0 if preference == "low" else 8.0))
        sustained_weight = float(mode_penalties.get("max_sustained_grade", 20.0 if preference == "low" else 8.0))
        long_climb_weight = float(mode_penalties.get("long_climb", 10.0 if preference == "low" else 4.0))
        ascent_weight = float(mode_penalties.get("ascent_per_km", 10.0 if preference == "low" else 8.0))
        ascent_per_km = (ascent or 0.0) / max(target_distance_km, 0.1)
        slope_score = max(0.0, 100.0 - uphill_8_share * uphill8_weight
                          - uphill_10_share * uphill10_weight
                          - min(1.0, max_sustained_grade / 12.0) * sustained_weight
                          - min(1.0, longest_8_m / 300.0) * long_climb_weight
                          - min(1.0, ascent_per_km / 80.0) * ascent_weight)
        terrain_burden = (uphill_10_share * 400.0 + uphill_8_share * 200.0
                          + max_sustained_grade * 1.5
                          + longest_8_m / max(target_distance_km * 10.0, 1.0)
                          + ascent_per_km * 0.05)
    else:
        terrain_burden = None
    if running_focused:
        access_default = 0.50 if start.get("access_type") == "subway_entrance" else 0.72
        access_score = max(0.0, min(100.0, float(start.get("accessibility_score", access_default) or access_default) * 100.0))
        if start.get("access_type") == "subway_entrance" and "running_fitness_access_score" not in start:
            access_score = 50.0
    else:
        access_score = max(0.0, min(100.0, float(start.get("accessibility_score", 0.5) or 0.5) * 100.0))
    detour_penalty = max(0.0, detour_ratio - 1.85) * 28.0
    continuity_score = max(0.0, 100.0 - detour_penalty)
    components = {
        "distance": round(distance_score, 2),
        "crossings": round(float(crossing_metrics["crossing_score"]), 2),
        "continuity": round(continuity_score, 2),
        "slope": round(slope_score, 2) if slope_score is not None else None,
        "walkability": network_metrics.get("walkability_score"),
        "running_fitness": geometry_metrics["running_fitness"].get("score") if running_focused else None,
        "access": round(access_score, 2),
    }
    effective_weights = {name: float(weight) for name, weight in score_weights.items()
                         if components.get(name) is not None}
    weight_sum = sum(effective_weights.values())
    total_score = (sum(float(components[name]) * weight for name, weight in effective_weights.items()) / weight_sum
                   if weight_sum else None)
    mapped_repeat_share = network_metrics.get("repeated_mapped_network_edge_share")
    repeat_fraction = (mapped_repeat_share if mapped_repeat_share is not None else
                       (item.get("repeated_segment_m", 0.0) / item.get("measured_distance_m", 0.0)
                        if item.get("measured_distance_m") else 0.0))
    return {"distance_score": distance_score, "slope_score": slope_score,
            "access_score": access_score, "continuity_score": continuity_score,
            "component_scores": components, "effective_score_weights": effective_weights,
            "total_score": total_score, "low_terrain_burden": terrain_burden,
            "detour_ratio": detour_ratio, "repeated_fraction": repeat_fraction,
            "mapped_edge_ids": set(network_metrics.get("mapped_edge_ids", []))}


def _route_rank_key(item: dict[str, Any], preference: str, running_focused: bool) -> tuple[Any, ...]:
    """Return the active selector's ranking key, shared with baseline comparisons."""
    route_id = str(item["route"].get("route_id", ""))
    if preference == "low":
        if running_focused:
            terrain = item.get("low_terrain_burden")
            fitness = item.get("geometry_metrics", {}).get("running_fitness", {}).get("score")
            terrain_rank = float(terrain) if terrain is not None else float("inf")
            fitness_penalty = 100.0 - float(fitness) if fitness is not None else 100.0
            return (0 if item.get("meets_gentle_thresholds") else 1,
                    0.85 * terrain_rank + 0.15 * fitness_penalty,
                    item["distance_error_m"], route_id)
        return (0 if item.get("meets_gentle_thresholds") else 1,
                item.get("low_terrain_burden") if item.get("low_terrain_burden") is not None else float("inf"),
                -(item.get("total_score") if item.get("total_score") is not None else -1),
                item["distance_error_m"], route_id)
    return (-(item.get("total_score") if item.get("total_score") is not None else -1),
            item["distance_error_m"], route_id)


def _evaluate_saved_representative(
    root: Path, destination: dict[str, Any], target_distance_km: float,
    distance_tolerance_m: float, preferred_distance_error_m: float, preference: str,
    defaults: dict[str, Any], fitness_config: dict[str, Any], osm: dict[str, Any],
    metric_index: dict[str, Any], riverside_index: dict[str, Any], waterway_index: dict[str, Any],
    restricted_areas: list[dict[str, Any]], exclusion_config: dict[str, Any],
    steep_grade_threshold_percent: float, grade_config: dict[str, Any],
    restriction_check_available: bool = True,
) -> dict[str, Any] | None:
    """Re-evaluate the saved representative independently; never adds it to top results."""
    index_path = root / "outputs" / "app" / "representative_routes.json"
    if not index_path.is_file():
        return None
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
        entry = index.get("destinations", {}).get(str(destination.get("id")), {}).get(
            _distance_label(target_distance_km), {}).get("representative")
        if not entry:
            return None
        relative = str((entry.get("files") or {}).get("json", "")).replace("\\", "/")
        route_path = root / relative
        route = json.loads(route_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {"status": "needs_verification", "reason": "saved representative route data could not be loaded"}

    route = dict(route)
    start = dict(route.get("start") or entry.get("start") or {})
    vias = [dict(item) for item in (route.get("waypoints") or [])]
    saved_destination = dict(route.get("destination") or entry.get("destination") or {})
    current_destination = dict(destination)
    same_destination = (saved_destination.get("latitude") is not None
                        and saved_destination.get("longitude") is not None
                        and _point_key(saved_destination) == _point_key(current_destination))
    summary = route.get("summary") or {}
    distance_km = summary.get("distance_km")
    geometry = route.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    result: dict[str, Any] = {
        "route_id": route.get("route_id", entry.get("route_id")),
        "source": "outputs/app/representative_routes.json",
        "saved_route_file": relative,
        "start": {key: start.get(key) for key in ("id", "name", "latitude", "longitude", "access_type")},
        "distance_km": distance_km,
        "destination_coordinate_matches_current": same_destination,
        "entrance_verified": bool(start.get("entrance_verified")) and bool(saved_destination.get("entrance_verified")),
        "restriction_check_available": bool(restriction_check_available),
    }
    if route.get("profile") != "foot-walking" or not same_destination or distance_km is None or len(coordinates) < 2:
        result.update({"status": "needs_verification", "comparison_eligible": False,
                       "reason": "profile, current destination coordinate, distance, or route geometry is incomplete"})
        return result
    distance_error = abs(float(distance_km) - target_distance_km) * 1000.0
    if not _within_distance_tolerance(float(distance_km), target_distance_km, distance_tolerance_m):
        result.update({"status": "out_of_tolerance", "comparison_eligible": False,
                       "distance_error_m": round(distance_error, 1)})
        return result
    route["stops"] = route.get("stops") or [start, *vias, current_destination]
    route["destination"] = current_destination
    geometry_metrics = evaluate_route_geometry(route, osm, metric_index, fitness_config,
                                               riverside_index, waterway_index)
    blocked_m = float((geometry_metrics.get("network") or {}).get("explicit_access_restricted_m") or 0.0)
    hard_area = route_intersects_restricted_area(
        route, restricted_areas,
        sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
    )
    connections = geometry_metrics.get("access_connections", {})
    if blocked_m > 0 or hard_area:
        result.update({"status": "excluded_restricted", "comparison_eligible": False,
                       "explicit_access_restricted_m": round(blocked_m, 1), "restricted_area": hard_area})
        return result
    slope = _grade_metrics(route, steep_grade_threshold_percent, grade_config)
    edges, repeated_m, measured_m = _edge_signatures(route)
    ascent = summary.get("ascent_m")
    candidate = {
        "route": route, "start": start, "waypoints": vias,
        "distance_error_m": distance_error, "edges": edges,
        "repeated_segment_m": repeated_m, "measured_distance_m": measured_m,
        "slope": slope, "ascent_m": float(ascent) if ascent is not None else None,
        "geometry_metrics": geometry_metrics,
    }
    candidate.update(_score_route_candidate(
        candidate, current_destination, target_distance_km, distance_tolerance_m,
        preferred_distance_error_m, preference, True, defaults, fitness_config,
    ))
    uphill = slope.get("uphill_grade_metrics") or {}
    thresholds = uphill.get("thresholds", {})
    candidate["meets_gentle_thresholds"] = bool(
        candidate["ascent_m"] is not None
        and candidate["ascent_m"] <= target_distance_km * float(defaults.get("gentle_max_ascent_per_km_m", 33.3333333))
        and float(thresholds.get("8_percent", {}).get("share") or 0.0)
            <= float(grade_config.get("gentle_max_uphill_8_share", 0.12))
        and float(uphill.get("max_sustained_uphill_grade_percent") or 0.0)
            <= float(grade_config.get("gentle_max_sustained_grade_percent", 8.0))
    )
    verified_stops = bool(connections.get("all_stops_connected"))
    metrics_comparable = verified_stops and bool(restriction_check_available)
    recommendation_eligible = metrics_comparable and bool(result["entrance_verified"])
    grade_quality_status = slope.get("elevation_data_quality", {}).get("status", "unknown")
    data_warning = True if grade_quality_status == "warning" else None if grade_quality_status == "unknown" else False
    result.update({
        "status": ("needs_verification" if not recommendation_eligible
                   else "eligible_baseline"),
        "comparison_eligible": metrics_comparable,
        "recommendation_eligible": recommendation_eligible,
        "distance_error_m": round(distance_error, 1),
        "ascent_m": candidate["ascent_m"],
        "grade_metrics": slope,
        "running_fitness_score": (geometry_metrics.get("running_fitness") or {}).get("score"),
        "running_friendly_share": (geometry_metrics.get("running_fitness") or {}).get("running_friendly_share_of_route"),
        "walkability_score": (geometry_metrics.get("network") or {}).get("walkability_score"),
        "crossings": (geometry_metrics.get("crossings") or {}).get("mapped_crossings_total"),
        "repeated_segment_share": round(candidate["repeated_fraction"], 4),
        "osm_match_share": (geometry_metrics.get("network") or {}).get("matched_osm_network_share"),
        "score_components": candidate["component_scores"],
        "score_weights": candidate["effective_score_weights"],
        "current_score": round(candidate["total_score"], 2) if candidate["total_score"] is not None else None,
        "low_terrain_burden": round(candidate["low_terrain_burden"], 2) if candidate["low_terrain_burden"] is not None else None,
        "all_stops_connected_to_ors_geometry": verified_stops,
        "explicit_access_restricted_m": round(blocked_m, 1),
        "hard_restricted_area": hard_area,
        "elevation_quality_warning": data_warning,
        "reason": ("No hard restriction found in current OSM data; unverified entrance status remains a field verification item."
                   if not result["entrance_verified"] else "Re-evaluated from stored ORS geometry against current OSM/configuration."),
        "_candidate": candidate,
    })
    return result


def _merge_candidates(primary: list[dict[str, Any]], secondary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[int, int], dict[str, Any]] = {}
    for item in [*primary, *secondary]:
        key = (round(item["latitude"] * 1e6), round(item["longitude"] * 1e6))
        existing = merged.get(key)
        if existing is None:
            merged[key] = item
            continue
        preferred = item if item.get("coordinate_source", "").startswith("OpenStreetMap") else existing
        other = existing if preferred is item else item
        merged[key] = {
            **other,
            **preferred,
            "required_for_comparison": bool(existing.get("required_for_comparison") or item.get("required_for_comparison")),
            "candidate_origin": ("required_curated_and_osm" if existing.get("required_for_comparison") or item.get("required_for_comparison") else preferred.get("candidate_origin")),
        }
    return list(merged.values())


def _bearing_degrees(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    return (math.degrees(math.atan2(math.sin(dlon) * math.cos(lat2),
                                    math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon))) + 360) % 360


def _balanced_spatial_candidates(
    candidates: list[dict[str, Any]], origin: tuple[float, float], limit: int, *,
    category_key: str, preference: str, target_distance_km: float | None = None,
    cached_route_quality: dict[tuple[int, int], float] | None = None,
) -> list[dict[str, Any]]:
    """Select a deterministic sample balanced across access types and geography.

    Category and source caps are soft: when the rest of the pool is exhausted,
    remaining valid mapped candidates can still fill the requested sample. The
    mode affects only tie-breaking quality; it never infers terrain from a start
    point. Elevation is assessed later from an actual ORS route.
    """
    if limit <= 0 or not candidates:
        return []

    candidates = _dedupe_candidates_by_coordinate(candidates)

    rows: list[dict[str, Any]] = []
    category_totals: dict[str, int] = {}
    source_totals: dict[str, int] = {}
    max_radius = max(_haversine_m(origin, _stop_point(item)) for item in candidates) or 1.0
    for item in candidates:
        category = str(item.get(category_key) or "unknown")
        raw_origin = str(item.get("candidate_origin") or "")
        source = "curated" if "curated" in raw_origin else "osm" if "osm" in raw_origin or raw_origin.startswith("automatic") else "other"
        point = _stop_point(item)
        distance = _haversine_m(origin, point)
        sector = int(_bearing_degrees(origin, point) // 45) % 8
        radial_band = min(2, int(distance / max_radius * 3))
        running_score = float(item.get("running_way_score", item.get("running_fitness_access_score", 50)) or 0)
        access_score = float(item.get("accessibility_score", 0.5) or 0.0) * 100.0
        # Both modes value mapped running quality and approach confidence. The
        # low mode uses estimated distance only as a tie-breaker, never as a
        # claim about the route's grade.
        if preference == "low":
            quality = 0.65 * running_score + 0.35 * access_score
        else:
            quality = 0.85 * running_score + 0.15 * access_score
        estimated_error = (abs(distance * 1.28 - target_distance_km * 1000)
                           if target_distance_km is not None else 0.0)
        rows.append({"item": item, "category": category, "source": source,
                     "sector": sector, "radial_band": radial_band,
                     "distance": distance, "quality": quality,
                     "estimated_error": estimated_error,
                     "cached_route_quality": (cached_route_quality or {}).get(_point_key(item)),
                     "running_score": running_score, "access_score": access_score,
                     "verification_score": (10.0 if item.get("entrance_verified") else 0.0)
                         + (5.0 if item.get("coordinate_verified") else 0.0)
                         + (15.0 if (item.get("station_access") or {}).get("route_verified") else 0.0)
                         + (10.0 if (item.get("station_access") or {}).get("osm_topology_verified") else 0.0)})
        category_totals[category] = category_totals.get(category, 0) + 1
        source_totals[source] = source_totals.get(source, 0) + 1

    category_count = len(category_totals)
    category_cap = max(1, math.ceil(limit / category_count * 1.5)) if category_count > 1 else limit
    balance_sources = len([name for name, count in source_totals.items() if count and name != "other"]) > 1
    source_cap = max(1, math.ceil(limit * 0.40)) if balance_sources else limit
    category_selected: dict[str, int] = {}
    source_selected: dict[str, int] = {}
    sector_selected: dict[int, int] = {}
    radial_selected: dict[int, int] = {}
    selected: list[dict[str, Any]] = []
    remaining = list(rows)

    while remaining and len(selected) < limit:
        category_eligible = [row for row in remaining
                             if category_selected.get(row["category"], 0) < category_cap]
        eligible = [row for row in category_eligible
                    if not balance_sources or row["source"] == "other"
                    or source_selected.get(row["source"], 0) < source_cap]
        # Relax the source cap before the category cap so a large candidate
        # source cannot indirectly make one access type dominate the tail.
        if not eligible:
            eligible = category_eligible
        # Soft caps do not discard valid mapped candidates if alternatives run out.
        if not eligible:
            eligible = remaining

        def priority(row: dict[str, Any]) -> tuple[Any, ...]:
            point = _stop_point(row["item"])
            if selected:
                nearest = min(_haversine_m(point, _stop_point(other["item"])) for other in selected)
                nearby = sum(_haversine_m(point, _stop_point(other["item"])) < 300 for other in selected)
            else:
                nearest = row["distance"]
                nearby = 0
            mode_tie_break = row["estimated_error"] if preference == "low" else -row["quality"]
            quality_tie_break = -row["quality"] if preference == "low" else row["estimated_error"]
            cached_quality_tie_break = -(row["cached_route_quality"]
                                         if row["cached_route_quality"] is not None else -1.0)
            return (sector_selected.get(row["sector"], 0),
                    radial_selected.get(row["radial_band"], 0),
                    category_selected.get(row["category"], 0),
                    source_selected.get(row["source"], 0),
                    cached_quality_tie_break, mode_tie_break, quality_tie_break,
                    -row["verification_score"], -row["access_score"],
                    -row["running_score"], nearby, -nearest,
                    str(row["item"].get("id", "")))

        chosen = min(eligible, key=priority)
        remaining.remove(chosen)
        selected.append(chosen)
        category_selected[chosen["category"]] = category_selected.get(chosen["category"], 0) + 1
        source_selected[chosen["source"]] = source_selected.get(chosen["source"], 0) + 1
        sector_selected[chosen["sector"]] = sector_selected.get(chosen["sector"], 0) + 1
        radial_selected[chosen["radial_band"]] = radial_selected.get(chosen["radial_band"], 0) + 1
    return [row["item"] for row in selected]


def _select_mode_starts(
    candidates: list[dict[str, Any]], destination: dict[str, Any], preference: str,
    limit: int = 64, running_focused: bool = False, target_distance_km: float | None = None,
    cached_route_quality: dict[tuple[int, int], float] | None = None,
) -> list[dict[str, Any]]:
    """Select a mode-aware, spatially and categorically balanced start sample."""
    center = _stop_point(destination)
    if running_focused:
        # Candidate type, direction and distance are balanced before a mode's
        # quality tie-breaker. No location-only slope assumption is made.
        return _balanced_spatial_candidates(
            candidates, center, min(limit, 32), category_key="access_type",
            preference=preference, target_distance_km=target_distance_km,
            cached_route_quality=cached_route_quality,
        )
    required = [item for item in candidates if item.get("required_for_comparison")]
    selected = list(required)
    selected_ids = {str(item["id"]) for item in selected}
    remaining = [item for item in candidates if str(item["id"]) not in selected_ids]
    if preference == "low":
        for category in ("park_entrance", "park_path_connection"):
            options = [item for item in remaining if item.get("access_type") == category]
            if options and len(selected) < limit:
                chosen = max(options, key=lambda item: (
                    min((_haversine_m(_stop_point(item), _stop_point(existing)) for existing in selected), default=0),
                    -_haversine_m(center, _stop_point(item)), str(item["id"]),
                ))
                remaining.remove(chosen)
                selected.append(chosen)
                selected_ids.add(str(chosen["id"]))
    sectors: set[int] = set()
    categories: set[str] = set()
    for item in selected:
        point = _stop_point(item)
        sectors.add(int(_bearing_degrees(center, point) // 45))
        categories.add(str(item.get("access_type", "unknown")))
    while remaining and len(selected) < limit:
        def priority(item: dict[str, Any]) -> tuple[float, float, str]:
            point = _stop_point(item)
            sector = int(_bearing_degrees(center, point) // 45)
            category = str(item.get("access_type", "unknown"))
            separation = min((_haversine_m(point, _stop_point(p)) for p in selected), default=0.0)
            novelty_bonus = 1100.0 if sector not in sectors else 0.0
            novelty_bonus += 1400.0 if category not in categories else 0.0
            if preference == "low" and category in {"park_entrance", "park_path_connection"} and category not in categories:
                novelty_bonus += 2200.0
            if preference == "any" and category == "subway_entrance" and category not in categories:
                novelty_bonus += 500.0
            return (separation + novelty_bonus, -_haversine_m(center, point), str(item["id"]))
        chosen = max(remaining, key=priority)
        remaining.remove(chosen)
        selected.append(chosen)
        point = _stop_point(chosen)
        sectors.add(int(_bearing_degrees(center, point) // 45))
        categories.add(str(chosen.get("access_type", "unknown")))
    return selected


def _mode_waypoints(
    waypoints: list[dict[str, Any]], preference: str, limit: int = 180, running_focused: bool = False,
    access_focused: bool = False, destination: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Select geographically balanced mapped waypoints with mode-specific tie-breaks."""
    if access_focused:
        allowed = [w for w in waypoints if w.get("candidate_type") != "foot_network_steps"
                   and w.get("running_way_class") != "uncertain_cycleway"]
        return _balanced_spatial_candidates(
            allowed, _stop_point(destination) if destination else (0.0, 0.0), limit,
            category_key="candidate_type", preference=preference,
        )
    if running_focused:
        allowed = [w for w in waypoints if w.get("candidate_type") != "foot_network_steps"
                   and w.get("running_way_class") != "uncertain_cycleway"]
        return _balanced_spatial_candidates(
            allowed, _stop_point(destination) if destination else (0.0, 0.0), limit,
            category_key="candidate_type", preference=preference,
        )
    if preference == "low":
        allowed = [w for w in waypoints if w.get("candidate_type") != "foot_network_steps"]
        priority = {
            "park_boundary_connection": 0, "mapped_park_entrance": 0,
            "foot_network_footway": 1, "foot_network_path": 1,
            "foot_network_pedestrian": 1, "mapped_crossing": 2,
            "mapped_transit_entrance": 3,
        }
        allowed.sort(key=lambda w: (priority.get(str(w.get("candidate_type")), 4), str(w.get("id"))))
        return allowed[:limit]
    return list(waypoints[:limit])


def _refresh_preference_overlap(
    root: Path, target_label: str, destination_slug: str, results_dir: Path | None = None,
) -> dict[str, Any] | None:
    """Compare the two top ORS routes by shared, OSM-mapped edge length."""
    mode_dir = results_dir or (root / "outputs" / "recommendations" / destination_slug / target_label)
    summary_paths = {
        preference: mode_dir
        / f"recommendations-{target_label}-{preference}.json"
        for preference in ("low", "any")
    }
    if not all(path.exists() for path in summary_paths.values()):
        return None
    summaries = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in summary_paths.items()}
    if not all(summary.get("recommendations") for summary in summaries.values()):
        return None
    low_route, any_route = (summaries[name]["recommendations"][0] for name in ("low", "any"))
    low_edges = low_route.get("network_metrics", {}).get("mapped_edge_lengths_m", {})
    any_edges = any_route.get("network_metrics", {}).get("mapped_edge_lengths_m", {})
    shared_edge_ids = set(low_edges) & set(any_edges)
    shared_m = sum(min(float(low_edges[key]), float(any_edges[key])) for key in shared_edge_ids)
    low_total_m = float(low_route.get("distance_km", 0)) * 1000
    any_total_m = float(any_route.get("distance_km", 0)) * 1000
    low_mapped_m = sum(float(value) for value in low_edges.values())
    any_mapped_m = sum(float(value) for value in any_edges.values())
    shorter_total = min(low_total_m, any_total_m)
    shorter_mapped = min(low_mapped_m, any_mapped_m)
    shared_of_shorter_mapped = shared_m / shorter_mapped if shorter_mapped else None
    low_coverage = low_mapped_m / low_total_m if low_total_m else None
    any_coverage = any_mapped_m / any_total_m if any_total_m else None
    if shared_of_shorter_mapped is not None and shared_of_shorter_mapped >= 0.8:
        interpretation = (
            "두 모드는 출발지 또는 경유지를 다르게 선택했지만, 상위 경로의 매핑된 보행 edge 대부분을 공유합니다. "
            "이는 목적지 접근로에서 경로가 합류하는 현상일 수도 있습니다. OSM 시작 후보 수와 공원 접근 후보 수를 함께 확인해야 하며, "
            "이 수치만으로 지형에 대안이 없다고 단정할 수는 없습니다."
        )
    elif shared_of_shorter_mapped is not None:
        interpretation = "상위 경로가 서로 다른 OSM 보행 edge를 상당 부분 사용해 경사 선호별 경로 생성 차이가 확인됩니다."
    else:
        interpretation = "OSM edge 매칭 자료가 부족해 공통 구간 비율을 계산할 수 없습니다."
    comparison = {
        "method": "OSM network edge IDs; shared length is the sum of the shorter route-matched length per common edge",
        "shared_edge_count": len(shared_edge_ids),
        "shared_mapped_length_m": round(shared_m, 1),
        "low_route_distance_m": round(low_total_m, 1),
        "any_route_distance_m": round(any_total_m, 1),
        "low_mapped_network_coverage": round(low_coverage, 4) if low_coverage is not None else None,
        "any_mapped_network_coverage": round(any_coverage, 4) if any_coverage is not None else None,
        "shared_fraction_of_shorter_mapped_route": round(shared_of_shorter_mapped, 4) if shared_of_shorter_mapped is not None else None,
        "shared_fraction_of_low_route_distance": round(shared_m / low_total_m, 4) if low_total_m else None,
        "shared_fraction_of_any_route_distance": round(shared_m / any_total_m, 4) if any_total_m else None,
        "low_start_id": low_route.get("start", {}).get("id"),
        "any_start_id": any_route.get("start", {}).get("id"),
        "low_waypoint_ids": [point.get("id") for point in low_route.get("waypoints", [])],
        "any_waypoint_ids": [point.get("id") for point in any_route.get("waypoints", [])],
        "interpretation": interpretation,
        "coverage_note": "Only OSM-matched edge length is compared. Unmatched route portions are unknown and are not treated as different streets.",
    }
    comparison_path = summary_paths["low"].parent / "preference-route-overlap.json"
    comparison_path.write_text(json.dumps(comparison, ensure_ascii=False, indent=2), encoding="utf-8")
    for preference, path in summary_paths.items():
        summary = summaries[preference]
        summary["cross_preference_comparison"] = {**comparison, "artifact": str(comparison_path.relative_to(root))}
        path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return comparison


def _candidate_combinations(
    starts: list[dict[str, Any]], waypoints: list[dict[str, Any]], destination: dict[str, Any],
    target_distance_km: float, running_focused: bool = False, slope_preference: str = "low",
    distance_tolerance_m: float = 300.0, preferred_distance_error_m: float = 50.0,
) -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    if slope_preference not in {"low", "any"}:
        raise ValueError("slope_preference must be 'low' or 'any'")
    starts = _dedupe_candidates_by_coordinate(starts)
    waypoints = _dedupe_candidates_by_coordinate(waypoints)
    combos: list[tuple[tuple[Any, ...], dict[str, Any], list[dict[str, Any]]]] = []
    # Distance calculations are pure inputs here. Cache them once so the
    # two-waypoint search does not repeatedly run trigonometry inside the
    # quadratic candidate loop (up to hundreds of thousands of combinations).
    destination_point = _stop_point(destination)
    waypoint_points = [_stop_point(item) for item in waypoints]
    waypoint_destination_m = [_haversine_m(point, destination_point) for point in waypoint_points]
    waypoint_pair_m: dict[tuple[int, int], float] = {}
    for left in range(len(waypoints)):
        for right in range(left + 1, len(waypoints)):
            waypoint_pair_m[(left, right)] = _haversine_m(waypoint_points[left], waypoint_points[right])

    def running_score(start: dict[str, Any], vias: list[dict[str, Any]]) -> float:
        # This score describes mapped OSM running-friendliness only. It is not
        # used as a proxy for elevation; actual grade is measured from ORS.
        values = [float(start.get("running_fitness_access_score", 50) or 0)]
        values.extend(float(point.get("running_way_score", 50) or 0) for point in vias)
        return sum(values) / len(values)

    def access_score(start: dict[str, Any]) -> float:
        score = float(start.get("accessibility_score", 0.5) or 0) * 100
        score += 10 if start.get("entrance_verified") else 0
        score += 5 if start.get("coordinate_verified") else 0
        return score

    def append_combo(start: dict[str, Any], vias: list[dict[str, Any]], estimate_m: float) -> None:
        distance_error = abs(estimate_m - target_distance_km * 1000)
        score = running_score(start, vias)
        stable_id = f"{start['id']}:" + ":".join(str(point["id"]) for point in vias)
        # Keep distance as the primary exploration band in both modes so poor
        # estimates do not consume the bounded ORS budget. Within each band,
        # low explores closest estimates first; any explores stronger mapped
        # running networks first. No location or heading is treated as grade.
        distance_band = (0 if distance_error <= preferred_distance_error_m
                         else 1 if distance_error <= distance_tolerance_m else 2)
        if slope_preference == "low":
            priority = (distance_band, distance_error, -access_score(start), -score, len(vias), stable_id)
        else:
            priority = (distance_band, -score, -access_score(start), distance_error, len(vias), stable_id)
        combos.append((priority, start, vias))

    for start in starts:
        s = _stop_point(start)
        direct_est = _haversine_m(s, destination_point)
        if direct_est <= target_distance_km * 1070:
            append_combo(start, [], direct_est * 1.28)
        start_waypoint_m = [_haversine_m(s, point) for point in waypoint_points]
        for waypoint_index, waypoint in enumerate(waypoints):
            if start_waypoint_m[waypoint_index] < 80 or waypoint_destination_m[waypoint_index] < 80:
                continue
            estimate = (start_waypoint_m[waypoint_index] + waypoint_destination_m[waypoint_index]) * 1.28
            if target_distance_km * 630 <= estimate <= target_distance_km * 1500:
                append_combo(start, [waypoint], estimate)
    # Two waypoints are selected from geographically promising nodes rather than
    # blindly taking the quadratic product of every mapped footway vertex.
    for start in starts:
        s = _stop_point(start)
        start_waypoint_m = [_haversine_m(s, point) for point in waypoint_points]
        for first_index, first in enumerate(waypoints):
            leg1 = start_waypoint_m[first_index]
            if leg1 > target_distance_km * 750 or leg1 < 120:
                continue
            for second_index, second in enumerate(waypoints):
                if second["id"] <= first["id"]:
                    continue
                leg2 = waypoint_pair_m.get((first_index, second_index))
                if leg2 is None:
                    leg2 = waypoint_pair_m.get((second_index, first_index), 0.0)
                leg3 = waypoint_destination_m[second_index]
                if min(leg2, leg3) < 100:
                    continue
                estimate = (leg1 + leg2 + leg3) * 1.28
                if target_distance_km * 700 <= estimate <= target_distance_km * 1430:
                    append_combo(start, [first, second], estimate)
    combos.sort(key=lambda row: row[0])
    # Keep route variants diverse: cap per start and ensure both one/two-waypoint options.
    output: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    counts: dict[str, int] = {}
    seen_coordinate_combinations: set[str] = set()
    for _, start, vias in combos:
        coordinate_key = _coordinate_key([start, *vias, destination])
        if coordinate_key in seen_coordinate_combinations:
            continue
        seen_coordinate_combinations.add(coordinate_key)
        start_key = json.dumps(_point_key(start), separators=(",", ":"))
        if counts.get(start_key, 0) >= 8:
            continue
        output.append((start, vias))
        counts[start_key] = counts.get(start_key, 0) + 1
    return output


def recommend_courses(
    root: Path,
    api_key: str,
    destination: dict[str, Any],
    target_distance_km: float,
    max_ors_calls: int = MAX_ORS_CALLS,
    slope_preference: str = "low",
    running_focused: bool = False,
    access_focused: bool = False,
    search_radius_override_m: float | None = None,
) -> dict[str, Any]:
    """Search OSM start/waypoint candidates and rank actual ORS routes for any destination."""
    if slope_preference not in {"low", "any"}:
        raise ValueError("경사도 선호는 'low' 또는 'any'여야 합니다.")
    target_distance_km = float(target_distance_km)
    if not math.isfinite(target_distance_km) or target_distance_km <= 0:
        raise ValueError("목표 거리는 0보다 큰 숫자여야 합니다.")
    for field in ("name", "latitude", "longitude"):
        if field not in destination or destination[field] in (None, ""):
            raise ValueError(f"목적지 정보에 {field} 값이 필요합니다.")
    destination = dict(destination)
    destination["latitude"] = float(destination["latitude"])
    destination["longitude"] = float(destination["longitude"])
    if not (-90 <= destination["latitude"] <= 90 and -180 <= destination["longitude"] <= 180):
        raise ValueError("목적지 위도·경도 범위를 확인하세요.")
    destination.setdefault("id", _slug(str(destination["name"])))
    access_focused = bool(access_focused)
    running_focused = bool(running_focused or access_focused)
    target_label = _distance_label(target_distance_km)
    destination_slug = _slug(str(destination["id"]))
    destination_results_dir = root / "outputs" / "recommendations" / destination_slug
    strategy_dir = "access_focused" if access_focused else "running_focused" if running_focused else None
    results_dir = (destination_results_dir / strategy_dir / target_label if strategy_dir
                   else destination_results_dir / target_label)
    results_dir.mkdir(parents=True, exist_ok=True)
    defaults = json.loads((root / DEFAULTS_PATH).read_text(encoding="utf-8"))
    fitness_config = json.loads((root / "data" / "running_fitness.json").read_text(encoding="utf-8"))
    # One configured absolute tolerance is used for every target distance.
    # A percentage-based tolerance would make 5/10 km routes progressively looser.
    distance_tolerance_m = float(defaults.get("distance_tolerance_min_m", 300.0))
    if not math.isfinite(distance_tolerance_m) or distance_tolerance_m < 0:
        raise ValueError("거리 허용 오차 설정은 0 이상의 유한한 값이어야 합니다.")
    preferred_distance_error_m = float(defaults.get("preferred_distance_error_m", 50))
    configured_search_radius_m = min(
        float(defaults.get("osm_search_radius_max_m", 15000)),
        max(float(defaults.get("osm_search_radius_min_m", 4500)),
            target_distance_km * float(defaults.get("osm_search_radius_per_target_km_m", 1500))),
    )
    search_radius_m = (float(search_radius_override_m) if search_radius_override_m is not None
                       else configured_search_radius_m)
    if (not math.isfinite(search_radius_m)
            or search_radius_m < float(defaults.get("osm_search_radius_min_m", 4500))
            or search_radius_m > float(defaults.get("osm_search_radius_max_m", 15000))):
        raise ValueError("OSM 검색 반경은 설정된 최소·최대 범위 안이어야 합니다.")
    steep_grade_threshold_percent = float(defaults.get("steep_grade_threshold_percent", 6.0))
    gentle_max_ascent_m = target_distance_km * float(defaults.get("gentle_max_ascent_per_km_m", 33.3333333))
    grade_config = defaults.get("grade_assessment", {})
    gentle_max_uphill_8_share = float(grade_config.get("gentle_max_uphill_8_share", 0.12))
    max_ors_calls = max(0, int(max_ors_calls))
    coordinate_fingerprint = hashlib.sha256(
        f"{destination['latitude']:.6f},{destination['longitude']:.6f},{search_radius_m:.0f}".encode("utf-8")
    ).hexdigest()[:16]
    osm_cache_path = root / "outputs" / "cache" / f"osm_network_{coordinate_fingerprint}.json"
    try:
        osm = fetch_osm_elements(destination, osm_cache_path, radius_m=int(search_radius_m))
    except OSMDataError as exc:
        failed_result = {
            "target_distance_km": target_distance_km,
            "destination": {"id": destination["id"], "name": destination["name"],
                            "latitude": destination["latitude"], "longitude": destination["longitude"],
                            "entrance_verified": destination.get("entrance_verified", False)},
            "slope_preference": slope_preference,
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "search": {"ors_api_calls": 0, "ors_cache_hits": 0, "max_ors_api_calls": max_ors_calls,
                       "routes_evaluated": 0, "failed_routes": [], "failure_stage": "osm_candidate_collection",
                       "route_failure_reason": str(exc),
                       "osm_error_category": getattr(exc, "error_category", "osm_error"),
                       "osm_http_status": getattr(exc, "http_status", None),
                       "osm_request_attempts": getattr(exc, "request_attempts", 0)},
            "recommendations": [],
        }
        summary_path = results_dir / f"recommendations-{target_label}-{slope_preference}.json"
        summary_path.write_text(json.dumps(failed_result, ensure_ascii=False, indent=2), encoding="utf-8")
        failed_result["summary_file"] = str(summary_path.relative_to(root))
        return failed_result
    exclusion_config: dict[str, Any] = {}
    restricted_areas: list[dict[str, Any]] = []
    advisory_areas: list[dict[str, Any]] = []
    restriction_data: dict[str, Any] | None = None
    if running_focused:
        exclusion_config = json.loads((root / "data" / "route_exclusions.json").read_text(encoding="utf-8"))
        # Query only the candidate/routing radius for this run; a city-wide
        # exclusion query would be slower and would include unrelated areas.
        restriction_radius_m = int(search_radius_m)
        restriction_data = fetch_restricted_area_elements(
            destination, root / "outputs" / "cache", restriction_radius_m, exclusion_config
        )
        restricted_areas = build_restricted_areas(restriction_data.get("elements", []), exclusion_config)
        advisory_areas = build_advisory_areas(restriction_data.get("elements", []), exclusion_config)
    cache_path = root / ROUTE_CACHE_PATH
    try:
        cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    except (OSError, ValueError):
        cache = {}
    if running_focused:
        route_lookup_cache, route_cache_sources, shared_cache_diagnostics = _load_shared_route_cache(root, cache)
    else:
        route_lookup_cache, route_cache_sources = cache, {}
        shared_cache_diagnostics = {"cache_files_read": [], "cache_entries_read": len(cache),
                                    "experiment_cache_entries": 0, "duplicate_coordinate_keys": 0}
    # Build OSM indexes once. The same current snapshot validates cached hints
    # and scores routes later; old cached score fields are never trusted.
    metric_index = build_osm_edge_grid(osm)
    riverside_walkable_index = build_riverside_walkable_edge_grid(osm, fitness_config)
    waterway_index = build_waterway_edge_grid(osm, fitness_config)
    access_diagnostics = None
    if access_focused:
        access_cache_path = root / "outputs" / "cache" / f"station_access_starts_{coordinate_fingerprint}.json"
        accessible_starts: list[dict[str, Any]] = []
        if access_cache_path.exists():
            try:
                access_cache = json.loads(access_cache_path.read_text(encoding="utf-8"))
                if (access_cache.get("schema_version") == 1
                        and access_cache.get("osm_fetched_at_epoch") == osm.get("fetched_at_epoch")
                        and access_cache.get("max_access_distance_m") == 800
                        and access_cache.get("target_distance_km") == target_distance_km):
                    accessible_starts = access_cache.get("starts", [])
                    access_diagnostics = access_cache.get("diagnostics")
            except (OSError, ValueError, TypeError):
                pass
        if access_diagnostics is None:
            destination_for_access = {**destination, "target_distance_m": target_distance_km * 1000}
            accessible_starts, access_diagnostics = build_station_accessible_running_starts(
                osm, destination_for_access, search_radius_m=search_radius_m,
                max_access_distance_m=800.0, walking_speed_m_per_min=80.0,
                restricted_areas=restricted_areas,
            )
            access_cache_path.parent.mkdir(parents=True, exist_ok=True)
            access_cache_path.write_text(json.dumps({
                "schema_version": 1,
                "osm_fetched_at_epoch": osm.get("fetched_at_epoch"),
                "target_distance_km": target_distance_km,
                "max_access_distance_m": 800,
                "diagnostics": access_diagnostics,
                "starts": accessible_starts,
            }, ensure_ascii=False), encoding="utf-8")
        # Waypoint candidates remain OSM-derived, while all new starts must pass
        # a topological shortest-path check from a named subway exit.
        _, osm_waypoints = build_osm_candidates(
            osm, destination, max_starts=1, max_waypoints=240, search_radius_m=int(search_radius_m)
        )
        osm_starts = accessible_starts
    else:
        osm_starts, osm_waypoints = build_osm_candidates(
            osm, destination, max_starts=200, max_waypoints=240, search_radius_m=int(search_radius_m)
        )
    csv_starts = _read_candidates(root / "data" / "start_candidates.csv")
    csv_waypoints = _read_candidates(root / "data" / "waypoint_candidates.csv")
    all_starts = list(osm_starts) if access_focused else _merge_candidates(osm_starts, csv_starts)
    all_starts = [s for s in all_starts if _haversine_m(_stop_point(s), _stop_point(destination)) <= search_radius_m]
    if restricted_areas:
        all_starts = [s for s in all_starts
                      if not point_in_restricted_area(_stop_point(s), restricted_areas)]
    cached_start_quality, cached_quality_diagnostics = _cached_start_route_quality(
        route_lookup_cache, all_starts, destination, target_distance_km, distance_tolerance_m,
        slope_preference, steep_grade_threshold_percent, osm, metric_index, fitness_config,
        riverside_walkable_index, waterway_index, restricted_areas, grade_config,
    )
    starts = _select_mode_starts(all_starts, destination, slope_preference, running_focused=running_focused,
                                 target_distance_km=target_distance_km,
                                 cached_route_quality=cached_start_quality)
    if access_focused:
        starts = [start for start in starts if start.get("station_access", {}).get("route_verified")
                  and start.get("station_access", {}).get("osm_topology_verified")
                  and float(start.get("station_access", {}).get("walking_distance_m", math.inf)) <= 400.0]
    all_waypoints = _merge_candidates(osm_waypoints, csv_waypoints)
    all_waypoints = [w for w in all_waypoints if _haversine_m(_stop_point(w), _stop_point(destination)) <= search_radius_m]
    if restricted_areas:
        all_waypoints = [w for w in all_waypoints
                         if not point_in_restricted_area(_stop_point(w), restricted_areas)]
    waypoints = _mode_waypoints(all_waypoints, slope_preference, running_focused=running_focused,
                                access_focused=access_focused, destination=destination)
    combinations = _candidate_combinations(
        starts, waypoints, destination, target_distance_km,
        running_focused=running_focused, slope_preference=slope_preference,
        distance_tolerance_m=distance_tolerance_m,
        preferred_distance_error_m=preferred_distance_error_m,
    )

    cache_path.parent.mkdir(parents=True, exist_ok=True)

    calls, cache_hits = 0, 0
    quota_exhausted = False
    api_stop_reason: str | None = None
    failures: list[dict[str, str]] = []
    candidates: list[dict[str, Any]] = []
    restricted_route_rejections: dict[str, int] = {}
    advisory_route_intersections: dict[str, int] = {}
    outside_tolerance_routes = 0
    seen_route_keys: set[str] = set()
    # Keep a small part of the per-run request budget for local waypoint
    # refinements after real ORS routes have been measured.
    local_refinement_call_reserve = min(3, max_ors_calls)
    initial_call_limit = max(0, max_ors_calls - local_refinement_call_reserve)
    local_refinement_routes_evaluated = 0
    local_refinement_routes_attempted = 0
    local_refinement_api_calls = 0
    local_refinement_cache_hits = 0
    # Straight-line estimates only filter and order candidates; all accepted
    # distances and route geometry still come from ORS.
    def rough_distance_error(pair: tuple[dict[str, Any], list[dict[str, Any]]]) -> float:
        stops = [pair[0], *pair[1], destination]
        straight_sum = sum(_haversine_m(_stop_point(a), _stop_point(b)) for a, b in zip(stops, stops[1:]))
        return abs(straight_sum * 1.28 - target_distance_km * 1000)

    def exploration_priority(pair: tuple[dict[str, Any], list[dict[str, Any]]]) -> tuple[Any, ...]:
        start, vias = pair
        error = rough_distance_error(pair)
        distance_band = (0 if error <= preferred_distance_error_m
                         else 1 if error <= distance_tolerance_m else 2)
        scores = [float(start.get("running_fitness_access_score", 50) or 0)]
        scores.extend(float(point.get("running_way_score", 50) or 0) for point in vias)
        mapped_running_score = sum(scores) / len(scores)
        connectivity = float(start.get("accessibility_score", 0.5) or 0) * 100
        connectivity += 10 if start.get("entrance_verified") else 0
        connectivity += 5 if start.get("coordinate_verified") else 0
        stable_id = f"{start['id']}:" + ":".join(str(point["id"]) for point in vias)
        if slope_preference == "low":
            return (distance_band, error, -connectivity, -mapped_running_score, len(vias), stable_id)
        return (distance_band, -mapped_running_score, -connectivity, error, len(vias), stable_id)

    by_start: dict[str, list[tuple[dict[str, Any], list[dict[str, Any]]]]] = {}
    for pair in combinations:
        by_start.setdefault(str(pair[0]["id"]), []).append(pair)
    # _candidate_combinations already ordered each start's options by the
    # active mode. Preserve that order through the budgeted request scheduler.
    required_ids = [] if running_focused else [str(start["id"]) for start in starts if start.get("required_for_comparison")]
    park_ids = [str(start["id"]) for start in starts
                if start.get("access_type") in {"park_entrance", "park_path_connection"}
                and str(start["id"]) not in required_ids]
    transit_ids = [str(start["id"]) for start in starts
                   if start.get("access_type") not in {"park_entrance", "park_path_connection"}
                   and str(start["id"]) not in required_ids]
    if running_focused:
        start_by_id = {str(start["id"]): start for start in starts}
        # Some mapped station-access starts may be too close/far to produce
        # even one geometrically plausible stop combination for this target.
        # Exclude those before ranking; otherwise min() over an empty list
        # aborts recommendation generation for the whole destination/distance.
        route_candidate_start_ids = [start_id for start_id in start_by_id if by_start.get(start_id)]
        priority_ids = sorted(route_candidate_start_ids, key=lambda start_id: (
            min(exploration_priority(pair) for pair in by_start.get(start_id, [])),
            str(start_by_id[start_id].get("access_type", "unknown")), start_id))
    elif slope_preference == "low":
        # On the initial, non-cached probe budget, reserve several starts for
        # mapped park/path connections before continuing across station exits.
        priority_ids = list(dict.fromkeys([*required_ids, *park_ids[:6], *transit_ids, *park_ids[6:]]))
    else:
        priority_ids = list(dict.fromkeys([*required_ids, *transit_ids, *park_ids]))
    scheduled_new: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    selected_keys: set[str] = set()
    positions = {start_id: 0 for start_id in by_start}
    for start_id in priority_ids:
        for _ in range(1):
            pairs = by_start.get(start_id, [])
            while positions.get(start_id, 0) < len(pairs):
                pair = pairs[positions[start_id]]
                positions[start_id] += 1
                key = _coordinate_key([pair[0], *pair[1], destination])
                if key not in route_lookup_cache and key not in selected_keys:
                    selected_keys.add(key)
                    scheduled_new.append(pair)
                    break
    other_ids = [key for key in by_start if key not in priority_ids]
    # Round-robin across starts so a tight ORS budget does not get spent on one
    # station alone. Required exits and one auto-discovered entrance go first.
    while True:
        advanced = False
        for start_id in other_ids + priority_ids:
            pairs = by_start.get(start_id, [])
            while positions.get(start_id, 0) < len(pairs):
                pair = pairs[positions[start_id]]
                positions[start_id] += 1
                key = _coordinate_key([pair[0], *pair[1], destination])
                if key not in route_lookup_cache and key not in selected_keys:
                    selected_keys.add(key)
                    scheduled_new.append(pair)
                    advanced = True
                    break
        if not advanced:
            break
    cached_pairs = [pair for pairs in by_start.values() for pair in pairs
                    if _coordinate_key([pair[0], *pair[1], destination]) in route_lookup_cache]
    cached_pairs.sort(key=exploration_priority)
    ordered_combinations = [*cached_pairs, *scheduled_new]
    direct_by_start: dict[str, float] = {}
    for start, route_waypoints in ordered_combinations:
        stops = [start, *route_waypoints, destination]
        request_key = _coordinate_key(stops)
        if request_key in seen_route_keys:
            continue
        seen_route_keys.add(request_key)
        route_id = _route_id(start, route_waypoints, destination, target_distance_km, slope_preference)
        if request_key in route_lookup_cache:
            route = dict(route_lookup_cache[request_key])
            cache_hits += 1
            cached_origin_modes = [_route_origin_mode(route)]
            route["route_id"], route["stops"] = route_id, stops
        else:
            if calls >= initial_call_limit:
                break
            calls += 1
            try:
                retries = 1 if initial_call_limit - calls >= 1 else 0
                route = fetch_walking_route_points(stops, api_key, route_id, max_retries=retries)
                calls += max(0, int(route.get("ors_request_attempts", 1)) - 1)
                cache[request_key] = route
                route_lookup_cache[request_key] = route
                cached_origin_modes = [slope_preference]
                _write_route_cache(cache_path, cache)
            except RouteError as exc:
                calls += max(0, int(getattr(exc, "request_attempts", 1)) - 1)
                failures.append({"route_id": route_id, "reason": str(exc),
                                 "error_category": getattr(exc, "error_category", "routing_error"),
                                 "http_status": getattr(exc, "http_status", None),
                                 "retry_after_seconds": getattr(exc, "retry_after_seconds", None),
                                 "request_attempts": getattr(exc, "request_attempts", 1)})
                if getattr(exc, "error_category", "") in {
                        "dns_error", "timeout", "network_error", "authentication", "rate_limit", "server_error"}:
                    api_stop_reason = str(exc)
                    quota_exhausted = getattr(exc, "error_category", "") == "rate_limit"
                    break
                continue
        if (route.get("profile") != "foot-walking"
                or route.get("summary", {}).get("distance_km") is None
                or not route.get("geometry", {}).get("coordinates")):
            continue
        distance_km = float(route["summary"]["distance_km"])
        error_m = abs(distance_km * 1000 - target_distance_km * 1000)
        if not _within_distance_tolerance(distance_km, target_distance_km, distance_tolerance_m):
            outside_tolerance_routes += 1
            continue
        edges, repeated_m, measured_m = _edge_signatures(route)
        if not route_waypoints:
            direct_by_start[start["id"]] = distance_km
        slope = _grade_metrics(route, steep_grade_threshold_percent, grade_config)
        geometry_metrics = evaluate_route_geometry(
            route, osm, metric_index, fitness_config, riverside_walkable_index, waterway_index,
        )
        blocked_access_m = float((geometry_metrics.get("network") or {}).get("explicit_access_restricted_m") or 0)
        if blocked_access_m > 0:
            restricted_area_name = route_intersects_restricted_area(
                route, restricted_areas,
                sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
            )
            rejection_key = restricted_area_name or "OSM-mapped explicit access restriction"
            restricted_route_rejections[rejection_key] = restricted_route_rejections.get(rejection_key, 0) + 1
            failures.append({"route_id": route_id,
                             "reason": f"matched route way has an explicit access restriction ({blocked_access_m:.0f} m): {rejection_key}"})
            continue
        restricted_area_name = route_intersects_restricted_area(
            route, restricted_areas,
            sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
        )
        if restricted_area_name:
            restricted_route_rejections[restricted_area_name] = restricted_route_rejections.get(restricted_area_name, 0) + 1
            failures.append({"route_id": route_id,
                             "reason": f"ORS route intersects a hard-restricted mapped area: {restricted_area_name}"})
            continue
        advisory_area_name = route_intersects_restricted_area(
            route, advisory_areas,
            sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
        )
        if advisory_area_name:
            advisory_route_intersections[advisory_area_name] = advisory_route_intersections.get(advisory_area_name, 0) + 1
        if running_focused and not geometry_metrics["access_connections"]["all_stops_connected"]:
            failures.append({"route_id": route_id, "reason": "one or more selected OSM starts/waypoints are more than 50 m from the ORS route geometry"})
            continue
        ascent = route.get("summary", {}).get("ascent_m")
        descent = route.get("summary", {}).get("descent_m")
        ascent = float(ascent) if ascent is not None else None
        descent = float(descent) if descent is not None else None
        candidates.append({"route": route, "start": start, "waypoints": route_waypoints,
                           "distance_error_m": error_m, "edges": edges, "repeated_segment_m": repeated_m,
                           "measured_distance_m": measured_m, "slope": slope, "ascent_m": ascent, "descent_m": descent,
                           "geometry_metrics": geometry_metrics,
                               "candidate_source_modes": sorted(set(cached_origin_modes) - {"unknown"}),
                           "advisory_area_intersections": [advisory_area_name] if advisory_area_name else []})

    # Local improvement: take the best distance-feasible measured routes,
    # replace one waypoint with a nearby mapped OSM candidate, and ask ORS to
    # validate that changed route. This stage shares the same hard API budget
    # and benefits from the exact-route cache.
    initial_in_range = [item for item in candidates
                        if _within_distance_tolerance(item["route"]["summary"]["distance_km"],
                                                      target_distance_km, distance_tolerance_m)]
    if initial_in_range and local_refinement_call_reserve:
        if slope_preference == "low":
            initial_in_range.sort(key=lambda item: (
                item["ascent_m"] if item["ascent_m"] is not None else float("inf"),
                item["slope"].get("steep_segment_ratio") if item["slope"].get("steep_segment_ratio") is not None else float("inf"),
                item["distance_error_m"], item["route"].get("route_id", ""),
            ))
        else:
            initial_in_range.sort(key=lambda item: (
                item["distance_error_m"],
                item["geometry_metrics"]["crossings"].get("crossing_score", 0) * -1,
                item["repeated_segment_m"], item["route"].get("route_id", ""),
            ))
        running_notes = defaults.get("running_score_notes", {})
        neighbor_radius_m = float(running_notes.get("local_refinement_radius_m", 250))
        refinement_variants: dict[str, tuple[float, dict[str, Any], list[dict[str, Any]]]] = {}
        for seed in initial_in_range[:3]:
            old_waypoints = seed["waypoints"]
            if not old_waypoints:
                continue
            for replace_index, old_waypoint in enumerate(old_waypoints):
                for alternative in waypoints:
                    if str(alternative["id"]) == str(old_waypoint["id"]):
                        continue
                    if _haversine_m(_stop_point(old_waypoint), _stop_point(alternative)) > neighbor_radius_m:
                        continue
                    revised_waypoints = list(old_waypoints)
                    revised_waypoints[replace_index] = alternative
                    if len({str(w["id"]) for w in revised_waypoints}) != len(revised_waypoints):
                        continue
                    stops = [seed["start"], *revised_waypoints, destination]
                    key = _coordinate_key(stops)
                    if key in seen_route_keys:
                        continue
                    rough_m = sum(_haversine_m(_stop_point(a), _stop_point(b)) for a, b in zip(stops, stops[1:])) * 1.28
                    estimate_error = abs(rough_m - target_distance_km * 1000)
                    existing = refinement_variants.get(key)
                    if existing is None or estimate_error < existing[0]:
                        refinement_variants[key] = (estimate_error, seed["start"], revised_waypoints)
        ranked_refinements = sorted(refinement_variants.items(), key=lambda pair: pair[1][0])
        for request_key, (_estimate_error, start, route_waypoints) in ranked_refinements:
            if request_key in seen_route_keys:
                continue
            if request_key not in route_lookup_cache and calls >= max_ors_calls:
                break
            seen_route_keys.add(request_key)
            local_refinement_routes_attempted += 1
            stops = [start, *route_waypoints, destination]
            route_id = _route_id(start, route_waypoints, destination, target_distance_km, slope_preference)
            if request_key in route_lookup_cache:
                route = dict(route_lookup_cache[request_key])
                cache_hits += 1
                local_refinement_cache_hits += 1
                cached_origin_modes = [_route_origin_mode(route)]
                route["route_id"], route["stops"] = route_id, stops
            else:
                calls += 1
                try:
                    retries = 1 if max_ors_calls - calls >= 1 else 0
                    route = fetch_walking_route_points(stops, api_key, route_id, max_retries=retries)
                    actual_attempts = max(1, int(route.get("ors_request_attempts", 1)))
                    calls += actual_attempts - 1
                    local_refinement_api_calls += actual_attempts
                    cache[request_key] = route
                    route_lookup_cache[request_key] = route
                    cached_origin_modes = [slope_preference]
                    _write_route_cache(cache_path, cache)
                except RouteError as exc:
                    actual_attempts = max(1, int(getattr(exc, "request_attempts", 1)))
                    calls += actual_attempts - 1
                    local_refinement_api_calls += actual_attempts
                    failures.append({"route_id": route_id, "reason": str(exc),
                                     "error_category": getattr(exc, "error_category", "routing_error"),
                                     "http_status": getattr(exc, "http_status", None),
                                     "retry_after_seconds": getattr(exc, "retry_after_seconds", None),
                                     "request_attempts": actual_attempts})
                    if getattr(exc, "error_category", "") in {
                            "dns_error", "timeout", "network_error", "authentication", "rate_limit", "server_error"}:
                        api_stop_reason = str(exc)
                        quota_exhausted = getattr(exc, "error_category", "") == "rate_limit"
                        break
                    continue
            if (route.get("profile") != "foot-walking"
                    or route.get("summary", {}).get("distance_km") is None
                    or not route.get("geometry", {}).get("coordinates")):
                continue
            distance_km = float(route["summary"]["distance_km"])
            error_m = abs(distance_km * 1000 - target_distance_km * 1000)
            if not _within_distance_tolerance(distance_km, target_distance_km, distance_tolerance_m):
                outside_tolerance_routes += 1
                continue
            edges, repeated_m, measured_m = _edge_signatures(route)
            slope = _grade_metrics(route, steep_grade_threshold_percent, grade_config)
            geometry_metrics = evaluate_route_geometry(
                route, osm, metric_index, fitness_config, riverside_walkable_index, waterway_index,
            )
            blocked_access_m = float((geometry_metrics.get("network") or {}).get("explicit_access_restricted_m") or 0)
            if blocked_access_m > 0:
                restricted_area_name = route_intersects_restricted_area(
                    route, restricted_areas,
                    sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
                )
                rejection_key = restricted_area_name or "OSM-mapped explicit access restriction"
                restricted_route_rejections[rejection_key] = restricted_route_rejections.get(rejection_key, 0) + 1
                failures.append({"route_id": route_id,
                                 "reason": f"matched route way has an explicit access restriction ({blocked_access_m:.0f} m): {rejection_key}"})
                continue
            restricted_area_name = route_intersects_restricted_area(
                route, restricted_areas,
                sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
            )
            if restricted_area_name:
                restricted_route_rejections[restricted_area_name] = restricted_route_rejections.get(restricted_area_name, 0) + 1
                failures.append({"route_id": route_id,
                                 "reason": f"ORS route intersects a hard-restricted mapped area: {restricted_area_name}"})
                continue
            advisory_area_name = route_intersects_restricted_area(
                route, advisory_areas,
                sample_spacing_m=float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
            )
            if advisory_area_name:
                advisory_route_intersections[advisory_area_name] = advisory_route_intersections.get(advisory_area_name, 0) + 1
            if running_focused and not geometry_metrics["access_connections"]["all_stops_connected"]:
                failures.append({"route_id": route_id, "reason": "one or more selected OSM starts/waypoints are more than 50 m from the ORS route geometry"})
                continue
            ascent = route.get("summary", {}).get("ascent_m")
            descent = route.get("summary", {}).get("descent_m")
            candidates.append({"route": route, "start": start, "waypoints": route_waypoints,
                               "distance_error_m": error_m, "edges": edges, "repeated_segment_m": repeated_m,
                               "measured_distance_m": measured_m, "slope": slope,
                               "ascent_m": float(ascent) if ascent is not None else None,
                               "descent_m": float(descent) if descent is not None else None,
                               "geometry_metrics": geometry_metrics, "search_stage": "local_waypoint_refinement",
                               "candidate_source_modes": sorted(set(cached_origin_modes) - {"unknown"}),
                               "advisory_area_intersections": [advisory_area_name] if advisory_area_name else []})
            local_refinement_routes_evaluated += 1
    _write_route_cache(cache_path, cache)

    # Revalidate routes previously found by either slope mode (including the
    # saved phase-6 caches) against this run's OSM snapshot. Raw cache entries
    # are never promoted on cache presence alone.
    common_pool_diagnostics = {
        "enabled": bool(running_focused),
        "cache_files_read": shared_cache_diagnostics["cache_files_read"],
        "cache_entries_read": shared_cache_diagnostics["cache_entries_read"],
        "experiment_cache_entries": shared_cache_diagnostics["experiment_cache_entries"],
        "duplicate_coordinate_keys": shared_cache_diagnostics["duplicate_coordinate_keys"],
        "raw_current_destination_in_range": 0,
        "validated_unique_routes_added": 0,
        "already_evaluated_geometry_skipped": 0,
        "rejected": {},
        "source_mode_counts": {"low": 0, "any": 0, "unknown": 0},
        "validation": "strict foot-walking profile; current destination coordinate; ORS distance ± configured tolerance; endpoint/stop connectivity; current OSM access restrictions and hard areas; current running metrics and grade profile",
    }
    if running_focused:
        seen_request_keys: set[str] = set()
        candidate_by_signature = {
            signature: item for item in candidates
            if (signature := _route_geometry_signature(item.get("route", {}))) is not None
        }
        seen_geometries = set(candidate_by_signature)
        for cache_key, cached_route in route_lookup_cache.items():
            if not isinstance(cached_route, dict) or cached_route.get("profile") != "foot-walking":
                continue
            cached_stops = cached_route.get("stops") or []
            if len(cached_stops) < 2:
                continue
            try:
                if _point_key(cached_stops[-1]) != _point_key(destination):
                    continue
                request_key = _coordinate_key(cached_stops)
            except (KeyError, TypeError, ValueError):
                continue
            if request_key in seen_request_keys:
                continue
            seen_request_keys.add(request_key)
            summary = cached_route.get("summary") or {}
            cached_distance_km = summary.get("distance_km")
            if cached_distance_km is None and summary.get("distance_m") is not None:
                cached_distance_km = float(summary["distance_m"]) / 1000.0
            if cached_distance_km is None or not _within_distance_tolerance(
                    float(cached_distance_km), target_distance_km, distance_tolerance_m):
                continue
            common_pool_diagnostics["raw_current_destination_in_range"] += 1
            signature = _route_geometry_signature(cached_route)
            if signature is None:
                common_pool_diagnostics["rejected"]["missing_geometry"] = common_pool_diagnostics["rejected"].get("missing_geometry", 0) + 1
                continue
            if signature in seen_geometries:
                common_pool_diagnostics["already_evaluated_geometry_skipped"] += 1
                existing = candidate_by_signature[signature]
                origin_mode = _route_origin_mode(cached_route)
                if origin_mode in {"low", "any"}:
                    existing["candidate_source_modes"] = sorted(
                        set(existing.get("candidate_source_modes", [])) | {origin_mode})
                existing["candidate_source_caches"] = sorted(
                    set(existing.get("candidate_source_caches", []))
                    | set(route_cache_sources.get(cache_key, [])))
                continue
            cached_candidate, rejection = _cached_route_candidate(
                cached_route, destination, target_distance_km, distance_tolerance_m,
                slope_preference, running_focused, osm, metric_index, fitness_config,
                riverside_walkable_index, waterway_index, restricted_areas, advisory_areas,
                exclusion_config, steep_grade_threshold_percent, grade_config,
                route_cache_sources.get(cache_key, []),
            )
            if cached_candidate is None:
                rejection = rejection or "invalid_cached_route"
                common_pool_diagnostics["rejected"][rejection] = common_pool_diagnostics["rejected"].get(rejection, 0) + 1
                continue
            cached_candidate["common_pool_geometry_signature"] = signature
            candidates.append(cached_candidate)
            seen_geometries.add(signature)
            candidate_by_signature[signature] = cached_candidate
            cache_hits += 1
            common_pool_diagnostics["validated_unique_routes_added"] += 1
            for source_mode in cached_candidate.get("candidate_source_modes", []) or ["unknown"]:
                common_pool_diagnostics["source_mode_counts"][source_mode] = common_pool_diagnostics["source_mode_counts"].get(source_mode, 0) + 1
        candidates = _dedupe_route_candidates_by_geometry(candidates)
        common_pool_diagnostics["deduplicated_valid_candidate_count"] = len(candidates)

    score_weights = defaults.get("running_score_weights", {}).get(slope_preference, {})
    if running_focused:
        fitness_weight = float(fitness_config.get("route_score_weights", {}).get(slope_preference, 0.30))
        base_total = sum(float(value) for value in score_weights.values())
        scale = max(0.0, 1.0 - fitness_weight) / base_total if base_total else 0.0
        score_weights = {key: float(value) * scale for key, value in score_weights.items()}
        score_weights["running_fitness"] = fitness_weight
    score_notes = defaults.get("running_score_notes", {})
    for item in candidates:
        route = item["route"]
        distance_km = float(route["summary"]["distance_km"])
        direct_km = direct_by_start.get(item["start"]["id"], max(_haversine_m(_stop_point(item["start"]), _stop_point(destination)) / 1000, 0.1))
        detour_ratio = distance_km / direct_km if direct_km else 1.0
        slope = item["slope"]
        geometry_metrics = item["geometry_metrics"]
        crossing_metrics = geometry_metrics["crossings"]
        network_metrics = geometry_metrics["network"]
        turn_metrics = geometry_metrics["turns"]
        mapped_repeat_share = network_metrics.get("repeated_mapped_network_edge_share")
        fallback_repeat_share = item["repeated_segment_m"] / item["measured_distance_m"] if item["measured_distance_m"] else None
        repeated_fraction = mapped_repeat_share if mapped_repeat_share is not None else fallback_repeat_share
        if repeated_fraction is None:
            repeated_fraction = 0.0
        distance_score = max(0.0, 100.0 - (item["distance_error_m"] / max(distance_tolerance_m, 1)) * 40.0)
        if item["distance_error_m"] <= preferred_distance_error_m:
            distance_score = min(100.0, distance_score + 10.0 * (1.0 - item["distance_error_m"] / max(preferred_distance_error_m, 1)))
        ascent = item["ascent_m"]
        uphill = slope.get("uphill_grade_metrics") or {}
        uphill_thresholds = uphill.get("thresholds", {})
        uphill_8_share = float(uphill_thresholds.get("8_percent", {}).get("share") or 0.0)
        uphill_10_share = float(uphill_thresholds.get("10_percent", {}).get("share") or 0.0)
        longest_8_m = float(uphill_thresholds.get("8_percent", {}).get("longest_continuous_m") or 0.0)
        max_sustained_grade = float(uphill.get("max_sustained_uphill_grade_percent") or 0.0)
        slope_score = None
        if slope.get("uphill_grade_metrics") is not None:
            mode_penalties = grade_config.get("mode_penalties", {}).get(slope_preference, {})
            uphill8_weight = float(mode_penalties.get("uphill_8_share", 35.0 if slope_preference == "low" else 12.0))
            uphill10_weight = float(mode_penalties.get("uphill_10_share", 25.0 if slope_preference == "low" else 8.0))
            sustained_weight = float(mode_penalties.get("max_sustained_grade", 20.0 if slope_preference == "low" else 8.0))
            long_climb_weight = float(mode_penalties.get("long_climb", 10.0 if slope_preference == "low" else 4.0))
            ascent_weight = float(mode_penalties.get("ascent_per_km", 10.0 if slope_preference == "low" else 8.0))
            ascent_per_km = (ascent or 0.0) / max(target_distance_km, 0.1)
            slope_score = max(0.0, 100.0
                              - uphill_8_share * uphill8_weight
                              - uphill_10_share * uphill10_weight
                              - min(1.0, max_sustained_grade / 12.0) * sustained_weight
                              - min(1.0, longest_8_m / 300.0) * long_climb_weight
                              - min(1.0, ascent_per_km / 80.0) * ascent_weight)
            # Lower is better: steep-climb exposure dominates; total ascent
            # contributes only a small secondary term.
            low_terrain_burden = (uphill_10_share * 400.0 + uphill_8_share * 200.0
                                  + max_sustained_grade * 1.5
                                  + longest_8_m / max(target_distance_km * 10.0, 1.0)
                                  + ascent_per_km * 0.05)
        else:
            low_terrain_burden = None
        if running_focused:
            access_default = 0.50 if item["start"].get("access_type") == "subway_entrance" else 0.72
            access_score = max(0.0, min(100.0, float(item["start"].get("accessibility_score", access_default) or access_default) * 100.0))
            if item["start"].get("access_type") == "subway_entrance" and "running_fitness_access_score" not in item["start"]:
                access_score = 50.0
        else:
            access_score = max(0.0, min(100.0, float(item["start"].get("accessibility_score", 0.5) or 0.5) * 100.0))
        detour_penalty = max(0.0, detour_ratio - 1.85) * 28.0
        # Repeated edges and turn counts are already included in the running
        # fitness naturalness component. Keep this general continuity term
        # focused on detour/directness to avoid scoring the same signals twice.
        continuity_score = max(0.0, 100.0 - detour_penalty)
        components = {
            "distance": round(distance_score, 2),
            "crossings": round(float(crossing_metrics["crossing_score"]), 2),
            "continuity": round(continuity_score, 2),
            "slope": round(slope_score, 2) if slope_score is not None else None,
            "walkability": network_metrics.get("walkability_score"),
            "running_fitness": geometry_metrics["running_fitness"].get("score") if running_focused else None,
            "access": round(access_score, 2),
        }
        effective_weights = {name: float(weight) for name, weight in score_weights.items() if components.get(name) is not None}
        weight_sum = sum(effective_weights.values())
        total_score = (sum(float(components[name]) * weight for name, weight in effective_weights.items()) / weight_sum
                       if weight_sum else None)
        item.update({"distance_score": distance_score, "slope_score": slope_score, "access_score": access_score,
                     "continuity_score": continuity_score, "component_scores": components,
                     "effective_score_weights": effective_weights, "total_score": total_score,
                     "low_terrain_burden": low_terrain_burden,
                     "detour_ratio": detour_ratio, "repeated_fraction": repeated_fraction,
                     "mapped_edge_ids": set(network_metrics.get("mapped_edge_ids", []))})

    baseline_reassessment = None
    baseline_ranking_candidate = None
    if running_focused:
        baseline_reassessment = _evaluate_saved_representative(
            root, destination, target_distance_km, distance_tolerance_m,
            preferred_distance_error_m, slope_preference, defaults, fitness_config, osm,
            metric_index, riverside_walkable_index, waterway_index, restricted_areas,
            exclusion_config, steep_grade_threshold_percent, grade_config,
            restriction_check_available=restriction_data is not None,
        )
        if baseline_reassessment:
            baseline_ranking_candidate = baseline_reassessment.pop("_candidate", None)

    in_range = [c for c in candidates
                if _within_distance_tolerance(c["route"]["summary"]["distance_km"],
                                              target_distance_km, distance_tolerance_m)]
    gentle_in_range = [
        c for c in in_range
        if c["ascent_m"] is not None
        and c["ascent_m"] <= gentle_max_ascent_m
        and c["slope"].get("uphill_grade_metrics") is not None
        and c["slope"]["uphill_grade_metrics"]["thresholds"]["8_percent"]["share"] <= gentle_max_uphill_8_share
        and c["slope"]["uphill_grade_metrics"]["max_sustained_uphill_grade_percent"]
            <= float(grade_config.get("gentle_max_sustained_grade_percent", 8.0))
    ]
    gentle_route_ids = {c["route"]["route_id"] for c in gentle_in_range}
    for candidate in candidates:
        candidate["meets_gentle_thresholds"] = candidate["route"]["route_id"] in gentle_route_ids
    # Keep all in-range candidates available so the top-three diversity selector
    # can fill remaining slots after ranking gentle routes first.
    pool = in_range if in_range else candidates
    naturalness_filter = {"repeated_edge_share_max": 0.15, "u_turn_count_max": 3,
                          "applied": False, "used_fallback": False, "excluded_route_count": 0}
    if in_range:
        natural = [c for c in pool if c["repeated_fraction"] <= naturalness_filter["repeated_edge_share_max"]
                   and c["geometry_metrics"]["turns"].get("u_turn_count_estimate", 0) <= naturalness_filter["u_turn_count_max"]]
        naturalness_filter["excluded_route_count"] = len(pool) - len(natural)
        if natural:
            pool = natural
            naturalness_filter["applied"] = True
        else:
            naturalness_filter["used_fallback"] = True
        if slope_preference == "low":
            # Keep distance and naturalness as hard constraints. Prefer routes
            # meeting the gentle thresholds, then fill any remaining slots with
            # the lowest terrain burden among the other in-range routes.
            pool.sort(key=lambda c: _route_rank_key(c, slope_preference, running_focused))
        else:
            pool.sort(key=lambda c: _route_rank_key(c, slope_preference, running_focused))
    else:
        pool.sort(key=lambda c: (c["distance_error_m"],
                                 -(c["total_score"] if c["total_score"] is not None else -1),
                                 c["route"]["route_id"]))
    if baseline_reassessment and baseline_ranking_candidate:
        if baseline_reassessment.get("recommendation_eligible"):
            rank_key = _route_rank_key(baseline_ranking_candidate, slope_preference, running_focused)
            comparable = [candidate for candidate in pool if candidate.get("total_score") is not None]
            baseline_reassessment["rank_if_included"] = 1 + sum(
                _route_rank_key(candidate, slope_preference, running_focused) < rank_key
                for candidate in comparable
            )
            baseline_reassessment["would_outrank_current_top"] = bool(
                comparable and rank_key < _route_rank_key(comparable[0], slope_preference, running_focused)
            )
            baseline_reassessment["current_top_route_id"] = (
                comparable[0]["route"].get("route_id") if comparable else None
            )
        else:
            baseline_reassessment["rank_if_included"] = None
            baseline_reassessment["would_outrank_current_top"] = None
    cross_mode_selection: dict[str, Any] = {
        "applied": False,
        "independent_mode_search": True,
        "peer_preference_read": False,
        "shared_common_candidate_pool": bool(running_focused),
        "independent_mode_scoring": True,
        "reason": "low/any에서 수집된 ORS 경로를 현재 OSM 기준으로 재검증해 공통 후보로 사용하고, 최종 순위는 각 모드의 기존 평가식으로 독립 계산합니다.",
    }
    requested_diversity_threshold = float(defaults.get("route_diversity_max_shared_fraction", 0.70))
    relaxation_steps = sorted({requested_diversity_threshold,
                               *[float(value) for value in defaults.get("route_diversity_relaxation_steps", [0.70, 0.80, 0.90, 0.95])]})
    selected: list[dict[str, Any]] = []
    selected_diversity_threshold: float | None = None
    overlap_excluded_at_selected_threshold = 0
    threshold_attempts: list[dict[str, Any]] = []
    for threshold in relaxation_steps:
        trial: list[dict[str, Any]] = []
        excluded = 0
        for item in pool:
            overlaps = [_route_overlap_fraction(item, kept) for kept in trial]
            # Unknown map matching is not evidence of a different route.
            if any(value is None or value >= threshold for value in overlaps):
                excluded += 1
                continue
            trial.append(item)
            if len(trial) >= 3:
                break
        threshold_attempts.append({"max_shared_fraction": threshold, "selected_count": len(trial),
                                   "excluded_by_overlap": excluded})
        selected = trial
        selected_diversity_threshold = threshold
        overlap_excluded_at_selected_threshold = excluded
        if len(selected) >= 3:
            break
    pairwise_selected_overlap = []
    for index, item in enumerate(selected):
        higher_ranked = []
        for higher_index, other in enumerate(selected[:index], 1):
            fraction = _route_overlap_fraction(item, other)
            higher_ranked.append({"rank": higher_index, "shared_fraction_of_shorter_route": fraction})
            pairwise_selected_overlap.append({"route_a_rank": higher_index, "route_b_rank": index + 1,
                                              "shared_fraction_of_shorter_route": fraction})
        item["overlap_with_higher_ranked"] = higher_ranked
    diversity_selection = {
        "requested_max_shared_fraction": requested_diversity_threshold,
        "selected_max_shared_fraction": selected_diversity_threshold,
        "threshold_relaxed": selected_diversity_threshold is not None and selected_diversity_threshold > requested_diversity_threshold,
        "threshold_attempts": threshold_attempts,
        "selected_count": len(selected),
        "excluded_by_overlap_at_final_threshold": overlap_excluded_at_selected_threshold,
        "pairwise_selected_route_overlap": pairwise_selected_overlap,
        "comparison_method": "Length-weighted overlap of the shorter candidate route using common OSM mapped edge IDs; unknown matching is not treated as different.",
        "fallback_reason": ("세 후보를 70% 중복 기준으로 채우지 못해 기준을 단계적으로 완화했습니다."
                            if selected_diversity_threshold is not None and selected_diversity_threshold > requested_diversity_threshold else
                            "요청된 중복 기준 안에서 세 후보를 선정했습니다." if len(selected) == 3 else
                            f"중복률 {requested_diversity_threshold:.0%} 기준에서 서로 다른 후보가 부족해 중복 코스를 추가하지 않았습니다."),
    }

    recommendations: list[dict[str, Any]] = []
    for rank, item in enumerate(selected, 1):
        route = item["route"]
        within = _within_distance_tolerance(item["route"]["summary"]["distance_km"],
                                            target_distance_km, distance_tolerance_m)
        slope = item["slope"]
        crossings = item["geometry_metrics"]["crossings"]
        verification_items = []
        if not item["start"].get("entrance_verified", False):
            verification_items.append("start_access_not_field_verified")
        if not destination.get("entrance_verified", False):
            verification_items.append("destination_access_not_field_verified")
        route_verification_status = "needs_verification" if verification_items else "verified"
        slope_text = f"경사 점수 {item['slope_score']:.1f}/100, 상승 {item['ascent_m']:.1f}m" if item["slope_score"] is not None and item["ascent_m"] is not None else "경사 데이터 없음"
        steep_text = f"급경사 구간 {(slope['steep_segment_ratio'] * 100):.1f}%" if slope["steep_segment_ratio"] is not None else "급경사 데이터 없음"
        route["running_analysis"] = {
            "target_distance_km": target_distance_km,
            "distance_error_m": round(item["distance_error_m"], 1),
            "distance_score": round(item["distance_score"], 2),
            "slope_preference": slope_preference,
            "verification_status": route_verification_status,
            "verification_items": verification_items,
            "score_components": item["component_scores"],
            "score_weights": item["effective_score_weights"],
            "slope_score": round(item["slope_score"], 2) if item["slope_score"] is not None else None,
            "low_terrain_burden_index": round(item["low_terrain_burden"], 2) if item["low_terrain_burden"] is not None else None,
            "total_score": round(item["total_score"], 2) if item["total_score"] is not None else None,
            "steep_segment_ratio": slope["steep_segment_ratio"],
            "steep_distance_m": round(slope["steep_distance_m"], 1) if slope["steep_distance_m"] is not None else None,
            "grade_metrics": slope,
            "elevation_data_quality": slope.get("elevation_data_quality"),
            "detour_ratio": round(item["detour_ratio"], 3),
            "repeated_segment_m": round(item["repeated_segment_m"], 1),
            "repeated_segment_share": round(item["repeated_fraction"], 4),
            "crossing_metrics": item["geometry_metrics"]["crossings"],
            "network_metrics": item["geometry_metrics"]["network"],
            "riverside_metrics": item["geometry_metrics"].get("running_fitness", {}).get("riverside_metrics"),
            "advisory_area_intersections": item.get("advisory_area_intersections", []),
            "running_fitness": item["geometry_metrics"].get("running_fitness"),
            "elevation_data_quality": slope.get("elevation_data_quality"),
            "access_connections": item["geometry_metrics"].get("access_connections"),
            "turn_metrics": item["geometry_metrics"]["turns"],
            "overlap_with_higher_ranked": item["overlap_with_higher_ranked"],
            "meets_gentle_thresholds": item["meets_gentle_thresholds"],
            "start_accessibility_score": item["access_score"],
            "station_access": item["start"].get("station_access"),
            "cross_mode_selection": cross_mode_selection if running_focused else None,
            "candidate_source_modes": item.get("candidate_source_modes", []),
            "candidate_source_caches": item.get("candidate_source_caches", []),
            "reason": (f"거리 오차 {item['distance_error_m']:.0f}m; "
                       f"출발 300m 내 OSM 매핑 횡단 {crossings['mapped_crossings_first_300m']}회, "
                       f"전체 매핑 횡단 {crossings['mapped_crossings_total']}회; {slope_text}; {steep_text}; "
                       f"반복 구간 {item['repeated_fraction'] * 100:.1f}%, "
                       f"급회전 추정 {item['geometry_metrics']['turns']['sharp_turn_count_estimate']}회, "
                       f"U턴 추정 {item['geometry_metrics']['turns']['u_turn_count_estimate']}회"),
        }
        files = save_route_files(route, item["start"], destination, results_dir, waypoints=item["waypoints"])
        recommendations.append({
            "route_id": route["route_id"], "rank": rank,
            "verification_status": route_verification_status,
            "verification_items": verification_items,
            "start": {"id": item["start"]["id"], "name": item["start"]["name"],
                      "latitude": item["start"]["latitude"], "longitude": item["start"]["longitude"],
                      "access_type": item["start"].get("access_type"),
                      "coordinate_source": item["start"].get("coordinate_source"),
                      "coordinate_verified": item["start"].get("coordinate_verified", False),
                      "accessibility_score": item["access_score"],
                      "entrance_verified": item["start"].get("entrance_verified", False),
                      "station_access": item["start"].get("station_access")},
            "waypoints": [{"id": w["id"], "name": w["name"],
                           "latitude": w["latitude"], "longitude": w["longitude"],
                           "candidate_type": w.get("candidate_type"),
                           "running_way_class": w.get("running_way_class"),
                           "running_way_score": w.get("running_way_score"),
                           "coordinate_source": w.get("coordinate_source"),
                           "coordinate_verified": w.get("coordinate_verified", False),
                           "entrance_verified": w.get("entrance_verified", False)} for w in item["waypoints"]],
            "destination": {"id": destination["id"], "name": destination["name"],
                            "latitude": destination["latitude"], "longitude": destination["longitude"],
                            "entrance_verified": destination.get("entrance_verified", False)},
            "distance_km": round(float(route["summary"]["distance_km"]), 4),
            "distance_error_m": round(item["distance_error_m"], 1), "within_tolerance": within,
            "duration_minutes": round(float(route["summary"]["duration_minutes"]), 2),
            "ascent_m": item["ascent_m"], "descent_m": item["descent_m"],
            "elevation_is_estimate": route["summary"].get("elevation_is_estimate", False),
            "steep_grade_threshold_percent": steep_grade_threshold_percent,
            "steep_segment_ratio": round(slope["steep_segment_ratio"], 4) if slope["steep_segment_ratio"] is not None else None,
            "steep_distance_m": round(slope["steep_distance_m"], 1) if slope["steep_distance_m"] is not None else None,
            "distance_score": round(item["distance_score"], 2),
            "slope_score": round(item["slope_score"], 2) if item["slope_score"] is not None else None,
            "total_score": round(item["total_score"], 2) if item["total_score"] is not None else None,
            "running_fitness_score": item["geometry_metrics"]["running_fitness"].get("score") if running_focused else None,
            "running_fitness": item["geometry_metrics"]["running_fitness"] if running_focused else None,
            "riverside_metrics": item["geometry_metrics"]["running_fitness"].get("riverside_metrics"),
            "access_connections": item["geometry_metrics"].get("access_connections"),
            "cross_mode_selection": cross_mode_selection if running_focused else None,
            "candidate_source_modes": item.get("candidate_source_modes", []),
            "score_components": item["component_scores"], "score_weights": item["effective_score_weights"],
            "mapped_crossings_total": item["geometry_metrics"]["crossings"]["mapped_crossings_total"],
            "mapped_crossings_first_300m": item["geometry_metrics"]["crossings"]["mapped_crossings_first_300m"],
            "mapped_signalized_crossings_total": item["geometry_metrics"]["crossings"]["mapped_signalized_crossings_total"],
            "crossing_data_status": item["geometry_metrics"]["crossings"]["data_status"],
            "repeated_network_edge_share": item["geometry_metrics"]["network"]["repeated_mapped_network_edge_share"],
            "overlap_with_higher_ranked": item["overlap_with_higher_ranked"],
            "u_turn_count_estimate": item["geometry_metrics"]["turns"]["u_turn_count_estimate"],
            "sharp_turn_count_estimate": item["geometry_metrics"]["turns"]["sharp_turn_count_estimate"],
            "network_metrics": item["geometry_metrics"]["network"],
            "advisory_area_intersections": item.get("advisory_area_intersections", []),
            "accessibility_score": item["access_score"],
            "recommendation_reason": route["running_analysis"]["reason"],
            "files": {path.suffix.lstrip("."): str(path.relative_to(root)) for path in files},
        })

    evaluated_start_ids = {str(item["start"]["id"]) for item in candidates}
    comparison_starts = [
        {"id": str(start["id"]), "name": str(start["name"]),
         "candidate_origin": start.get("candidate_origin", "curated_candidate_list"),
         "required_for_comparison": bool(start.get("required_for_comparison")),
         "evaluated": str(start["id"]) in evaluated_start_ids,
         "entrance_verified": bool(start.get("entrance_verified", False)),
         "coordinate_verified": bool(start.get("coordinate_verified", False)),
         "station_access": start.get("station_access")}
        for start in starts if start.get("required_for_comparison")
        or str(start.get("candidate_origin", "")).startswith("automatic_osm")
        or str(start.get("candidate_origin", "")).startswith("automatic_running")
        or str(start.get("candidate_origin", "")).startswith("automatic_station_exit_connected")
        or start.get("candidate_origin") == "automatic_park_boundary_candidate"
    ]
    result = {
        "target_distance_km": target_distance_km,
        "recommendation_strategy": "access_focused" if access_focused else "running_focused" if running_focused else "station_baseline",
        "distance_tolerance_km": distance_tolerance_m / 1000,
        "distance_tolerance_m": distance_tolerance_m,
        "slope_preference": slope_preference,
        "access_focused_version": 1 if access_focused else None,
        "cross_mode_selection": cross_mode_selection if running_focused else None,
                    "common_candidate_pool": common_pool_diagnostics,
        "destination": {"id": destination["id"], "name": destination["name"],
                        "latitude": destination["latitude"], "longitude": destination["longitude"],
                        "entrance_verified": destination.get("entrance_verified", False)},
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "search": {"ors_api_calls": calls, "ors_cache_hits": cache_hits, "max_ors_api_calls": max_ors_calls,
                   "candidate_starts": len(starts), "available_start_candidates": len(all_starts),
                   "cached_start_quality": {
                       **cached_quality_diagnostics,
                       "candidate_starts_with_valid_cached_route": len(cached_start_quality),
                       "selection_hint": "current ORS distance, current OSM access restrictions/connectivity, current grade profile and current running-fitness metrics; cached stored scores are ignored",
                   },
                   "park_start_candidates": sum(s.get("access_type") in {"park_entrance", "park_path_connection"} for s in all_starts),
                   "running_network_start_candidates": sum(s.get("access_type") in {"running_network_access", "riverside_path"} for s in all_starts),
                   "candidate_waypoints": len(waypoints), "available_waypoint_candidates": len(all_waypoints),
                   "candidate_strategy": ("access_focused: only named OSM subway exits topologically connected to a foot-allowed OSM walking graph are sources; running starts are mapped running-network vertices with a network-verified station approach up to 800m, scored by proximity with <=400m preferred. Access distance is excluded from the ORS target running distance."
                                          if access_focused else
                                          "running_focused: select spatially diverse mapped park, riverside and high-running-score OSM path vertices first; station exits remain eligible but receive no transit-only bonus; route waypoints are sampled from tagged foot/cycle pedestrian networks and all chosen routes are checked by ORS foot-walking."
                                          if running_focused else
                                          "low: preserve required exits; probe park/path starts before station exits; prefer mapped park/path/footway waypoints; refinement seeds ranked by ORS ascent and steep-grade share."
                                          if slope_preference == "low" else
                                          "any: preserve required exits, spatially diversify transit/park access starts; include all mapped access, crossing and foot-network waypoint types; refinement seeds prioritize distance, crossings and route reuse."),
                   "waypoints_per_route_max": MAX_WAYPOINTS_PER_ROUTE, "candidate_combinations": len(combinations),
                   "routes_evaluated": len(candidates), "within_tolerance_candidates": len(in_range), "failed_routes": failures,
                   "routes_skipped_outside_distance_tolerance": outside_tolerance_routes,
                   "quota_exhausted": quota_exhausted,
                   "naturalness_filter": naturalness_filter,
                   "station_access_search": access_diagnostics if access_focused else None,
                   "restricted_area_filter": ({
                       "enabled": True,
                       "source": "OSM way-level explicit access tags plus hard area rules; school/park boundaries are advisories",
                       "cache_reused_from": restriction_data.get("reused_from_cache") if restriction_data else None,
                       "mapped_area_count": len(restricted_areas),
                       "mapped_area_names": sorted({area["name"] for area in restricted_areas
                                                     if not str(area["name"]).startswith("OSM ")})[:50],
                       "route_intersection_sample_spacing_m": float(exclusion_config.get("route_intersection_sample_spacing_m", 10)),
                       "rejected_ors_routes_by_area": restricted_route_rejections,
                       "advisory_route_intersections": advisory_route_intersections,
                       "school_park_boundary_policy": "area overlap is advisory; reject only explicit matched access restrictions or configured hard-restricted historic areas",
                       "note": exclusion_config.get("note"),
                   } if running_focused else {"enabled": False}),
                   "cross_mode_selection": cross_mode_selection if running_focused else None,
                   "route_diversity_selection": diversity_selection,
                   "local_refinement": {"attempted_route_count": local_refinement_routes_evaluated,
                                        "candidate_routes_attempted": local_refinement_routes_attempted,
                                        "ors_api_calls": local_refinement_api_calls,
                                        "cache_hits": local_refinement_cache_hits,
                                        "waypoint_neighbor_radius_m": float(defaults.get("running_score_notes", {}).get("local_refinement_radius_m", 250)),
                                        "request_budget_reserved": local_refinement_call_reserve},
                   "comparison_starts": comparison_starts,
                   "retry_policy": "At most one exponential-backoff retry for network, timeout and 5xx errors; HTTP 429 retries only once when a short Retry-After is supplied. Authentication, rate-limit and repeated API outages stop further requests; all attempts count toward the per-run cap.",
                   "api_stop_reason": api_stop_reason,
                   "route_failure_reason": ("ORS HTTP 429 rate limit reached; additional route requests were stopped." if quota_exhausted else
                                             None if candidates else
                                             api_stop_reason if api_stop_reason else
                                             failures[0]["reason"] if failures else
                                             "목표 거리 근처의 경로 후보를 만들지 못했습니다. 목적지 주변 OSM 데이터와 출발 후보를 확인하세요."),
                   "ranking": ("ORS foot-walking and ±distance tolerance are hard conditions; running_fitness is scored separately from slope, distance, mapped crossings and continuity using data/running_fitness.json. Slope ranking uses distance-smoothed uphill 8%/10% exposure, 100m sustained grade and longest steep climb; ascent is secondary. Missing OSM attributes remain unknown and are not treated as safe."
                               if running_focused else
                               "ORS foot-walking and ±distance tolerance are hard conditions; low mode ranks sustained steep-uphill exposure and long climbs before total ascent, then favors non-repeating routes and running fitness."
                               if slope_preference == "low" else
                               "ORS foot-walking and ±distance tolerance are hard conditions; any mode gives a lighter penalty to steep uphill grades and prioritizes running fitness, continuity, distance and mapped crossings." )},
        "slope_assessment": {
            "gentle_route_found_within_distance_tolerance": bool(gentle_in_range),
            "gentle_thresholds": {"max_ascent_m": gentle_max_ascent_m,
                                  "max_uphill_8_percent_share": gentle_max_uphill_8_share,
                                  "max_sustained_uphill_grade_percent": grade_config.get("gentle_max_sustained_grade_percent", 8.0),
                                  "steep_grade_threshold_percent": steep_grade_threshold_percent},
            "evaluated_routes_within_distance_tolerance": len(in_range),
            "gentle_candidates_within_tolerance": len(gentle_in_range),
            "selected_routes_meeting_gentle_thresholds": sum(bool(item.get("meets_gentle_thresholds")) for item in recommendations),
            "message": (f"거리 허용 범위 안에서 완만 기준을 만족하는 코스 {len(gentle_in_range)}개를 찾았습니다. 완만 코스가 3개보다 적으면 자연스러움·중복 기준을 통과한 거리 적합 후보 중 지형 부담이 낮은 순으로 나머지를 채우며, 각 후보의 완만 기준 충족 여부를 표시합니다." if gentle_in_range else
                        f"거리 적합 코스 {len(in_range)}개 중 완만 기준(상승 {gentle_max_ascent_m:.0f}m 이하, 8% 이상 오르막 비율 {gentle_max_uphill_8_share * 100:.0f}% 이하, 지속 경사 {float(grade_config.get('gentle_max_sustained_grade_percent', 8.0)):.0f}% 이하)을 만족하는 코스가 없습니다. 실제 ORS 경로 중 평가 점수가 높은 순서로 표시합니다." if slope_preference == "low" else
                        "언덕 허용 선호로 평가했습니다. 높은 고도를 보너스 처리하지 않고 거리·횡단·연속성도 함께 반영했습니다."),
        },
        "data_notes": [
            "경로 거리·시간·고도 좌표는 실제 ORS foot-walking 응답으로 검증했습니다.",
            f"경사율은 경로 거리를 {float(grade_config.get('profile_sample_m', GRADE_SEGMENT_MIN_M)):.0f}m 간격으로 재표본화하고 {float(grade_config.get('smoothing_window_m', 60.0)):.0f}m 중앙값 창으로 평활화했습니다.",
            "8%·10% 지표는 오르막만 계산하고, 최대 지속 경사는 설정된 거리 창의 누적 고도차로 계산했습니다. ORS 고도 해상도와 평활화에 따른 추정치이며 현장 측량값은 아닙니다.",
            "출발·경유 후보 좌표는 OpenStreetMap 데이터이며 ODbL 조건과 출처를 따릅니다.",
            "공원 경계 보행 연결 후보는 OSM 공원 경계와 실제 매핑된 보행로 정점으로부터 생성한 미검증 후보이며 실제 출입구로 확인된 것은 아닙니다.",
            "역·공원 출입구 위치, 실제 진입 가능 여부와 연결성은 지도 또는 현장에서 추가 확인해야 합니다.",
            "OSM/ORS 데이터만으로 보행 안전성이나 러닝 안전성을 추정하지 않았습니다.",
            "러닝 적합도는 data/running_fitness.json의 OSM 태그 분류 점수 추정이며 실제 노면·보행자 밀도·차량 분리·야간 조명·러닝 안전성을 현장 검증한 값이 아닙니다.",
            "자전거도로는 foot=yes/designated/permissive가 명시된 경우만 보행 허용 후보로 분류했습니다. 보행 태그가 없는 cycleway는 불확실로 별도 보고합니다.",
            "차량 분리 비율은 OSM highway 분류의 대리 지표입니다. 물리적 분리 시설 여부는 확인하지 않았습니다.",
            "연속 러닝 길이는 OSM에 매핑된 횡단·신호 지점에서 끊기는 것으로 추정했습니다. 실제 신호 대기나 누락된 횡단은 반영되지 않을 수 있습니다.",
            "OSM에 매칭되지 않은 경로는 정보 부족으로 집계하고 안전하다고 보지 않습니다.",
            f"거리 허용 오차는 ±{distance_tolerance_m:.0f}m이며, ±{preferred_distance_error_m:.0f}m 이내는 거리 점수를 더 높게 받습니다.",
            "횡단 수는 OSM 횡단 태그와 ORS 경로를 15m 이내로 맞춘 결과입니다. OSM에 누락된 횡단은 없는 것으로 간주하지 않습니다.",
            "출발 후 첫 300m의 횡단을 별도 집계하고, 신호 횡단·신호 없는/표시된 횡단·유형 미상 횡단에 서로 다른 페널티를 적용합니다.",
            "OSM way/edge 반복률은 네트워크에 맞춘 값이며, 매칭되지 않은 구간은 미상입니다. 급회전은 ORS 선형의 방향 변화 추정치입니다.",
            "보행 적합성은 OSM 태그 기반 참고 점수입니다. 실제 보도 상태·교통 위험·출입구 연결은 현장 확인이 필요합니다.",
            OSM_ATTRIBUTION,
        ],
        "recommendations": recommendations,
        "representative_baseline_reassessment": baseline_reassessment,
    }
    summary_path = results_dir / f"recommendations-{target_label}-{slope_preference}.json"
    summary_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    comparison = _refresh_preference_overlap(root, target_label, destination_slug, results_dir)
    if comparison is not None:
        result["cross_preference_comparison"] = {**comparison,
                                                 "artifact": str((results_dir / "preference-route-overlap.json").relative_to(root))}
    result["summary_file"] = str(summary_path.relative_to(root))
    if running_focused:
        baseline_path = destination_results_dir / target_label / f"recommendations-{target_label}-{slope_preference}.json"
        if baseline_path.exists():
            baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
            result["baseline_comparison"] = {
                "baseline_summary_file": str(baseline_path.relative_to(root)),
                "baseline_strategy": baseline.get("recommendation_strategy", "station_baseline"),
                "baseline_top_route": baseline.get("recommendations", [{}])[0] if baseline.get("recommendations") else None,
                "comparison_note": "Baseline files were left unchanged; compare this strategy's separate summary and route artifacts against them.",
            }
            summary_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result
