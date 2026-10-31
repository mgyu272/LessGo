"""Offline tests for running-fitness component mapping and normalization."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from src.running_metrics import _FITNESS_COMPONENT_SOURCES, _weighted_fitness_score


class RunningFitnessScoringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[1]
        self.config = json.loads((self.root / "data" / "running_fitness.json").read_text(encoding="utf-8"))
        self.weights = self.config["score_components"]
        self.values = {
            "running_friendly_share": 50.0,
            "vehicle_separation_proxy_share": 50.0,
            "continuous_running_estimate_score": 50.0,
            "surface_width_quality_score": 50.0,
            "naturalness_score": 50.0,
        }

    def test_config_weights_are_mapped_to_all_five_real_metrics(self) -> None:
        self.assertEqual(set(self.weights), set(_FITNESS_COMPONENT_SOURCES))
        self.assertEqual(self.config["score_component_sources"], _FITNESS_COMPONENT_SOURCES)
        self.assertEqual(self.config["score_component_value_range"], [0, 100])
        self.assertEqual(self.config["missing_score_component_policy"], "renormalize_available")
        self.assertAlmostEqual(sum(self.weights.values()), 1.0)
        for config_name, source_name in _FITNESS_COMPONENT_SOURCES.items():
            with self.subTest(component=config_name):
                baseline, _, _ = _weighted_fitness_score(self.values, self.weights, _FITNESS_COMPONENT_SOURCES)
                changed_values = dict(self.values)
                changed_values[source_name] = 100.0
                changed, details, _ = _weighted_fitness_score(changed_values, self.weights, _FITNESS_COMPONENT_SOURCES)
                self.assertGreater(changed, baseline)
                self.assertTrue(details[config_name]["included"])
                self.assertEqual(details[config_name]["scale"], "0_to_100")

    def test_missing_metric_is_not_imputed_and_remaining_weights_renormalize(self) -> None:
        values = dict(self.values)
        values["running_friendly_share"] = None
        score, details, weight_sum = _weighted_fitness_score(values, self.weights, _FITNESS_COMPONENT_SOURCES)
        self.assertAlmostEqual(score, 50.0)
        self.assertAlmostEqual(weight_sum, 0.55)
        self.assertFalse(details["mapped_running_friendly_share"]["included"])
        self.assertEqual(details["mapped_running_friendly_share"]["reason"], "missing_or_non_numeric")
        self.assertEqual(details["vehicle_separation_proxy_share"]["normalized_weight"], round(0.20 / 0.55, 6))

    def test_out_of_range_and_non_finite_values_are_excluded(self) -> None:
        for invalid in (-0.01, 100.01, float("nan"), float("inf"), "not-a-score"):
            with self.subTest(value=invalid):
                values = dict(self.values)
                values["naturalness_score"] = invalid
                score, details, weight_sum = _weighted_fitness_score(values, self.weights, _FITNESS_COMPONENT_SOURCES)
                self.assertEqual(score, 50.0)
                self.assertAlmostEqual(weight_sum, 0.95)
                self.assertFalse(details["naturalness"]["included"])
                expected_reason = "missing_or_non_numeric" if isinstance(invalid, str) else "non_finite_or_out_of_range"
                self.assertEqual(details["naturalness"]["reason"], expected_reason)

    def test_all_missing_returns_no_score_instead_of_a_fabricated_zero(self) -> None:
        score, details, weight_sum = _weighted_fitness_score({}, self.weights, _FITNESS_COMPONENT_SOURCES)
        self.assertIsNone(score)
        self.assertEqual(weight_sum, 0)
        self.assertTrue(all(not item["included"] for item in details.values()))

    def test_invalid_configured_weight_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            _weighted_fitness_score(self.values, {"naturalness": -0.1}, _FITNESS_COMPONENT_SOURCES)


if __name__ == "__main__":
    unittest.main()
