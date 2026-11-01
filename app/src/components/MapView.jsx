// 지도 공통 부품 (react-leaflet + OpenStreetMap, 무료·키 없음)

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { boundary } from "../lib/territory.js";
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
          color: gold ? "#A8331A" : dark ? "#ECB22E" : "#C99212", weight: 1,
          fillColor: gold ? "#D2461F" : "#ECB22E", fillOpacity: gold ? 0.7 : dark ? 0.4 : 0.42,
        }} />
      ))}
      {goalCells.map((c) => (
        <Polygon key={"g" + c} positions={boundary(c)} interactive={false}
          pathOptions={{ color: "#D2461F", weight: 2, dashArray: "4 4", fillOpacity: 0 }} />
      ))}
    </>
  );
}

// 스팟 색: 역사 = 석간주(붉은 흙색), 하천 = 쪽빛, 공원 = 뇌록
export const SPOT_COLORS = { history: "#A8331A", stream: "#34508C", park: "#2F6E5E" };

export function SpotMarker({ spot, label = false, onClick }) {
  return (
    <CircleMarker center={[spot.lat, spot.lng]} radius={9}
      pathOptions={{ color: "#fff", weight: 3, fillColor: SPOT_COLORS[spot.category] || "#A8331A", fillOpacity: 1 }}
      eventHandlers={onClick ? { click: onClick } : undefined}>
      {label && <Tooltip permanent direction="top" offset={[0, -10]} className="spot-label">{loc(spot.name)}</Tooltip>}
    </CircleMarker>
  );
}

export function Route({ path, color = "#D2461F", weight = 6 }) {
  return <Polyline positions={path.map((p) => [p.lat, p.lng])} pathOptions={{ color, weight, opacity: 0.9 }} />;
}

export function Dot({ at, color = "#1F1C2C", radius = 7 }) {
  return <CircleMarker center={at} radius={radius} pathOptions={{ color: "#fff", weight: 3, fillColor: color, fillOpacity: 1 }} />;
}

const meIcon = L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18] });
export function Me({ at }) { return at ? <Marker position={at} icon={meIcon} /> : null; }
