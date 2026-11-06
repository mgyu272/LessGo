// 팀원이 만든 코스 번들(public/data/lessgo/routes.json + routes.geojson) → 앱의 코스 모양
//
// 조회: routes.destinations[목적지].distances['3km'|'5km'|'10km'].routes['low'|'high']
// 선:   route.feature_id 로 routes.geojson의 feature를 찾아 ORS LineString을 그대로 써요. 좌표는 [lng, lat, elevation?]
// 지표: 거리·오르막·점수는 route 객체의 값을 써요. null은 0이 아니라 "알 수 없음"이에요.
// 화면(api/recommend.js 포함)은 예전 courses.geojson 때와 같은 { id, properties, path, len, cues } 모양으로 써요.

import { distance } from "./geo.js";
import { t } from "./i18n.js";

export const DESTINATIONS = ["simujang", "jeongneung", "uiryeong"];
export const DISTANCES = [3, 5, 10];
export const MODES = ["low", "high"]; // low = 완만한 길, high = 언덕 허용
export const MIN_PER_KM = 6.5;        // 예상 시간: 1km 6분 30초 (ORS duration은 걷기 시간이라 안 써요)
export const WALK_MIN_PER_KM = 15;    // 걷기 모드 예상 시간: 1km 15분

// 이동 방식(run | walk)에 맞춘 예상 시간(분)
export const minutesFor = (km, move) => Math.round(km * (move === "walk" ? WALK_MIN_PER_KM : MIN_PER_KM));
// 분 → "34분" / 60분이 넘으면 "1시간 14분"
export function durText(min) {
  const n = Math.max(0, Math.round(min));
  if (n <= 60) return t("min_n", { n });
  const h = Math.floor(n / 60), m = n % 60;
  return m ? t("h_min", { h, m }) : t("h_only", { h });
}

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

// 새 알고리즘으로 만든 코스 (public/data/lessgo/generated_routes.json, api/plan-course.js로 생성)
//   places[장소 id].routes["3"|"5"|"10"].low|high = { start: {name}, path: 폴리라인 문자열 또는 [[lng,lat,ele]], metrics }
//   overrides["simujang-5km-low"] = 같은 모양 → 기존 번들 코스를 바꿔요 (이상하게 돌아가던 코스 고친 것)
// spotOf(id): 그 장소의 스팟 모양 (이름·좌표). 결과는 byKey에 더해요.
export function buildGenerated(gen, spotOf, byKey) {
  const add = (dest, km, mode, r) => {
    if (!r?.path) return;
    const coords = typeof r.path === "string" ? decodePath(r.path) : r.path;
    const m = r.metrics || {};
    const route = {
      summary: { distance_km: m.distance_m != null ? Math.round(m.distance_m / 100) / 10 : null, ascent_m: m.ascent_m ?? null },
      status: "generated", formal_recommendation: false, elevation: { confidence: "medium" },
      start: { name: r.start?.name || null }, metrics: m,
    };
    byKey[keyOf(dest, km, mode)] = makeCourse({ dest, km, mode, route, coords, spot: spotOf(dest) });
  };
  Object.entries(gen?.places || {}).forEach(([id, pl]) => {
    Object.entries(pl.routes || {}).forEach(([km, rr]) => { add(id, Number(km), "low", rr.low); add(id, Number(km), "high", rr.high); });
  });
  Object.entries(gen?.overrides || {}).forEach(([key, r]) => {
    const m = key.match(/^(.+)-(\d+)km-(low|high)$/);
    if (m) add(m[1], Number(m[2]), m[3], r);
  });
}

// 구글 폴리라인(정밀도 1e5) + 고도(정수 m, 쉼표 목록) → [[lng, lat, ele]]
export function decodePath(str) {
  const [poly, eles = ""] = str.split("|");
  const out = []; let i = 0, lat = 0, lng = 0;
  const next = () => { let r = 0, s = 0, b; do { b = poly.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < poly.length) { lat += next(); lng += next(); out.push([lng / 1e5, lat / 1e5, null]); }
  const e = eles ? eles.split(",").map((x) => (x === "" ? null : Number(x))) : [];
  out.forEach((p, k) => { p[2] = e[k] ?? null; });
  return out;
}

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
  // 저장된 ORS directions의 way_points를 실제 경로 좌표에 연결합니다.
  // 추정 회전 안내는 만들지 않으며, directions가 없어도 출발 안내는 제공합니다.
  return { id: p.id, properties: p, path, len, cues: makeCues(route.directions, path) };
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


// ORS instruction type: https://openrouteservice.org/dev/#/api-docs/v2/directions
// 길 안내에 필요한 확실한 회전 유형만 번역합니다. 불명확한 유형은 원문만 사용합니다.
const TURN_KO = {
  0: "좌회전하세요.", 1: "우회전하세요.",
  2: "급좌회전하세요.", 3: "급우회전하세요.",
  4: "완만하게 좌회전하세요.", 5: "완만하게 우회전하세요.",
  6: "직진하세요.", 9: "유턴하세요.",
  12: "왼쪽 길을 유지하세요.", 13: "오른쪽 길을 유지하세요.",
};
function makeCues(directions, path) {
  if (!path.length) return [];
  const cues = [{
    pos: path[0],
    text: { ko: "러닝을 시작합니다. 안전에 유의하며 경로를 따라 이동하세요.", en: "Your run starts now. Follow the route and stay safe." },
  }];
  if (!Array.isArray(directions)) return cues;
  for (const step of directions) {
    const idx = Number(step?.way_points?.[0]);
    const type = Number(step?.type);
    if (!Number.isInteger(idx) || idx <= 0 || idx >= path.length) continue;
    // 출발/도착 안내는 중복하지 않고, 실제 ORS가 제공한 회전만 알립니다.
    if (type === 10 || type === 11) continue;
    const ko = TURN_KO[type];
    const en = typeof step.instruction === "string" ? step.instruction.trim() : "";
    if (!ko && !en) continue;
    cues.push({ pos: path[idx], text: { ko: ko || en, en: en || ko } });
  }
  return cues;
}
