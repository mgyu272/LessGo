// 지도 공통 부품 (카카오맵 JavaScript SDK + react-kakao-maps-sdk)
// 앱 키는 .env.local 의 NEXT_PUBLIC_KAKAO_MAP_KEY 에서 읽어요. 코드에 키를 쓰지 마세요.
// 지도를 쓰는 화면(홈·코스 상세·달리기·내 기록)은 모두 이 파일의 부품만 써요.

import { useEffect, useMemo, useState } from "react";
import { Map, CustomOverlayMap, Polygon, Polyline, useMap } from "react-kakao-maps-sdk";
import { spotIconSvg, LABEL_OFFSETS } from "./SpotIcons.jsx";
import { t, loc } from "../lib/i18n.js";
import { CENTER } from "../state/AppContext.jsx";

const KAKAO_MAP_KEY = import.meta.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

// SDK는 autoload=false 로 한 번만 불러오고, kakao.maps.load() 안에서 준비 완료를 알려요
let sdkPromise = null;
function loadKakaoMaps() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (!KAKAO_MAP_KEY) return reject(new Error("no-key"));
    const ready = () => window.kakao.maps.load(resolve);
    if (window.kakao?.maps) return ready();
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_MAP_KEY)}&autoload=false`;
    script.async = true;
    script.onload = ready;
    script.onerror = () => { sdkPromise = null; script.remove(); reject(new Error("load-failed")); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function useKakaoMaps() {
  const [status, setStatus] = useState(() => (window.kakao?.maps?.LatLng ? "ready" : "loading"));
  useEffect(() => {
    if (status === "ready") return;
    let alive = true;
    loadKakaoMaps().then(
      () => alive && setStatus("ready"),
      (e) => alive && setStatus(e.message === "no-key" ? "no-key" : "error"),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return status;
}

const toLatLng = (p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : { lat: p.lat, lng: p.lng });
// Leaflet 확대 단계(zoom, 클수록 가까이) → 카카오 레벨(level, 작을수록 가까이)
const levelOf = (zoom) => Math.min(14, Math.max(1, 19 - zoom));

export function MapView({ dark, className = "", center = CENTER, zoom = 15, level, children }) {
  const status = useKakaoMaps();
  // 처음 위치만 쓰고, 이후 이동은 FitBounds·Follow·FlyTo 가 맡아요
  const [initialCenter] = useState(() => toLatLng(center));
  const cls = `map ${dark ? "map-dark" : ""} ${className}`;
  if (status !== "ready") {
    return <div className={`${cls} map-fallback`}>{status === "loading" ? null : <p>{t(status === "no-key" ? "map_no_key" : "map_error")}</p>}</div>;
  }
  return <Map className={cls} center={initialCenter} level={level ?? levelOf(zoom)}><AutoRelayout />{children}</Map>;
}

// 지도 칸 크기가 바뀌면(화면 전환·창 크기·시트) 카카오맵에 다시 맞추라고 알려요. 안 하면 타일이 일부만 그려져요
function AutoRelayout() {
  const map = useMap();
  useEffect(() => {
    const el = map.getNode();
    if (!window.ResizeObserver || !el) return;
    let last = "";
    const ro = new ResizeObserver(() => {
      const size = `${el.offsetWidth}x${el.offsetHeight}`;
      if (size !== last) { last = size; const c = map.getCenter(); map.relayout(); map.setCenter(c); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// 처음 한 번(또는 key가 바뀔 때) 영역에 맞춰 확대. 여백은 [왼쪽, 위], [오른쪽, 아래] (px)
export function FitBounds({ points, padTL = [30, 30], padBR = [30, 30], fitKey = "" }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    const { kakao } = window;
    if (points.length === 1) return map.setCenter(new kakao.maps.LatLng(points[0][0], points[0][1]));
    const bounds = new kakao.maps.LatLngBounds();
    points.forEach(([lat, lng]) => bounds.extend(new kakao.maps.LatLng(lat, lng)));
    map.setBounds(bounds, padTL[1], padBR[0], padBR[1], padTL[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

// 이름표 달린 스팟 마커(SpotMarker label)가 차지하는 칸: 실제 위치 기준 px [왼, 위, 오른, 아래] 목록
function pinExtents(spot) {
  const [dx, dy] = LABEL_OFFSETS[spot.id] || [0, -40];
  const label = dy <= 0 ? [dx - 42, dy - 56, dx + 42, dy - 29] : [dx - 42, dy + 26, dx + 42, dy + 54];
  return [[-8, -8, 8, 8], [dx - 28, dy - 28, dx + 28, dy + 28], label];
}

// 홈 지도: 스팟 배지·이름표까지 모두 보이게 setBounds로 맞춰요.
// safe(): 핀이 보여야 하는 지도 안쪽 영역 px { top, right, bottom, left } (위 검색·칩 아래 ~ 아래 시트 위)
// 여백에 배지·이름표 크기(pinExtents)를 더해서 이름표까지 영역 안에 들어오게 해요.
// 화면이 낮아 다 못 넣어도 maxLevel보다 멀리 축소하지 않아요 (성북구를 벗어나 서울 전체로 가지 않게).
// refitKey가 바뀌면 다시 맞춰요 (예: 내 위치를 못 쓸 때 성북구 핀 전체 보기로 돌아오기)
export function FitSpots({ spots, safe, maxLevel = 8, refitKey = 0 }) {
  const map = useMap();
  useEffect(() => {
    if (!spots?.length) return;
    let alive = true;
    fit();
    // 글꼴이 늦게 들어오면 아래 시트 높이가 바뀌어서, 다 들어온 뒤 한 번 더 맞춰요
    document.fonts?.ready.then(() => { if (alive) fit(); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, spots, refitKey]);

  function fit() {
    const { kakao } = window;
    const el = map.getNode();
    const W = el.offsetWidth, H = el.offsetHeight;
    if (!W || !H) return;
    const area = safe();
    // 배지·이름표가 실제 위치에서 위·아래·옆으로 얼마나 나가는지
    const ext = { l: 0, t: 0, r: 0, b: 0 };
    spots.forEach((sp) => pinExtents(sp).forEach(([x1, y1, x2, y2]) => {
      ext.l = Math.min(ext.l, x1); ext.t = Math.min(ext.t, y1); ext.r = Math.max(ext.r, x2); ext.b = Math.max(ext.b, y2);
    }));
    let pad = { top: area.top - ext.t, bottom: H - area.bottom + ext.b, left: area.left - ext.l, right: W - area.right + ext.r };
    // 남는 칸이 너무 좁으면(낮은 화면) 이름표 여백은 포기하고 점 위치만 영역 안에 넣어요
    if (H - pad.top - pad.bottom < 60) pad = { ...pad, top: area.top + 24, bottom: H - area.bottom + 16 };
    if (W - pad.left - pad.right < 60) pad = { ...pad, left: area.left + 24, right: W - area.right + 24 };
    const bounds = new kakao.maps.LatLngBounds();
    spots.forEach((sp) => bounds.extend(new kakao.maps.LatLng(sp.lat, sp.lng)));
    map.setBounds(bounds, pad.top, pad.right, pad.bottom, pad.left);

    const level = map.getLevel();
    if (level <= maxLevel) return;
    // 너무 멀리 축소됐으면 maxLevel로 당기고, 핀 묶음 가운데를 영역 가운데로 옮겨요.
    // 단계를 바꾼 직후에는 좌표 계산이 바로 갱신되지 않아서, 지금 단계에서 미리 계산해요 (한 단계 = 거리 절반)
    const k = 2 ** (level - maxLevel);
    const proj = map.getProjection();
    const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
    const mid = proj.containerPointFromCoords(new kakao.maps.LatLng((sw.getLat() + ne.getLat()) / 2, (sw.getLng() + ne.getLng()) / 2));
    const target = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
    const c = proj.coordsFromContainerPoint(new kakao.maps.Point(mid.x - (target.x - W / 2) / k, mid.y - (target.y - H / 2) / k));
    map.setLevel(maxLevel);
    map.setCenter(c);
  }
  return null;
}

// 내 위치를 따라 지도 이동 (애니메이션 없이)
export function Follow({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos) map.setCenter(new window.kakao.maps.LatLng(pos[0], pos[1])); }, [map, pos?.[0], pos?.[1]]);
  return null;
}

// 검색한 곳으로 확대해 이동
export function FlyTo({ to, level = 2 }) {
  const map = useMap();
  useEffect(() => {
    if (!to) return;
    map.setLevel(level);
    map.panTo(new window.kakao.maps.LatLng(to[0], to[1]));
  }, [map, to, level]); // to는 누를 때마다 새 배열이라 같은 곳이어도 다시 움직여요
  return null;
}

// 달리기 별: 흰 원(r12) + 금색 테두리 + 금색 별. 주운 별은 연한 금색 바탕
export function StarMark({ at, got = false }) {
  return (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={0.5} zIndex={4}>
      <svg className={`star-mark ${got ? "got" : ""}`} width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r="12" fill={got ? "#FFF6D6" : "#FFFFFF"} stroke="#F2D27A" strokeWidth="2" />
        <path d="M14 7.5l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="#E0B63A" opacity={got ? 0.55 : 1} />
      </svg>
    </CustomOverlayMap>
  );
}

// 스팟 마커: 장소 그림이 들어간 원형 배지(먹색 테두리)를 CustomOverlay로 올려요.
// label이 있으면(홈 지도) 이름표를 달고, 스팟이 몰리는 곳은 배지를 옆으로 빼서 점선으로 실제 위치와 이어요.
const PIN_BOX = 200;

export function SpotMarker({ spot, label = false, onClick }) {
  const name = loc(spot.name);
  const svg = useMemo(() => ({ __html: spotIconSvg(spot) }), [spot]);
  const Badge = onClick ? "button" : "span";
  const badgeProps = onClick ? { type: "button", "aria-label": name, onClick } : { "aria-hidden": true };
  const position = { lat: spot.lat, lng: spot.lng };

  if (!label) {
    return (
      <CustomOverlayMap position={position} xAnchor={0.5} yAnchor={0.5} zIndex={3} clickable={!!onClick}>
        <div className="spot-pin sm"><Badge className="pin-badge sm" {...badgeProps} dangerouslySetInnerHTML={svg} /></div>
      </CustomOverlayMap>
    );
  }
  const [dx, dy] = LABEL_OFFSETS[spot.id] || [0, -40];
  const c = PIN_BOX / 2;
  const bx = c + dx, by = c + dy;
  return (
    <CustomOverlayMap position={position} xAnchor={0.5} yAnchor={0.5} zIndex={3} clickable={!!onClick}>
      <div className="spot-pin" style={{ width: PIN_BOX, height: PIN_BOX }}>
        <svg className="pin-lead" width={PIN_BOX} height={PIN_BOX} aria-hidden="true"><line x1={c} y1={c} x2={bx} y2={by} /></svg>
        <span className="pin-dot" style={{ left: c, top: c }} />
        <Badge className="pin-badge" style={{ left: bx, top: by }} {...badgeProps} dangerouslySetInnerHTML={svg} />
        <span className={`pin-label ${dy <= 0 ? "above" : "below"}`} style={{ left: bx, top: by }} onClick={onClick}>{name}</span>
      </div>
    </CustomOverlayMap>
  );
}

// 코스·달린 길 선. path는 [{lat,lng}] 또는 [[lat,lng]] 둘 다 돼요. dashed면 짧은 점선
export function Route({ path, color = "#1F4D3F", weight = 6, opacity = 0.9, dashed = false }) {
  const line = useMemo(() => path.map(toLatLng), [path]);
  return <Polyline path={line} strokeColor={color} strokeWeight={weight} strokeOpacity={opacity} strokeStyle={dashed ? "shortdash" : "solid"} />;
}

export function Dot({ at, color = "#1C2B26", radius = 7 }) {
  return (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={0.5} zIndex={2}>
      <span className="map-dot" style={{ width: radius * 2, height: radius * 2, background: color }} />
    </CustomOverlayMap>
  );
}

// 1km·2km 같은 거리 표시: 흰 원 + 연두 점 + 옆에 작은 이름표
export function KmMark({ at, label }) {
  return (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={0.5} zIndex={3}>
      <div className="km-mark"><i aria-hidden="true" /><span>{label}</span></div>
    </CustomOverlayMap>
  );
}

export function Me({ at }) {
  return at ? (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={0.5} zIndex={5}>
      <div className="me-dot" />
    </CustomOverlayMap>
  ) : null;
}
