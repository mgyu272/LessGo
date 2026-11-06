// 현재 위치에서 달리기: 내 위치 = 출발지 → 코스의 목적지까지 러닝 최적 코스를 서버(/api/route-from-here)에서 받아 바로 달려요.
// 시연 모드: 위치를 못 받거나 목적지에서 8km보다 멀면 원래 코스 출발점을 내 위치로 가정하고 자동으로 움직여요.
import { distance } from "./geo.js";
import { MIN_PER_KM } from "./routes.js";

const MAX_ACCURACY_M = 100;
const DEMO_MAX_M = 8000;

function getPosition(ms) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      reject, { enableHighAccuracy: true, maximumAge: 5000, timeout: ms });
  });
}

const gpsError = (e) => e?.code === 1 ? "위치 권한이 거부됐어요. 휴대폰·브라우저 설정에서 허용해 주세요."
  : e?.code === 0 ? "GPS는 HTTPS 주소에서만 동작해요."
  : e?.code === 9 ? "GPS 정확도가 낮아요. 실외에서 다시 시도해 주세요."
  : "GPS 위치를 가져오지 못했어요. 실외에서 다시 시도해 주세요.";

// 성공하면 { low, high, here } (완만한 길 · 언덕 허용 두 코스), 실패하면 { error }
// bases: { low, high } 같은 목적지의 저장 코스 (이름·배지 등 속성을 물려받아요)
export async function buildCoursesFromHere(bases, dest, demo, km = null) {
  const base = bases.low || bases.high;
  let here = null;
  try {
    here = await getPosition(demo ? 6000 : 15000);
    if (!demo && here.accuracy > MAX_ACCURACY_M) throw { code: 9 };
  } catch (e) {
    if (!demo) return { error: gpsError(e) };
  }
  if (demo && (!here || distance(here, dest) > DEMO_MAX_M)) here = { ...base.path[0] };
  try {
    const res = await fetch("/api/route-from-here", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: { lat: here.lat, lng: here.lng }, to: { lat: dest.lat, lng: dest.lng }, km }),
    });
    const json = await res.json();
    if (!res.ok || !json.best) throw new Error(json.error || "route");
    return {
      here,
      low: makeCourse(bases.low || base, dest, json.low || json.best, "low"),
      high: makeCourse(bases.high || base, dest, json.high || json.best, "high"),
    };
  } catch {
    return { error: "코스를 찾지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요." };
  }
}

// 서버 결과 → 앱 코스 모양 (기존 코스의 속성은 그대로 두고 길·거리만 바꿔요)
function makeCourse(base, dest, best, mode) {
  const path = best.path.map(([lng, lat]) => ({ lat, lng }));
  let len = 0;
  for (let i = 1; i < path.length; i++) len += distance(path[i - 1], path[i]);
  const m = best.metrics;
  const distance_km = Math.round(len / 100) / 10;
  const short = { ko: dest.name.ko.replace(/\s*\(.*\)/, ""), en: dest.name.en.replace(/\s*\(.*\)/, "") };
  const ele = best.path.map((p) => p[2]);
  const elevation = ele.every((x) => x != null) ? sample(ele, 60) : [];
  const properties = {
    ...base.properties,
    id: `here-${base.properties.dest}-${mode}-${Date.now()}`, mode,
    name: { ko: `내 위치 → ${short.ko}`, en: `From here → ${short.en}` },
    title: { ko: `내 위치 → ${short.ko}`, en: `From here → ${short.en}` },
    distance_km, minutes: Math.round(distance_km * MIN_PER_KM),
    ascent_m: m.ascent_m ?? null, elevation, spots: [base.properties.dest],
    route: { ...(base.properties.route || {}), start: { name: "현위치" } },
    fromHere: true, hereMetrics: m, formal: false, status: "here", elevationLow: false,
  };
  return { id: properties.id, properties, path, len, cues: [] };
}
function sample(xs, n) {
  return Array.from({ length: n }, (_, k) => xs[Math.round((k / (n - 1)) * (xs.length - 1))]);
}
