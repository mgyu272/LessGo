// AI 답변 정확도 채점 (기획서 성공 지표: "해설 답변 정확도")
// 사용법:  npm run eval:ask              ← .env.local 의 GEMINI_API_KEY 로 실제 채점
//          npm run eval:ask -- eval/다른파일.json
// 키가 없으면 GEMINI_MOCK=1 로 흐름만 확인할 수 있어요:  (PowerShell) $env:GEMINI_MOCK=1; npm run eval:ask

import { readFile } from "node:fs/promises";
import { answerQuestion } from "../api/ask.js";

const file = process.argv[2] || "eval/qa-gilsangsa.json";
const set = JSON.parse(await readFile(file, "utf8"));
let pass = 0;
console.log(`\n채점: ${file}  (모델: ${process.env.GEMINI_API_KEY ? process.env.GEMINI_MODEL || "gemini-3.5-flash-lite" : process.env.GEMINI_MOCK === "1" ? "mock" : "키 없음"})\n`);

for (const item of set.items) {
  try {
    const res = await answerQuestion({ spotId: set.spotId, question: item.q, lang: item.lang || "en" });
    const text = (res.answer || "").toLowerCase();
    const keywordOk = !item.keywords.length || item.keywords.some((k) => text.includes(k.toLowerCase()));
    const ok = res.inSources === item.expect_in_sources && (!item.expect_in_sources || keywordOk);
    if (ok) pass++;
    console.log(`${ok ? "✅" : "❌"} ${item.q}\n   → ${res.answer}  [in_sources=${res.inSources}]`);
  } catch (e) {
    console.log(`⚠️  ${item.q}\n   → 오류: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400)); // 무료 등급 한도 배려
}
console.log(`\n정확도: ${pass}/${set.items.length} (${Math.round((pass / set.items.length) * 100)}%)\n`);
