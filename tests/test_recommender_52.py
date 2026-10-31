"""Offline tests for stage 5.2 candidate ranking and elevation confidence."""

from __future__ import annotations

import math
import unittest

from src.recommender import (
    _balanced_spatial_candidates,
    _candidate_combinations,
    _coordinate_key,
    _dedupe_candidates_by_coordinate,
    _grade_metrics,
    _route_rank_key,
    _select_mode_starts,
)


class Stage52CandidateTests(unittest.TestCase):
    def test_coordinate_aliases_keep_best_observed_candidate_metadata(self) -> None:
        candidates = [
            {"id": "unverified", "latitude": 37.6, "longitude": 127.0,
             "access_type": "subway_entrance", "running_way_score": 40,
             "accessibility_score": 0.5},
            {"id": "verified-alias", "latitude": 37.6000001, "longitude": 127.0000001,
             "access_type": "subway_entrance", "running_way_score": 88,
             "accessibility_score": 0.9, "coordinate_verified": True},
        ]
        unique = _dedupe_candidates_by_coordinate(candidates)
        self.assertEqual(len(unique), 1)
        self.assertEqual(unique[0]["id"], "verified-alias")
        self.assertIn("unverified", unique[0]["coordinate_alias_ids"])

    def test_cache_quality_can_select_a_good_candidate_without_removing_new_candidates(self) -> None:
        origin = {"id": "destination", "latitude": 37.6, "longitude": 127.0}
        candidates = []
        for index in range(40):
            candidates.append({
                "id": f"candidate-{index}", "latitude": 37.61 + index * 0.00001,
                "longitude": 127.02, "access_type": "subway_entrance",
                "candidate_origin": "automatic_osm_entrance",
                "running_way_score": 60 + index % 20, "accessibility_score": 0.7,
            })
        cached = candidates[0]
        quality = {(round(cached["longitude"] * 1_000_000), round(cached["latitude"] * 1_000_000)): 130.0}
        selected = _balanced_spatial_candidates(
            candidates, (origin["latitude"], origin["longitude"]), 32,
            category_key="access_type", preference="low", target_distance_km=3,
            cached_route_quality=quality,
        )
        selected_ids = {item["id"] for item in selected}
        self.assertEqual(len(selected), 32)
        self.assertIn(cached["id"], selected_ids)
        self.assertGreater(len(selected_ids - {cached["id"]}), 20)

    def test_running_focused_start_cap_stays_at_32_and_keeps_multiple_sectors(self) -> None:
        candidates = []
        for index in range(64):
            angle = (index % 8) * 45 + 22.5
            radius = 900 + (index // 8) * 300
            latitude = 37.6 + (radius * math.cos(angle * math.pi / 4) / 111000)
            longitude = 127.0 + (radius * math.sin(angle * math.pi / 4)
                                 / (111000 * math.cos(math.radians(37.6))))
            candidates.append({"id": f"start-{index}", "latitude": latitude, "longitude": longitude,
                               "access_type": "park_entrance",
                               "candidate_origin": "automatic_osm", "running_way_score": 80,
                               "accessibility_score": 0.8})
        selected = _select_mode_starts(
            candidates, {"latitude": 37.6, "longitude": 127.0}, "any",
            limit=64, running_focused=True, target_distance_km=3,
        )
        from src.recommender import _bearing_degrees, _stop_point
        sectors = {int(_bearing_degrees((37.6, 127.0), _stop_point(item)) // 45) % 8 for item in selected}
        self.assertEqual(len(selected), 32)
        self.assertEqual(len(sectors), 8)

    def test_coordinate_duplicate_combinations_are_removed_before_per_start_cap(self) -> None:
        start = {"id": "start", "latitude": 37.6, "longitude": 127.0,
                 "running_fitness_access_score": 50}
        start_alias = {**start, "id": "start-alias"}
        destination = {"id": "destination", "latitude": 37.6, "longitude": 127.025}
        waypoint = {"id": "via", "latitude": 37.601, "longitude": 127.012,
                    "candidate_type": "foot_network_footway", "running_way_score": 80}
        waypoint_alias = {**waypoint, "id": "via-alias"}
        combos = _candidate_combinations(
            [start, start_alias], [waypoint, waypoint_alias], destination, 3.0,
            slope_preference="low",
        )
        deduped_combos = _candidate_combinations(
            [start], [waypoint], destination, 3.0, slope_preference="low",
        )
        keys = {_coordinate_key([route_start, *vias, destination]) for route_start, vias in combos}
        self.assertEqual(len(keys), len(combos))
        self.assertEqual(len(combos), len(deduped_combos))
        self.assertLessEqual(len(combos), 8)

    def test_low_baseline_is_compared_by_terrain_rank_and_is_not_granted_priority(self) -> None:
        baseline = {"route": {"route_id": "saved"}, "meets_gentle_thresholds": False,
                    "low_terrain_burden": 90.0, "geometry_metrics": {"running_fitness": {"score": 40}},
                    "distance_error_m": 10}
        new = {"route": {"route_id": "new"}, "meets_gentle_thresholds": False,
               "low_terrain_burden": 70.0, "geometry_metrics": {"running_fitness": {"score": 40}},
               "distance_error_m": 20}
        self.assertLess(_route_rank_key(new, "low", True), _route_rank_key(baseline, "low", True))

    def test_long_elevation_sample_gap_marks_grade_confidence_without_changing_values(self) -> None:
        # A long gap with a recorded rise is retained as-is and marked for review.
        lat0 = 37.6
        coords = [
            [127.0, lat0, 20.0],
            [127.0, lat0 + 0.00009, 20.0],
            [127.0, lat0 + 0.00135, 50.0],
            [127.0, lat0 + 0.00144, 60.0],
        ]
        result = _grade_metrics(
            {"geometry": {"coordinates": coords}}, 6.0,
            {"profile_sample_m": 20, "smoothing_window_m": 60,
             "sustained_window_m": 100, "elevation_gap_warning_m": 100,
             "uphill_thresholds_percent": [8, 10]},
        )
        quality = result["elevation_data_quality"]
        self.assertEqual(quality["status"], "warning")
        self.assertGreater(quality["max_coordinate_spacing_m"], 100)
        self.assertTrue(quality["max_sustained_window_overlaps_warning_gap"])
        self.assertAlmostEqual(quality["max_gap"]["elevation_change_m"], 30.0, places=1)


if __name__ == "__main__":
    unittest.main()
