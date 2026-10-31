"""Serve the rank-1 ORS route over Kakao Maps on a local-only web server."""

from __future__ import annotations

import json
import html
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from dotenv import load_dotenv
from src.navigation_data import load_navigation_route


ROOT = Path(__file__).resolve().parent
RECOMMENDATIONS_DIR = ROOT / "outputs" / "recommendations"
TEMPLATE_PATH = ROOT / "web" / "kakao_route_map.html"
NAVIGATION_SCRIPT_PATH = ROOT / "web" / "english_voice_navigation.js"
HOST = "127.0.0.1"
PORT = 8000
SUPPORTED_DISTANCES_KM = {3, 5, 10}
REPRESENTATIVE_ROUTES_PATH = ROOT / "outputs" / "app" / "representative_routes.json"
FINAL_ROUTES_PATH = ROOT / "analysis" / "experiments" / "final_routes_20261101" / "outputs" / "app" / "representative_routes.json"


def representative_index_path(dataset: str = "app") -> Path:
    """Resolve only the built-in app index or the reviewed final experiment index."""
    if dataset == "app":
        return REPRESENTATIVE_ROUTES_PATH
    if dataset == "final_routes":
        return FINAL_ROUTES_PATH
    raise ValueError("dataset must be 'app' or 'final_routes'")


class NoRouteError(FileNotFoundError):
    """A valid, explicit no-route result rather than a missing server file."""


def get_representative_entry(destination_id: str, target_distance_km: int, slope_preference: str, dataset: str = "app") -> dict | None:
    """Read an app-facing route/status entry when one has been prepared."""
    index_path = representative_index_path(dataset)
    if not index_path.exists():
        return None
    data = json.loads(index_path.read_text(encoding="utf-8"))
    distance = data.get("destinations", {}).get(destination_id, {}).get(f"{target_distance_km}km", {})
    return distance.get("modes", {}).get(slope_preference)


def get_representative_comparison(destination_id: str, target_distance_km: int, dataset: str = "app") -> dict | None:
    """Read the stored low-vs-any edge overlap for an app-facing representative route."""
    index_path = representative_index_path(dataset)
    if not index_path.exists():
        return None
    data = json.loads(index_path.read_text(encoding="utf-8"))
    distance = data.get("destinations", {}).get(destination_id, {}).get(f"{target_distance_km}km", {})
    representative = distance.get("representative", {})
    fraction = representative.get("shared_route_fraction_between_modes")
    if fraction is None:
        return None
    return {"shared_fraction_of_shorter_mapped_route": fraction,
            "method": "offline shared OSM mapped-edge length; see representative_routes.json"}


