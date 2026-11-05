// 저장된 코스를 "실제 GPS"로 시작해요. 시연 모드는 없어요.
// 출발지와의 거리에 따라 세 가지로 시작해요 (예전처럼 멀다고 막지 않아요):
//   1) 출발지 150m 이내          → 코스 처음부터
//   2) 코스 중간 지점 150m 이내  → 가장 가까운 코스 지점부터 (남은 코스만)
//   3) 코스에서 멀리 있음        → 지금 위치에서 바로 시작, 출발지까지 가는 길도 기록에 포함
import { distance, lineLength } from "./geo.js";

export const NEAR_M = 150;
const MAX_ACCURACY_M = 100;

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

// 지금 위치 기준으로 어떻게 시작할지 정해요 (화면에 미리 보여줄 때도 써요)
export function planStart(course, here) {
  const path = course.path;
  const fromStart = distance(here, path[0]);
  if (fromStart <= NEAR_M) return { mode: "start", fromStart, course };
  const near = nearestOnPath(path, here);
  // 끝에서 200m 안쪽이면 남는 코스가 너무 짧아서 출발지 기준으로 가요
  const leftAfter = lineLength(path.slice(near.index));
  if (near.meters <= NEAR_M && near.index > 0 && leftAfter > 200) {
    return { mode: "join", fromStart, joinM: near.meters, course: trimCourse(course, near.index) };
  }
  return { mode: "approach", fromStart, course };
}

// 코스를 index 지점부터 잘라서 새 코스로 (원본 데이터는 그대로)
function trimCourse(course, index) {
  const path = course.path.slice(index);
  const cues = (course.cues || []).filter((c) => c.pos && nearestOnPath(path, c.pos).meters < 30);
  return { ...course, path, len: lineLength(path), cues, trimmed: true };
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
    if (plan.mode === "join") app.toast("가장 가까운 코스 지점부터 시작해요.");
    if (plan.mode === "approach") app.toast(`출발지까지 약 ${fmtM(plan.fromStart)} — 가는 길도 기록돼요.`);
    app.run.start(plan.course, { approach: plan.mode === "approach", here });
  } catch (e) {
    app.toast(e?.code === 1 ? "위치 권한이 거부됐어요. 휴대폰·브라우저 설정에서 허용해 주세요."
      : e?.code === 0 ? "실제 GPS는 HTTPS 주소에서만 동작해요."
      : e?.code === 3 ? "GPS를 찾지 못했어요. 잠시 후 다시 시도해 주세요."
      : "GPS 위치를 확인할 수 없어요.");
  }
}

export const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);
