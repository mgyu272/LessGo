"""Fetch and turn nearby OSM entrances and footway geometry into route candidates."""

from __future__ import annotations

import json
import hashlib
import heapq
import math
import re
import time
from pathlib import Path
from typing import Any

import requests
from src.running_metrics import classify_running_way


OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_FALLBACK_URLS = ["https://overpass.private.coffee/api/interpreter"]
OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
CACHE_TTL_SECONDS = 24 * 60 * 60
OSM_SCHEMA_VERSION = 5
NETWORK_WAYPOINT_SPACING_M = 300
ACCESS_GRAPH_SCHEMA_VERSION = 1
STATION_EXIT_PATTERN_KO = re.compile(r"(.+?역)\s*(\d+)\s*번\s*(?:출구|출입구)")
STATION_EXIT_PATTERN_EN = re.compile(r"(.+?Station)\s+gate\s*(\d+)", re.IGNORECASE)


class OSMDataError(RuntimeError):
    """OSM Overpass data could not be fetched or parsed."""

    def __init__(self, message: str, *, error_category: str = "osm_error", http_status: int | None = None,
                 request_attempts: int = 0):
        super().__init__(message)
        self.error_category = error_category
        self.http_status = http_status
        self.request_attempts = request_attempts


def _post_overpass_query(query: str, timeout_s: int) -> tuple[requests.Response, str, int]:
    """Try the primary Overpass instance and one documented public fallback.

    Do not rotate endpoints on 429, authentication, or other client errors; that
    would evade an operator policy. A network failure or 5xx gets one alternate.
    """
    endpoints = [OVERPASS_URL, *OVERPASS_FALLBACK_URLS]
    failures: list[str] = []
    attempts = 0
    for index, endpoint in enumerate(endpoints):
        attempts += 1
        try:
            response = requests.post(
                endpoint,
                data={"data": query},
                headers={"User-Agent": "LessGO-local-course-search/1.0", "Accept": "application/json"},
                timeout=timeout_s,
            )
        except requests.Timeout:
            failures.append("timeout")
            if index + 1 < len(endpoints):
                continue
            raise OSMDataError("Overpass request timed out on the primary and fallback endpoints.",
                               error_category="timeout", request_attempts=attempts)
        except requests.ConnectionError as exc:
            text = str(exc).lower()
            category = "dns_error" if any(t in text for t in ("name resolution", "getaddrinfo", "nodename")) else "connection_error"
            failures.append(category)
            if index + 1 < len(endpoints):
                continue
            raise OSMDataError("Overpass network connection failed on the primary and fallback endpoints.",
                               error_category=category, request_attempts=attempts) from exc
        except requests.RequestException as exc:
            failures.append(type(exc).__name__)
            if index + 1 < len(endpoints):
                continue
            raise OSMDataError("Overpass request failed on the primary and fallback endpoints.",
                               error_category="network_error", request_attempts=attempts) from exc

        if response.status_code == 429:
            raise OSMDataError("Overpass HTTP 429; request was stopped without endpoint rotation.",
                               error_category="rate_limit", http_status=429, request_attempts=attempts)
        if response.status_code in {401, 403}:
            raise OSMDataError(f"Overpass HTTP {response.status_code}; access was denied.",
                               error_category="authentication", http_status=response.status_code,
                               request_attempts=attempts)
        if response.status_code >= 500 and index + 1 < len(endpoints):
            failures.append(f"http_{response.status_code}")
            continue
        if not response.ok:
            raise OSMDataError(f"Overpass HTTP {response.status_code}.",
                               error_category="http_error", http_status=response.status_code,
                               request_attempts=attempts)
        return response, endpoint, attempts
    raise OSMDataError("Overpass primary and fallback requests failed: " + ",".join(failures),
                       error_category="network_or_server_error", request_attempts=attempts)


def _access_way_is_walkable(tags: dict[str, Any]) -> bool:
    highway = str(tags.get("highway", ""))
    allowed = {"footway", "pedestrian", "path", "steps", "living_street", "residential",
               "service", "unclassified", "track", "tertiary", "secondary", "primary", "cycleway"}
    if highway not in allowed:
        return False
    foot = str(tags.get("foot", "")).casefold()
    if foot in {"no", "private", "use_sidepath"}:
        return False
    if (str(tags.get("access", "")).casefold() in {"no", "private", "customers", "permit"}
            and foot not in {"yes", "designated", "permissive"}):
        return False
    if highway == "cycleway" and foot not in {"yes", "designated", "permissive"}:
        return False
    return True


def _parse_station_exit(tags: dict[str, Any]) -> tuple[str, str] | None:
    description = str(tags.get("description:ko") or tags.get("description") or tags.get("name:ko") or tags.get("name") or "")
    match = STATION_EXIT_PATTERN_KO.search(description) or STATION_EXIT_PATTERN_EN.search(description)
    if match:
        return match.group(1).strip(), match.group(2)
    station_match = re.search(r"(.+?역)", description)
    exit_number = str(tags.get("ref", "")).strip()
    if station_match and exit_number.isdigit():
        return station_match.group(1).strip(), exit_number
    return None


