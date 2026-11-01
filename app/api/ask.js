// POST /api/ask  { spotId, question, lang }
// → { answer, inSources, sources:[{title,url}], model }
//
// 팀이 모은 스팟 자료(public/data/spots.json)만 근거로 Gemini가 답해요.
// 자료에 없는 질문이면 "자료에 없다"고 답하게 해서 지어낸 답을 막아요. (기획서: 해설 정확도)

import { askGeminiJSON, readData, handler, isMock, MODEL } from "./_lib/gemini.js";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING", description: "Short answer, max 3 sentences, easy to read aloud" },
    in_sources: { type: "BOOLEAN", description: "true only if the reference material supports the answer" },
    source_ids: { type: "ARRAY", items: { type: "INTEGER" }, description: "indexes of the sources used" },
  },
  required: ["answer", "in_sources", "source_ids"],
};

export async function answerQuestion({ spotId, question, lang = "en" }) {
  if (!spotId || !question || String(question).length > 300) throw Object.assign(new Error("bad request"), { status: 400 });
  const spot = (await readData("spots.json")).spots.find((s) => s.id === spotId);
  if (!spot) throw Object.assign(new Error("unknown spot"), { status: 404 });

  if (isMock()) return mockAnswer(spot, question, lang);

  // 근거 자료: 카드 + 해설 원고 + 데이터 팀이 넣는 docs(원문)
  const docs = [
    ...spot.cards.map((c) => `- ${c.title.en} / ${c.title.ko}: ${c.body.en} / ${c.body.ko}`),
    `- Narration: ${spot.narration.en}`,
    ...(spot.docs || []).map((d) => `- ${d}`),
  ].join("\n");
  const sourceList = (spot.sources || []).map((s, i) => `[${i}] ${s.title}`).join("\n") || "(none)";

  const system = `You are a friendly audio guide for runners visiting ${spot.name.en} (${spot.name.ko}) in Seongbuk-gu, Seoul.
Rules:
- Answer ONLY from the reference material below. Do not use outside knowledge.
- If the material does not cover the question, set in_sources to false and say briefly that our sources don't cover it yet.
- Answer in ${lang === "ko" ? "Korean" : "simple English"}, in at most 3 short sentences that sound natural when read aloud.

Reference material:
${docs}

Sources:
${sourceList}`;

  const out = await askGeminiJSON({ system, user: String(question), schema: SCHEMA });
  const sources = (out.source_ids || []).map((i) => spot.sources?.[i]).filter(Boolean);
  return { answer: out.answer, inSources: !!out.in_sources, sources: out.in_sources ? sources : [], model: MODEL() };
}

// 키가 없을 때(GEMINI_MOCK=1): 저장된 답변으로 AI 흐름만 흉내 내요
function mockAnswer(spot, question, lang) {
  const q = question.toLowerCase();
  const hit = (spot.faq || []).find((f) => f.keywords.some((k) => q.includes(k.toLowerCase())));
  if (!hit) return { answer: lang === "ko" ? "아직 자료에 없는 내용이에요. (목업)" : "Our sources don't cover that yet. (mock)", inSources: false, sources: [], model: "mock" };
  return { answer: `${hit.answer[lang] || hit.answer.en} (mock)`, inSources: true, sources: (hit.sources || [0]).map((i) => spot.sources[i]).filter(Boolean), model: "mock" };
}

export default handler(answerQuestion);
