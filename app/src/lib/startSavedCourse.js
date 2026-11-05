// 저장된 코스를 "실제 GPS"로 시작해요. 시연 모드는 없어요.
// 코스 출발점 = 지금 내 위치.
//   1) 원래 출발점 150m 이내 → 원래 코스 그대로
//   2) 그 밖                  → 내 위치에서 코스까지 걷는 길을 앞에 이어 붙여 새 코스로 만들어요
//      이어 붙일 지점: 코스에서 내 위치와 가장 가까운 점 (남은 코스가 너무 짧으면 원래 출발점)
//      걷는 길은 OSM 도보 길찾기로 받고, 실패하면 직선으로 이어요.
import { distance, lineLength } from "./geo.js";

export const NEAR_M = 150;
const MAX_ACCURACY_M = 100;
const ROUTE_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000,
    });
  });
}

// 코스 위에서 지금 위치와 가장 가까운 점의 번호와 거리
export function nearestOnPath(path, here) {
  let index = 0, meters = Infinity;
  path.forEach((q, i) => { const d = distance(q, here); if (d < meters) { meters = d; index = i; } });
  return { index, meters };
}

// 지금 위치 기준으로 어디에 이어 붙일지 정해요 (화면에 미리 보여줄 때도 써요)
export function planStart(course, here) {
  const path = course.path;
  const fromStart = distance(here, path[0]);
  if (fromStart <= NEAR_M) return { mode: "start", fromStart, joinIndex: 0, joinM: fromStart };
  const near = nearestOnPath(path, here);
  // 가까운 점 이후 남은 코스가 짧으면(코스의 절반 미만) 원래 출발점에 이어요
  const leftAfter = lineLength(path.slice(near.index));
  const useNear = leftAfter >= course.len * 0.5;
  const joinIndex = useNear ? near.index : 0;
  return { mode: "connect", fromStart, joinIndex, joinM: distance(here, path[joinIndex]) };
}

// 내 위치 → 코스 이음점까지 걷는 길 (실패하면 직선)
async function walkPath(from, to) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const url = `${ROUTE_URL}${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const json = await res.json();
    const coords = json?.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) return coords.map(([lng, lat]) => ({ lat, lng }));
  } catch { /* 네트워크 실패 → 직선 */ }
  return [from, to];
}

// 내 위치에서 시작하는 새 코스 만들기 (원본 코스 데이터는 그대로)
export async function courseFromHere(course, here, plan = planStart(course, here)) {
  if (plan.mode === "start") return course;
  const rest = course.path.slice(plan.joinIndex);
  const lead = await walkPath({ lat: here.lat, lng: here.lng }, rest[0]);
  const path = [{ lat: here.lat, lng: here.lng }, ...lead.slice(1, -1), ...rest];
  const cues = (course.cues || []).filter((c) => c.pos && nearestOnPath(rest, c.pos).meters < 30);
  return { ...course, path, len: lineLength(path), cues, fromHere: true };
}

export async function startSavedCourse(app, course, known) {
  if (!course?.path?.length) { app.toast("코스 데이터를 불러오지 못했어요."); return; }
  try {
    let here = known;
    if (!here) {
      const { coords } = await getCurrentPosition();
      here = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
    }
    if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) throw { code: 2 };
    if (here.accuracy > MAX_ACCURACY_M) {
      app.toast("GPS 정확도가 낮아요. 실외에서 다시 시도해 주세요.");
      return;
    }
    const plan = planStart(course, here);
    const mine = await courseFromHere(course, here, plan);
    if (plan.mode === "connect") app.toast(`지금 위치에서 출발하는 ${fmtM(mine.len)} 코스로 시작해요.`);
    app.run.start(mine, { here });
  } catch (e) {
    app.toast(e?.code === 1 ? "위치 권한이 거부됐어요. 휴대폰·브라우저 설정에서 허용해 주세요."
      : e?.code === 0 ? "실제 GPS는 HTTPS 주소에서만 동작해요."
      : e?.code === 3 ? "GPS를 찾지 못했어요. 잠시 후 다시 시도해 주세요."
      : "GPS 위치를 확인할 수 없어요.");
  }
}

export const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);
