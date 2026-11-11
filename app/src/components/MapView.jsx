// 지도 공통 부품 (카카오맵 JavaScript SDK + react-kakao-maps-sdk)
// 앱 키는 .env.local 의 NEXT_PUBLIC_KAKAO_MAP_KEY 에서 읽어요. 코드에 키를 쓰지 마세요.
// 지도를 쓰는 화면(홈·코스 상세·달리기·내 기록)은 모두 이 파일의 부품만 써요.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, CustomOverlayMap, Polygon, Polyline, Circle, MarkerClusterer, useMap } from "react-kakao-maps-sdk";
import { spotIconSvg, LABEL_OFFSETS, GroupIcon } from "./SpotIcons.jsx";
import { t, loc } from "../lib/i18n.js";
import { CENTER } from "../state/AppContext.jsx";
import { exploreColor, areaLabel, groupOf } from "../lib/places.js";

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
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_MAP_KEY)}&autoload=false&libraries=clusterer`;
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

// interactive={false}: 미리보기 지도 (끌기 · 확대 · 더블클릭 확대 · 휠 확대를 막아요)
export function MapView({ dark, className = "", center = CENTER, zoom = 15, level, interactive = true, children }) {
  const status = useKakaoMaps();
  // 처음 위치만 쓰고, 이후 이동은 FitBounds·Follow·FlyTo 가 맡아요
  const [initialCenter] = useState(() => toLatLng(center));
  const cls = `map ${dark ? "map-dark" : ""} ${className}`;
  if (status !== "ready") {
    return <div className={`${cls} map-fallback`}>{status === "loading" ? null : <p>{t(status === "no-key" ? "map_no_key" : "map_error")}</p>}</div>;
  }
  const lock = interactive ? {} : { draggable: false, zoomable: false, scrollwheel: false, disableDoubleClickZoom: true, keyboardShortcuts: false };
  return <Map className={cls} center={initialCenter} level={level ?? levelOf(zoom)} {...lock}><AutoRelayout />{children}</Map>;
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

// 그곳을 가린 곳 없는 칸의 가운데에 두고 확대 (to는 누를 때마다 새 배열)
// pad(): 비워 둘 지도 가장자리 px [위, 오른쪽, 아래, 왼쪽]. 그 여백을 뺀 영역의 가운데에 to가 오게 지도 중심을 옮겨요
export function FocusOn({ to, level, pad }) {
  const map = useMap();
  useEffect(() => {
    if (!to) return;
    const { kakao } = window;
    const [top, right, bottom, left] = pad?.() || [0, 0, 0, 0];
    const el = map.getNode();
    const W = el.offsetWidth, H = el.offsetHeight;
    // to가 빈 칸 가운데(cx, cy)에 오려면, 지도 중심은 to에서 (화면 가운데 - 빈 칸 가운데)만큼 떨어져야 해요.
    // 단계를 바꾼 직후에는 좌표 계산이 바로 갱신되지 않아서, 지금 단계에서 미리 계산해요 (한 단계 = 거리 절반)
    const k = level ? 2 ** (level - map.getLevel()) : 1;
    const proj = map.getProjection();
    const pt = proj.containerPointFromCoords(new kakao.maps.LatLng(to[0], to[1]));
    const cx = (left + W - right) / 2, cy = (top + H - bottom) / 2;
    const center = proj.coordsFromContainerPoint(new kakao.maps.Point(pt.x + (W / 2 - cx) * k, pt.y + (H / 2 - cy) * k));
    if (level) map.setLevel(level);
    map.setCenter(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, to]);
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
export function Route({ path, color = "#1F4D3F", weight = 6, opacity = 0.9, dashed = false, zIndex = 0 }) {
  const line = useMemo(() => path.map(toLatLng), [path]);
  // zIndex: 겹치는 구간에서 어떤 선이 위에 보일지 (큰 값이 위)
  return <Polyline path={line} strokeColor={color} strokeWeight={weight} strokeOpacity={opacity} strokeStyle={dashed ? "shortdash" : "solid"} zIndex={zIndex} />;
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

// 출발지로 이동: 파란 내 위치 점(퍼지는 원)
export function HereDot({ at }) {
  return at ? (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={0.5} zIndex={5}>
      <div className="here-dot" aria-hidden="true"><i /></div>
    </CustomOverlayMap>
  ) : null;
}

// 출발지 깃발 + 이름표 ("출발지 · 150m 안에서 시작"). 깃대 아래 끝이 실제 위치예요
export function StartFlag({ at, label }) {
  return (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={1} zIndex={4}>
      <div className="start-flag">
        <span className="sf-label">{label}</span>
        <svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true"><path d="M5 31V3" stroke="#1F3D14" strokeWidth="2.4" strokeLinecap="round" /><path d="M6 4h13l-3.5 5L19 14H6z" fill="#E38B2C" stroke="#1F3D14" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      </div>
    </CustomOverlayMap>
  );
}

// 반지름 radius(m) 원 (출발지 둘레 150m)
export function RangeCircle({ at, radius }) {
  return <Circle center={toLatLng(at)} radius={radius} strokeWeight={2} strokeColor="#2F6512" strokeOpacity={0.7} strokeStyle="shortdash" fillColor="#9FD25E" fillOpacity={0.16} />;
}

// 아이콘 없는 기본 핀 (상권 탭에서 고른 가게)
export function PlainPin({ at, label }) {
  return at ? (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={1} zIndex={8}>
      <svg className="plain-pin" viewBox="0 0 28 38" width="28" height="38" role="img" aria-label={label}>
        <path d="M14 37s12-12.6 12-22.5A12 12 0 002 14.5C2 24.4 14 37 14 37z" fill="#E5483B" stroke="#FFFFFF" strokeWidth="2" />
        <circle cx="14" cy="14.5" r="4.5" fill="#FFFFFF" />
      </svg>
    </CustomOverlayMap>
  ) : null;
}

export function Me({ at }) {
  return at ? (
    <CustomOverlayMap position={toLatLng(at)} xAnchor={0.5} yAnchor={0.5} zIndex={5}>
      <div className="me-dot" />
    </CustomOverlayMap>
  ) : null;
}

// 지도가 멈출 때마다(이동·확대 끝) 확대 단계와 보이는 영역을 알려줘요 { level, center: {lat,lng}, bounds: {s,w,n,e} }
export function MapWatch({ onChange }) {
  const map = useMap();
  const cb = useRef(onChange); cb.current = onChange;
  useEffect(() => {
    const { kakao } = window;
    const fire = () => {
      const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast(), c = map.getCenter();
      cb.current({ level: map.getLevel(), center: { lat: c.getLat(), lng: c.getLng() }, bounds: { s: sw.getLat(), w: sw.getLng(), n: ne.getLat(), e: ne.getLng() } });
    };
    kakao.maps.event.addListener(map, "idle", fire);
    fire();
    return () => kakao.maps.event.removeListener(map, "idle", fire);
  }, [map]);
  return null;
}

// ---------- 둘러볼 곳 아이콘 ----------
// 종류별 선 아이콘 (viewBox 0 0 24 24, places.js의 iconTypeOf와 짝)
const EXPLORE_ICONS = {
  hanok: "M2 11c3 .5 5-1 6.5-3.5h7C17 10 19 11.5 22 11M5 11v8h14v-8M10 19v-5h4v5",
  temple: "M12 2v3M8 5h8M8 5L5.5 9h13L16 5M7 9v4h10V9M5 13h14M8 13v7h8v-7M10.5 20v-3h3v3",
  church: "M12 2v6M9.5 4.5h5M7 21V12l5-4 5 4v9M4 21h16M10 21v-4h4v4",
  literature: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 1 2-2h13",
  museum: "M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18",
  art: "M4 5h16v14H4zM7 16l4-5 3 3 2-2 2 4M15 8.5h.01",
  wall: "M3 20V9h3v3h3V9h6v3h3V9h3v11M10 20v-4a2 2 0 0 1 4 0v4",
  park: "M12 3L6 11h4l-4 6h12l-4-6h4zM12 17v4",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
};
// 흰 원 + 1.5px 분류 색 테두리 + 가운데 테마 그림(전시·역사·종교·공원, 칩 아이콘과 같아요). 예전 선 아이콘(EXPLORE_ICONS)은 지금 안 써요. size: "sm"(22px, 단계 6 이상) · "lg"(28px, 5 이하).
// 고르면 36px로 커지고 원이 분류 색으로 채워지고(아이콘은 흰색) 아래에 이름 알약이 떠요. 누르는 칸은 최소 30px
export function ExploreDot({ place, selected = false, size = "sm", onClick }) {
  const name = loc(place.name);
  return (
    <CustomOverlayMap position={{ lat: place.lat, lng: place.lng }} xAnchor={0.5} yAnchor={0.5} zIndex={selected ? 2 : 1} clickable>
      <div className={`ex-pin ${size} ${selected ? "on" : ""}`} style={{ "--c": exploreColor(place) }}>
        <button type="button" className="ex-dot" aria-label={name} aria-pressed={selected} onClick={onClick}>
          <GroupIcon group={groupOf(place)} className="grp-icon ex-art" />
        </button>
        {selected && <span className="ex-name" onClick={onClick} aria-hidden="true">{name}</span>}
      </div>
    </CustomOverlayMap>
  );
}

const posKey = (lat, lng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// 묶음 글자는 아래 relabel에서 직접 넣어요. 카카오 기본 모양(파란 원)은 지워요
const CLUSTER_STYLE = { width: "auto", height: "auto", background: "none", border: "0", lineHeight: "normal", textAlign: "left", color: "inherit" };

// 둘러볼 곳 아이콘 여러 개. 서울 동북부 전체처럼 아주 멀리 볼 때(확대 단계 9 이상)만 카카오 MarkerClusterer로 묶고,
// 성북구 전체(휴대폰 홈 첫 화면 단계 8)나 그보다 가까우면 장소마다 하나씩 보여요.
// 묶음은 "성북동 18"처럼 가장 많은 동네 이름 + 개수(섞여 있으면 숫자만), 누르면 그 범위로 확대해요.
//   pad(): 확대할 때 비워 둘 지도 가장자리 px [위, 오른쪽, 아래, 왼쪽] (홈은 위 검색·칩, 아래 시트)
// level: 지금 확대 단계 (아이콘 크기를 정해요). 고른 아이콘은 묶음에 들어가지 않게 밖에 따로 그려요.
export const CLUSTER_MIN_LEVEL = 9;
const ZOOM_IN_MAX = 3; // 가까운 장소 2개짜리 묶음도 너무 깊이 들어가지 않게
// clusterMinLevel: 이 단계부터 묶어요 (기본은 아주 멀리 볼 때만. 장소 탭 작은 지도는 더 가까이서도 묶어요)
export function ExploreLayer({ places, selectedId, cluster = true, clusterMinLevel = CLUSTER_MIN_LEVEL, level = 6, onSelect, pad }) {
  const byPos = useMemo(() => {
    const m = {};
    places.forEach((p) => { m[posKey(p.lat, p.lng)] = p; });
    return m;
  }, [places]);
  const relabel = useCallback((_, clusters) => {
    clusters.forEach((c) => {
      const marker = c.getClusterMarker?.();
      marker?.setZIndex?.(1); // 코스 목적지 핀(3)보다 아래
      const el = marker?.getContent?.();
      if (!el || typeof el === "string") return;
      const count = {};
      c.getMarkers().forEach((m) => {
        const pos = m.getPosition();
        const p = byPos[posKey(pos.getLat(), pos.getLng())];
        if (p) count[p.area] = (count[p.area] || 0) + 1;
      });
      // 한 동네가 절반을 넘을 때만 동네 이름을 붙여요 (여러 동네가 섞인 큰 묶음은 숫자만)
      const n = c.getSize();
      const [area, top = 0] = Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [];
      const label = area && top * 2 > n ? areaLabel({ area }) : "";
      el.innerHTML = `<span class="ex-cluster">${label ? `<span>${esc(label)}</span>` : ""}<b>${n}</b></span>`;
      // 카카오는 기본 묶음 크기로 위치를 잡아서, 알약 가운데가 실제 위치에 오게 다시 맞춰요
      el.style.transform = "translate(-50%, -50%)";
      requestAnimationFrame(() => { if (el.parentElement) el.parentElement.style.margin = "0"; });
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", t(label ? "cluster_label" : "cluster_label_n", { area: label, n }));
    });
  }, [byPos]);

  // 칩을 바꿔 이 층이 사라질 때 묶음 표시가 지도에 남지 않게 지워요
  const clusterer = useRef(null);
  useEffect(() => () => { clusterer.current?.clear(); clusterer.current = null; }, []);
  const zoomIn = useCallback((clusterer, c) => {
    const map = clusterer.getMap();
    // 확대하면 묶음이 다시 계산돼 비니까, 범위를 먼저 꺼내 둬요
    const bounds = c.getBounds(), center = c.getCenter();
    const [top, right, bottom, left] = pad?.() || [40, 40, 40, 40];
    map.setBounds(bounds, top, right, bottom, left);
    // 그래도 묶이는 단계면 묶음이 풀리는 단계까지 들어가요
    if (map.getLevel() >= clusterMinLevel) map.setLevel(clusterMinLevel - 1, { anchor: center });
    if (map.getLevel() < ZOOM_IN_MAX) map.setLevel(ZOOM_IN_MAX, { anchor: center });
  }, [pad, clusterMinLevel]);

  const sel = places.find((p) => p.id === selectedId);
  const size = level >= 6 ? "sm" : "lg";
  const dots = places.filter((p) => p.id !== selectedId)
    .map((p) => <ExploreDot key={p.id} place={p} size={size} onClick={() => onSelect?.(p)} />);
  return (
    <>
      {cluster
        ? <MarkerClusterer averageCenter minLevel={clusterMinLevel} gridSize={64} styles={[CLUSTER_STYLE]} disableClickZoom onClusterclick={zoomIn} onClustered={relabel} onCreate={(c) => { clusterer.current = c; }}>{dots}</MarkerClusterer>
        : dots}
      {sel && <ExploreDot place={sel} selected size={size} onClick={() => onSelect?.(sel)} />}
    </>
  );
}