def build_station_accessible_running_starts(
    osm_data: dict[str, Any], destination: dict[str, Any], search_radius_m: float,
    max_access_distance_m: float = 400.0, walking_speed_m_per_min: float = 80.0,
    max_station_exits: int = 120, starts_per_exit: int = 4,
    restricted_areas: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Create running starts reachable from a mapped subway exit on connected OSM foot ways.

    The access path is a shortest path over OSM way node references. Exits that
    are not topologically attached to the mapped walking graph are excluded;
    nearby-by-straight-line points are never treated as connected.
    """
    dest = (float(destination["latitude"]), float(destination["longitude"]))
    max_access_distance_m = max(0.0, float(max_access_distance_m))
    walking_speed_m_per_min = max(1.0, float(walking_speed_m_per_min))
    graph: dict[int, list[tuple[int, float, dict[str, Any]]]] = {}
    node_coordinates: dict[int, tuple[float, float]] = {}
    node_tags: dict[int, dict[str, Any]] = {}
    candidate_nodes: dict[int, dict[str, Any]] = {}
    restricted_areas = restricted_areas or []
    exit_records: list[dict[str, Any]] = []
    walkable_way_count = 0
    skipped_unconnected_vertex_count = 0

    for element in osm_data.get("elements", []):
        if element.get("type") != "node":
            continue
        node_tags[int(element["id"])] = element.get("tags", {})
        if element.get("tags", {}).get("railway") != "subway_entrance":
            continue
        parsed_exit = _parse_station_exit(element.get("tags", {}))
        if parsed_exit is None:
            continue
        point = (float(element["lat"]), float(element["lon"]))
        if point_in_restricted_area(point, restricted_areas):
            continue
        if _haversine_m(dest, point) <= float(search_radius_m):
            exit_records.append({"node_id": int(element["id"]), "station_name": parsed_exit[0],
                                 "exit_number": parsed_exit[1], "latitude": point[0], "longitude": point[1],
                                 "osm_element": f"node/{element['id']}"})

    for element in osm_data.get("elements", []):
        if element.get("type") != "way" or not _access_way_is_walkable(element.get("tags", {})):
            continue
        node_ids = element.get("nodes") or []
        geometry = element.get("geometry") or []
        if len(node_ids) < 2 or len(node_ids) != len(geometry):
            continue
        tags = element.get("tags", {})
        walkable_way_count += 1
        if restricted_areas and any(point_in_restricted_area((float(point["lat"]), float(point["lon"])), restricted_areas)
                                    for point in geometry):
            continue
        running_class = classify_running_way(tags)
        for node_id, point in zip(node_ids, geometry):
            node_id = int(node_id)
            node_coordinates[node_id] = (float(point["lat"]), float(point["lon"]))
            if (running_class.get("walkable") is True and running_class.get("score") is not None
                    and float(running_class["score"]) >= 55 and tags.get("highway") != "steps"):
                old = candidate_nodes.get(node_id)
                if old is None or float(running_class["score"]) > float(old["running_score"]):
                    name = tags.get("name:ko") or tags.get("name")
                    tags_at_node = node_tags.get(node_id, {})
                    is_park_entrance = tags_at_node.get("leisure") == "park_entrance"
                    is_riverside = bool(name and any(token in str(name).casefold()
                                                     for token in ("천", "하천", "강변", "산책로", "river", "stream")))
                    candidate_nodes[node_id] = {
                        "name": (str(name) + " 보행로 접근 지점" if name else
                                 "OSM 공원 출입구" if is_park_entrance else "OSM 보행로 접근 지점"),
                        "access_type": ("park_entrance" if is_park_entrance else
                                        "riverside_path" if is_riverside else "running_network_access"),
                        "running_class": running_class.get("class"),
                        "running_score": float(running_class["score"]),
                        "osm_element": f"way/{element['id']}",
                    }
        oneway_foot = str(tags.get("oneway:foot", "")).casefold()
        for index, (left_id, right_id) in enumerate(zip(node_ids, node_ids[1:])):
            left_id, right_id = int(left_id), int(right_id)
            a = node_coordinates[left_id]
            b = node_coordinates[int(node_ids[index + 1])]
            length = _haversine_m(a, b)
            if length <= 0.1:
                continue
            graph.setdefault(left_id, [])
            graph.setdefault(right_id, [])
            edge_tags = {"way_id": element["id"], "highway": tags.get("highway"), "foot": tags.get("foot")}
            if oneway_foot != "-1":
                graph[left_id].append((right_id, length, edge_tags))
            if oneway_foot not in {"yes", "1", "true"}:
                graph[right_id].append((left_id, length, edge_tags))

    connected_exits = [record for record in exit_records if record["node_id"] in graph]
    unconnected_exit_count = len(exit_records) - len(connected_exits)
    starts_by_node: dict[int, dict[str, Any]] = {}
    route_reach_count = 0
    for exit_record in sorted(connected_exits,
                              key=lambda item: (abs(_haversine_m(dest, (item["latitude"], item["longitude"]))
                                                   - float(destination.get("target_distance_m", 3000)) * 0.72),
                                                item["station_name"], item["exit_number"]))[:max_station_exits]:
        source_id = int(exit_record["node_id"])
        distances = {source_id: 0.0}
        previous: dict[int, int] = {}
        queue: list[tuple[float, int]] = [(0.0, source_id)]
        while queue:
            distance, node_id = heapq.heappop(queue)
            if distance != distances.get(node_id) or distance > max_access_distance_m:
                continue
            for next_id, length, _edge_tags in graph.get(node_id, []):
                next_distance = distance + length
                if next_distance > max_access_distance_m or next_distance >= distances.get(next_id, float("inf")):
                    continue
                distances[next_id] = next_distance
                previous[next_id] = node_id
                heapq.heappush(queue, (next_distance, next_id))
        reachable = [node_id for node_id in distances if node_id in candidate_nodes]
        reachable.sort(key=lambda node_id: (
            0 if candidate_nodes[node_id]["access_type"] in {"riverside_path", "park_entrance"} else 1,
            distances[node_id], -candidate_nodes[node_id]["running_score"], node_id,
        ))
        for run_node_id in reachable[:starts_per_exit]:
            path_node_ids = [run_node_id]
            while path_node_ids[-1] != source_id:
                parent = previous.get(path_node_ids[-1])
                if parent is None:
                    break
                path_node_ids.append(parent)
            if path_node_ids[-1] != source_id:
                continue
            path_node_ids.reverse()
            access_distance_m = float(distances[run_node_id])
            path_coordinates = [[node_coordinates[node_id][0], node_coordinates[node_id][1]] for node_id in path_node_ids]
            candidate = candidate_nodes[run_node_id]
            exit_access = {
                "station_name": exit_record["station_name"],
                "exit_number": exit_record["exit_number"],
                "station_exit_coordinates": [exit_record["latitude"], exit_record["longitude"]],
                "station_exit_osm_element": exit_record["osm_element"],
                "running_start_coordinates": [node_coordinates[run_node_id][0], node_coordinates[run_node_id][1]],
                "walking_distance_m": round(access_distance_m, 1),
                "estimated_walking_time_seconds": round(access_distance_m / walking_speed_m_per_min * 60.0),
                "walking_speed_m_per_min": walking_speed_m_per_min,
                "route_coordinates": path_coordinates,
                "route_verified": True,
                "verification_method": "shortest path over shared OSM pedestrian-way node references",
                "osm_topology_verified": True,
                "distance_in_target_running_km": False,
                "note": "접근 경로는 OSM 보행 네트워크 최단 경로 추정이며, 현장 출입구·개방 여부는 미확인입니다.",
            }
            existing = starts_by_node.get(run_node_id)
            if existing is None or access_distance_m < existing["station_access"]["walking_distance_m"]:
                starts_by_node[run_node_id] = {
                    "id": f"osm-access-run-node-{run_node_id}",
                    "name": candidate["name"],
                    "latitude": node_coordinates[run_node_id][0], "longitude": node_coordinates[run_node_id][1],
                    "access_type": candidate["access_type"],
                    "accessibility_score": max(0.0, 1.0 - access_distance_m / max_access_distance_m),
                    "running_fitness_access_score": candidate["running_score"],
                    "running_way_class": candidate["running_class"],
                    "osm_element": candidate["osm_element"],
                    "coordinate_source": "OpenStreetMap mapped walkable way vertex",
                    "candidate_origin": "automatic_station_exit_connected_running_start",
                    "coordinate_verified": True,
                    "entrance_verified": False,
                    "station_access": exit_access,
                    "notes": "지하철 출구부터 같은 OSM 보행 네트워크의 위상 연결이 확인된 러닝 시작 정점입니다. 현장 안전성은 미확인입니다.",
                }
        route_reach_count += sum(node_id in candidate_nodes for node_id in distances)

    starts = sorted(starts_by_node.values(), key=lambda item: (
        abs(_haversine_m(dest, _stop_latlon(item)) - float(destination.get("target_distance_m", 3000)) * 0.72),
        -float(item.get("running_fitness_access_score", 0)),
        float(item["station_access"]["walking_distance_m"]), item["id"],
    ))
    diagnostics = {
        "method": "OSM pedestrian graph shortest path over shared way node IDs; no straight-line connector",
        "walkable_way_count": walkable_way_count,
        "connected_subway_exit_count": len(connected_exits),
        "unconnected_subway_exit_count": unconnected_exit_count,
        "examined_subway_exit_count": min(len(connected_exits), max_station_exits),
        "accessible_running_start_count": len(starts),
        "starts_within_preferred_access_m": sum(item["station_access"]["walking_distance_m"] <= min(400.0, max_access_distance_m) for item in starts),
        "preferred_access_distance_m": min(400.0, max_access_distance_m),
        "max_access_distance_m": max_access_distance_m,
        "estimated_walking_speed_m_per_min": walking_speed_m_per_min,
        "reachable_running_nodes_examined": route_reach_count,
        "dropped_unconnected_exits_are_not_snapped": True,
    }
    return starts, diagnostics


def _stop_latlon(point: dict[str, Any]) -> tuple[float, float]:
    return float(point["latitude"]), float(point["longitude"])


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(h))


def _point_in_polygon(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    lat, lon = point
    inside = False
    if len(polygon) < 4:
        return False
    previous = polygon[-1]
    for current in polygon:
        y1, x1 = previous
        y2, x2 = current
        if (y1 > lat) != (y2 > lat):
            cross_lon = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lon < cross_lon:
                inside = not inside
        previous = current
    return inside


def fetch_restricted_area_elements(
    destination: dict[str, Any], cache_dir: Path, radius_m: int, config: dict[str, Any],
) -> dict[str, Any]:
    """Fetch/cache OSM education and palace boundaries, separate from route-network cache."""
    lat, lon = float(destination["latitude"]), float(destination["longitude"])
    cache_key = hashlib.sha256(f"{lat:.5f},{lon:.5f},{int(radius_m)}".encode("ascii")).hexdigest()[:16]
    cache_path = cache_dir / f"osm_restricted_areas_{cache_key}.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if (time.time() - float(cached.get("fetched_at_epoch", 0)) < CACHE_TTL_SECONDS
                    and cached.get("schema_version") == 3):
                return cached
        except (OSError, ValueError, TypeError):
            pass

    for nearby_path in cache_dir.glob("osm_restricted_areas_*.json"):
        if nearby_path == cache_path:
            continue
        try:
            nearby = json.loads(nearby_path.read_text(encoding="utf-8"))
            old_coords = nearby.get("destination_coordinates") or []
            source_radius = float(nearby.get("query_radius_m", 0))
            age = time.time() - float(nearby.get("fetched_at_epoch", 0))
            if (age < CACHE_TTL_SECONDS and nearby.get("schema_version") == 3 and len(old_coords) == 2
                    and source_radius >= radius_m
                    and _haversine_m((lat, lon), (float(old_coords[0]), float(old_coords[1]))) + radius_m <= source_radius):
                reused = {**nearby, "destination_coordinates": [lat, lon], "query_radius_m": radius_m,
                          "reused_from_cache": str(nearby_path)}
                cache_dir.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(json.dumps(reused, ensure_ascii=False), encoding="utf-8")
                return reused
        except (OSError, ValueError, TypeError, KeyError):
            continue

    lat_delta = radius_m / 111_000
    lon_delta = radius_m / (111_000 * max(0.1, math.cos(math.radians(lat))))
    south, west, north, east = lat - lat_delta, lon - lon_delta, lat + lat_delta, lon + lon_delta
    selectors: list[str] = []
    for key, values in config.get("excluded_area_tags", {}).items():
        if not values:
            continue
        pattern = "^(" + "|".join(re.escape(str(value)) for value in values) + ")$"
        selectors.extend([f'way["{key}"~"{pattern}"]({south},{west},{north},{east});',
                          f'relation["{key}"~"{pattern}"]({south},{west},{north},{east});'])
    terms = [re.escape(str(value)) for value in config.get("excluded_name_terms", []) if value]
    if terms:
        name_pattern = "|".join(terms)
        selectors.extend([f'relation["name"~"{name_pattern}"]({south},{west},{north},{east});',
                          f'relation["name:ko"~"{name_pattern}"]({south},{west},{north},{east});'])
    query = "[out:json][timeout:60];\n(\n" + "\n".join(selectors) + "\n);\nout body geom;"
    response, source_endpoint, request_attempts = _post_overpass_query(query, timeout_s=90)
    try:
        payload = response.json()
        elements = payload.get("elements", [])
    except ValueError as exc:
        raise OSMDataError("출입 제한 구역 OSM 응답을 JSON으로 읽지 못했습니다.") from exc
    result = {"schema_version": 3, "source": source_endpoint, "request_attempts": request_attempts,
              "destination_coordinates": [lat, lon], "query_radius_m": radius_m,
              "fetched_at_epoch": time.time(), "element_count": len(elements),
              "osm_base_timestamp": (payload.get("osm3s") or {}).get("timestamp_osm_base"), "elements": elements}
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def _element_area_rings(element: dict[str, Any]) -> list[list[tuple[float, float]]]:
    """Extract closed outer rings from a way or a relation's outer members."""
    if element.get("type") == "way":
        geometries = [element.get("geometry") or []]
    elif element.get("type") == "relation":
        geometries = [member.get("geometry") or [] for member in element.get("members", [])
                      if member.get("role") in {"outer", ""} and member.get("type") == "way"]
    else:
        return []
    segments = [[(float(point["lat"]), float(point["lon"])) for point in geometry]
                for geometry in geometries if len(geometry) >= 2]
    rings = [segment for segment in segments if len(segment) >= 4 and segment[0] == segment[-1]]
    open_segments = [segment[:] for segment in segments if segment[0] != segment[-1]]
    while open_segments:
        ring = open_segments.pop(0)
        changed = True
        while changed and ring[0] != ring[-1]:
            changed = False
            for index, segment in enumerate(open_segments):
                if ring[-1] == segment[0]:
                    ring.extend(segment[1:])
                elif ring[-1] == segment[-1]:
                    ring.extend(reversed(segment[:-1]))
                elif ring[0] == segment[-1]:
                    ring = segment[:-1] + ring
                elif ring[0] == segment[0]:
                    ring = list(reversed(segment[1:])) + ring
                else:
                    continue
                open_segments.pop(index)
                changed = True
                break
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def build_restricted_areas(elements: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    """Return only hard-excluded mapped areas; soft boundary matches are advisories."""
    selectors = config.get("hard_excluded_area_tags", config.get("excluded_area_tags", {}))
    terms = [str(value).casefold() for value in config.get("hard_excluded_name_terms", config.get("excluded_name_terms", []))]
    areas = []
    for element in elements:
        tags = element.get("tags", {})
        name = str(tags.get("name:ko") or tags.get("name") or tags.get("ref") or f"OSM {element.get('type')}/{element.get('id')}")
        tag_match = any(str(tags.get(key, "")).casefold() in {str(value).casefold() for value in values}
                        for key, values in selectors.items())
        name_match = (element.get("type") == "relation"
                      and tags.get("type") == "multipolygon"
                      and any(term in name.casefold() for term in terms))
        if not (tag_match or name_match):
            continue
        for ring in _element_area_rings(element):
            latitudes = [point[0] for point in ring]
            longitudes = [point[1] for point in ring]
            areas.append({"osm_element": f"{element.get('type')}/{element.get('id')}",
                          "name": name, "tags": tags, "polygon": ring,
                          "bounds": [min(latitudes), min(longitudes), max(latitudes), max(longitudes)]})
    return areas


def build_advisory_areas(elements: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    """Build school/park-style boundaries for short cautions, never blanket rejection."""
    advisory_config = {
        "excluded_area_tags": config.get("advisory_area_tags", {}),
        "excluded_name_terms": config.get("advisory_name_terms", []),
    }
    return build_restricted_areas(elements, advisory_config)


def point_in_restricted_area(point: tuple[float, float], areas: list[dict[str, Any]]) -> str | None:
    for area in areas:
        polygon = area.get("polygon", [])
        bounds = area.get("bounds")
        if bounds and not (bounds[0] <= point[0] <= bounds[2] and bounds[1] <= point[1] <= bounds[3]):
            continue
        if polygon and _point_in_polygon(point, polygon):
            return str(area.get("name", "제한 구역"))
    return None


def route_intersects_restricted_area(
    route: dict[str, Any], areas: list[dict[str, Any]], sample_spacing_m: float = 10.0,
) -> str | None:
    """Densify ORS geometry and return the first intersected mapped-area name.

    Whether an intersection blocks a route or is only advisory is determined by
    which area set the caller supplied.
    """
    coordinates = route.get("geometry", {}).get("coordinates", [])
    if not areas or not coordinates:
        return None
    points = [(float(coord[1]), float(coord[0])) for coord in coordinates if len(coord) >= 2]
    if not points:
        return None
    for left, right in zip(points, points[1:]):
        segment_bounds = (min(left[0], right[0]), min(left[1], right[1]),
                          max(left[0], right[0]), max(left[1], right[1]))
        relevant_areas = []
        for area in areas:
            bounds = area.get("bounds")
            if bounds is None:
                polygon = area.get("polygon", [])
                if not polygon:
                    continue
                bounds = (min(p[0] for p in polygon), min(p[1] for p in polygon),
                          max(p[0] for p in polygon), max(p[1] for p in polygon))
            if (bounds[0] <= segment_bounds[2] and bounds[2] >= segment_bounds[0]
                    and bounds[1] <= segment_bounds[3] and bounds[3] >= segment_bounds[1]):
                relevant_areas.append(area)
        if not relevant_areas:
            continue
        segment_m = _haversine_m(left, right)
        sample_count = max(1, int(math.ceil(segment_m / max(1.0, sample_spacing_m))))
        for index in range(sample_count + 1):
            fraction = index / sample_count
            point = (left[0] + (right[0] - left[0]) * fraction,
                     left[1] + (right[1] - left[1]) * fraction)
            area_name = point_in_restricted_area(point, relevant_areas)
            if area_name:
                return area_name
    return None


def _distance_to_polygon_m(point: tuple[float, float], polygon: list[tuple[float, float]]) -> float:
    lat, lon = point
    cos_lat = math.cos(math.radians(lat))
    best = float("inf")
    for a, b in zip(polygon, polygon[1:]):
        ax, ay = (a[1] - lon) * 111_320 * cos_lat, (a[0] - lat) * 111_320
        bx, by = (b[1] - lon) * 111_320 * cos_lat, (b[0] - lat) * 111_320
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / length2)) if length2 else 0.0
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def _query_for(destination: dict[str, Any], radius_m: int) -> str:
    lat = float(destination["latitude"])
    lon = float(destination["longitude"])
    lat_delta = radius_m / 111_000
    lon_delta = radius_m / (111_000 * math.cos(math.radians(lat)))
    south, north = lat - lat_delta, lat + lat_delta
    west, east = lon - lon_delta, lon + lon_delta
    return f"""[out:json][timeout:60];
(
  node[\"railway\"=\"subway_entrance\"](around:{radius_m},{lat},{lon});
  node[\"railway\"=\"station\"](around:{radius_m},{lat},{lon});
  node[\"public_transport\"=\"station\"](around:{radius_m},{lat},{lon});
  way[\"railway\"=\"station\"](around:{radius_m},{lat},{lon});
  way[\"public_transport\"=\"station\"](around:{radius_m},{lat},{lon});
  node[\"public_transport\"=\"entrance\"](around:{radius_m},{lat},{lon});
  node[\"entrance\"](around:{radius_m},{lat},{lon});
  node[\"leisure\"=\"park_entrance\"](around:{radius_m},{lat},{lon});
  node[\"highway\"=\"crossing\"](around:{radius_m},{lat},{lon});
  node[\"highway\"=\"traffic_signals\"](around:{radius_m},{lat},{lon});
  node[\"crossing:signals\"](around:{radius_m},{lat},{lon});
  way[\"leisure\"~\"^(park|garden)$\"]({south},{west},{north},{east});
  way[\"highway\"~\"^(footway|path|pedestrian|steps)$\"]({south},{west},{north},{east});
  way[\"highway\"~\"^(residential|living_street|service|unclassified|tertiary|secondary|primary|cycleway|track)$\"]({south},{west},{north},{east});
  way[\"waterway\"~\"^(river|stream|canal|tidal_channel)$\"]({south},{west},{north},{east});
);
out body geom;"""


def fetch_osm_elements(
    destination: dict[str, Any], cache_path: Path, radius_m: int = 4500, force_refresh: bool = False
) -> dict[str, Any]:
    """Fetch one bounded Overpass result and cache it for 24 hours."""
    if cache_path.exists() and not force_refresh:
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            age = time.time() - float(cached.get("fetched_at_epoch", 0))
            same_center = cached.get("destination_coordinates") == [float(destination["latitude"]), float(destination["longitude"])]
            if age < CACHE_TTL_SECONDS and cached.get("elements") and cached.get("schema_version") == OSM_SCHEMA_VERSION \
                    and cached.get("query_radius_m") == radius_m and same_center:
                return cached
        except (OSError, ValueError, TypeError):
            pass

    # A destination pin can move to a nearby ticket booth without requiring a
    # full Overpass download. Reuse a still-fresh, larger-radius OSM cache only
    # when its queried square safely covers the new search radius.
    if not force_refresh:
        new_center = (float(destination["latitude"]), float(destination["longitude"]))
        for nearby_path in cache_path.parent.glob("osm_network_*.json"):
            if nearby_path == cache_path:
                continue
            try:
                # Cache files include large OSM geometries. Inspect their small
                # metadata prefix first so unrelated 90 MB region caches are
                # rejected without deserializing the full file.
                with nearby_path.open("r", encoding="utf-8") as stream:
                    prefix = stream.read(2048)
                schema_match = re.search(r'"schema_version"\s*:\s*(\d+)', prefix)
                coords_match = re.search(r'"destination_coordinates"\s*:\s*\[\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\]', prefix)
                radius_match = re.search(r'"query_radius_m"\s*:\s*([-+\d.eE]+)', prefix)
                fetched_match = re.search(r'"fetched_at_epoch"\s*:\s*([-+\d.eE]+)', prefix)
                if not all((schema_match, coords_match, radius_match, fetched_match)):
                    continue
                if (int(schema_match.group(1)) != OSM_SCHEMA_VERSION
                        or time.time() - float(fetched_match.group(1)) >= CACHE_TTL_SECONDS):
                    continue
                old_center = (float(coords_match.group(1)), float(coords_match.group(2)))
                source_radius = float(radius_match.group(1))
                if (source_radius < radius_m
                        or _haversine_m(new_center, old_center) + radius_m > source_radius):
                    continue
                nearby = json.loads(nearby_path.read_text(encoding="utf-8"))
                if nearby.get("elements"):
                    reused = {**nearby,
                              "destination_coordinates": [new_center[0], new_center[1]],
                              "query_radius_m": radius_m,
                              "reused_from_cache": str(nearby_path)}
                    # Keep the original large cache intact and avoid writing a
                    # duplicate copy solely for the moved destination pin.
                    return reused
            except (OSError, ValueError, TypeError, KeyError):
                continue

    response, source_endpoint, request_attempts = _post_overpass_query(_query_for(destination, radius_m), timeout_s=90)
    try:
        payload = response.json()
        elements = payload.get("elements", [])
    except ValueError as exc:
        raise OSMDataError("OSM Overpass가 JSON 응답을 반환하지 않았습니다.") from exc
    if not elements:
        raise OSMDataError("목적지 주변에서 OSM 출입구나 보행 네트워크 후보를 찾지 못했습니다.")

    result = {
        "schema_version": OSM_SCHEMA_VERSION,
        "optional_layers": {"waterway_lines_requested": True},
        "source": source_endpoint,
        "request_attempts": request_attempts,
        "destination_coordinates": [float(destination["latitude"]), float(destination["longitude"])],
        "query_radius_m": radius_m,
        "fetched_at_epoch": time.time(),
        "element_count": len(elements),
        "osm_base_timestamp": (payload.get("osm3s") or {}).get("timestamp_osm_base"),
        "attribution": OSM_ATTRIBUTION,
        "license_url": OSM_COPYRIGHT_URL,
        "elements": elements,
    }
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def build_osm_candidates(
    osm_data: dict[str, Any],
    destination: dict[str, Any],
    max_starts: int = 12,
    max_waypoints: int = 120,
    search_radius_m: int = 4500,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Create named start candidates and spaced waypoints on mapped footways."""
    dest = (float(destination["latitude"]), float(destination["longitude"]))
    starts: list[dict[str, Any]] = []
    raw_starts: list[dict[str, Any]] = []
    waypoints: list[dict[str, Any]] = []
    seen_start: set[tuple[int, int]] = set()
    seen_waypoints: set[tuple[int, int]] = set()

    station_points: list[tuple[float, float, str]] = []
    park_polygons: list[tuple[str, list[tuple[float, float]], tuple[float, float, float, float]]] = []
    for element in osm_data.get("elements", []):
        tags = element.get("tags", {})
        if element.get("type") == "way" and tags.get("leisure") in {"park", "garden"} and element.get("geometry"):
            geometry = [(float(p["lat"]), float(p["lon"])) for p in element["geometry"]]
            if len(geometry) >= 4 and geometry[0] == geometry[-1]:
                park_polygons.append((
                    tags.get("name:ko") or tags.get("name") or "OSM 공원", geometry,
                    (min(p[0] for p in geometry), min(p[1] for p in geometry),
                     max(p[0] for p in geometry), max(p[1] for p in geometry)),
                ))
        if tags.get("railway") != "station" and tags.get("public_transport") != "station":
            continue
        if element.get("type") == "node":
            lat, lon = float(element["lat"]), float(element["lon"])
        elif element.get("center"):
            lat, lon = float(element["center"]["lat"]), float(element["center"]["lon"])
        else:
            continue
        station_name = tags.get("name:ko") or tags.get("name")
        if station_name:
            station_points.append((lat, lon, station_name))

    for element in osm_data.get("elements", []):
        if element.get("type") != "node":
            continue
        tags = element.get("tags", {})
        access = tags.get("access", "")
        foot = str(tags.get("foot", "")).casefold()
        if ((access in {"private", "no", "customers", "permit"} and foot not in {"yes", "designated", "permissive"})
                or tags.get("entrance") == "no"):
            continue
        railway = tags.get("railway")
        entrance = tags.get("entrance")
        leisure = tags.get("leisure")
        public_transport = tags.get("public_transport")
        highway = tags.get("highway")
        is_transit_entrance = railway == "subway_entrance" or public_transport == "entrance"
        is_park_entrance = leisure == "park_entrance" or (entrance in {"yes", "main", "exit"} and tags.get("park"))
        name = tags.get("name:ko") or tags.get("name") or tags.get("station")
        if is_transit_entrance and not name:
            nearest_station = min(
                station_points,
                key=lambda point: _haversine_m((float(element["lat"]), float(element["lon"])), (point[0], point[1])),
                default=None,
            )
            if nearest_station and _haversine_m((float(element["lat"]), float(element["lon"])), (nearest_station[0], nearest_station[1])) <= 350:
                name = nearest_station[2]
            if name and tags.get("ref", "").isdigit():
                name = f"{name} {tags['ref']}번 출구"
            elif not name and tags.get("ref", "").isdigit():
                name = f"지하철 출입구 {tags['ref']}번"
        if not name and tags.get("ref"):
            name = tags["ref"]
        if is_transit_entrance or is_park_entrance:
            if not name:
                name = "OSM 지하철 출입구" if is_transit_entrance else "OSM 공원 출입구"
            key = (round(float(element["lat"]) * 1e6), round(float(element["lon"]) * 1e6))
            if key not in seen_start:
                seen_start.add(key)
                kind = "subway_entrance" if is_transit_entrance else "park_entrance"
                raw_starts.append({
                    "id": f"osm-node-{element['id']}",
                    "name": name,
                    "latitude": float(element["lat"]),
                    "longitude": float(element["lon"]),
                    "access_type": kind,
                    "accessibility_score": 1.0 if is_transit_entrance else 0.75,
                    "osm_element": f"node/{element['id']}",
                    "coordinate_source": "OpenStreetMap via Overpass API",
                    "candidate_origin": "automatic_osm_entrance",
                    "coordinate_verified": True,
                    "entrance_verified": False,
                    "notes": "OSM에 매핑된 입구 좌표; 현장 출입구 및 접근성은 별도 확인 필요",
                })
        if highway == "crossing" or is_transit_entrance or is_park_entrance:
            key = (round(float(element["lat"]) * 1e6), round(float(element["lon"]) * 1e6))
            if key not in seen_waypoints:
                seen_waypoints.add(key)
                waypoints.append({
                    "id": f"osm-node-{element['id']}",
                    "name": name or ("보행 횡단 지점" if highway == "crossing" else "OSM 접근 지점"),
                    "latitude": float(element["lat"]),
                    "longitude": float(element["lon"]),
                    "candidate_type": ("mapped_crossing" if highway == "crossing" else
                                        "mapped_park_entrance" if is_park_entrance else "mapped_transit_entrance"),
                    "osm_element": f"node/{element['id']}",
                    "coordinate_source": "OpenStreetMap via Overpass API",
                    "coordinate_verified": True,
                    "entrance_verified": False,
                    "notes": "OSM에 매핑된 접근 지점; 보행 가능 여부는 ORS 경로 응답으로 확인",
                })

    # A park entrance tag is uncommon in this area. Where the map has park
    # polygons and a mapped public footway crosses the boundary, use an actual
    # OSM footway vertex nearest that boundary as an inferred start candidate.
    # This is explicitly marked as unverified; no synthetic coordinate is made.
    park_start_count = 0
    for element in osm_data.get("elements", []):
        if element.get("type") != "way" or not element.get("geometry") or not park_polygons:
            continue
        tags = element.get("tags", {})
        foot = str(tags.get("foot", "")).casefold()
        access = str(tags.get("access", "")).casefold()
        if (tags.get("highway") not in {"footway", "path", "pedestrian"}
                or foot in {"private", "no", "use_sidepath"}
                or (access in {"private", "no", "customers", "permit"} and foot not in {"yes", "designated", "permissive"})):
            continue
        geometry = element["geometry"]
        if len(geometry) < 2:
            continue
        points = [(float(p["lat"]), float(p["lon"])) for p in geometry]
        for index, (a, b) in enumerate(zip(points, points[1:])):
            segment_min_lat, segment_max_lat = min(a[0], b[0]), max(a[0], b[0])
            segment_min_lon, segment_max_lon = min(a[1], b[1]), max(a[1], b[1])
            for park_name, polygon, bounds in park_polygons:
                # Most mapped footway segments are far from any park. Reject
                # disjoint segment/polygon bounding boxes before the costly
                # point-in-polygon and boundary-distance checks.
                if (segment_max_lat < bounds[0] or segment_min_lat > bounds[2]
                        or segment_max_lon < bounds[1] or segment_min_lon > bounds[3]):
                    continue
                if _point_in_polygon(a, polygon) == _point_in_polygon(b, polygon):
                    continue
                distance_a = _distance_to_polygon_m(a, polygon)
                distance_b = _distance_to_polygon_m(b, polygon)
                chosen, chosen_distance = (a, distance_a) if distance_a <= distance_b else (b, distance_b)
                if chosen_distance > 100:
                    continue
                key = (round(chosen[0] * 1e6), round(chosen[1] * 1e6))
                if key in seen_start:
                    continue
                seen_start.add(key)
                node_ids = element.get("nodes") or []
                vertex_index = index if chosen == a else index + 1
                node_ref = node_ids[vertex_index] if vertex_index < len(node_ids) else f"way-{element['id']}-vertex-{vertex_index}"
                raw_starts.append({
                    "id": f"osm-park-edge-{node_ref}",
                    "name": f"{park_name} 보행 연결 후보",
                    "latitude": chosen[0], "longitude": chosen[1],
                    "access_type": "park_path_connection",
                    "accessibility_score": 0.8,
                    "osm_element": f"way/{element['id']}",
                    "coordinate_source": "OpenStreetMap mapped footway vertex near park boundary",
                    "candidate_origin": "automatic_park_boundary_candidate",
                    "coordinate_verified": True,
                    "entrance_verified": False,
                    "notes": "공원 경계와 보행로 연결에서 찾은 OSM 정점 후보; 실제 출입구·개방 여부는 현장 확인 필요",
                })
                if key not in seen_waypoints:
                    seen_waypoints.add(key)
                    waypoints.append({
                        "id": f"osm-park-edge-{node_ref}",
                        "name": f"{park_name} 보행 연결",
                        "latitude": chosen[0], "longitude": chosen[1],
                        "candidate_type": "park_boundary_connection",
                        "osm_element": f"way/{element['id']}",
                        "coordinate_source": "OpenStreetMap mapped footway vertex near park boundary",
                        "coordinate_verified": True,
                        "entrance_verified": False,
                        "notes": "공원 경계에 연결된 OSM 보행로 정점; 실제 출입구·개방 여부는 현장 확인 필요",
                    })
                park_start_count += 1
                if park_start_count >= 80:
                    break
            if park_start_count >= 80:
                break
        if park_start_count >= 80:
            break

    # Treat tagged running paths as primary start and waypoint sources. Samples
    # are existing OSM vertices; no coordinate is interpolated or moved off-map.
    running_start_count = 0
    for element in osm_data.get("elements", []):
        if element.get("type") != "way" or not element.get("geometry"):
            continue
        tags = element.get("tags", {})
        highway = tags.get("highway")
        if highway not in {"footway", "path", "pedestrian", "steps", "cycleway", "living_street", "residential"}:
            continue
        classification = classify_running_way(tags)
        if classification.get("walkable") is False or classification.get("score") is None:
            continue
        if classification.get("score", 0) < 55:
            continue
        geometry = element["geometry"]
        if len(geometry) < 2:
            continue
        cumulative = 0.0
        next_sample = NETWORK_WAYPOINT_SPACING_M
        name = tags.get("name:ko") or tags.get("name")
        is_riverside = bool(name and any(token in name.casefold() for token in ("천", "하천", "강변", "산책로", "river", "stream")))
        for vertex_index, (previous, point) in enumerate(zip(geometry, geometry[1:]), 1):
            a = (float(previous["lat"]), float(previous["lon"]))
            b = (float(point["lat"]), float(point["lon"]))
            cumulative += _haversine_m(a, b)
            if cumulative < next_sample:
                continue
            key = (round(b[0] * 1e6), round(b[1] * 1e6))
            if key not in seen_waypoints:
                seen_waypoints.add(key)
                waypoints.append({
                    "id": f"osm-way-{element['id']}-node-{len(waypoints) + 1}",
                    "name": tags.get("name:ko") or tags.get("name") or f"OSM {highway} 네트워크 지점",
                    "latitude": b[0],
                    "longitude": b[1],
                    "candidate_type": f"foot_network_{highway}",
                    "running_way_class": classification.get("class"),
                    "running_way_score": classification.get("score"),
                    "osm_element": f"way/{element['id']}",
                    "coordinate_source": "OpenStreetMap footway geometry via Overpass API",
                    "coordinate_verified": True,
                    "entrance_verified": False,
                    "notes": "실제 OSM 보행 네트워크 정점; 보행 가능 여부는 ORS 경로 응답으로 확인",
                })
                next_sample += NETWORK_WAYPOINT_SPACING_M
            if cumulative >= next_sample - NETWORK_WAYPOINT_SPACING_M and running_start_count < 120:
                foot_allowed = tags.get("highway") != "cycleway" or tags.get("foot") in {"yes", "designated", "permissive"}
                if foot_allowed and classification.get("score", 0) >= 60:
                    node_ids = element.get("nodes") or []
                    node_ref = node_ids[vertex_index] if vertex_index < len(node_ids) else f"way-{element['id']}-vertex-{vertex_index}"
                    key = (round(b[0] * 1e6), round(b[1] * 1e6))
                    if key not in seen_start:
                        seen_start.add(key)
                        access_type = "riverside_path" if is_riverside else "running_network_access"
                        raw_starts.append({
                            "id": f"osm-running-node-{node_ref}",
                            "name": (f"{name} 보행로 접근 지점" if name else f"OSM {highway} 보행로 접근 지점"),
                            "latitude": b[0], "longitude": b[1],
                            "access_type": access_type,
                            "accessibility_score": 0.78,
                            "running_fitness_access_score": classification.get("score"),
                            "running_way_class": classification.get("class"),
                            "osm_element": f"way/{element['id']}",
                            "coordinate_source": "OpenStreetMap mapped running/walking way vertex",
                            "candidate_origin": "automatic_running_network_vertex",
                            "coordinate_verified": True,
                            "entrance_verified": False,
                            "notes": "태그가 있는 OSM 보행 네트워크의 실제 정점. 접근성, 현장 노면 및 실제 러닝 적합성은 미검증이며 ORS 연결을 확인해야 함.",
                        })
                        running_start_count += 1

    # Keep park paths represented even when the area contains many more subway
    # exits. The recommender later selects a spatially diverse, mode-specific set.
    starts_by_type: dict[str, list[dict[str, Any]]] = {}
    for candidate in raw_starts:
        starts_by_type.setdefault(candidate["access_type"], []).append(candidate)
    for group in starts_by_type.values():
        group.sort(key=lambda p: _haversine_m(dest, (p["latitude"], p["longitude"])))
    starts = []
    type_order = ["riverside_path", "running_network_access", "park_path_connection", "park_entrance", "subway_entrance"]
    while len(starts) < max_starts and any(starts_by_type.values()):
        for access_type in type_order:
            group = starts_by_type.get(access_type, [])
            if group and len(starts) < max_starts:
                starts.append(group.pop(0))
    # Preserve distinct exits; local station-cluster pruning hid useful options.
    # Reduce local clusters while retaining geographically distinct access points.
    destination_distance = lambda p: _haversine_m(dest, (p["latitude"], p["longitude"]))
    waypoints = [p for p in waypoints if destination_distance(p) <= search_radius_m]
    waypoint_priority = {"mapped_park_entrance": 0, "mapped_crossing": 2,
                         "mapped_transit_entrance": 3}
    waypoints.sort(key=lambda p: (waypoint_priority.get(p["candidate_type"], 1),
                                  -float(p.get("running_way_score", 0) or 0), destination_distance(p)))
    spaced: list[dict[str, Any]] = []
    for candidate in waypoints:
        if all(_haversine_m((candidate["latitude"], candidate["longitude"]), (p["latitude"], p["longitude"])) >= 120 for p in spaced):
            spaced.append(candidate)
        if len(spaced) >= max_waypoints:
            break
    return starts, spaced
