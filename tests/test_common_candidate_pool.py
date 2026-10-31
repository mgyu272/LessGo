"""Offline regression tests for mode-shared, revalidated ORS route candidates."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.recommender import (
    _cached_route_candidate,
    _dedupe_route_candidates_by_geometry,
    _load_shared_route_cache,
    _route_geometry_signature,
    _route_origin_mode,
    _route_rank_key,
    _score_route_candidate,
)


ROOT = Path(__file__).resolve().parents[1]


def _metric_stub() -> dict:
    return {
        "network": {
            "explicit_access_restricted_m": 0.0,
            "walkability_score": 72.0,
            "repeated_mapped_network_edge_share": 0.0,
            "matched_osm_network_share": 0.95,
            "mapped_edge_ids": ["edge-1"],
            "mapped_edge_lengths_m": {"edge-1": 100.0},
        },
        "access_connections": {"all_stops_connected": True, "max_stop_snap_m": 2.0},
        "running_fitness": {"score": 70.0},
        "crossings": {"crossing_score": 75.0},
        "turns": {"u_turn_count_estimate": 0, "sharp_turn_count_estimate": 0},
    }


class CommonCandidatePoolTests(unittest.TestCase):
    def test_phase6_cache_is_merged_read_only_with_active_cache_precedence(self) -> None:
        active_route = {"route_id": "same-low", "profile": "foot-walking", "stops": []}
        experiment_route = {"route_id": "same-any", "profile": "foot-walking", "stops": []}
        other_route = {"route_id": "other-any", "profile": "foot-walking", "stops": []}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache_path = root / "analysis/experiments/phase6_retry/outputs/cache/ors_routes.json"
            cache_path.parent.mkdir(parents=True)
            cache_path.write_text(json.dumps({"same": experiment_route, "other": other_route}), encoding="utf-8")
            lookup, sources, diagnostics = _load_shared_route_cache(root, {"same": active_route})
            self.assertIs(lookup["same"], active_route)
            self.assertEqual(lookup["other"], other_route)
            self.assertGreaterEqual(diagnostics["duplicate_coordinate_keys"], 1)
            self.assertIn("phase6_retry", sources["same"][0])
            self.assertTrue(cache_path.exists())

    def test_geometry_dedup_collapses_alias_route_ids_and_preserves_origins(self) -> None:
        route = {"route_id": "found-low", "geometry": {"coordinates": [[127.0, 37.6], [127.01, 37.61]]}}
        alias = {"route_id": "found-any", "geometry": {"coordinates": [[127.0, 37.6], [127.01, 37.61]]}}
        result = _dedupe_route_candidates_by_geometry([
            {"route": route, "start": {"id": "a", "accessibility_score": 0.5},
             "candidate_source_modes": ["low"]},
            {"route": alias, "start": {"id": "b", "accessibility_score": 0.9},
             "candidate_source_modes": ["any"]},
        ])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["start"]["id"], "b")
        self.assertEqual(result[0]["candidate_source_modes"], ["any", "low"])
        self.assertEqual(_route_geometry_signature(route), _route_geometry_signature(alias))

    def test_ors_response_requires_current_destination_distance_connectivity_and_access(self) -> None:
        destination = {"id": "destination", "name": "destination", "latitude": 37.6, "longitude": 127.02}
        route = {
            "route_id": "route-low", "profile": "foot-walking",
            "stops": [
                {"id": "start", "name": "start", "latitude": 37.6, "longitude": 127.0,
                 "access_type": "subway_entrance", "accessibility_score": 0.8},
                destination,
            ],
            "geometry": {"type": "LineString", "coordinates": [[127.0, 37.6, 10], [127.02, 37.6, 12]]},
            "summary": {"distance_m": 3000, "distance_km": 3.0, "duration_minutes": 36,
                        "ascent_m": 2, "descent_m": 0},
        }
        valid = _metric_stub()
        args = (route, destination, 3.0, 300.0, "any", True, {}, {}, {}, {}, {}, [], [], {}, 6.0, {})
        with patch("src.recommender.evaluate_route_geometry", return_value=valid):
            candidate, error = _cached_route_candidate(*args)
        self.assertIsNone(error)
        self.assertIsNotNone(candidate)
        self.assertTrue(candidate["geometry_metrics"]["access_connections"]["all_stops_connected"])
        self.assertTrue(candidate["route"]["route_id"].endswith("-any"))
        self.assertIsNotNone(candidate["slope"].get("elevation_data_quality"))

        restricted = _metric_stub()
        restricted["network"]["explicit_access_restricted_m"] = 1.0
        with patch("src.recommender.evaluate_route_geometry", return_value=restricted):
            candidate, error = _cached_route_candidate(*args)
        self.assertIsNone(candidate)
        self.assertEqual(error, "explicit_access_restriction")

        disconnected = _metric_stub()
        disconnected["access_connections"]["all_stops_connected"] = False
        with patch("src.recommender.evaluate_route_geometry", return_value=disconnected):
            candidate, error = _cached_route_candidate(*args)
        self.assertIsNone(candidate)
        self.assertEqual(error, "stop_connection_unverified")

    def test_wrong_profile_stale_destination_and_distance_are_not_promoted(self) -> None:
        destination = {"id": "d", "name": "D", "latitude": 37.6, "longitude": 127.02}
        start = {"id": "s", "name": "S", "latitude": 37.6, "longitude": 127.0}
        route = {"profile": "cycling-regular", "stops": [start, destination],
                 "geometry": {"coordinates": [[127.0, 37.6], [127.02, 37.6]]},
                 "summary": {"distance_m": 3000, "distance_km": 3, "duration_minutes": 30}}
        args = (route, destination, 3, 300, "low", True, {}, {}, {}, {}, {}, [], [], {}, 6, {})
        candidate, error = _cached_route_candidate(*args)
        self.assertIsNone(candidate)
        self.assertEqual(error, "not_foot_walking")

        walking = {**route, "profile": "foot-walking"}
        stale = {**walking, "stops": [start, {**destination, "longitude": 127.03}]}
        candidate, error = _cached_route_candidate(stale, *args[1:])
        self.assertIsNone(candidate)
        self.assertEqual(error, "stale_destination_coordinate")

        outside = {**walking, "summary": {"distance_m": 3401, "distance_km": 3.401, "duration_minutes": 30}}
        candidate, error = _cached_route_candidate(outside, *args[1:])
        self.assertIsNone(candidate)
        self.assertEqual(error, "outside_distance_tolerance")

    def test_saved_uiryeong_50456_km_low_candidate_can_be_reranked_for_any(self) -> None:
        cache_path = ROOT / "analysis/experiments/phase6_retry_20261101/outputs/cache/ors_routes.json"
        if not cache_path.exists():
            self.skipTest("phase6_retry cache fixture is not present")
        cache = json.loads(cache_path.read_text(encoding="utf-8-sig"))
        route = next(value for value in cache.values()
                     if value.get("profile") == "foot-walking"
                     and str(value.get("route_id", "")).endswith("uiryeong-low")
                     and abs(float((value.get("summary") or {}).get("distance_km", 0)) - 5.0456) < 0.002)
        destination = next(item for item in json.loads((ROOT / "data/destinations.json").read_text(encoding="utf-8-sig"))["destinations"]
                           if item["id"] == "uiryeong")
        defaults = json.loads((ROOT / "data/route_defaults.json").read_text(encoding="utf-8-sig"))
        fitness_config = json.loads((ROOT / "data/running_fitness.json").read_text(encoding="utf-8-sig"))
        with patch("src.recommender.evaluate_route_geometry", return_value=_metric_stub()):
            candidate, error = _cached_route_candidate(
                route, destination, 5.0, 300.0, "any", True, {}, {}, fitness_config, {}, {}, [], [], {},
                defaults["steep_grade_threshold_percent"], defaults["grade_assessment"], ["phase6_retry"],
            )
        self.assertIsNone(error)
        self.assertAlmostEqual(candidate["route"]["summary"]["distance_km"], 5.0456, places=3)
        self.assertTrue(candidate["route"]["route_id"].endswith("-any"))
        for mode in ("low", "any"):
            scored = _score_route_candidate(
                candidate, destination, 5.0, 300.0, 50.0, mode, True, defaults, fitness_config,
            )
            self.assertIsNotNone(scored["total_score"])

    def test_any_discovered_cached_route_can_be_revalidated_and_scored_as_low(self) -> None:
        cache_path = ROOT / "analysis/experiments/phase6_20261101/outputs/cache/ors_routes.json"
        if not cache_path.exists():
            self.skipTest("phase6 cache fixture is not present")
        cache = json.loads(cache_path.read_text(encoding="utf-8-sig"))
        destination = next(item for item in json.loads((ROOT / "data/destinations.json").read_text(encoding="utf-8-sig"))["destinations"]
                           if item["id"] == "simujang")
        route = next(value for value in cache.values()
                     if value.get("profile") == "foot-walking"
                     and str(value.get("route_id", "")).endswith("simujang-any")
                     and 2.7 <= float((value.get("summary") or {}).get("distance_km", 0)) <= 3.3
                     and value.get("stops")
                     and abs(float(value["stops"][-1]["latitude"]) - destination["latitude"]) < 0.000001
                     and abs(float(value["stops"][-1]["longitude"]) - destination["longitude"]) < 0.000001)
        defaults = json.loads((ROOT / "data/route_defaults.json").read_text(encoding="utf-8-sig"))
        fitness_config = json.loads((ROOT / "data/running_fitness.json").read_text(encoding="utf-8-sig"))
        with patch("src.recommender.evaluate_route_geometry", return_value=_metric_stub()):
            candidate, error = _cached_route_candidate(
                route, destination, 3.0, 300.0, "low", True, {}, {}, fitness_config, {}, {}, [], [], {},
                defaults["steep_grade_threshold_percent"], defaults["grade_assessment"], ["phase6"],
            )
        self.assertIsNone(error)
        self.assertEqual(candidate["candidate_source_modes"], ["any"])
        self.assertTrue(candidate["route"]["route_id"].endswith("-low"))
        scored = _score_route_candidate(
            candidate, destination, 3.0, 300.0, 50.0, "low", True, defaults, fitness_config,
        )
        self.assertIsNotNone(scored["total_score"])

    def test_simujang_10km_cache_pool_exposes_both_mode_origins_for_independent_scoring(self) -> None:
        cache_path = ROOT / "analysis/experiments/phase6_20261101/outputs/cache/ors_routes.json"
        if not cache_path.exists():
            self.skipTest("phase6 cache fixture is not present")
        cache = json.loads(cache_path.read_text(encoding="utf-8-sig"))
        matching = [route for route in cache.values()
                    if route.get("profile") == "foot-walking"
                    and str(route.get("route_id", "")).endswith("simujang-low")
                    and "2135082041" in str(route.get("route_id", ""))]
        self.assertTrue(matching)
        route = matching[0]
        self.assertAlmostEqual(route["summary"]["distance_km"], 9.9939, places=3)
        # The single geometry is allowed to remain best in both modes.
        candidate = {"route": route, "start": route["stops"][0], "distance_error_m": 6.1,
                     "ascent_m": route["summary"].get("ascent_m"), "slope": {"uphill_grade_metrics": {}},
                     "geometry_metrics": {"crossings": {"crossing_score": 70}, "network": _metric_stub()["network"],
                                          "running_fitness": _metric_stub()["running_fitness"],
                                          "turns": _metric_stub()["turns"]}}
        defaults = json.loads((ROOT / "data/route_defaults.json").read_text(encoding="utf-8-sig"))
        fitness_config = json.loads((ROOT / "data/running_fitness.json").read_text(encoding="utf-8-sig"))
        destination = next(item for item in json.loads((ROOT / "data/destinations.json").read_text(encoding="utf-8-sig"))["destinations"]
                           if item["id"] == "simujang")
        low = _score_route_candidate(candidate, destination, 10, 300, 50, "low", True, defaults, fitness_config)
        any_mode = _score_route_candidate(candidate, destination, 10, 300, 50, "any", True, defaults, fitness_config)
        self.assertIsNotNone(low["total_score"])
        self.assertIsNotNone(any_mode["total_score"])
        self.assertEqual(_route_geometry_signature(route), _route_geometry_signature(candidate["route"]))
        # A one-route pool is valid for both preferences; the selector doesn't force divergence.
        low_candidate = {**candidate, **low, "meets_gentle_thresholds": True}
        any_candidate = {**candidate, **any_mode, "meets_gentle_thresholds": True}
        low_best = sorted([low_candidate], key=lambda item: _route_rank_key(item, "low", True))[0]
        any_best = sorted([any_candidate], key=lambda item: _route_rank_key(item, "any", True))[0]
        self.assertEqual(_route_geometry_signature(low_best["route"]),
                         _route_geometry_signature(any_best["route"]))


if __name__ == "__main__":
    unittest.main()
