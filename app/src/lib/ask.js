// "이 장소에 대해 물어보기"
// 1) 서버 함수(api/ask.js → Gemini)에 물어보고
// 2) 실패하면(인터넷 끊김, 로컬 실행, API 한도) spots.json의 faq에 저장된 답으로 대신해요.
//    → 발표 때 와이파이가 끊겨도 시연이 이어져요.

import { getLang, loc } from "./i18n.js";

export async function askSpot(spot, question) {
  const lang = getLang();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotId: spot.id, question, lang }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.answer) throw new Error("empty");
    return { answer: data.answer, sources: data.sources || [], cached: false, model: data.model };
  } catch (e) {
    console.info("[ask] 서버 답변 실패 → 저장된 답변 사용:", e.message);
    return localAnswer(spot, question);
  }
}

// 질문에 들어간 단어로 저장된 답을 찾아요
function localAnswer(spot, question) {
  const q = question.toLowerCase();
  const hit = (spot.faq || []).find((f) => f.keywords.some((k) => q.includes(k.toLowerCase())));
  if (!hit) return { answer: null, sources: [], cached: true };
  const sources = (hit.sources || [0]).map((i) => spot.sources[i]).filter(Boolean);
  return { answer: loc(hit.answer), sources, cached: true };
}
