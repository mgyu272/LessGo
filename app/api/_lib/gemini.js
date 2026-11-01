// Gemini 호출 공통 부품 (서버에서만 실행돼요. 키가 브라우저로 가지 않아요)
// 파일 이름이 _ 로 시작하는 폴더는 Vercel에서 주소(API)로 열리지 않아요.
//
// 환경변수
//   GEMINI_API_KEY  : Google AI Studio에서 받은 키 (없으면 아래 목업 모드나 오류)
//   GEMINI_MODEL    : 모델 이름 (기본 gemini-3.5-flash-lite — 무료 등급에서 쓸 수 있는 정식 Flash-Lite)
//   GEMINI_MOCK=1   : 키가 없을 때 가짜 응답으로 화면 흐름을 확인하는 모드

import { readFile } from "node:fs/promises";
import path from "node:path";

export const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
export const hasKey = () => Boolean(process.env.GEMINI_API_KEY);
export const isMock = () => !hasKey() && process.env.GEMINI_MOCK === "1";

// public/data 의 JSON 읽기 (데이터 담당이 고치는 그 파일)
const cache = {};
export async function readData(file) {
  if (!cache[file]) cache[file] = JSON.parse(await readFile(path.join(process.cwd(), "public", "data", file), "utf8"));
  return cache[file];
}

// Gemini에 묻고 JSON으로 받아요.
// schema를 주면 그 모양대로만 답하게 해요 (구조화 출력).
export async function askGeminiJSON({ system, user, schema, temperature = 0.2, timeoutMs = 15000 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY is not set"), { status: 501 });

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      ...(schema ? { responseSchema: schema } : {}),
    },
  };

  // 무료 등급은 잠깐 몰리면 429(한도)·503(혼잡)이 날 수 있어요 → 한 번만 쉬었다가 다시
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if ((r.status === 429 || r.status === 503) && attempt === 0) { await sleep(1200); continue; }
      if (!r.ok) throw Object.assign(new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`), { status: 502 });
      const data = await r.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!text) throw Object.assign(new Error("empty response (blocked or no candidates)"), { status: 502 });
      return JSON.parse(stripFence(text));
    } finally {
      clearTimeout(timer);
    }
  }
  throw Object.assign(new Error("gemini busy"), { status: 503 });
}

// 가끔 ```json ... ``` 로 감싸서 오는 경우 대비
function stripFence(s) { return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vercel 함수 공통: POST만, 본문 읽기, 오류를 JSON으로
export function handler(fn) {
  return async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      return res.status(200).json(await fn(body));
    } catch (e) {
      console.error("[api]", e.message);
      return res.status(e.status || 500).json({ error: e.message });
    }
  };
}
