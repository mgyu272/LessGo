"""Read saved representative-route geometry and ORS turn instructions for navigation."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any


# ORS Directions API maneuver types. Unknown types are intentionally omitted;
# the client must never invent a turn from a street name or route shape.
ORS_MANEUVER_NAMES = {
    0: "left",
    1: "right",
    2: "sharp_left",
    3: "sharp_right",
    4: "slight_left",
    5: "slight_right",
    6: "straight",
    7: "roundabout_enter",
    8: "roundabout_exit",
    9: "u_turn",
    12: "keep_left",
    13: "keep_right",
}


def _distance_m(a: list[float], b: list[float]) -> float:
    lon1, lat1 = math.radians(float(a[0])), math.radians(float(a[1]))
    lon2, lat2 = math.radians(float(b[0])), math.radians(float(b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    hav = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.atan2(math.sqrt(hav), math.sqrt(max(0.0, 1 - hav)))


def _find_route(index: dict[str, Any], destination_id: str, route_id: str) -> tuple[str, dict[str, Any]] | None:
    destination = index.get("destinations", {}).get(destination_id, {})
    seen_files: set[str] = set()
    for distance_label, entry in destination.items():
        variants = [("representative", entry.get("representative", {}))]
        variants.extend((mode, route) for mode, route in entry.get("modes", {}).items())
        for mode, route in variants:
            files = route.get("files", {})
            json_path = str(files.get("json", ""))
            if not json_path or json_path in seen_files:
                continue
            seen_files.add(json_path)
            if route.get("route_id") == route_id:
                return distance_label, {**route, "_mode": mode, "_distance_label": distance_label}
    return None


def load_navigation_route(
    root: Path, destination_id: str, route_id: str,
    index_path: Path | None = None,
) -> dict[str, Any]:
    """Resolve an indexed route ID and expose its saved GeoJSON plus real ORS steps."""
    index_path = index_path or root / "outputs" / "app" / "representative_routes.json"
    if not index_path.is_file():
        raise FileNotFoundError("앱 대표 경로 인덱스를 찾지 못했습니다.")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    found = _find_route(index, destination_id, route_id)
    if found is None:
        raise FileNotFoundError("요청한 destination_id와 route_id 조합이 대표 경로 인덱스에 없습니다.")
    distance_label, representative = found
    if representative.get("status") == "no_route":
        raise FileNotFoundError("이 대표 경로는 경로 없음 상태입니다.")

    files = representative.get("files", {})
    json_path = (root / str(files.get("json", ""))).resolve()
    geojson_path = (root / str(files.get("geojson", ""))).resolve()
    json_path.relative_to(root.resolve())
    geojson_path.relative_to(root.resolve())
    route = json.loads(json_path.read_text(encoding="utf-8"))
    collection = json.loads(geojson_path.read_text(encoding="utf-8"))
    if route.get("route_id") != route_id:
        raise ValueError("대표 경로 인덱스와 경로 JSON의 route_id가 다릅니다.")
    feature = next((item for item in collection.get("features", [])
                    if item.get("properties", {}).get("route_id") == route_id), None)
    if feature is None and len(collection.get("features", [])) == 1:
        feature = collection["features"][0]
    coordinates = (feature or {}).get("geometry", {}).get("coordinates", [])
    if len(coordinates) < 2:
        return {
            "supported": False,
            "reason": "저장된 GeoJSON에 안내용 경로 좌표가 없습니다.",
            "destination_id": destination_id,
            "route_id": route_id,
        }

    cumulative = [0.0]
    for left, right in zip(coordinates, coordinates[1:]):
        cumulative.append(cumulative[-1] + _distance_m(left, right))

    steps = route.get("steps") or []
    maneuvers: list[dict[str, Any]] = []
    unsupported_types: set[int] = set()
    for step_index, step in enumerate(steps):
        try:
            step_type = int(step.get("type"))
        except (TypeError, ValueError):
            continue
        if step_type in {10, 11}:  # arrival and departure are handled by GPS state.
            continue
        turn = ORS_MANEUVER_NAMES.get(step_type)
        if turn is None:
            unsupported_types.add(step_type)
            continue
        way_points = step.get("way_points") or []
        if len(way_points) < 1:
            continue
        try:
            coordinate_index = int(way_points[0])
        except (TypeError, ValueError):
            continue
        if not 0 <= coordinate_index < len(cumulative):
            continue
        instruction = str(step.get("instruction") or "").strip()
        maneuvers.append({
            "id": f"step-{step_index}",
            "ors_step_index": step_index,
            "ors_type": step_type,
            "turn": turn,
            "chainage_m": round(cumulative[coordinate_index], 1),
            "distance_m": step.get("distance_m"),
            "instruction": instruction,
        })

    maneuvers.sort(key=lambda item: (item["chainage_m"], item["ors_step_index"]))
    summary = route.get("summary", {})
    destination = route.get("destination", {})
    supported = bool(maneuvers)
    support_level = "unsupported" if not supported else "partial" if unsupported_types else "full"
    if not supported:
        support_reason = "저장된 ORS 경로에는 사용할 수 있는 방향 전환 단계가 없습니다. 임의 안내는 제공하지 않습니다."
    elif unsupported_types:
        support_reason = f"일부 ORS 안내 유형({', '.join(map(str, sorted(unsupported_types)))})은 아직 처리하지 않아 해당 구간 안내가 생략됩니다."
    else:
        support_reason = None
    return {
        "supported": supported,
        "support_level": support_level,
        "reason": support_reason,
        "destination_id": destination_id,
        "destination_name": destination.get("name"),
        "target_distance_km": representative.get("target_distance_km"),
        "distance_label": distance_label,
        "slope_preference": representative.get("_mode"),
        "route_id": route_id,
        "route_status": representative.get("status"),
        "distance_m": round(float(summary.get("distance_km") or cumulative[-1] / 1000) * 1000, 1),
        "duration_seconds": summary.get("duration_seconds"),
        "coordinates": coordinates,
        "maneuvers": maneuvers,
        "ors_steps_count": len(steps),
        "unsupported_ors_step_types": sorted(unsupported_types),
        "coordinate_order": "[longitude, latitude, elevation?]",
        "instruction_source": "saved ORS directions steps in the representative route JSON",
        "destination_coordinate": [destination.get("longitude"), destination.get("latitude")],
    }
