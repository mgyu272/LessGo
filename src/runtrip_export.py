"""Convert saved Less GO routes into the run (성북 런트립) web app data format.

The run app reads public/data/courses.geojson and public/data/spots.json.
Only saved route files are read; ORS and OSM are never called here.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from src.navigation_data import ORS_MANEUVER_NAMES, _distance_m


SOURCE_TAG = "lessgo"
DEFAULT_INDEX = Path("analysis/experiments/final_routes_20261101/outputs/app/representative_routes.json")
DISTANCE_LABELS = ("3km", "5km", "10km")
ELEVATION_SAMPLES = 24
CUE_MIN_GAP_M = 30.0  # run app fires a cue within 25m, so closer cues would overlap.
SEALS = {"simujang": "심우", "jeongneung": "정릉", "uiryeong": "의릉"}
MODE_LABELS = {"low": {"ko": "완만한 길", "en": "Gentle"}, "any": {"ko": "언덕 허용", "en": "Hills OK"}}

TURN_TEXT = {
    "left": ("좌회전하세요", "Turn left"),
    "right": ("우회전하세요", "Turn right"),
    "sharp_left": ("왼쪽으로 크게 꺾으세요", "Turn sharp left"),
    "sharp_right": ("오른쪽으로 크게 꺾으세요", "Turn sharp right"),
    "slight_left": ("왼쪽으로 살짝 꺾으세요", "Bear left"),
    "slight_right": ("오른쪽으로 살짝 꺾으세요", "Bear right"),
    "straight": ("직진하세요", "Continue straight"),
    "roundabout_enter": ("회전교차로로 들어가세요", "Enter the roundabout"),
    "roundabout_exit": ("회전교차로에서 나가세요", "Exit the roundabout"),
    "u_turn": ("유턴하세요", "Make a U-turn"),
    "keep_left": ("왼쪽 길로 계속 가세요", "Keep left"),
    "keep_right": ("오른쪽 길로 계속 가세요", "Keep right"),
}


def _hill(ascent_m: float, distance_km: float) -> str:
    per_km = ascent_m / max(distance_km, 0.1)
    return "flat" if per_km < 15 else "mild" if per_km < 35 else "hard"


def _tone(hill: str, distance_km: float) -> str:
    if hill == "hard" or distance_km >= 8:
        return "hard"
    return "easy" if hill == "flat" and distance_km <= 5.5 else "normal"


def _themes(running_analysis: dict[str, Any]) -> list[str]:
    fitness = running_analysis.get("running_fitness", {})
    network = running_analysis.get("network_metrics", {})
    themes = []
    if float(fitness.get("riverside_bonus_points") or 0) > 0:
        themes.append("stream")
    if float(network.get("dedicated_pedestrian_way_share_of_route") or 0) >= 0.5:
        themes.append("park")
    return themes or ["alley"]


def _elevation_profile(coordinates: list[list[float]], samples: int = ELEVATION_SAMPLES) -> list[float]:
    """Resample saved ORS elevations at equal route distances for the app's chart."""
    if not coordinates or len(coordinates[0]) < 3:
        return []
    cumulative = [0.0]
    for left, right in zip(coordinates, coordinates[1:]):
        cumulative.append(cumulative[-1] + _distance_m(left, right))
    total = cumulative[-1]
    profile, j = [], 0
    for i in range(samples):
        target = total * i / (samples - 1)
        while j < len(cumulative) - 2 and cumulative[j + 1] < target:
            j += 1
        span = cumulative[j + 1] - cumulative[j] if len(cumulative) > 1 else 0
        frac = (target - cumulative[j]) / span if span else 0
        z = coordinates[j][2] + (coordinates[min(j + 1, len(coordinates) - 1)][2] - coordinates[j][2]) * frac
        profile.append(round(z, 1))
    return profile


def _road_name(instruction: str) -> str:
    for marker in (" onto ", " on "):
        if marker in instruction:
            return instruction.split(marker, 1)[1].strip()
    return ""


