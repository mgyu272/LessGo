// 명소·코스·가게 데이터 불러오기 (public/data 폴더의 JSON)
// 데이터 담당은 public/data 안의 파일만 고치면 돼요. 빌드 없이 바로 반영돼요.
// 코스는 팀원 번들 public/data/lessgo/ (routes.json + routes.geojson) → lib/routes.js 에서 앱 모양으로 바꿔요.

import { cellOf } from "./territory.js";
import { buildCourses, keyOf, nearestKm } from "./routes.js";

// 지금은 화면(홈 지도 핀·스팟 목록·카테고리)에서 숨기는 장소. spots.json 데이터는 그대로 두고,
// 코스가 생기면 여기서 id를 빼면 다시 보여요.
export const HIDDEN_SPOTS = new Set(["gilsangsa"]);

const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); });

// 파일 하나를 못 받아도 앱은 뜨게 빈 값으로 채우고, 어떤 파일이 실패했는지 failed에 남겨요 (홈 지도에 안내)
export async function loadData() {
  const names = ["spots", "routes", "routeLines", "shops"];
  const res = await Promise.allSettled([
    getJSON("/data/spots.json"),
    getJSON("/data/lessgo/routes.json"),
    getJSON("/data/lessgo/routes.geojson"),
    getJSON("/data/shops.json"),
  ]);
  const failed = names.filter((n, i) => res[i].status === "rejected");
  res.forEach((r, i) => { if (r.status === "rejected") console.error(`[data] ${names[i]}`, r.reason); });
  const [spots, routes, routeLines, shops] = res.map((r, i) => (r.status === "fulfilled" ? r.value : [{ spots: [] }, {}, { features: [] }, { shops: [] }][i]));
  const spotById = {};
  const landmarkCells = new Set();
  const visible = spots.spots.filter((s) => !HIDDEN_SPOTS.has(s.id));
  spots.spots.forEach((s) => { spotById[s.id] = s; });
  visible.forEach((s) => landmarkCells.add(cellOf(s)));
  const { byKey, list } = buildCourses(routes, routeLines, spotById);
  return {
    spots: visible,           // 화면에 보이는 장소만
    allSpots: spots.spots,    // 숨긴 장소까지 전부
    shops: shops.shops,
    courses: list,            // 목적지 3 × 거리 3 × low/high = 18개
    courseByKey: byKey,
    spotById,
    landmarkCells,
    failed,
  };
}

// 목적지·거리·모드로 코스 하나 (거리는 가장 가까운 3/5/10km, 'any'는 'high')
export function getCourse(data, dest, km, mode) {
  return data.courseByKey[keyOf(dest, nearestKm(km), mode)] || null;
}

// 고도 배열에서 오르막 합계. frac(0~1)만큼 진행했을 때까지의 값도 구할 수 있어요.
export function ascentOf(elev, frac = 1) {
  if (elev.length < 2) return 0;
  const upto = frac * (elev.length - 1);
  let sum = 0;
  for (let i = 1; i <= Math.ceil(upto); i++) {
    const diff = elev[i] - elev[i - 1];
    const part = Math.min(1, upto - (i - 1));
    if (diff > 0) sum += diff * part;
  }
  return Math.round(sum);
}
