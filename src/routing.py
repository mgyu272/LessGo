"""OpenRouteService walking directions and output serialization."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import folium
import requests
from xyzservices import providers


ORS_DIRECTIONS_URL = "https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson"
ELEVATION_NOISE_FILTER_M = 0.5


class RouteError(RuntimeError):
    """A safe-to-display ORS or response validation error."""

    def __init__(self, message: str, request_attempts: int = 0):
        super().__init__(message)
        self.request_attempts = request_attempts


def fetch_walking_route(start: dict[str, Any], destination: dict[str, Any], api_key: str) -> dict[str, Any]:
    """Backward-compatible direct route helper."""
    return fetch_walking_route_points(
        [start, destination],
        api_key,
        "hansung-station-5-to-simujang",
    )


def fetch_walking_route_points(
    stops: list[dict[str, Any]],
    api_key: str,
    route_id: str,
    max_retries: int = 1,
) -> dict[str, Any]:
    """Fetch a foot-walking route through ordered stops (lat/lon input)."""
    if len(stops) < 2:
        raise ValueError("경로에는 출발지와 목적지가 필요합니다.")
    body = {
        "coordinates": [[float(stop["longitude"]), float(stop["latitude"])] for stop in stops],
        "instructions": True,
        "instructions_format": "text",
        "elevation": True,
        "extra_info": ["steepness"],
    }
    response = None
    attempts = 0
    retryable_statuses = {429, 500, 502, 503, 504}
    for attempt in range(max(0, int(max_retries)) + 1):
        attempts += 1
        try:
            response = requests.post(
                ORS_DIRECTIONS_URL,
                json=body,
                headers={"Authorization": api_key, "Content-Type": "application/json", "Accept": "application/geo+json"},
                timeout=30,
            )
        except requests.RequestException as exc:
            if attempt < max_retries:
                time.sleep(0.5 * (2 ** attempt))
                continue
            raise RouteError(f"ORS에 연결하지 못했습니다 ({exc.__class__.__name__}). 네트워크를 확인하세요.", attempts) from exc
        if response.status_code in retryable_statuses and attempt < max_retries:
            time.sleep(0.5 * (2 ** attempt))
            continue
        break

    assert response is not None

    if not response.ok:
        try:
            payload = response.json()
            detail = payload.get("error", {}).get("message") or payload.get("message") or payload.get("error")
            if isinstance(detail, dict):
                detail = detail.get("message") or json.dumps(detail, ensure_ascii=False)
        except (ValueError, AttributeError):
            detail = response.text[:400]
        raise RouteError(f"ORS HTTP {response.status_code}: {detail or response.reason}", attempts)

    try:
        data = response.json()
        feature = data["features"][0]
        properties = feature["properties"]
        ors_summary = properties["summary"]
        geometry = feature["geometry"]
        if geometry.get("type") != "LineString" or len(geometry.get("coordinates", [])) < 2:
            raise KeyError("geometry.coordinates")
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise RouteError("ORS 응답에 경로 또는 요약 정보가 없습니다. API 응답 형식을 확인하세요.", attempts) from exc

    segments = properties.get("segments", [])
    steps = []
    for segment in segments:
        for step in segment.get("steps", []):
            steps.append({
                "instruction": step.get("instruction"),
                "distance_m": step.get("distance"),
                "duration_seconds": step.get("duration"),
                "type": step.get("type"),
                "way_points": step.get("way_points"),
            })

    extras = properties.get("extras", {})
    steepness_extra = extras.get("steepness")
    ascent_m = ors_summary.get("ascent")
    descent_m = ors_summary.get("descent")
    ascent_field = "summary.ascent" if ascent_m is not None else None
    descent_field = "summary.descent" if descent_m is not None else None
    elevation_source = "ors_response"
    elevation_is_estimate = False

    # ORS GeoJSON has returned ascent/descent at feature.properties level,
    # alongside summary (which usually only has distance and duration).
    if ascent_m is None:
        ascent_m = properties.get("ascent")
        if ascent_m is not None:
            ascent_field = "properties.ascent"
    if descent_m is None:
        descent_m = properties.get("descent")
        if descent_m is not None:
            descent_field = "properties.descent"

    # Keep a clearly labeled geometry-derived fallback for responses without
    # ascent/descent aggregates. Ignore tiny changes to limit noise accumulation.
    if ascent_m is None or descent_m is None:
        coordinates = geometry.get("coordinates", [])
        elevations = [point[2] for point in coordinates if len(point) >= 3]
        if len(elevations) == len(coordinates) and len(elevations) >= 2:
            estimated_ascent = 0.0
            estimated_descent = 0.0
            for previous, current in zip(elevations, elevations[1:]):
                delta = float(current) - float(previous)
                if delta >= ELEVATION_NOISE_FILTER_M:
                    estimated_ascent += delta
                elif delta <= -ELEVATION_NOISE_FILTER_M:
                    estimated_descent -= delta
            if ascent_m is None:
                ascent_m = estimated_ascent
                ascent_field = "geometry.coordinates (estimate)"
            if descent_m is None:
                descent_m = estimated_descent
                descent_field = "geometry.coordinates (estimate)"
            elevation_source = "geometry_estimate"
            elevation_is_estimate = True

    return {
        "route_id": route_id,
        "profile": "foot-walking",
        "stops": stops,
        "geometry": geometry,
        "summary": {
            "distance_m": ors_summary.get("distance"),
            "distance_km": ors_summary.get("distance", 0) / 1000,
            "duration_seconds": ors_summary.get("duration"),
            "duration_minutes": ors_summary.get("duration", 0) / 60,
            "ascent_m": ascent_m,
            "descent_m": descent_m,
            "elevation_source": elevation_source if ascent_m is not None or descent_m is not None else None,
            "elevation_is_estimate": elevation_is_estimate,
            "elevation_noise_filter_m": ELEVATION_NOISE_FILTER_M if elevation_is_estimate else None,
            "ascent_field": ascent_field,
            "descent_field": descent_field,
        },
        "steps": steps,
        "steepness": steepness_extra,
        "elevation_available": any(len(point) >= 3 for point in geometry["coordinates"]),
        "data_notes": [
            "장소 좌표는 사용자 제공 또는 지오코더 결과이며 실제 출입구와 일치하는지 검증되지 않았습니다.",
            "장소 내부 보행 가능 여부는 확인하지 않았으며 목적지 좌표까지의 경로입니다.",
            "고도와 경사도는 ORS 응답에 제공된 경우에만 기록했습니다.",
            "좌표에서 계산한 고도는 추정값이며 0.5m 미만의 인접 변화량을 노이즈 완화 목적으로 제외했습니다." if elevation_is_estimate else "상승·하강고도는 ORS 응답 필드에서 추출했습니다.",
        ],
        "ors": {"source": "OpenRouteService Directions API", "profile": "foot-walking"},
        "ors_request_attempts": attempts,
    }


def save_route_files(
    route: dict[str, Any],
    start: dict[str, Any],
    destination: dict[str, Any],
    output_dir: Path,
    waypoints: list[dict[str, Any]] | None = None,
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = route["route_id"]
    json_path = output_dir / f"{prefix}.json"
    geojson_path = output_dir / f"{prefix}.geojson"
    map_path = output_dir / f"{prefix}.html"

    payload = {
        **route,
        "start": {key: start.get(key) for key in ("id", "name", "latitude", "longitude", "access_type", "running_way_class", "running_fitness_access_score", "coordinate_source", "coordinate_verified", "entrance_verified", "station_access")},
        "waypoints": [
            {key: waypoint.get(key) for key in ("id", "name", "latitude", "longitude", "candidate_type", "running_way_class", "running_way_score", "coordinate_source", "coordinate_verified", "entrance_verified")}
            for waypoint in (waypoints or [])
        ],
        "destination": {key: destination.get(key) for key in ("id", "name", "latitude", "longitude", "coordinate_source", "coordinate_verified", "entrance_verified")},
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    feature = {
        "type": "Feature",
        "properties": {
            "route_id": prefix,
            "profile": route["profile"],
            "distance_m": route["summary"]["distance_m"],
            "duration_seconds": route["summary"]["duration_seconds"],
            "ascent_m": route["summary"]["ascent_m"],
            "descent_m": route["summary"]["descent_m"],
            "elevation_source": route["summary"]["elevation_source"],
            "elevation_is_estimate": route["summary"]["elevation_is_estimate"],
            "ascent_field": route["summary"]["ascent_field"],
            "descent_field": route["summary"]["descent_field"],
            "start": {"id": start.get("id"), "name": start["name"], "entrance_verified": start.get("entrance_verified", False),
                      "station_access": start.get("station_access")},
            "waypoints": [{"id": waypoint["id"], "name": waypoint["name"],
                           "entrance_verified": waypoint.get("entrance_verified", False)} for waypoint in (waypoints or [])],
            "destination": {"id": destination.get("id"), "name": destination["name"],
                            "entrance_verified": destination.get("entrance_verified", False)},
            "running_analysis": route.get("running_analysis"),
        },
        "geometry": route["geometry"],
    }
    geojson_path.write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}, ensure_ascii=False, indent=2), encoding="utf-8")

    center = [
        (float(start["latitude"]) + float(destination["latitude"])) / 2,
        (float(start["longitude"]) + float(destination["longitude"])) / 2,
    ]
    # Keep the ORS route overlay fixed while offering alternate detailed
    # basemaps. The topographic layer is the default; users can switch to
    # street labels or aerial imagery from Folium's layer control.
    map_view = folium.Map(location=center, zoom_start=16, control_scale=True, tiles=None)
    folium.TileLayer(
        tiles=providers.Esri.WorldTopoMap,
        name="Esri 상세 도로·지형",
        overlay=False,
        control=True,
        show=True,
    ).add_to(map_view)
    folium.TileLayer(
        tiles=providers.Esri.WorldStreetMap,
        name="Esri 도로 지도",
        overlay=False,
        control=True,
        show=False,
    ).add_to(map_view)
    folium.TileLayer(
        tiles=providers.Esri.WorldImagery,
        name="Esri 항공사진",
        overlay=False,
        control=True,
        show=False,
    ).add_to(map_view)
    folium.GeoJson(feature, name="ORS foot-walking 경로", tooltip="실제 ORS 보행 경로").add_to(map_view)
    folium.Marker(
        [start["latitude"], start["longitude"]], tooltip=start["name"],
        popup=f"출발: {start['name']}<br>출입구와 보행 가능 여부 추가 확인 필요", icon=folium.Icon(color="green", icon="play"),
    ).add_to(map_view)
    for index, waypoint in enumerate(waypoints or [], start=1):
        folium.Marker(
            [waypoint["latitude"], waypoint["longitude"]], tooltip=f"경유 {index}: {waypoint['name']}",
            popup=f"경유: {waypoint['name']}<br>정확한 진입 위치와 보행 가능 여부 추가 확인 필요",
            icon=folium.Icon(color="orange", icon="info-sign"),
        ).add_to(map_view)
    folium.Marker(
        [destination["latitude"], destination["longitude"]], tooltip=destination["name"],
        popup=f"도착: {destination['name']}<br>출입구와 보행 가능 여부 추가 확인 필요", icon=folium.Icon(color="red", icon="flag"),
    ).add_to(map_view)
    coordinates = route["geometry"]["coordinates"]
    map_view.fit_bounds([[point[1], point[0]] for point in coordinates], max_zoom=16)
    folium.LayerControl().add_to(map_view)
    map_view.save(str(map_path))
    return [json_path, geojson_path, map_path]
