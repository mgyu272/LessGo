// 지도 공통 부품 (react-leaflet + OpenStreetMap, 무료·키 없음)

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { boundary } from "../lib/territory.js";
import { spotIconSvg, LABEL_OFFSETS } from "./SpotIcons.jsx";
import { loc } from "../lib/i18n.js";
import { CENTER } from "../state/AppContext.jsx";

export function MapView({ dark, className = "", center = CENTER, zoom = 15, children }) {
  return (
    <MapContainer className={`map ${dark ? "map-dark" : ""} ${className}`} center={center} zoom={zoom} zoomControl={false} fadeAnimation={false}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="© OpenStreetMap" />
      {children}
    </MapContainer>
  );
}

// 처음 한 번(또는 key가 바뀔 때) 영역에 맞춰 확대
export function FitBounds({ points, padTL = [30, 30], padBR = [30, 30], fitKey = "" }) {
  const map = useMap();
  useEffect(() => {
    if (points?.length) map.fitBounds(L.latLngBounds(points), { paddingTopLeft: padTL, paddingBottomRight: padBR, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

// 내 위치를 따라 지도 이동
export function Follow({ pos }) {
  const map = useMap();
  // 애니메이션 없이 이동해요 (화면이 바뀌는 순간 애니메이션이 남아 있으면 Leaflet 오류가 나서)
  useEffect(() => { if (pos) map.panTo(pos, { animate: false }); }, [map, pos?.[0], pos?.[1]]);
  return null;
}

// 육각형 영역 (얻은 칸 = 노랑, 스팟 칸 = 금색, 아직 못 얻은 스팟 칸 = 금색 점선)
export function HexLayer({ cells, landmarkCells, dark = false, goals = false, fresh = [] }) {
  const freshSet = useMemo(() => new Set(fresh), [fresh.join(",")]);
  const owned = useMemo(() => [...cells].map((c) => ({ c, b: boundary(c), gold: landmarkCells.has(c) })), [cells, landmarkCells]);
  const goalCells = useMemo(() => (goals ? [...landmarkCells].filter((c) => !cells.has(c)) : []), [goals, cells, landmarkCells]);
  return (
    <>
      {owned.map(({ c, b, gold }) => (
        <Polygon key={c} positions={b} interactive={false} pathOptions={{
          className: freshSet.has(c) ? "hex-fresh" : "",
          color: gold ? "#1F4D3F" : dark ? "#7CC4A4" : "#4F9C7E", weight: 1,
          fillColor: gold ? "#2E6B57" : "#7CC4A4", fillOpacity: gold ? 0.7 : dark ? 0.4 : 0.42,
        }} />
      ))}
      {goalCells.map((c) => (
        <Polygon key={"g" + c} positions={boundary(c)} interactive={false}
          pathOptions={{ color: "#1F4D3F", weight: 2, dashArray: "4 4", fillOpacity: 0 }} />
      ))}
    </>
  );
}

// 스팟 마커: 장소 그림이 들어간 원형 배지(먹색 테두리). label이 있으면(홈 지도) 이름표를 달고,
// 스팟이 몰리는 곳은 배지를 옆으로 빼서 점선으로 실제 위치와 이어요.
const PIN_BOX = 200;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function spotIcon(spot, label, name) {
  if (!label) {
    return L.divIcon({
      className: "spot-pin", iconSize: [36, 36], iconAnchor: [18, 18],
      html: `<span class="pin-badge sm">${spotIconSvg(spot)}</span>`,
    });
  }
  const [dx, dy] = LABEL_OFFSETS[spot.id] || [0, -40];
  const c = PIN_BOX / 2;
  const bx = c + dx, by = c + dy;
  const above = dy <= 0;
  return L.divIcon({
    className: "spot-pin", iconSize: [PIN_BOX, PIN_BOX], iconAnchor: [c, c],
    html: `<svg class="pin-lead" width="${PIN_BOX}" height="${PIN_BOX}" aria-hidden="true"><line x1="${c}" y1="${c}" x2="${bx}" y2="${by}"/></svg>`
      + `<span class="pin-dot" style="left:${c}px;top:${c}px"></span>`
      + `<span class="pin-badge" style="left:${bx}px;top:${by}px">${spotIconSvg(spot)}</span>`
      + `<span class="pin-label ${above ? "above" : "below"}" style="left:${bx}px;top:${by}px">${escapeHtml(name)}</span>`,
  });
}

export function SpotMarker({ spot, label = false, onClick }) {
  const name = loc(spot.name);
  const icon = useMemo(() => spotIcon(spot, label, name), [spot, label, name]);
  return (
    <Marker position={[spot.lat, spot.lng]} icon={icon} title={name} keyboard={!!onClick}
      eventHandlers={onClick ? { click: onClick } : undefined} />
  );
}

export function Route({ path, color = "#1F4D3F", weight = 6 }) {
  return <Polyline positions={path.map((p) => [p.lat, p.lng])} pathOptions={{ color, weight, opacity: 0.9 }} />;
}

export function Dot({ at, color = "#1C2B26", radius = 7 }) {
  return <CircleMarker center={at} radius={radius} pathOptions={{ color: "#fff", weight: 3, fillColor: color, fillOpacity: 1 }} />;
}

const meIcon = L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18] });
export function Me({ at }) { return at ? <Marker position={at} icon={meIcon} /> : null; }
