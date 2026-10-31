"""Offline tests for OSM waterway-to-walkable-route matching and scoring."""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from src.osm_data import _query_for
from src.running_metrics import evaluate_route_geometry


ORIGIN = (37.6, 127.0)
LAT_END = ORIGIN[0] + 100 / 110_540


def lon_offset(meters: float) -> float:
    return meters / (111_320 * math.cos(math.radians(ORIGIN[0])))


def osm_way(osm_id: int, tags: dict, east_m: float = 0.0) -> dict:
    lon = ORIGIN[1] + lon_offset(east_m)
    return {
        "type": "way", "id": osm_id, "tags": tags,
        "geometry": [{"lat": ORIGIN[0], "lon": lon}, {"lat": LAT_END, "lon": lon}],
    }


def route() -> dict:
    return {
        "geometry": {"type": "LineString", "coordinates": [
            [ORIGIN[1], ORIGIN[0]], [ORIGIN[1], LAT_END],
        ]},
        "summary": {"distance_m": 100.0, "distance_km": 0.1},
        "stops": [],
    }


def config() -> dict:
    root = Path(__file__).resolve().parents[1]
    return json.loads((root / "data" / "running_fitness.json").read_text(encoding="utf-8"))


class RiversideMetricTests(unittest.TestCase):
    def test_foot_allowed_riverfront_path_gets_limited_bonus(self) -> None:
        data = {"elements": [
            osm_way(1, {"highway": "footway", "foot": "designated", "surface": "asphalt"}, east_m=5),
            osm_way(2, {"waterway": "stream", "name": "Name is deliberately irrelevant"}, east_m=18),
        ]}
        result = evaluate_route_geometry(route(), data, fitness_config=config())["running_fitness"]
        metrics = result["riverside_metrics"]
        self.assertEqual(metrics["data_status"], "matched_osm_walkway_and_waterway")
        self.assertAlmostEqual(metrics["riverside_walkable_length_m"], 100, delta=2)
        self.assertEqual(metrics["riverside_walkable_share_percent"], 100.0)
        self.assertEqual(metrics["osm_walkable_match_success_percent"], 100.0)
        self.assertGreater(result["riverside_bonus_points"], 0)
        self.assertLessEqual(result["riverside_bonus_points"], 4)
        self.assertLessEqual(result["score"], result["base_score_before_riverside_bonus"] + 4)

    def test_nearby_motor_road_is_not_credited(self) -> None:
        data = {"elements": [
            osm_way(3, {"highway": "residential", "surface": "asphalt"}, east_m=5),
            osm_way(4, {"waterway": "river"}, east_m=10),
        ]}
        result = evaluate_route_geometry(route(), data, fitness_config=config())["running_fitness"]
        self.assertEqual(result["riverside_metrics"]["riverside_walkable_length_m"], 0)
        self.assertEqual(result["riverside_bonus_points"], 0)

    def test_bicycle_only_cycleway_and_explicit_foot_ban_are_excluded(self) -> None:
        cases = [
            {"highway": "cycleway", "bicycle": "designated"},
            {"highway": "cycleway", "bicycle": "designated", "foot": "no"},
            {"highway": "path", "bicycle": "designated"},
            {"highway": "footway", "foot": "no"},
            {"highway": "path", "access": "private"},
            {"highway": "footway", "foot": "yes", "surface": "mud"},
        ]
        for index, tags in enumerate(cases, start=10):
            with self.subTest(tags=tags):
                data = {"elements": [
                    osm_way(index, tags, east_m=5),
                    osm_way(index + 100, {"waterway": "canal"}, east_m=10),
                ]}
                result = evaluate_route_geometry(route(), data, fitness_config=config())["running_fitness"]
                self.assertEqual(result["riverside_metrics"]["riverside_walkable_length_m"], 0)
                self.assertEqual(result["riverside_bonus_points"], 0)

    def test_missing_waterway_data_keeps_legacy_score_unchanged(self) -> None:
        data = {"elements": [osm_way(20, {"highway": "footway", "foot": "yes", "surface": "paved"}, east_m=5)]}
        result = evaluate_route_geometry(route(), data, fitness_config=config())["running_fitness"]
        self.assertEqual(result["score"], result["base_score_before_riverside_bonus"])
        self.assertEqual(result["riverside_bonus_points"], 0)
        self.assertEqual(result["riverside_metrics"]["data_status"], "waterway_data_unavailable")
        self.assertEqual(result["riverside_metrics"]["osm_walkable_match_success_percent"], 100.0)
        self.assertEqual(result["riverside_metrics"]["uncertain_share_percent"], 100.0)

    def test_far_walkway_and_waterway_do_not_false_match_route(self) -> None:
        data = {"elements": [
            osm_way(30, {"highway": "footway", "foot": "yes"}, east_m=35),
            osm_way(31, {"waterway": "river"}, east_m=40),
        ]}
        result = evaluate_route_geometry(route(), data, fitness_config=config())["running_fitness"]
        metrics = result["riverside_metrics"]
        self.assertEqual(metrics["riverside_walkable_length_m"], 0)
        self.assertEqual(metrics["osm_walkable_match_success_percent"], 0.0)
        self.assertEqual(result["riverside_bonus_points"], 0)

    def test_query_requests_generic_waterway_lines_without_name_filter(self) -> None:
        query = _query_for({"latitude": 37.6, "longitude": 127.0}, 4500)
        self.assertIn('way["waterway"~"^(river|stream|canal|tidal_channel)$"]', query)
        self.assertNotIn("name~", query)


if __name__ == "__main__":
    unittest.main()