def _cues(steps: list[dict[str, Any]], coordinates: list[list[float]], destination: dict[str, str]) -> list[dict[str, Any]]:
    """Build run app cues from saved ORS steps; unknown maneuver types are skipped."""
    cues: list[dict[str, Any]] = []
    first = coordinates[0]
    first_road = _road_name(str(steps[0].get("instruction") or "")) if steps else ""
    cues.append({"at": [first[0], first[1]], "text": {
        "ko": f"{destination['ko']}까지 출발합니다." + (f" {first_road} 방향으로 가세요." if first_road else ""),
        "en": f"Starting your run to {destination['en']}." + (f" Head along {first_road}." if first_road else ""),
    }})
    for step in steps:
        turn = ORS_MANEUVER_NAMES.get(step.get("type"))
        way_points = step.get("way_points") or []
        if turn is None or not way_points or not 0 <= int(way_points[0]) < len(coordinates):
            continue
        point = coordinates[int(way_points[0])]
        if _distance_m(point, cues[-1]["at"]) < CUE_MIN_GAP_M:
            continue
        ko, en = TURN_TEXT[turn]
        road = _road_name(str(step.get("instruction") or ""))
        cues.append({"at": [point[0], point[1]], "text": {
            "ko": f"{road} 방향으로 {ko}." if road else f"{ko}.",
            "en": f"{en} onto {road}." if road else f"{en}.",
        }})
    return cues


