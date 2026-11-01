"""Offline tests for exporting saved routes to the run app data format."""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

from src.runtrip_export import _hill, _tone, build_runtrip_data, merge_into_run


ROOT = Path(__file__).resolve().parents[1]


class RuntripExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.courses, cls.spots = build_runtrip_data(ROOT)

    def test_shared_low_any_geometry_is_published_once(self) -> None:
        ids = [c["properties"]["id"] for c in self.courses]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(self.courses), 15)
        self.assertIn("simujang-10km-low-any", ids)

    def test_courses_match_run_app_schema(self) -> None:
        spot_ids = {s["id"] for s in self.spots}
        for course in self.courses:
            p = course["properties"]
            self.assertIn(p["hill"], {"flat", "mild", "hard"})
            self.assertIn(p["tone"], {"easy", "normal", "hard"})
            self.assertTrue(set(p["spots"]) <= spot_ids)
            self.assertNotIn("minutes", p)  # the run app derives running time from distance.
            coords = course["geometry"]["coordinates"]
            self.assertTrue(all(len(c) == 2 for c in coords))
            self.assertEqual(p["cues"][0]["at"], coords[0])
            self.assertTrue(all(c["text"]["ko"] and c["text"]["en"] for c in p["cues"]))
            # An en-US voice cannot read Hangul road names.
            self.assertFalse(any(re.search("[가-힣]", c["text"]["en"]) for c in p["cues"]))

    def test_spot_radius_covers_every_route_end(self) -> None:
        from src.navigation_data import _distance_m
        spots = {s["id"]: s for s in self.spots}
        for course in self.courses:
            spot = spots[course["properties"]["spots"][0]]
            end = course["geometry"]["coordinates"][-1]
            self.assertLessEqual(_distance_m([spot["lng"], spot["lat"]], end), spot["radius_m"])

    def test_merge_keeps_existing_items_and_is_repeatable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            sample_course = {"type": "Feature", "properties": {"id": "stream-loop"},
                             "geometry": {"type": "LineString", "coordinates": [[127.0, 37.5], [127.1, 37.6]]}}
            (data_dir / "courses.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [sample_course]}), encoding="utf-8")
            (data_dir / "spots.json").write_text(json.dumps({"_설명": "keep", "spots": [{"id": "gilsangsa"}]}), encoding="utf-8")
            merge_into_run(data_dir, self.courses, self.spots)
            counts = merge_into_run(data_dir, self.courses, self.spots)
            self.assertEqual(counts, {"courses_kept": 1, "courses_added": 15, "spots_kept": 1, "spots_added": 3})
            spots_doc = json.loads((data_dir / "spots.json").read_text(encoding="utf-8"))
            self.assertEqual(spots_doc["_설명"], "keep")
            self.assertEqual(spots_doc["spots"][0]["id"], "gilsangsa")

    def test_hill_and_tone_thresholds(self) -> None:
        self.assertEqual(_hill(38, 3.0), "flat")
        self.assertEqual(_hill(60, 3.0), "mild")
        self.assertEqual(_hill(127, 3.0), "hard")
        self.assertEqual(_tone("flat", 3.0), "easy")
        self.assertEqual(_tone("flat", 10.0), "hard")


if __name__ == "__main__":
    unittest.main()
