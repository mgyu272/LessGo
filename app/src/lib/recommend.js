// 코스 추천 — 규칙 점수 (AI 추천의 후보 거르기 + AI가 안 될 때 대신)
// 목적지 3곳(심우장·정릉·의릉)마다, 고른 거리(가장 가까운 3/5/10km)와 경사 선호(평지 위주 = low, 그 외 = high)에
// 맞는 코스를 하나씩 골라 점수 순서로 보여줘요.
// 같은 점수대는 날짜·버튼 누른 횟수에 따라 순서를 돌려서 한 코스에 사람이 몰리지 않게 해요.
//
// ▶ AI 추천은 api/recommend.js 에 있어요: 같은 후보 3개를 Gemini가 순서를 정하고 "추천 이유"를 써요.
//   AI가 안 되면 이 파일의 결과가 그대로 쓰여요.

import { DESTINATIONS, keyOf, modeOfHill, nearestKm } from "./routes.js";

// 설정에 맞는 목적지별 코스 (최대 3개)
export function candidatesFor(courseByKey, s) {
  const km = nearestKm(s.km), mode = modeOfHill(s.hill);
  return DESTINATIONS.map((d) => courseByKey[keyOf(d, km, mode)]).filter(Boolean);
}

export function scoreCourses(courses, s, weather) {
  const night = s.time === "evening" || s.time === "night";
  const gentle = s.hill === "flat" || weather?.rain || night || s.purpose === "walk" || s.purpose === "family";
  return courses.map((c) => {
    const p = c.properties;
    let score = 100;
    score -= Math.abs(p.distance_km - s.km) * 8;                    // 원하는 거리와 차이
    if (p.formal) score += 12;                                      // 정식 추천 경로
    if (p.status === "review_required") score -= 4;                 // 검토가 필요한 경로는 조금 뒤로
    if (gentle && p.ascent_m != null) score -= (p.ascent_m / Math.max(1, p.distance_km)) * 0.4; // 1km당 오르막
    return { course: c, score };
  }).sort((a, b) => b.score - a.score);
}

export function pickThree(data, settings, weather, shuffleSeed = 0) {
  const ranked = scoreCourses(candidatesFor(data.courseByKey, settings), settings, weather).map((r) => r.course);
  // "다른 코스 보기": 누를 때마다 순서를 한 칸씩 돌려요
  const offset = ranked.length ? shuffleSeed % ranked.length : 0;
  return [...ranked.slice(offset), ...ranked.slice(0, offset)];
}
