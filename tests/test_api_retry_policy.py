import json
import unittest
from unittest.mock import patch

import requests

from src.osm_data import OSMDataError, OVERPASS_FALLBACK_URLS, OVERPASS_URL, _post_overpass_query
from src import routing
from src.routing import RouteError, fetch_walking_route_points


def response(status: int, headers=None, payload=None):
    item = requests.Response()
    item.status_code = status
    item.headers.update(headers or {})
    item.url = "https://example.invalid/test"
    item._content = json.dumps(payload or {}).encode("utf-8")
    return item


class ApiRetryPolicyTests(unittest.TestCase):
    def setUp(self):
        routing._last_ors_request_monotonic = None
        self.stops = [
            {"id": "a", "latitude": 37.59, "longitude": 126.99},
            {"id": "b", "latitude": 37.60, "longitude": 127.00},
        ]

    @patch("src.routing.time.sleep")
    @patch("src.routing.requests.post")
    def test_429_retries_once_only_after_retry_after(self, post, sleep):
        post.side_effect = [response(429, {"Retry-After": "2"}), response(429, {"Retry-After": "60"})]
        with self.assertRaises(RouteError) as raised:
            fetch_walking_route_points(self.stops, "not-printed", "route", max_retries=1)
        self.assertEqual(post.call_count, 2)
        delays = [call.args[0] for call in sleep.call_args_list]
        self.assertIn(2.0, delays)
        self.assertTrue(all(delay <= 2.0 for delay in delays))
        self.assertEqual(raised.exception.error_category, "rate_limit")
        self.assertEqual(raised.exception.http_status, 429)
        self.assertEqual(raised.exception.retry_after_seconds, 60.0)

    @patch("src.routing.requests.post")
    def test_429_without_retry_after_is_not_retried(self, post):
        post.return_value = response(429)
        with self.assertRaises(RouteError) as raised:
            fetch_walking_route_points(self.stops, "not-printed", "route", max_retries=1)
        self.assertEqual(post.call_count, 1)
        self.assertEqual(raised.exception.error_category, "rate_limit")
        self.assertIsNone(raised.exception.retry_after_seconds)

    @patch("src.routing.requests.post")
    def test_authentication_error_is_not_retried(self, post):
        post.return_value = response(401)
        with self.assertRaises(RouteError) as raised:
            fetch_walking_route_points(self.stops, "not-printed", "route", max_retries=1)
        self.assertEqual(post.call_count, 1)
        self.assertEqual(raised.exception.error_category, "authentication")

    @patch("src.routing.time.sleep")
    @patch("src.routing.requests.post")
    def test_5xx_gets_one_exponential_backoff_retry(self, post, sleep):
        post.side_effect = [response(503), response(503)]
        with self.assertRaises(RouteError) as raised:
            fetch_walking_route_points(self.stops, "not-printed", "route", max_retries=1)
        self.assertEqual(post.call_count, 2)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1.0, 1.0])
        self.assertEqual(raised.exception.error_category, "server_error")

    @patch("src.osm_data.requests.post")
    def test_overpass_uses_one_fallback_after_primary_5xx(self, post):
        post.side_effect = [response(503), response(200, payload={"elements": []})]
        result, endpoint, attempts = _post_overpass_query("[out:json];out;", timeout_s=1)
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args_list[0].args[0], OVERPASS_URL)
        self.assertEqual(post.call_args_list[1].args[0], OVERPASS_FALLBACK_URLS[0])
        self.assertEqual(endpoint, OVERPASS_FALLBACK_URLS[0])
        self.assertEqual(attempts, 2)
        self.assertEqual(result.status_code, 200)

    @patch("src.osm_data.requests.post")
    def test_overpass_429_does_not_rotate_endpoints(self, post):
        post.return_value = response(429, {"Retry-After": "30"})
        with self.assertRaises(OSMDataError) as raised:
            _post_overpass_query("[out:json];out;", timeout_s=1)
        self.assertEqual(post.call_count, 1)
        self.assertEqual(raised.exception.error_category, "rate_limit")


if __name__ == "__main__":
    unittest.main()