def _course(destination_id: str, label: str, modes: list[str], route: dict[str, Any],
            feature: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    coordinates = feature["geometry"]["coordinates"]
    summary = route["summary"]
    distance_km = round(float(summary["distance_km"]), 2)
    ascent_m = round(float(summary.get("ascent_m") or 0))
    hill = _hill(ascent_m, distance_km)
    analysis = route.get("running_analysis", {})
    mode_name = {lang: " · ".join(MODE_LABELS[m][lang] for m in modes) for lang in ("ko", "en")}
    start_name = route.get("start", {}).get("name") or ""
    return {
        "type": "Feature",
        "properties": {
            "id": f"{destination_id}-{label}-{'-'.join(modes)}",
            "name": {"ko": f"{names['ko']} {label} · {mode_name['ko']}",
                     "en": f"{names['en']} {label.upper()} · {mode_name['en']}"},
            "themes": _themes(analysis),
            "hill": hill,
            "tone": _tone(hill, distance_km),
            # LessGo has no lighting, crowd or residential data; these are neutral defaults.
            "lamps": 2,
            "crowd": "mid",
            "residential": False,
            "spots": [destination_id],
            "distance_km": distance_km,
            "ascent_m": ascent_m,
            "elevation": _elevation_profile(coordinates),
            "cues": _cues(route.get("steps") or [], coordinates, names),
            "lessgo": {
                "source": SOURCE_TAG,
                "route_id": route["route_id"],
                "slope_modes": modes,
                "start_name": start_name,
                "running_score": analysis.get("running_fitness", {}).get("score"),
                "verification_status": "needs_verification",
            },
        },
        "geometry": {"type": "LineString", "coordinates": [[c[0], c[1]] for c in coordinates]},
    }


def _spot(destination: dict[str, Any], narration: dict[str, Any], route_ends: list[list[float]]) -> dict[str, Any]:
    point = [destination["longitude"], destination["latitude"]]
    farthest_end = max((_distance_m(point, end) for end in route_ends), default=0.0)
    names = narration["name"]
    paragraphs = {lang: [p.strip() for p in narration["narration"][lang].split("\n\n") if p.strip()] for lang in ("ko", "en")}
    card_count = 3
    cards = []
    for i in range(card_count):
        body = {}
        for lang, items in paragraphs.items():
            size = math.ceil(len(items) / card_count)
            body[lang] = "\n\n".join(items[i * size:(i + 1) * size])
        cards.append({"title": {"ko": f"{names['ko']} 이야기 {i + 1}", "en": f"{names['en']} story {i + 1}"}, "body": body})
    return {
        "id": destination["id"],
        "name": names,
        "seal": SEALS.get(destination["id"], names["ko"][:2]),
        "category": "history",
        "lat": destination["latitude"],
        "lng": destination["longitude"],
        # Routes end at the mapped approach point, so the arrival radius must cover every route end.
        "radius_m": max(50, math.ceil(farthest_end + 20)),
        "cards": cards,
        "narration": narration["narration"],
        "notice": {"ko": "유적지 입구와 관람 시간은 현장에서 확인하세요. 주민과 관람객을 배려해 주세요.",
                   "en": "Check the entrance and opening hours on site, and please be considerate of residents and visitors."},
        "sources": [],
        "faq": [],
        "source": SOURCE_TAG,
    }


def build_runtrip_data(root: Path, index_path: Path = DEFAULT_INDEX) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (course features, spots) for every saved destination/distance route."""
    index = json.loads((root / index_path).read_text(encoding="utf-8"))
    destinations = {d["id"]: d for d in json.loads((root / "data" / "destinations.json").read_text(encoding="utf-8"))["destinations"]}
    narrations = json.loads((root / "data" / "narrations.json").read_text(encoding="utf-8"))
    courses, spots = [], []
    for destination_id, entries in index["destinations"].items():
        names = narrations[destination_id]["name"]
        ends = []
        for label in DISTANCE_LABELS:
            loaded: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
            for mode, entry in entries.get(label, {}).get("modes", {}).items():
                if entry.get("generation_status") != "success":
                    continue
                route = json.loads((root / entry["files"]["json"]).read_text(encoding="utf-8"))
                feature = json.loads((root / entry["files"]["geojson"]).read_text(encoding="utf-8"))["features"][0]
                loaded.append((mode, route, feature))
            # low and any can share one geometry; publish it once with both mode labels.
            groups: list[tuple[list[str], dict[str, Any], dict[str, Any]]] = []
            for mode, route, feature in loaded:
                same = next((g for g in groups if g[2]["geometry"]["coordinates"] == feature["geometry"]["coordinates"]), None)
                if same:
                    same[0].append(mode)
                else:
                    groups.append(([mode], route, feature))
            for modes, route, feature in groups:
                courses.append(_course(destination_id, label, modes, route, feature, names))
                ends.append(feature["geometry"]["coordinates"][-1])
        spots.append(_spot(destinations[destination_id], narrations[destination_id], ends))
    return courses, spots


def merge_into_run(run_data_dir: Path, courses: list[dict[str, Any]], spots: list[dict[str, Any]]) -> dict[str, int]:
    """Replace earlier LessGo items in the run app files and keep everything else."""
    courses_path = run_data_dir / "courses.geojson"
    spots_path = run_data_dir / "spots.json"
    course_doc = json.loads(courses_path.read_text(encoding="utf-8"))
    spot_doc = json.loads(spots_path.read_text(encoding="utf-8"))
    new_course_ids = {c["properties"]["id"] for c in courses}
    new_spot_ids = {s["id"] for s in spots}
    kept_courses = [f for f in course_doc["features"]
                    if f["properties"].get("lessgo", {}).get("source") != SOURCE_TAG and f["properties"]["id"] not in new_course_ids]
    kept_spots = [s for s in spot_doc["spots"] if s.get("source") != SOURCE_TAG and s["id"] not in new_spot_ids]
    course_doc["features"] = kept_courses + courses
    spot_doc["spots"] = kept_spots + spots
    courses_path.write_text(json.dumps(course_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    spots_path.write_text(json.dumps(spot_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"courses_kept": len(kept_courses), "courses_added": len(courses),
            "spots_kept": len(kept_spots), "spots_added": len(spots)}