def get_rank_one_files(
    target_distance_km: int = 3, slope_preference: str = "low", strategy: str = "baseline",
    destination_id: str = "simujang", dataset: str = "app",
) -> tuple[Path, Path, Path]:
    if target_distance_km not in SUPPORTED_DISTANCES_KM:
        raise ValueError("distance must be 3, 5, or 10")
    if slope_preference not in {"low", "any"}:
        raise ValueError("slope query must be 'low' or 'any'")
    target_label = f"{target_distance_km}km"
    if strategy not in {"baseline", "running_focused", "access_focused"}:
        raise ValueError("strategy must be 'baseline', 'running_focused', or 'access_focused'")
    destinations = json.loads((ROOT / "data" / "destinations.json").read_text(encoding="utf-8")).get("destinations", [])
    destination = next((item for item in destinations if item.get("id") == destination_id), None)
    if destination is None:
        raise ValueError("unknown destination")
    index_path = representative_index_path(dataset)
    representative = get_representative_entry(destination_id, target_distance_km, slope_preference, dataset)
    if representative is not None and strategy in {"running_focused", "access_focused"}:
        if representative.get("status") == "no_route" or not representative.get("files", {}).get("json"):
            raise NoRouteError(representative.get("message") or "경로 없음 · 이 거리 조건을 만족하는 경로가 없습니다.")
        route_json = (ROOT / representative["files"]["json"]).resolve()
        route_geojson = (ROOT / representative["files"]["geojson"]).resolve()
        route_json.relative_to(ROOT)
        route_geojson.relative_to(ROOT)
        summary_path = index_path.resolve()
        return summary_path, route_json, route_geojson
    destination_dir = RECOMMENDATIONS_DIR / destination_id
    results_dir = (destination_dir / strategy / target_label if strategy in {"running_focused", "access_focused"}
                   else destination_dir / target_label)
    summary_path = results_dir / f"recommendations-{target_label}-{slope_preference}.json"
    if not summary_path.exists():
        raise FileNotFoundError(
            f"{destination['name']} {target_label} {slope_preference} 추천 결과가 없습니다. 해당 거리·경사 모드를 먼저 실행하세요."
        )
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary_destination = summary.get("destination", {})
    if summary_destination.get("latitude") is None or summary_destination.get("longitude") is None:
        raise ValueError(f"{destination['name']} 결과에 목적지 좌표가 없어 최신성 검증이 불가능합니다.")
    coordinate_delta = max(
        abs(float(summary_destination["latitude"]) - float(destination["latitude"])),
        abs(float(summary_destination["longitude"]) - float(destination["longitude"])),
    )
    if coordinate_delta > 1e-7:
        raise ValueError(
            f"{destination['name']} 목적지 좌표가 변경되어 이 결과는 이전 좌표 기준입니다. 새 좌표로 코스를 다시 계산하세요."
        )
    if strategy in {"running_focused", "access_focused"}:
        restriction_check = summary.get("search", {}).get("restricted_area_filter", {})
        if not restriction_check.get("enabled"):
            raise ValueError(
                f"{destination['name']} {target_label} 결과는 학교·궁궐 회피 검증 전 결과입니다. 새 기준으로 다시 계산하세요."
            )
    recommendations = summary.get("recommendations") or []
    if not recommendations:
        search = summary.get("search") or {}
        rejected = (search.get("restricted_area_filter") or {}).get("rejected_ors_routes_by_area") or {}
        if rejected:
            areas = ", ".join(list(rejected.keys())[:3])
            detail = f"ORS 후보 {sum(rejected.values())}개가 OSM상 출입이 어려운 구역({areas}) 통과로 제외됐습니다."
        else:
            detail = search.get("route_failure_reason") or "거리 허용 범위 ±100m의 ORS 보행 경로 후보가 없습니다."
        raise ValueError(
            f"{destination['name']} {target_label} {slope_preference}: 표시할 검증 경로가 없습니다. {detail}"
        )
    recommendation = next((item for item in recommendations if item.get("rank") == 1), None)
    if recommendation is None:
        raise ValueError("추천 결과 JSON에서 1순위 경로를 찾지 못했습니다.")
    route_json = (ROOT / recommendation["files"]["json"]).resolve()
    route_geojson = (ROOT / recommendation["files"]["geojson"]).resolve()
    route_json.relative_to(ROOT)
    route_geojson.relative_to(ROOT)
    return summary_path.resolve(), route_json, route_geojson


