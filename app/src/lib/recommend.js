// 코스 추천 — 규칙 점수 (AI 추천의 후보 거르기 + AI가 안 될 때 대신)
// 설정(거리·언덕·테마·시간대)과 날씨로 점수를 매겨 3개를 골라요.
// 같은 점수대는 날짜·버튼 누른 횟수에 따라 순서를 돌려서 한 코스에 사람이 몰리지 않게 해요.
//
// ▶ AI 추천은 api/recommend.js 에 있어요: 여기 scoreCourses로 후보 6개를 거른 뒤
//   Gemini가 3개를 고르고 "추천 이유"를 써요. AI가 안 되면 이 파일의 결과가 그대로 쓰여요.

const HILL_RANK = { flat: 0, mild: 1, hard: 2 };

export function scoreCourses(courses, s, weather) {
  const night = s.time === "evening" || s.time === "night";
  const rainy = weather?.rain;
  return courses.map((c) => {
    const p = c.properties;
    let score = 100;
    score -= Math.abs(p.distance_km - s.km) * 8;                       // 원하는 거리와 차이
    score -= Math.abs(HILL_RANK[p.hill] - HILL_RANK[s.hill]) * 15;      // 언덕 정도
    const overlap = p.themes.filter((th) => s.themes.has(th)).length;
    score += overlap * 10;                                             // 테마 겹침
    if (night) score += (p.lamps - 2) * 10;                            // 밤엔 밝은 길
    if (night && p.hill === "hard") score -= 15;
    if (rainy && p.hill !== "flat") score -= 10;                       // 비 오면 평지
    if (s.quiet && p.residential) score -= 6;                          // 조용한 길 우선
    if (s.purpose === "walk" || s.purpose === "family") score -= HILL_RANK[p.hill] * 8;
    return { course: c, score };
  }).sort((a, b) => b.score - a.score);
}

export function pickThree(courses, settings, weather, shuffleSeed = 0) {
  const ranked = scoreCourses(courses, settings, weather);
  // 상위 6개 안에서 seed만큼 돌려 보여주기 ("다른 코스 보기")
  const pool = ranked.slice(0, 6);
  const daySeed = new Date().getDate();
  const offset = pool.length > 3 ? (daySeed + shuffleSeed) % (pool.length - 2) : 0;
  const picked = pool.slice(offset, offset + 3);
  return (picked.length < 3 ? pool.slice(0, 3) : picked).map((r) => r.course);
}
