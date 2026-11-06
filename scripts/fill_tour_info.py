"""Fill missing visit fields from Korea Tourism Organization's KorService2."""
import hashlib
import json
import math
import re
import sys
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from html import unescape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "app/public/data/explore.json"
CACHE = ROOT / "outputs/tour_cache"
SERVICE = "https://apis.data.go.kr/B551011/KorService2/"
FIELDS = ("open_days", "hours", "fee")


def read_key():
    env = (ROOT / "app/.env.local").read_text(encoding="utf-8-sig")
    match = re.search(r"(?m)^\s*(?:export\s+)?TOUR_API_KEY\s*=\s*(.*)$", env)
    key = unquote(match[1].strip().strip("\"'")) if match else ""
    if not key:
        raise SystemExit("Set TOUR_API_KEY in app/.env.local.")
    return key


def page(key, endpoint, **params):
    query = urlencode(sorted(dict(MobileOS="ETC", MobileApp="LessGo", _type="json", **params).items()))
    cache = CACHE / (endpoint + "-" + hashlib.sha256(query.encode()).hexdigest() + ".json")
    if cache.exists():
        raw = cache.read_bytes()
    else:
        url = SERVICE + endpoint + "?" + query + "&" + urlencode({"serviceKey": key})
        try:
            with urlopen(url, timeout=30) as response:
                raw = response.read()
        except HTTPError as exc:
            raise SystemExit(f"{endpoint}: HTTP {exc.code}") from None
        except (URLError, TimeoutError):
            raise SystemExit(f"{endpoint}: network failure") from None
    try:
        response = json.loads(raw)["response"]
        code = response["header"]["resultCode"]
        if str(code) not in {"0000", "00"}:
            raise SystemExit(f"{endpoint}: API error {code}")
        body = response["body"]
        items = (body.get("items") or {}).get("item", [])
    except (ValueError, KeyError, AttributeError, TypeError):
        raise SystemExit(f"{endpoint}: unexpected response") from None
    if not cache.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(raw)
    return ([items] if isinstance(items, dict) else items), int(body["totalCount"])


def items(key, endpoint, **params):
    result = []
    for number in range(1, 1001):
        batch, total = page(key, endpoint, pageNo=number, numOfRows=100, **params)
        result.extend(batch)
        if len(result) >= total:
            return result
        if not batch:
            break
    raise SystemExit(f"{endpoint}: incomplete result")


def norm(text):
    return re.sub(r"[^가-힣a-z0-9]", "", text.lower())


def distance(place, row):
    coords = (place.get("lat"), place.get("lng"), row.get("mapy"), row.get("mapx"))
    if any(v in (None, "") for v in coords):
        return math.inf
    lat1, lon1, lat2, lon2 = [math.radians(float(v)) for v in coords]
    a = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12710000 * math.asin(math.sqrt(min(1, a)))


def match_place(key, place):
    name = place["name"]["ko"]
    rows = items(key, "searchKeyword2", keyword=name)
    compact = "".join(name.split())
    if not rows and compact != name:
        rows = items(key, "searchKeyword2", keyword=compact)
    if place["lat"] is not None and place["lng"] is not None:
        rows += items(key, "locationBasedList2", mapX=place["lng"], mapY=place["lat"], radius=300)
    near, review = [], []
    target = norm(name)
    for row in {str(r["contentid"]): r for r in rows}.values():
        title = row["title"]
        base = norm(re.sub(r"\([^()]*\)|\[[^\[\]]*\]", "", title))
        exact = target in (base, norm(title))
        related = exact or target in norm(title) or SequenceMatcher(None, target, base).ratio() >= 0.8
        if not related:
            continue
        meters = distance(place, row)
        note = f"{title} ({round(meters)}m)" if math.isfinite(meters) else f"{title} (거리 미확인)"
        if exact and meters <= 200:
            near.append(row)
        if meters <= 300 or not math.isfinite(meters) or exact:
            review.append(note)
    if len(near) == 1 and len(review) == 1:
        return near[0], None
    if review or place["lat"] is None or place["lng"] is None:
        return None, "확인 필요: " + (", ".join(review) or "기준 좌표 없음")
    return None, "검색 일치 없음"


def clean(value):
    text = unescape(str(value or ""))
    text = re.sub(r"<br\s*/?>|</p>", " / ", text, flags=re.I)
    return " ".join(re.sub("<[^>]+>", " ", text).split()).strip(" /")


def visit_fields(key, row):
    params = dict(contentId=row["contentid"], contentTypeId=row["contenttypeid"])
    intro = items(key, "detailIntro2", **params)
    info = intro[0] if intro else {}
    kind = str(row["contenttypeid"])
    if kind == "12":
        days, hours, fee = info.get("restdate"), info.get("usetime"), None
    elif kind == "14":
        days, hours, fee = info.get("restdateculture"), info.get("usetimeculture"), info.get("usefee")
    else:
        return {}
    if not clean(fee):
        charges = [clean(x.get("infotext")) for x in items(key, "detailInfo2", **params)
                   if clean(x.get("infoname")) in {"입장료", "관람료", "이용요금"}]
        fee = " / ".join(dict.fromkeys(filter(None, charges)))
    days = clean(days)
    return dict(open_days="쉬는 날: " + days if days else "", hours=clean(hours), fee=clean(fee))


def main():
    key = read_key()
    data = json.loads(DATA.read_text(encoding="utf-8"))
    stamp = datetime.now(timezone(timedelta(hours=9))).date()
    changed = False
    for place in data["places"]:
        missing = [k for k in FIELDS if place[k] is None]
        if not missing:
            continue
        name = place["name"]["ko"]
        row, reason = match_place(key, place)
        if row is None:
            print(name, reason)
            continue
        fields = visit_fields(key, row)
        updates = {k: fields[k] for k in missing if fields.get(k)}
        print(name, row["title"], row["contentid"], round(distance(place, row)), updates or "대상 필드 미제공")
        if updates:
            place.update(updates)
            source = f"{stamp} 한국관광공사 TourAPI (contentid: {row['contentid']})"
            if source not in place["source"]:
                place["source"].append(source)
            changed = True
    if changed:
        temp = DATA.with_suffix(".json.tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        temp.replace(DATA)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
