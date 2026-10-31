"""OSM-backed, explicitly incomplete running-continuity metrics for ORS routes."""

from __future__ import annotations

import math
import json
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any


_CELL_DEGREES = 0.0005
_MAX_SNAP_M = 12.0
_PEDESTRIAN_WAYS = {"footway", "path", "pedestrian"}
_ROAD_WAYS = {
    "residential", "living_street", "service", "unclassified", "tertiary",
    "secondary", "primary", "trunk", "road", "motorway", "motorway_link",
    "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}
_RUNNING_CONFIG_PATH = Path(__file__).resolve().parents[1] / "data" / "running_fitness.json"


@lru_cache(maxsize=1)
def _running_config() -> dict[str, Any]:
    try:
        return json.loads(_RUNNING_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def classify_running_way(tags: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Classify one OSM way without turning missing tags into a safety claim."""
    settings = config or _running_config()
    scores = settings.get("way_scores", {})
    highway = str(tags.get("highway", ""))
    foot = str(tags.get("foot", "")).casefold()
    access = str(tags.get("access", "")).casefold()
    explicit_foot_allow = foot in {"yes", "designated", "permissive"}
    if foot in {"no", "private", "use_sidepath"} or (access in {"no", "private", "customers", "permit"} and not explicit_foot_allow):
        return {"class": "not_walkable_by_tag", "score": 0.0, "walkable": False, "separated_proxy": False}
    if highway == "steps":
        return {"class": "steps", "score": float(scores.get("steps", 0)), "walkable": True, "separated_proxy": True}
    if highway == "cycleway":
        if foot not in {"yes", "designated", "permissive"}:
            return {"class": "uncertain_cycleway", "score": scores.get("uncertain_cycleway"), "walkable": None, "separated_proxy": None}
        key = "cycleway_foot_allowed"
    elif highway == "pedestrian":
        key = "pedestrian"
    elif highway == "footway":
        key = "footway"
    elif highway == "path":
        key = "path"
    elif highway == "living_street":
        key = "living_street"
    elif highway in {"residential", "unclassified"}:
        sidewalk = str(tags.get("sidewalk", "")).casefold()
        key = "residential_with_sidewalk" if sidewalk in {"both", "left", "right", "separate"} else "residential_unknown_sidewalk"
    elif highway == "service":
        key = "service_with_sidewalk" if tags.get("sidewalk") in {"both", "left", "right", "separate"} else "other_motor_road"
    elif highway in _ROAD_WAYS:
        key = "other_motor_road"
    else:
        return {"class": "unmapped_or_unknown", "score": scores.get("unmapped_or_unknown"), "walkable": None, "separated_proxy": None}

    score = scores.get(key)
    if score is not None:
        score = float(score)
        surface = str(tags.get("surface", "unknown")).casefold().replace(" ", "_")
        smoothness = str(tags.get("smoothness", "")).casefold().replace(" ", "_")
        score += float(settings.get("surface_adjustments", {}).get(surface, 0))
        score += float(settings.get("smoothness_adjustments", {}).get(smoothness, 0))
        width = str(tags.get("width", ""))
        try:
            width_m = float(width.removesuffix("m").strip())
            width_config = settings.get("width_m", {})
            if width_m < float(width_config.get("narrow_below", 1.2)):
                score -= float(width_config.get("narrow_penalty", 18))
            elif width_m >= float(width_config.get("comfortable_above", 2.0)):
                score += float(width_config.get("comfortable_bonus", 3))
        except (ValueError, TypeError):
            width_m = None
        else:
            pass
        score = max(0.0, min(100.0, score))
    else:
        width_m = None
    separated_proxy = key in {"pedestrian", "footway", "path", "cycleway_foot_allowed"}
    if key == "path" and tags.get("motor_vehicle") in {"yes", "designated"}:
        separated_proxy = False
    return {"class": key, "score": score, "walkable": True, "separated_proxy": separated_proxy,
            "surface": tags.get("surface"), "smoothness": tags.get("smoothness"), "width_m": width_m,
            "lit": tags.get("lit"), "segregated": tags.get("segregated"), "foot": tags.get("foot")}


def _distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(h))


def _project_xy(point: tuple[float, float], latitude_ref: float) -> tuple[float, float]:
    lat, lon = point
    return lon * 111_320.0 * math.cos(math.radians(latitude_ref)), lat * 110_540.0


def _point_segment_distance(point: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    lat_ref = (point[0] + a[0] + b[0]) / 3
    px, py = _project_xy(point, lat_ref)
    ax, ay = _project_xy(a, lat_ref)
    bx, by = _project_xy(b, lat_ref)
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    t = 0.0 if denom == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _route_position(point: tuple[float, float], coordinates: list[list[float]]) -> tuple[float, float]:
    """Return distance to route and chainage at the nearest projected segment point."""
    best_distance = math.inf
    best_chainage = 0.0
    chainage = 0.0
    for left, right in zip(coordinates, coordinates[1:]):
        a, b = (float(left[1]), float(left[0])), (float(right[1]), float(right[0]))
        segment = _distance_m(a, b)
        distance = _point_segment_distance(point, a, b)
        if distance < best_distance:
            best_distance = distance
            # Recompute the projection fraction in the same local metric.
            lat_ref = (point[0] + a[0] + b[0]) / 3
            px, py = _project_xy(point, lat_ref)
            ax, ay = _project_xy(a, lat_ref)
            bx, by = _project_xy(b, lat_ref)
            dx, dy = bx - ax, by - ay
            denom = dx * dx + dy * dy
            t = 0.0 if denom == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
            best_chainage = chainage + t * segment
        chainage += segment
    return best_distance, best_chainage


def build_osm_edge_grid(osm_data: dict[str, Any]) -> dict[tuple[int, int], list[dict[str, Any]]]:
    grid: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for way in osm_data.get("elements", []):
        if way.get("type") != "way" or len(way.get("geometry", [])) < 2:
            continue
        tags = way.get("tags", {})
        highway = tags.get("highway")
        if highway not in _PEDESTRIAN_WAYS | _ROAD_WAYS | {"steps", "cycleway", "track"}:
            continue
        points = way["geometry"]
        for index, (left, right) in enumerate(zip(points, points[1:])):
            a = (float(left["lat"]), float(left["lon"]))
            b = (float(right["lat"]), float(right["lon"]))
            edge = {
                "key": (str(way.get("id")), index), "a": a, "b": b, "highway": highway,
                "sidewalk": tags.get("sidewalk"), "foot": tags.get("foot"), "tags": tags,
            }
            lat0 = math.floor(min(a[0], b[0]) / _CELL_DEGREES)
            lat1 = math.floor(max(a[0], b[0]) / _CELL_DEGREES)
            lon0 = math.floor(min(a[1], b[1]) / _CELL_DEGREES)
            lon1 = math.floor(max(a[1], b[1]) / _CELL_DEGREES)
            for lat_cell in range(lat0, lat1 + 1):
                for lon_cell in range(lon0, lon1 + 1):
                    grid[(lat_cell, lon_cell)].append(edge)
    return grid


def _nearest_osm_edge(midpoint: tuple[float, float], grid: dict[tuple[int, int], list[dict[str, Any]]]) -> tuple[dict[str, Any] | None, float]:
    lat_cell = math.floor(midpoint[0] / _CELL_DEGREES)
    lon_cell = math.floor(midpoint[1] / _CELL_DEGREES)
    best, best_distance = None, _MAX_SNAP_M
    seen: set[tuple[str, int]] = set()
    for lat_offset in (-1, 0, 1):
        for lon_offset in (-1, 0, 1):
            for edge in grid.get((lat_cell + lat_offset, lon_cell + lon_offset), []):
                if edge["key"] in seen:
                    continue
                seen.add(edge["key"])
                distance = _point_segment_distance(midpoint, edge["a"], edge["b"])
                if distance < best_distance:
                    best, best_distance = edge, distance
    return best, best_distance


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    return math.degrees(math.atan2(math.sin(dlon) * math.cos(lat2),
                                   math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)))


def _turn_metrics(coordinates: list[list[float]]) -> dict[str, Any]:
    headings: list[float] = []
    for left, right in zip(coordinates, coordinates[1:]):
        a, b = (float(left[1]), float(left[0])), (float(right[1]), float(right[0]))
        if _distance_m(a, b) >= 5:
            headings.append(_bearing(a, b))
    sharp = u_turns = 0
    for first, second in zip(headings, headings[1:]):
        angle = abs((second - first + 180) % 360 - 180)
        if angle >= 150:
            u_turns += 1
        elif angle >= 65:
            sharp += 1
    return {"sharp_turn_count_estimate": sharp, "u_turn_count_estimate": u_turns,
            "turn_thresholds_degrees": {"sharp": 65, "u_turn": 150},
            "turn_measurement_note": "ORS geometry heading changes over adjacent segments >=5m; mapped road junction identity is not available."}


def evaluate_route_geometry(
    route: dict[str, Any], osm_data: dict[str, Any],
    network_grid: dict[tuple[int, int], list[dict[str, Any]]] | None = None,
    fitness_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Measure mapped crossing events, network-edge reuse, and tagged path coverage."""
    coordinates = route.get("geometry", {}).get("coordinates", [])
    if len(coordinates) < 2:
        return {"crossings": None, "network": None, "turns": None}
    grid = network_grid if network_grid is not None else build_osm_edge_grid(osm_data)
    fitness_config = fitness_config or _running_config()
    snap_limit = float(fitness_config.get("matching", {}).get("max_snap_m", _MAX_SNAP_M))
    total_route_m = float(route.get("summary", {}).get("distance_m") or 0.0)
    if total_route_m <= 0:
        total_route_m = sum(_distance_m((a[1], a[0]), (b[1], b[0])) for a, b in zip(coordinates, coordinates[1:]))

    matched_m = dedicated_m = steps_m = road_m = mapped_sidewalk_m = explicitly_no_sidewalk_m = 0.0
    explicit_access_restricted_m = 0.0
    explicit_access_restricted_ways: dict[str, float] = {}
    repeated_m = 0.0
    matched_edges: set[tuple[str, int]] = set()
    matched_edge_lengths_m: dict[str, float] = {}
    used_edges: set[tuple[str, int]] = set()
    previous_edge: tuple[str, int] | None = None
    friendly_m = separated_proxy_m = steps_m = bad_surface_m = uncertain_cycleway_m = 0.0
    quality_weighted_m = quality_m = 0.0
    running_intervals: list[tuple[float, float, bool]] = []
    chainage_m = 0.0
    mapped_class_lengths: dict[str, float] = {}
    max_match_distance_m = 0.0
    for left, right in zip(coordinates, coordinates[1:]):
        a, b = (float(left[1]), float(left[0])), (float(right[1]), float(right[0]))
        length = _distance_m(a, b)
        if length <= 0.2:
            continue
        midpoint = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        edge, match_distance = _nearest_osm_edge(midpoint, grid)
        segment_start = chainage_m
        chainage_m += length
        if edge is None:
            previous_edge = None
            running_intervals.append((segment_start, segment_start + length, False))
            continue
        max_match_distance_m = max(max_match_distance_m, match_distance)
        edge_tags = edge.get("tags", {})
        access_tag = str(edge_tags.get("access", "")).casefold()
        foot_tag = str(edge_tags.get("foot", "")).casefold()
        explicit_foot_allow = foot_tag in {"yes", "designated", "permissive"}
        if (foot_tag in {"no", "private", "use_sidepath"}
                or (access_tag in {"no", "private", "customers", "permit"} and not explicit_foot_allow)):
            explicit_access_restricted_m += length
            way_id = str(edge["key"][0])
            explicit_access_restricted_ways[way_id] = explicit_access_restricted_ways.get(way_id, 0.0) + length
        classification = classify_running_way(edge["tags"], fitness_config)
        way_class = classification["class"]
        mapped_class_lengths[way_class] = mapped_class_lengths.get(way_class, 0.0) + length
        if classification.get("walkable") is True and classification.get("score") is not None:
            score = float(classification["score"])
            quality_weighted_m += score * length
            quality_m += length
            if score >= 60.0 and way_class != "steps":
                friendly_m += length
                running_intervals.append((segment_start, segment_start + length, True))
            else:
                running_intervals.append((segment_start, segment_start + length, False))
            if classification.get("separated_proxy") is True:
                separated_proxy_m += length
            if score < 35.0:
                bad_surface_m += length
        else:
            running_intervals.append((segment_start, segment_start + length, False))
            if way_class == "uncertain_cycleway":
                uncertain_cycleway_m += length
        key = edge["key"]
        matched_m += length
        matched_edges.add(key)
        edge_id = f"{key[0]}:{key[1]}"
        matched_edge_lengths_m[edge_id] = matched_edge_lengths_m.get(edge_id, 0.0) + length
        if edge["highway"] in _PEDESTRIAN_WAYS:
            dedicated_m += length
        elif edge["highway"] == "steps":
            steps_m += length
        elif edge["highway"] in _ROAD_WAYS:
            road_m += length
            if edge["sidewalk"] in {"both", "left", "right", "separate"}:
                mapped_sidewalk_m += length
            elif edge["sidewalk"] == "no":
                explicitly_no_sidewalk_m += length
        if key in used_edges and key != previous_edge:
            repeated_m += length
        used_edges.add(key)
        previous_edge = key

    crossing_nodes = []
    continuous_interruptions: list[float] = []
    signal_nodes = 0
    for element in osm_data.get("elements", []):
        if element.get("type") != "node" or "lat" not in element or "lon" not in element:
            continue
        tags = element.get("tags", {})
        highway = tags.get("highway")
        is_crossing = highway == "crossing"
        is_signal = highway == "traffic_signals"
        if not is_crossing and not is_signal:
            continue
        distance, chainage = _route_position((float(element["lat"]), float(element["lon"])), coordinates)
        if distance > 15:
            continue
        if is_signal:
            signal_nodes += 1
            continuous_interruptions.append(chainage)
        if is_crossing:
            continuous_interruptions.append(chainage)
            crossing = tags.get("crossing", "")
            signals = tags.get("crossing:signals", "")
            if crossing in {"traffic_signals", "signals"} or signals == "yes":
                crossing_type = "signalized"
            elif crossing in {"uncontrolled", "unmarked", "marked"} or signals == "no":
                crossing_type = "unsignalized_or_marked"
            else:
                crossing_type = "type_unknown"
            crossing_nodes.append({"id": element.get("id"), "chainage_m": round(chainage, 1),
                                   "distance_to_ors_route_m": round(distance, 1), "type": crossing_type,
                                   "tags": {key: tags[key] for key in ("crossing", "crossing:signals", "traffic_signals") if key in tags}})

    # OSM sometimes maps several crossing nodes at the same junction. Keep the best tagged node per 8m chainage cluster.
    crossing_nodes.sort(key=lambda event: (event["chainage_m"], {"signalized": 0, "unsignalized_or_marked": 1, "type_unknown": 2}[event["type"]]))
    unique_crossings = []
    for event in crossing_nodes:
        if unique_crossings and event["chainage_m"] - unique_crossings[-1]["chainage_m"] < 8:
            if event["type"] == "signalized" and unique_crossings[-1]["type"] != "signalized":
                unique_crossings[-1] = event
            continue
        unique_crossings.append(event)
    early = [event for event in unique_crossings if event["chainage_m"] <= 300]
    crossing_counts = {
        "mapped_crossings_total": len(unique_crossings),
        "mapped_crossings_first_300m": len(early),
        "mapped_signalized_crossings_total": sum(event["type"] == "signalized" for event in unique_crossings),
        "mapped_signalized_crossings_first_300m": sum(event["type"] == "signalized" for event in early),
        "mapped_unsignalized_or_marked_crossings_total": sum(event["type"] == "unsignalized_or_marked" for event in unique_crossings),
        "mapped_unknown_type_crossings_total": sum(event["type"] == "type_unknown" for event in unique_crossings),
    }
    crossing_penalty = (
        crossing_counts["mapped_signalized_crossings_first_300m"] * 22
        + sum(event["type"] == "unsignalized_or_marked" for event in early) * 12
        + sum(event["type"] == "type_unknown" for event in early) * 16
        + sum(event["type"] == "signalized" and event not in early for event in unique_crossings) * 10
        + sum(event["type"] == "unsignalized_or_marked" and event not in early for event in unique_crossings) * 6
        + sum(event["type"] == "type_unknown" and event not in early for event in unique_crossings) * 8
    )
    crossings = {
        **crossing_counts,
        "crossing_score": max(0.0, 100.0 - crossing_penalty),
        "mapped_events": unique_crossings,
        "traffic_signal_nodes_near_route_not_confirmed_crossings": signal_nodes,
        "data_status": "OSM mapped records only; missing or unmapped crossings are unknown, not absent.",
        "match_distance_m": 15,
        "early_window_m": 300,
    }
    longest_continuous_m = streak_m = 0.0
    interruption_positions = sorted(continuous_interruptions)
    interruption_index = 0
    for start_m, end_m, friendly in running_intervals:
        while interruption_index < len(interruption_positions) and interruption_positions[interruption_index] < start_m:
            if streak_m:
                longest_continuous_m = max(longest_continuous_m, streak_m)
                streak_m = 0.0
            interruption_index += 1
        interrupted_inside = interruption_index < len(interruption_positions) and interruption_positions[interruption_index] <= end_m
        if friendly and not interrupted_inside:
            streak_m += end_m - start_m
        else:
            longest_continuous_m = max(longest_continuous_m, streak_m)
            streak_m = 0.0
        if interrupted_inside:
            longest_continuous_m = max(longest_continuous_m, streak_m)
            streak_m = 0.0
            interruption_index += 1
    longest_continuous_m = max(longest_continuous_m, streak_m)
    mapped_fraction = matched_m / total_route_m if total_route_m else 0.0
    walkability_score = None
    if matched_m >= 100 and mapped_fraction >= 0.25:
        walkability_score = max(0.0, min(100.0, 100 * (dedicated_m / matched_m) - 100 * (steps_m / matched_m)))
    network = {
        "matched_osm_network_share": round(mapped_fraction, 4) if total_route_m else None,
        "dedicated_pedestrian_way_share_of_route": round(dedicated_m / total_route_m, 4) if total_route_m else None,
        "steps_share_of_route": round(steps_m / total_route_m, 4) if total_route_m else None,
        "mapped_motor_road_share_of_route": round(road_m / total_route_m, 4) if total_route_m else None,
        "explicit_access_restricted_m": round(explicit_access_restricted_m, 1),
        "explicit_access_restricted_share_of_route": round(explicit_access_restricted_m / total_route_m, 4) if total_route_m else None,
        "explicit_access_restricted_way_lengths_m": {key: round(value, 1) for key, value in sorted(explicit_access_restricted_ways.items())},
        "mapped_sidewalk_share_of_route": round(mapped_sidewalk_m / total_route_m, 4) if total_route_m else None,
        "explicitly_no_sidewalk_share_of_route": round(explicitly_no_sidewalk_m / total_route_m, 4) if total_route_m else None,
        "repeated_mapped_network_edge_m": round(repeated_m, 1),
        "repeated_mapped_network_edge_share": round(repeated_m / total_route_m, 4) if total_route_m else None,
        "mapped_edge_count": len(matched_edges),
        "mapped_edge_ids": [f"{way_id}:{segment_index}" for way_id, segment_index in sorted(matched_edges)],
        "mapped_edge_lengths_m": {edge_id: round(length, 2) for edge_id, length in sorted(matched_edge_lengths_m.items())},
        "walkability_score": round(walkability_score, 2) if walkability_score is not None else None,
        "walkability_score_note": "Only mapped OSM ways are classified; unmatched portions remain unknown and are not treated as unsafe.",
        "snap_threshold_m": _MAX_SNAP_M,
    }
    turns = _turn_metrics(coordinates)
    target_m = float(route.get("summary", {}).get("distance_m") or total_route_m)
    component_weights = fitness_config.get("score_components", {})
    friendly_share = friendly_m / total_route_m if total_route_m else None
    separated_share = separated_proxy_m / total_route_m if total_route_m else None
    continuous_score = min(100.0, longest_continuous_m / max(1.0, min(target_m, 1200.0)) * 100)
    surface_quality_score = quality_weighted_m / quality_m if quality_m else None
    repeated_share = network.get("repeated_mapped_network_edge_share")
    naturalness_score = max(0.0, 100.0
                            - turns["u_turn_count_estimate"] * 20
                            - turns["sharp_turn_count_estimate"] * 2
                            - (float(repeated_share or 0) * 100))
    components = {
        "running_friendly_share": friendly_share * 100 if friendly_share is not None else None,
        "vehicle_separation_proxy_share": separated_share * 100 if separated_share is not None else None,
        "continuous_running_estimate_score": continuous_score,
        "surface_width_quality_score": surface_quality_score,
        "naturalness_score": naturalness_score,
    }
    applicable = [(key, float(weight)) for key, weight in component_weights.items()
                  if components.get(key) is not None and float(weight) > 0]
    weight_sum = sum(weight for _, weight in applicable)
    fitness_score = (sum(float(components[key]) * weight for key, weight in applicable) / weight_sum
                     if weight_sum else None)
    fitness = {
        "score": round(fitness_score, 2) if fitness_score is not None else None,
        "components": {key: round(value, 4) if key.endswith("share") else round(value, 2) if value is not None else None
                       for key, value in components.items()},
        "running_friendly_share_of_route": round(friendly_share, 4) if friendly_share is not None else None,
        "vehicle_separation_proxy_share_of_route": round(separated_share, 4) if separated_share is not None else None,
        "estimated_longest_continuous_run_m": round(longest_continuous_m, 1),
        "steps_share_of_route": round(steps_m / total_route_m, 4) if total_route_m else None,
        "low_quality_surface_or_way_share_of_route": round(bad_surface_m / total_route_m, 4) if total_route_m else None,
        "uncertain_cycleway_share_of_route": round(uncertain_cycleway_m / total_route_m, 4) if total_route_m else None,
        "unknown_or_unmatched_share_of_route": round(max(0.0, 1.0 - mapped_fraction), 4),
        "matched_way_class_lengths_m": {key: round(value, 1) for key, value in sorted(mapped_class_lengths.items())},
        "matched_osm_route_share": round(mapped_fraction, 4),
        "max_route_to_osm_match_distance_m": round(max_match_distance_m, 1),
        "classification_status": "OSM tag estimate only; not field-verified running quality or safety.",
        "vehicle_separation_note": "OSM highway class is a separation proxy; physical barriers, traffic conditions and actual use were not verified.",
        "continuous_running_note": "Longest mapped running-friendly stretch between OSM-mapped crossing/signal interruptions; unmapped interruptions may be missing.",
        "cycleway_note": "Cycleways without foot=yes/designated/permissive are excluded from walkable running share and reported as uncertain.",
        "matching_threshold_m": snap_limit,
    }
    stop_connections = []
    for stop in route.get("stops", []):
        point = (float(stop["latitude"]), float(stop["longitude"]))
        distance, chainage = _route_position(point, coordinates)
        stop_connections.append({"id": stop.get("id"), "name": stop.get("name"),
                                 "distance_to_ors_geometry_m": round(distance, 1),
                                 "route_chainage_m": round(chainage, 1),
                                 "connected_within_tolerance": distance <= float(fitness_config.get("matching", {}).get("max_stop_snap_m", 50))})
    connections = {
        "stops": stop_connections,
        "all_stops_connected": all(item["connected_within_tolerance"] for item in stop_connections),
        "max_stop_snap_m": float(fitness_config.get("matching", {}).get("max_stop_snap_m", 50)),
        "status": "ORS route geometry snap distance; confirms routing-network attachment only, not a physical open entrance.",
    }
    return {"crossings": crossings, "network": network, "turns": turns,
            "running_fitness": fitness, "access_connections": connections}
