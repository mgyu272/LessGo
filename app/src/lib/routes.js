// 팀원이 만든 코스 번들(public/data/lessgo/routes.json + routes.geojson) → 앱의 코스 모양
//
// 조회: routes.destinations[목적지].distances['3km'|'5km'|'10km'].routes['low'|'high']
// 선:   route.feature_id 로 routes.geojson의 feature를 찾아 ORS LineString을 그대로 써요. 좌표는 [lng, lat, elevation?]
// 지표: 거리·오르막·점수는 route 객체의 값을 써요. null은 0이 아니라 "알 수 없음"이에요.
// 화면(api/recommend.js 포함)은 예전 courses.geojson 때와 같은 { id, properties, path, len, cues } 모양으로 써요.

import { distance } from "./geo.js";

export const DESTINATIONS = ["simujang", "jeongneung", "uiryeong"];
export const DISTANCES = [3, 5, 10];
export const MODES = ["low", "high"]; // low = 완만한 길, high = 언덕 허용
export const MIN_PER_KM = 6.5;        // 예상 시간: 1km 6분 30초 (ORS duration은 걷기 시간이라 안 써요)

const MODE_NAME = { low: { ko: "완만한 길", en: "Gentle route" }, high: { ko: "언덕 허용", en: "Hills OK" } };

// 예전 데이터의 'any'는 'high'로 (번들 README의 mode_alias)
export const normMode = (m) => (m === "low" ? "low" : "high");
// 설정의 경사 선호 → 모드: 평지 위주 = low, 조금·언덕 OK = high
export const modeOfHill = (hill) => (hill === "flat" ? "low" : "high");
// 번들에는 3·5·10km만 있어서, 직접 입력한 거리는 가장 가까운 거리로 골라요
export const nearestKm = (km) => DISTANCES.reduce((best, d) => (Math.abs(d - km) < Math.abs(best - km) ? d : best), DISTANCES[0]);

// 번들 + spots.json → { byKey: { "uiryeong-3km-low": course }, list: [18개] }
export function buildCourses(index, collection, spotById) {
  const features = Object.fromEntries((collection?.features || []).map((f) => [f.id, f]));
  const byKey = {};
  for (const dest of DESTINATIONS) {
    const d = index?.destinations?.[dest];
    for (const km of DISTANCES) {
      const routes = d?.distances?.[`${km}km`]?.routes || {};
      for (const [rawMode, route] of Object.entries(routes)) {
        const mode = normMode(rawMode);
        const f = features[route.feature_id];
        if (!f || route.available === false) continue;
        byKey[keyOf(dest, km, mode)] = makeCourse({ dest, km, mode, route, coords: f.geometry.coordinates, spot: spotById[dest] });
      }
    }
  }
  return { byKey, list: Object.values(byKey) };
}

export const keyOf = (dest, km, mode) => `${dest}-${km}km-${normMode(mode)}`;

function makeCourse({ dest, km, mode, route, coords, spot }) {
  const path = coords.map(([lng, lat]) => ({ lat, lng }));
  let len = 0;
  for (let i = 1; i < path.length; i++) len += distance(path[i - 1], path[i]);
  const sum = route.summary || {};
  const distance_km = sum.distance_km != null ? Math.round(sum.distance_km * 10) / 10 : Math.round(len / 100) / 10;
  const placeName = spot?.name || { ko: dest, en: dest };
  const short = { ko: placeName.ko.replace(/\s*\(.*\)/, ""), en: placeName.en.replace(/\s*\(.*\)/, "") };
  const ascent = sum.ascent_m != null ? Math.round(sum.ascent_m) : null;
  const perKm = ascent != null && distance_km ? ascent / distance_km : null;
  const p = {
    id: keyOf(dest, km, mode), dest, km, mode,
    name: { ko: `${short.ko} ${km}km · ${MODE_NAME[mode].ko}`, en: `${short.en} ${km} km · ${MODE_NAME[mode].en}` },
    title: { ko: `${short.ko} ${km}km`, en: `${short.en} ${km} km` }, // 카드 제목 (길 종류는 옆 칩에)
    distance_km,
    minutes: Math.round(distance_km * MIN_PER_KM),
    ascent_m: ascent, // null = 알 수 없음
    elevation: sampleElevation(coords, path),
    modeName: MODE_NAME[mode],
    // 설정의 경사 선호와 맞추는 값: 완만한 길 = flat, 언덕 허용 = hard
    hill: mode === "low" ? "flat" : "hard",
    // 오르막 정도: 1km당 오른 높이로 (15m 미만 낮음 · 30m 미만 중간 · 그 이상 높음). 모르면 null
    climbLevel: perKm == null ? null : perKm < 15 ? "low" : perKm < 30 ? "mid" : "high",
    spots: [dest],
    // 경고·검토 상태 (화면 배지)
    status: route.status,
    formal: route.formal_recommendation === true,
    elevationLow: route.elevation?.confidence === "low",
    route, // 번들 원본 (지표가 더 필요하면 여기서)
    // 번들에 없는 예전 필드: 화면이 깨지지 않게 기본값만 둬요 (이번 작업에서는 화면을 손대지 않음)
    themes: [], lamps: 2, crowd: "mid", residential: false,
    tone: mode === "low" ? "easy" : "normal",
  };
  // 음성 길안내(cues)는 이번 작업에서 연결하지 않아요 (route.directions는 영어 ORS 안내라 따로 다듬어야 해요)
  return { id: p.id, properties: p, path, len, cues: [] };
}

// 고도 그래프용: 좌표의 세 번째 값(고도)을 거리 기준으로 60개 정도로 줄여요. 고도가 없으면 빈 배열
function sampleElevation(coords, path, n = 60) {
  if (!coords.length || coords.some((c) => c[2] == null)) return [];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distance(path[i - 1], path[i]));
  const total = cum[cum.length - 1] || 1;
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const at = (k / (n - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < at) j++;
    const t = cum[j + 1] > cum[j] ? (at - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    const a = coords[j][2], b = coords[j + 1]?.[2] ?? a;
    out.push(Math.round((a + (b - a) * t) * 10) / 10);
  }
  return out;
}
