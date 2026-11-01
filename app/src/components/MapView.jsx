// 지도 공통 부품 (카카오맵 JavaScript SDK + react-kakao-maps-sdk)
// 앱 키는 .env.local 의 NEXT_PUBLIC_KAKAO_MAP_KEY 에서 읽어요. 코드에 키를 쓰지 마세요.
// 지도를 쓰는 화면(홈·코스 상세·달리기·내 기록)은 모두 이 파일의 부품만 써요.

import { useEffect, useMemo, useState } from "react";
import { Map, CustomOverlayMap, Polygon, Polyline, useMap } from "react-kakao-maps-sdk";
import { boundary } from "../lib/territory.js";
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

export function MapView({ dark, className = "", center = CENTER, zoom = 15, children }) {
  const status = useKakaoMaps();
  // 처음 위치만 쓰고, 이후 이동은 FitBounds·Follow·FlyTo 가 맡아요
  const [initialCenter] = useState(() => toLatLng(center));
  const cls = `map ${dark ? "map-dark" : ""} ${className}`;
  if (status !== "ready") {
    return <div className={`${cls} map-fallback`}>{status === "loading" ? null : <p>{t(status === "no-key" ? "map_no_key" : "map_error")}</p>}</div>;
  }
  return <Map className={cls} center={initialCenter} level={levelOf(zoom)}>{children}</Map>;
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
  }, [map, to, level]);
  return null;
}

// 육각형 영역 (얻은 칸 = 옥빛, 스팟 칸 = 녹색, 아직 못 얻은 스팟 칸 = 녹색 점선). 방금 얻은 칸은 더 진하게
export function HexLayer({ cells, landmarkCells, dark = false, goals = false, fresh = [] }) {
  const freshSet = useMemo(() => new Set(fresh), [fresh.join(",")]);
  const owned = useMemo(() => [...cells].map((c) => ({ c, path: boundary(c).map(toLatLng), gold: landmarkCells.has(c) })), [cells, landmarkCells]);
  const goalCells = useMemo(() => (goals ? [...landmarkCells].filter((c) => !cells.has(c)) : []), [goals, cells, landmarkCells]);
  return (
    <>
      {owned.map(({ c, path, gold }) => (
        <Polygon key={c} path={path} strokeWeight={1} strokeOpacity={1}
          strokeColor={gold ? "#1F4D3F" : dark ? "#7CC4A4" : "#4F9C7E"}
          fillColor={gold ? "#2E6B57" : "#7CC4A4"}
          fillOpacity={freshSet.has(c) ? 0.75 : gold ? 0.7 : dark ? 0.4 : 0.42} />
      ))}
      {goalCells.map((c) => (
        <Polygon key={"g" + c} path={boundary(c).map(toLatLng)} strokeWeight={2} strokeColor="#1F4D3F"
          strokeOpacity={1} strokeStyle="dash" fillOpacity={0} />
      ))}
    </>
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

// 코스·달린 길 선. path는 [{lat,lng}] 또는 [[lat,lng]] 둘 다 돼요
export function Route({ path, color = "#1F4D3F", weight = 6, opacity = 0.9 }) {
  const line = useMemo(() => path.map(toLatLng), [path]);
  return <Polyline path={line} strokeColor={color} strokeWeight={weight} strokeOpacity={opacity} />;
}

export function Dot({ at, color = "#1C2B26", radius = 7 }) {
  return (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={0.5} zIndex={2}>
      <span className="map-dot" style={{ width: radius * 2, height: radius * 2, background: color }} />
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
