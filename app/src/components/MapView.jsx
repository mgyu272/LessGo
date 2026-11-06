// 지도 공통 부품 (카카오맵 JavaScript SDK + react-kakao-maps-sdk)
// 앱 키는 .env.local 의 NEXT_PUBLIC_KAKAO_MAP_KEY 에서 읽어요. 코드에 키를 쓰지 마세요.
// 지도를 쓰는 화면(홈·코스 상세·달리기·내 기록)은 모두 이 파일의 부품만 써요.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, CustomOverlayMap, Polygon, Polyline, Circle, useMap } from "react-kakao-maps-sdk";
import { spotIconSvg, groupIconSvg, LABEL_OFFSETS } from "./SpotIcons.jsx";
import { t, loc } from "../lib/i18n.js";
import { CENTER } from "../state/AppContext.jsx";
import { groupOf } from "../lib/places.js";

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

// ---------- 장소 아이콘 (테마별: 역사·전시·종교·공원) ----------
// 코스 목적지(spots)와 둘러볼 곳(places)을 똑같이 테마 아이콘으로 보여줘요.
// - 축소해서 겹치면 같은 테마끼리 "아이콘 + 역사 5" 알약으로 묶어요. 묶음을 누르면 확대해요.
// - 확대(단계 LABEL_LEVEL 이하)하면 장소마다 실제 위치 점 + 점선 + 아이콘 + 아래 이름표 (예전 심우장 핀과 같은 모양)
// - 서로 다른 테마끼리 겹치면 아이콘을 살짝 밀어서 안 겹치게 둬요 (점선이 실제 위치를 가리켜요)
//   pad(): 확대할 때 비워 둘 지도 가장자리 px [위, 오른쪽, 아래, 왼쪽]
const MERGE_PX = 50;      // 같은 테마가 이보다 가까우면 묶어요
const LABEL_LEVEL = 6;    // 이 단계 이하(성북구 전체 정도부터 확대)일 때 이름표·점선 핀을 기본으로
const LIFT_PX = 44;       // 이름표 핀: 아이콘을 실제 위치보다 이만큼 위에
const LABEL_MERGE_PX = 80; // 확대해도 이만큼 붙어 있는 같은 테마는 이름표 대신 묶음으로 (더 확대하면 풀려요)
export function ExploreLayer({ places = [], spots = [], selectedId, onSelect, onSpot, pad }) {
  const map = useMap();
  const [items, setItems] = useState([]);
  const [labeled, setLabeled] = useState(false);
  const latest = useRef(null);
  // 같은 장소가 둘러볼 곳에도 있으면(spot_id) 코스 목적지 쪽만 남겨요
  const spotIds = new Set(spots.map((s) => s.id));
  latest.current = [
    ...spots.map((p) => ({ p, spot: true })),
    ...places.filter((p) => !spotIds.has(p.spot_id)).map((p) => ({ p, spot: false })),
  ];

  const compute = useCallback(() => {
    const { kakao } = window;
    const proj = map.getProjection?.();
    if (!kakao || !proj) return;
    const label = map.getLevel() <= LABEL_LEVEL;
    const pts = latest.current.map(({ p, spot }) => {
      const pt = proj.containerPointFromCoords(new kakao.maps.LatLng(p.lat, p.lng));
      return { p, spot, x: pt.x, y: pt.y, g: groupOf(p) };
    }).sort((a, b) => a.y - b.y || a.x - b.x);
    // 1) 같은 테마끼리 가까우면 묶기 (이름표를 보여줄 만큼 확대했으면 묶지 않아요)
    const used = new Set(), out = [];
    pts.forEach((a, i) => {
      if (used.has(i)) return;
      const members = [];
      pts.forEach((b, j) => {
        if (used.has(j) || b.g !== a.g || Math.hypot(a.x - b.x, a.y - b.y) > (label ? LABEL_MERGE_PX : MERGE_PX)) return;
        used.add(j); members.push(b);
      });
      const x = members.reduce((n, m) => n + m.x, 0) / members.length;
      const y = members.reduce((n, m) => n + m.y, 0) / members.length;
      // 아이콘 자리(bx, by): 이름표 핀이면 실제 위치보다 위에
      out.push({ g: a.g, members, x, y, bx: x, by: label && members.length === 1 ? y - LIFT_PX : y });
    });
    // 2) 겹치면 아이콘(+이름표) 상자끼리 밀어내기. 이름표 핀은 상자가 넓어요
    // 이름표 핀 상자 폭은 이름 길이에 맞춰요 (글자당 약 12px)
    const box = (it) => (it.members.length > 1 ? { w: 100, h: 46 }
      : label ? { w: Math.max(60, loc(it.members[0].p.name).length * 12 + 24), h: 80 } : { w: 46, h: 46 });
    for (let k = 0; k < 80; k++) {
      let moved = false;
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j], A = box(a), B = box(b);
        const dx = b.bx - a.bx, dy = b.by - a.by;
        const ox = (A.w + B.w) / 2 - Math.abs(dx), oy = (A.h + B.h) / 2 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) { const s2 = (dx >= 0 ? 1 : -1) * ox / 2; a.bx -= s2; b.bx += s2; }
        else { const s2 = (dy >= 0 ? 1 : -1) * oy / 2; a.by -= s2; b.by += s2; }
        moved = true;
      }
      if (!moved) break;
    }
    setLabeled(label);
    setItems(out.map((it) => {
      // 이름표 핀은 실제 위치에 두고 아이콘을 (dx, dy)만큼 옮겨 그려요. 아니면 아이콘 자리를 좌표로 바꿔요
      const ll = proj.coordsFromContainerPoint(new kakao.maps.Point(it.bx, it.by));
      return { ...it, lat: ll.getLat(), lng: ll.getLng(), dx: it.bx - it.x, dy: it.by - it.y, key: it.members.map((m) => m.p.id).join("|") };
    }));
  }, [map]);

  useEffect(() => {
    const { kakao } = window;
    compute();
    kakao.maps.event.addListener(map, "idle", compute);
    return () => kakao.maps.event.removeListener(map, "idle", compute);
  }, [map, compute, places, spots]);

  const zoomTo = (members) => {
    const { kakao } = window;
    const bounds = new kakao.maps.LatLngBounds();
    members.forEach((m) => bounds.extend(new kakao.maps.LatLng(m.p.lat, m.p.lng)));
    const [top, right, bottom, left] = pad?.() || [60, 40, 60, 40];
    const before = map.getLevel();
    map.setBounds(bounds, top, right, bottom, left);
    if (map.getLevel() >= before && before > 1) map.setLevel(before - 1);
  };
  const open = (m) => (m.spot ? onSpot?.(m.p) : onSelect?.(m.p));

  return items.map((it) => {
    const m = it.members[0];
    const name = loc(m.p.name);
    const svg = { __html: groupIconSvg(it.g) };
    if (it.members.length > 1) {
      return (
        <CustomOverlayMap key={it.key} position={{ lat: it.lat, lng: it.lng }} xAnchor={0.5} yAnchor={0.5} zIndex={1} clickable>
          <button type="button" className="th-cluster" aria-label={`${t("grp_" + it.g)} ${it.members.length}`} onClick={() => zoomTo(it.members)}>
            <span className="th-cluster-ic" aria-hidden="true" dangerouslySetInnerHTML={svg} />
            <span>{t("grp_" + it.g)}</span><b>{it.members.length}</b>
          </button>
        </CustomOverlayMap>
      );
    }
    const selected = m.p.id === selectedId;
    if (!labeled) {
      return (
        <CustomOverlayMap key={it.key} position={{ lat: it.lat, lng: it.lng }} xAnchor={0.5} yAnchor={0.5} zIndex={selected ? 3 : m.spot ? 2 : 1} clickable>
          <button type="button" className={`th-pin ${selected ? "on" : ""}`} aria-label={name} aria-pressed={selected} onClick={() => open(m)} dangerouslySetInnerHTML={svg} />
        </CustomOverlayMap>
      );
    }
    // 확대: 실제 위치 점 + 점선 + 아이콘 + 아래 이름표
    const c = PIN_BOX / 2, bx = c + it.dx, by = c + it.dy;
    return (
      <CustomOverlayMap key={it.key} position={{ lat: m.p.lat, lng: m.p.lng }} xAnchor={0.5} yAnchor={0.5} zIndex={selected ? 3 : m.spot ? 2 : 1} clickable>
        <div className="spot-pin" style={{ width: PIN_BOX, height: PIN_BOX }}>
          <svg className="pin-lead" width={PIN_BOX} height={PIN_BOX} aria-hidden="true"><line x1={c} y1={c} x2={bx} y2={by} /></svg>
          <span className="pin-dot" style={{ left: c, top: c }} />
          <button type="button" className={`pin-badge th-badge ${selected ? "on" : ""}`} style={{ left: bx, top: by }} aria-label={name} onClick={() => open(m)} dangerouslySetInnerHTML={svg} />
          <span className="pin-label below" style={{ left: bx, top: by }} onClick={() => open(m)}>{name}</span>
        </div>
      </CustomOverlayMap>
    );
  });
}
