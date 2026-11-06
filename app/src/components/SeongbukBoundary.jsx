// 홈 지도의 성북구 경계: 바깥을 흐리게 덮고 외곽선·동 경계를 그려요. 지도 범위도 여기서 맡아요.
// - 처음 열 때 성북구가 보이는 칸에 꽉 차게 맞추고, 그보다 1단계 멀리까지만 축소돼요.
// - 끌어서 많이 벗어나면 멈춘 뒤 되돌아와요. 성북구 바운드를 사방 1km 넓힌 곳까지는 그대로 둬요.
// - extra(): 되돌리지 않고 허용할 지점 [lat, lng] 목록 (성북구 밖의 내 위치, 고른 장소)
// - 경계 파일을 못 불러오면 도형 없이 예전처럼 핀 전체에 맞춰요.
// 경계 데이터는 scripts/build_seongbuk_boundary.py 로 만들어요.

import { useEffect, useRef, useState } from "react";
import { useMap } from "react-kakao-maps-sdk";
import { FitSpots } from "./MapView.jsx";

const URL = "/data/seongbuk-boundary.geojson";
const MARGIN_LAT = 1 / 111; // 약 1km
const MARGIN_LNG = 1 / 88;
const NO_LIMIT = 14;
const SETTLE = 0.0005; // 이 정도(약 50m) 차이는 되돌리지 않아요
// 바깥 막: 어디로 끌어도 덮이도록 우리나라 전체보다 넓게
const MASK = [[32, 123], [32, 133], [40, 133], [40, 123]];

let loading = null;
const loadBoundary = () => {
  loading ??= fetch(URL).then((res) => {
    if (!res.ok) throw new Error(`boundary ${res.status}`);
    return res.json();
  }).catch((e) => { loading = null; throw e; });
  return loading;
};

const outerRings = (geometry) => (geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((poly) => poly[0]));

export default function SeongbukBoundary({ spots, safe, refitKey = 0, keepView = false, extra }) {
  const map = useMap();
  const [geo, setGeo] = useState(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({});
  latest.current = { safe, extra, keepView };

  useEffect(() => {
    let alive = true;
    loadBoundary().then((g) => { if (alive) setGeo(g); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const district = geo?.features.find((f) => f.properties.kind === "district");
  const box = useRef(null);

  // 그리는 순서: 바깥 막 → 동 경계 → 외곽선 (핀과 코스 선은 그 위)
  useEffect(() => {
    if (!district) return;
    const { kakao } = window;
    const toPath = (ring) => ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
    const rings = outerRings(district.geometry);
    const points = rings.flat();
    box.current = {
      south: Math.min(...points.map((p) => p[1])), north: Math.max(...points.map((p) => p[1])),
      west: Math.min(...points.map((p) => p[0])), east: Math.max(...points.map((p) => p[0])),
    };
    const shapes = [new kakao.maps.Polygon({
      map, zIndex: 1, path: [MASK.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng)), ...rings.map(toPath)],
      fillColor: "#EEF1EA", fillOpacity: 0.55, strokeWeight: 0, strokeOpacity: 0,
    })];
    geo.features.filter((f) => f.properties.kind === "dong").forEach((f) => outerRings(f.geometry).forEach((ring) => {
      shapes.push(new kakao.maps.Polyline({ map, zIndex: 2, path: toPath(ring), strokeColor: "#C9DABB", strokeWeight: 1, strokeOpacity: 0.8 }));
    }));
    rings.forEach((ring) => {
      shapes.push(new kakao.maps.Polyline({ map, zIndex: 3, path: toPath(ring), strokeColor: "#2E6B1C", strokeWeight: 9, strokeOpacity: 0.15 }));
      shapes.push(new kakao.maps.Polyline({ map, zIndex: 4, path: toPath(ring), strokeColor: "#2E6B1C", strokeWeight: 3, strokeOpacity: 1 }));
    });
    return () => shapes.forEach((shape) => shape.setMap(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geo]);

  // 성북구를 보이는 칸(위 검색·칩 아래 ~ 아래 시트 위)에 꽉 차게. 그 단계 + 1까지만 축소돼요
  useEffect(() => {
    if (!district || !box.current) return;
    let alive = true;
    const fit = () => {
      const { kakao } = window;
      const el = map.getNode();
      const W = el.offsetWidth, H = el.offsetHeight;
      if (!W || !H) return;
      const area = latest.current.safe();
      let top = area.top, bottom = H - area.bottom;
      if (H - top - bottom < 60) { top = Math.min(top, 24); bottom = Math.min(bottom, 24); } // 칸이 너무 좁으면 여백을 포기해요
      const { south, north, west, east } = box.current;
      const bounds = new kakao.maps.LatLngBounds(new kakao.maps.LatLng(south, west), new kakao.maps.LatLng(north, east));
      const keep = latest.current.keepView ? { center: map.getCenter(), level: map.getLevel() } : null;
      map.setMaxLevel(NO_LIMIT);
      map.setBounds(bounds, top, W - area.right, bottom, area.left);
      const fitLevel = map.getLevel();
      if (keep) {
        map.setLevel(keep.level);
        map.setCenter(keep.center);
      }
      map.setMaxLevel(fitLevel + 1);
    };
    fit();
    // 글꼴이 늦게 들어오면 아래 시트 높이가 바뀌어서, 다 들어온 뒤 한 번 더 맞춰요
    document.fonts?.ready.then(() => { if (alive) fit(); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geo, refitKey]);

  // 멈췄을 때 보이는 칸의 가운데가 허용 범위 밖이면 부드럽게 되돌려요
  useEffect(() => {
    if (!district) return;
    const { kakao } = window;
    const onIdle = () => {
      if (!box.current) return;
      let { south, north, west, east } = box.current;
      (latest.current.extra?.() || []).forEach(([lat, lng]) => {
        south = Math.min(south, lat); north = Math.max(north, lat);
        west = Math.min(west, lng); east = Math.max(east, lng);
      });
      const el = map.getNode();
      const area = latest.current.safe();
      const x = (area.left + area.right) / 2;
      const y = area.bottom > area.top ? (area.top + area.bottom) / 2 : el.offsetHeight / 2;
      const seen = map.getProjection().coordsFromContainerPoint(new kakao.maps.Point(x, y));
      const lat = seen.getLat(), lng = seen.getLng();
      const dLat = Math.min(Math.max(lat, south - MARGIN_LAT), north + MARGIN_LAT) - lat;
      const dLng = Math.min(Math.max(lng, west - MARGIN_LNG), east + MARGIN_LNG) - lng;
      if (Math.abs(dLat) < SETTLE && Math.abs(dLng) < SETTLE) return;
      const center = map.getCenter();
      map.panTo(new kakao.maps.LatLng(center.getLat() + dLat, center.getLng() + dLng));
    };
    kakao.maps.event.addListener(map, "idle", onIdle);
    return () => kakao.maps.event.removeListener(map, "idle", onIdle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geo]);

  if (failed && !keepView) return <FitSpots spots={spots} safe={safe} refitKey={refitKey} />;
  return null;
}
