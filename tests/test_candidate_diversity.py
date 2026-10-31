"""Offline tests for generic candidate balancing; no OSM or ORS requests."""

from __future__ import annotations

import math
import json
import unittest
from pathlib import Path

from src.recommender import (
    _balanced_spatial_candidates,
    _candidate_combinations,
    _coordinate_key,
    _mode_waypoints,
    _select_mode_starts,
    _within_distance_tolerance,
)


ORIGIN = (37.6, 127.0)


def point_at(bearing_degrees: float, distance_m: float) -> tuple[float, float]:
    angle = math.radians(bearing_degrees)
    latitude = ORIGIN[0] + math.cos(angle) * distance_m / 111_000
    longitude = ORIGIN[1] + math.sin(angle) * distance_m / (111_000 * math.cos(math.radians(ORIGIN[0])))
    return latitude, longitude


def candidates_for(category: str, count: int, *, key: str, bearing_offset: float = 0.0) -> list[dict]:
    candidates = []
    # Many nearby points in each type exercise the type cap and spatial sampler.
    for index in range(count):
        bearing = bearing_offset + (index % 8) * 45
        radius = 500 + (index // 8) * 180
        latitude, longitude = point_at(bearing, radius)
        candidates.append({
            "id": f"{category}-{index}",
            key: category,
            "access_type": category,
            "candidate_type": category,
            "latitude": latitude,
            "longitude": longitude,
            "running_way_score": 90 - index % 7,
            "accessibility_score": 0.8,
            "candidate_origin": "automatic_osm_test",
        })
    return candidates


class CandidateDiversityTests(unittest.TestCase):
    def test_start_sample_balances_types_and_approach_directions(self) -> None:
        candidates = []
        for kind, offset in (("running_network_access", 0), ("park_entrance", 17), ("subway_entrance", 31)):
            candidates.extend(candidates_for(kind, 24, key="access_type", bearing_offset=offset))
        before_ids = [item["id"] for item in candidates]
        destination = {"latitude": ORIGIN[0], "longitude": ORIGIN[1]}

        selected = _select_mode_starts(
            candidates, destination, "low", limit=18, running_focused=True, target_distance_km=3,
        )

        self.assertEqual(len(selected), 18)
        self.assertEqual({item["access_type"] for item in selected},
                         {"running_network_access", "park_entrance", "subway_entrance"})
        self.assertGreaterEqual(len({item["id"] for item in selected}), 12)
        self.assertEqual([item["id"] for item in candidates], before_ids)
        self.assertTrue(all(item in candidates for item in selected))

    def test_low_and_any_are_diverse_samples_without_forcing_distinct_routes(self) -> None:
        candidates = []
        for kind, offset in (("foot_network_footway", 0), ("foot_network_path", 13), ("mapped_crossing", 27)):
            candidates.extend(candidates_for(kind, 20, key="candidate_type", bearing_offset=offset))
        destination = {"latitude": ORIGIN[0], "longitude": ORIGIN[1]}

        low = _mode_waypoints(candidates, "low", limit=18, running_focused=True, destination=destination)
        any_mode = _mode_waypoints(candidates, "any", limit=18, running_focused=True, destination=destination)

        self.assertEqual(len(low), 18)
        self.assertEqual(len(any_mode), 18)
        self.assertEqual({item["candidate_type"] for item in low},
                         {"foot_network_footway", "foot_network_path", "mapped_crossing"})
        self.assertGreaterEqual(len({item["id"] for item in any_mode}), 12)

    def test_steps_and_uncertain_cycleways_remain_excluded(self) -> None:
        allowed = candidates_for("foot_network_footway", 5, key="candidate_type")
        rejected = [
            {**allowed[0], "id": "stairs", "candidate_type": "foot_network_steps"},
            {**allowed[1], "id": "uncertain-cycleway", "running_way_class": "uncertain_cycleway"},
        ]
        result = _mode_waypoints(
            allowed + rejected, "any", limit=20, running_focused=True,
            destination={"latitude": ORIGIN[0], "longitude": ORIGIN[1]},
        )
        result_ids = {item["id"] for item in result}
        self.assertNotIn("stairs", result_ids)
        self.assertNotIn("uncertain-cycleway", result_ids)
        self.assertEqual(len(result), len(allowed))

    def test_curated_csv_candidates_cannot_fill_the_sample_by_themselves(self) -> None:
        candidates = candidates_for("subway_exit", 40, key="access_type")
        for index, item in enumerate(candidates):
            item["candidate_origin"] = "curated_csv" if index < 20 else "automatic_osm_candidate"

        selected = _balanced_spatial_candidates(
            candidates, ORIGIN, 10, category_key="access_type", preference="any",
        )

        curated = sum(item["candidate_origin"] == "curated_csv" for item in selected)
        automatic = sum(item["candidate_origin"] == "automatic_osm_candidate" for item in selected)
        self.assertEqual(len(selected), 10)
        self.assertGreater(automatic, 0)
        self.assertLessEqual(curated, 5)

    def test_mode_priority_changes_actual_candidate_order_without_grade_guessing(self) -> None:
        start = {
            "id": "shared-start", "latitude": ORIGIN[0], "longitude": ORIGIN[1],
            "accessibility_score": 0.9, "running_fitness_access_score": 60,
        }
        destination_lat, destination_lon = point_at(0, 1500)
        destination = {"id": "generic-destination", "latitude": destination_lat, "longitude": destination_lon}
        # Both points are OSM-derived pedestrian network candidates. Their
        # running scores differ, but neither score claims anything about grade.
        waypoints = []
        for identifier, side_distance, score in (("nearer", 800, 25), ("runner-friendly", 1050, 98)):
            latitude, longitude = point_at(90, side_distance)
            waypoints.append({
                "id": identifier, "latitude": latitude, "longitude": longitude,
                "candidate_type": "foot_network_footway", "running_way_score": score,
                "running_way_class": "mapped_pedestrian_network",
            })

        low = _candidate_combinations([start], waypoints, destination, 4.0, slope_preference="low")
        any_mode = _candidate_combinations([start], waypoints, destination, 4.0, slope_preference="any")

        self.assertGreaterEqual(len(low), 2)
        self.assertGreaterEqual(len(any_mode), 2)
        self.assertNotEqual(low[0][1][0]["id"], any_mode[0][1][0]["id"])
        self.assertEqual({pair[1][0]["id"] for pair in low[:2]}, {"nearer", "runner-friendly"})
        self.assertEqual({pair[1][0]["id"] for pair in any_mode[:2]}, {"nearer", "runner-friendly"})

    def test_same_stops_share_the_existing_ors_cache_key_across_modes(self) -> None:
        stops = [
            {"latitude": 37.6, "longitude": 127.0, "slope_preference": "low"},
            {"latitude": 37.61, "longitude": 127.01, "slope_preference": "low"},
        ]
        other_mode_stops = [{**stop, "slope_preference": "any"} for stop in stops]
        # The cache key intentionally contains only routing inputs, never the
        # slope preference or target label, so both modes can reuse ORS output.
        self.assertEqual(_coordinate_key(stops), _coordinate_key(other_mode_stops))

    def test_absolute_tolerance_includes_300m_boundary_for_all_target_lengths(self) -> None:
        for target in (3.0, 5.0, 10.0):
            self.assertTrue(_within_distance_tolerance(target - 0.3, target, 300))
            self.assertTrue(_within_distance_tolerance(target + 0.3, target, 300))
            self.assertFalse(_within_distance_tolerance(target - 0.301, target, 300))
            self.assertFalse(_within_distance_tolerance(target + 0.301, target, 300))

    def test_route_default_uses_300m_without_changing_the_50m_preference_band(self) -> None:
        project_root = Path(__file__).resolve().parents[1]
        defaults = json.loads((project_root / "data" / "route_defaults.json").read_text(encoding="utf-8"))
        self.assertEqual(defaults["distance_tolerance_min_m"], 300)
        self.assertEqual(defaults["preferred_distance_error_m"], 50)


if __name__ == "__main__":
    unittest.main()
