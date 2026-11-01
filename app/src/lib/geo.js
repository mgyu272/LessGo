// 거리 계산 도구 모음 (지도 API 없이 직접 계산해요)
// 좌표는 앱 안에서 항상 {lat, lng} 객체로 다뤄요.
// GeoJSON 파일은 [경도, 위도] 순서라서 fromGeoJSON()으로 바꿔서 써요.

const R = 6371000; // 지구 반지름(m)
const rad = (d) => (d * Math.PI) / 180;

// 두 점 사이 거리(m)
export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fromGeoJSON(coords) {
  return coords.map(([lng, lat]) => ({ lat, lng }));
}

// 선 전체 길이(m)
export function lineLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += distance(points[i - 1], points[i]);
  return sum;
}

// 선 위에서 시작점부터 meters만큼 간 지점
export function pointAlong(points, meters) {
  let left = meters;
  for (let i = 1; i < points.length; i++) {
    const seg = distance(points[i - 1], points[i]);
    if (left <= seg) {
      const f = seg === 0 ? 0 : left / seg;
      return {
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * f,
        lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * f,
      };
    }
    left -= seg;
  }
  return { ...points[points.length - 1] };
}

// "1.2km" / "420m" 형태로
export function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`;
}

// 초 → "16:08" 또는 "1:02:05"
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, "0") : m;
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

// 페이스(1km당 시간) → 6'12"
export function fmtPace(sec, meters) {
  if (meters < 50 || sec <= 0) return "–";
  const p = sec / (meters / 1000);
  return `${Math.floor(p / 60)}'${String(Math.round(p % 60)).padStart(2, "0")}"`;
}