class KakaoRouteHandler(BaseHTTPRequestHandler):
    server_version = "LessGOMap/1.0"

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API name
        parsed_url = urlsplit(self.path)
        route_path = parsed_url.path
        query = parse_qs(parsed_url.query)
        slope_preference = query.get("slope", ["compare"])[0]
        strategy = query.get("strategy", ["baseline"])[0]
        destination_id = query.get("destination", ["simujang"])[0]
        dataset = query.get("dataset", ["app"])[0]
        try:
            target_distance_km = int(query.get("distance", ["3"])[0])
        except ValueError:
            target_distance_km = 0
        try:
            if route_path == "/english_voice_navigation.js":
                self._send(200, NAVIGATION_SCRIPT_PATH.read_bytes(), "application/javascript; charset=utf-8")
                return
            if route_path in {"/", "/index.html"}:
                template = TEMPLATE_PATH.read_text(encoding="utf-8")
                kakao_key = os.getenv("KAKAO_JS_KEY", "").strip()
                key_value = json.dumps(kakao_key) if kakao_key else "null"
                page = template.replace("__KAKAO_JS_KEY_JSON__", key_value)
                page = page.replace("__DATASET_JSON__", json.dumps(dataset if dataset in {"app", "final_routes"} else "app"))
                destinations = json.loads((ROOT / "data" / "destinations.json").read_text(encoding="utf-8")).get("destinations", [])
                destination_ids = {item["id"] for item in destinations}
                initial_destination_id = destination_id if destination_id in destination_ids else destinations[0]["id"]
                options = "".join(
                    f'<option value="{html.escape(item["id"], quote=True)}">{html.escape(item["name"])}</option>'
                    for item in destinations
                )
                page = page.replace("__DESTINATION_OPTIONS__", options)
                page = page.replace("__DESTINATION_ID_JSON__", json.dumps(initial_destination_id))
                self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")
                return
            if route_path == "/route.json" or route_path == "/route.geojson":
                summary_path, route_json, route_geojson = get_rank_one_files(
                    target_distance_km, slope_preference, strategy, destination_id, dataset
                )
                if route_path == "/route.json":
                    route_data = json.loads(route_json.read_text(encoding="utf-8"))
                    route_data["requested_slope_preference"] = slope_preference
                    representative = get_representative_entry(destination_id, target_distance_km, slope_preference, dataset)
                    if representative is not None:
                        route_data["validation_status"] = representative.get("status", "needs_verification")
                        route_data["validation_notes"] = representative.get("notes", [])
                        route_data["distance_error_m"] = representative.get("distance_error_m")
                        if representative.get("start", {}).get("station_access"):
                            route_data.setdefault("start", {})["station_access"] = representative["start"]["station_access"]
                    comparison = get_representative_comparison(destination_id, target_distance_km, dataset)
                    if comparison is not None:
                        route_data["cross_preference_comparison"] = comparison
                    overlap_path = summary_path.parent / "preference-route-overlap.json"
                    if overlap_path.exists():
                        overlap = json.loads(overlap_path.read_text(encoding="utf-8"))
                        shared_fraction = overlap.get("shared_fraction_of_shorter_mapped_route")
                        if shared_fraction is not None:
                            route_data["cross_preference_comparison"] = {
                                "shared_fraction_of_shorter_mapped_route": shared_fraction,
                                "shared_mapped_length_m": overlap.get("shared_mapped_length_m"),
                                "method": overlap.get("method"),
                                "coverage_note": overlap.get("coverage_note"),
                            }
                    body = json.dumps(route_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                    self._send(200, body, "application/json; charset=utf-8")
                    return
                geojson_data = json.loads(route_geojson.read_text(encoding="utf-8"))
                representative = get_representative_entry(destination_id, target_distance_km, slope_preference, dataset)
                if representative is not None:
                    for feature in geojson_data.get("features", []):
                        feature.setdefault("properties", {})["validation_status"] = representative.get("status", "needs_verification")
                        feature["properties"]["validation_notes"] = representative.get("notes", [])
                        if representative.get("start", {}).get("station_access"):
                            feature.setdefault("properties", {}).setdefault("start", {})["station_access"] = representative["start"]["station_access"]
                self._send(200, json.dumps(geojson_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), "application/geo+json; charset=utf-8")
                return
            if route_path == "/route-summary.json":
                summary_path, _, _ = get_rank_one_files(
                    target_distance_km, slope_preference, strategy, destination_id, dataset
                )
                self._send(200, summary_path.read_bytes(), "application/json; charset=utf-8")
                return
            if route_path == "/navigation-route.json":
                selected_destination = query.get("destination_id", query.get("destination", [""]))[0]
                route_id = query.get("route_id", [""])[0]
                if not selected_destination or not route_id:
                    self._send(400, b"destination_id and route_id are required", "text/plain; charset=utf-8")
                    return
                selected_dataset = query.get("dataset", [dataset])[0]
                payload = load_navigation_route(ROOT, selected_destination, route_id, representative_index_path(selected_dataset))
                body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return
            self._send(404, b"Not found", "text/plain; charset=utf-8")
        except NoRouteError as exc:
            self._send(404, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
        except FileNotFoundError as exc:
            self._send(404, str(exc).encode("utf-8", errors="replace"), "text/plain; charset=utf-8")
        except (OSError, ValueError, KeyError) as exc:
            self._send(500, str(exc).encode("utf-8", errors="replace"), "text/plain; charset=utf-8")

    def log_message(self, format: str, *args: object) -> None:
        # Do not log request query strings or any environment settings.
        print(f"{self.address_string()} {self.command} {urlsplit(self.path).path}")


def main() -> None:
    load_dotenv(ROOT / ".env")
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"지도 템플릿을 찾을 수 없습니다: {TEMPLATE_PATH}")
    get_rank_one_files(3, "low", "running_focused", "simujang")
    with ThreadingHTTPServer((HOST, PORT), KakaoRouteHandler) as server:
        print(f"Less GO Kakao route map: http://localhost:{PORT}")
        print("종료하려면 Ctrl+C를 누르세요.")
        server.serve_forever()


if __name__ == "__main__":
    main()
