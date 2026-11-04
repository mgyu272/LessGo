// Starting a saved route in live GPS mode requires the runner to be near its real start.
// Demo is always an explicit user choice, never a silent fallback.
import { distance } from "./geo.js";

const START_RADIUS_M = 150;

export async function startSavedCourse(app, course, speedup = 10) {
  if (!course?.path?.length) { app.toast("코스 데이터를 불러오지 못했어요."); return; }
  if (app.demo) {
    app.run.start(course, { demo: true, speedup });
    return;
  }
  if (!navigator.geolocation || !window.isSecureContext) {
    app.toast("실제 GPS는 HTTPS와 위치 권한이 필요해요.");
    return;
  }
  try {
    const position = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, maximumAge: 0, timeout: 15000,
      })
    );
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || accuracy > 60) {
      app.toast("GPS 정확도가 낮아요. 실외에서 다시 시도해 주세요.");
      return;
    }
    const start = course.path[0];
    const fromStart = Math.round(distance({ lat, lng }, start));
    if (fromStart > START_RADIUS_M) {
      app.toast(`코스 출발지에서 약 ${fromStart}m 떨어져 있어요. 출발지 근처에서 시작해 주세요.`);
      return;
    }
    app.run.start(course, { demo: false, speedup: 1 });
  } catch (e) {
    app.toast(e.code === 1 ? "위치 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요."
      : e.code === 3 ? "GPS를 찾지 못했어요. 잠시 후 다시 시도해 주세요."
      : "GPS 위치를 확인할 수 없어요.");
  }
}
