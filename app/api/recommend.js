// POST /api/recommend  { settings, weather, lang, avoid }
// → { picks: [{ id, reason }], model }
//
// 1) 고른 거리·경사 선호에 맞는 목적지별 코스 3개(심우장·정릉·의릉)를 규칙 점수(src/lib/recommend.js)로 줄 세우고
// 2) Gemini가 순서를 정하고, 러너에게 보여줄 "추천 이유"를 한 문장씩 써요.
// 규칙으로 먼저 거르기 때문에 AI가 엉뚱한 코스(없는 코스, 너무 먼 코스)를 고를 수 없어요.

import { askGeminiJSON, readData, handler, isMock, MODEL } from "./_lib/gemini.js";
import { scoreCourses, candidatesFor } from "../src/lib/recommend.js";
import { buildCourses } from "../src/lib/routes.js";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    picks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "course id from the candidate list" },
          reason: { type: "STRING", description: "one short sentence for the runner, max 70 characters" },
        },
        required: ["id", "reason"],
      },
    },
  },
  required: ["picks"],
};

// 팀원 코스 번들(public/data/lessgo) → 앱과 같은 코스 모양
async function loadCourses() {
  const [index, lines, spots] = await Promise.all([readData("lessgo/routes.json"), readData("lessgo/routes.geojson"), readData("spots.json")]);
  const spotById = Object.fromEntries(spots.spots.map((s) => [s.id, s]));
  return buildCourses(index, lines, spotById).byKey;
}

export async function recommend({ settings = {}, weather = null, lang = "en", avoid = [] }) {
  const s = {
    km: Number(settings.km) || 5, purpose: settings.purpose || "run", time: settings.time || "day",
    hill: settings.hill || "flat", themes: new Set(settings.themes || []), quiet: settings.quiet !== false,
  };
  const ranked = scoreCourses(candidatesFor(await loadCourses(), s), s, weather);
  const ids = ranked.map((r) => r.course.id);

  if (isMock()) return mockPicks(ranked, s, lang);

  const candidates = ranked.map(({ course: { properties: p } }) => ({
    id: p.id, name: p.name.en, destination: p.dest, distance_km: p.distance_km, minutes: p.minutes, route_type: p.modeName.en,
    total_climb_m: p.ascent_m, // null = unknown
    official_recommendation: p.formal, needs_review: p.status === "review_required", elevation_is_estimate: p.elevationLow,
  }));

  const system = `You recommend running courses in Seongbuk-gu, Seoul, to a visiting runner (often an international student).
Order up to 3 courses ONLY from the candidate list, best first. Each goes to a different historic site. Consider distance fit, total climb,
time of day and weather (prefer gentle routes at night or in rain), and the purpose. Never call a route "official" or "recommended" unless official_recommendation is true,
and do not invent facts (lights, crowds, scenery) that are not in the data. ${avoid.length ? "If quality is similar, prefer courses not in this list: " + avoid.join(", ") + "." : ""}
For each pick write one short, concrete reason in ${lang === "ko" ? "Korean (polite 해요체)" : "simple English"} that mentions a real feature from the data (e.g. distance, climb, the destination). No exaggeration.`;

  const user = JSON.stringify({
    runner: { distance_km: s.km, purpose: s.purpose, time_of_day: s.time, hills: s.hill },
    weather, candidates,
  });

  const out = await askGeminiJSON({ system, user, schema: SCHEMA, temperature: 0.4 });
  // 후보에 없는 id는 버리고, 3개가 안 되면 규칙 순서로 채워요
  const picks = (out.picks || []).filter((p) => ids.includes(p.id)).filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i).slice(0, 3);
  for (const id of ids) if (picks.length < 3 && !picks.some((p) => p.id === id)) picks.push({ id, reason: "" });
  return { picks, model: MODEL() };
}

// 키가 없을 때(GEMINI_MOCK=1): 규칙 순서 그대로 + 틀에 맞춘 이유
function mockPicks(ranked, s, lang) {
  const ko = lang === "ko";
  return {
    model: "mock",
    picks: ranked.slice(0, 3).map(({ course: { properties: p } }) => ({
      id: p.id,
      reason: ko
        ? `${p.distance_km}km, 오르막 ${p.ascent_m ?? "알 수 없음"}${p.ascent_m != null ? "m" : ""} · ${p.name.ko} (목업)`
        : `${p.distance_km} km with ${p.ascent_m ?? "unknown"}${p.ascent_m != null ? " m" : ""} of climb · ${p.name.en} (mock)`,
    })),
  };
}

export default handler(recommend);
