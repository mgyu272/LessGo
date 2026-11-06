"""성북구 외곽과 동 경계를 받아 app/public/data/seongbuk-boundary.geojson 으로 저장합니다.

출처: 통계청 행정구역 경계 (github.com/southkorea/seoul-maps, kostat/2013)
실행: python scripts/build_seongbuk_boundary.py
"""
import json
from pathlib import Path
from urllib.request import Request, urlopen

BASE = "https://raw.githubusercontent.com/southkorea/seoul-maps/master/kostat/2013/json/"
DISTRICT_URL = BASE + "seoul_municipalities_geo_simple.json"
DONG_URL = BASE + "seoul_submunicipalities_geo_simple.json"
SEONGBUK = "11080"
OUT = Path(__file__).resolve().parent.parent / "app" / "public" / "data" / "seongbuk-boundary.geojson"


def fetch(url):
    request = Request(url, headers={"User-Agent": "LessGo-boundary-build/1.0"})
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def feature(source, kind):
    props = source["properties"]
    return {
        "type": "Feature",
        "properties": {"kind": kind, "code": str(props["code"]), "name": props["name"]},
        "geometry": source["geometry"],
    }


def main():
    districts = [f for f in fetch(DISTRICT_URL)["features"] if str(f["properties"]["code"]) == SEONGBUK]
    dongs = [f for f in fetch(DONG_URL)["features"] if str(f["properties"]["code"]).startswith(SEONGBUK)]
    if len(districts) != 1:
        raise SystemExit(f"성북구 외곽을 찾지 못했어요: {len(districts)}개")
    if not dongs:
        raise SystemExit("성북구 동 경계를 찾지 못했어요")
    collection = {
        "type": "FeatureCollection",
        "source": "통계청 행정구역 경계 (southkorea/seoul-maps, kostat/2013)",
        "features": [feature(districts[0], "district")] + [feature(f, "dong") for f in dongs],
    }
    OUT.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.name}: district 1, dong {len(dongs)}")


if __name__ == "__main__":
    main()
