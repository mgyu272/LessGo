// POST /api/recommend  { settings, weather, lang, avoid }
// → { picks: [{ id, reason }], model }
//
// 1) 규칙 점수(src/lib/recommend.js)로 후보 코스를 최대 6개 추리고
// 2) Gemini가 그중 3개를 고르고, 러너에게 보여줄 "추천 이유"를 한 문장씩 써요.
// 규칙으로 먼저 거르기 때문에 AI가 엉뚱한 코스(없는 코스, 너무 먼 코스)를 고를 수 없어요.

import { askGeminiJSON, readData, handler, isMock, MODEL } from "./_lib/gemini.js";
import { scoreCourses } from "../src/lib/recommend.js";
import { fromGeoJSON, lineLength } from "../src/lib/geo.js";

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

async function loadCourses() {
  const geo = await readData("courses.geojson");
  const spots = (await readData("spots.json")).spots;
  return geo.features.map((f) => {
    const p = { ...f.properties };
    const len = lineLength(fromGeoJSON(f.geometry.coordinates));
    p.distance_km ??= Math.round(len / 100) / 10;
    p.minutes ??= Math.round((len / 1000) * 6.3);
    const e = p.elevation || [];
    p.ascent_m ??= Math.round(e.reduce((s, v, i) => s + (i && v > e[i - 1] ? v - e[i - 1] : 0), 0));
    p.spotNames = (p.spots || []).map((id) => spots.find((s) => s.id === id)?.name.en).filter(Boolean);
    return { id: p.id, properties: p };
  });
}

export async function recommend({ settings = {}, weather = null, lang = "en", avoid = [] }) {
  const s = {
    km: Number(settings.km) || 5, purpose: settings.purpose || "run", time: settings.time || "day",
    hill: settings.hill || "flat", themes: new Set(settings.themes || []), quiet: settings.quiet !== false,
  };
  const ranked = scoreCourses(await loadCourses(), s, weather).slice(0, 6);
  const ids = ranked.map((r) => r.course.id);

  if (isMock()) return mockPicks(ranked, s, lang);

  const candidates = ranked.map(({ course: { properties: p } }) => ({
    id: p.id, name: p.name.en, distance_km: p.distance_km, minutes: p.minutes, hill: p.hill, total_climb_m: p.ascent_m,
    street_lights_1to3: p.lamps, themes: p.themes, residential_parts: p.residential, spots: p.spotNames,
  }));

  const system = `You recommend running courses in Seongbuk-gu, Seoul, to a visiting runner (often an international student).
Pick up to 3 courses ONLY from the candidate list, best first. Consider distance fit, hills, time of day (prefer well-lit, gentle routes in the evening/night),
weather (prefer flat routes when raining), themes, and the purpose. ${avoid.length ? "If quality is similar, prefer courses not in this list: " + avoid.join(", ") + "." : ""}
For each pick write one short, concrete reason in ${lang === "ko" ? "Korean (polite 해요체)" : "simple English"} that mentions a real feature from the data (e.g. distance, climb, lights, a spot). No exaggeration.`;

  const user = JSON.stringify({
    runner: { distance_km: s.km, purpose: s.purpose, time_of_day: s.time, hills: s.hill, themes: [...s.themes], prefers_quiet_roads: s.quiet },
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
        ? `${p.distance_km}km, 오르막 ${p.ascent_m}m${p.spotNames[0] ? ` · ${p.spotNames[0]}을(를) 지나요` : ""} (목업)`
        : `${p.distance_km} km with ${p.ascent_m} m of climb${p.spotNames[0] ? `, passing ${p.spotNames[0]}` : ""} (mock)`,
    })),
  };
}

export default handler(recommend);
