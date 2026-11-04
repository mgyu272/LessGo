// Gemini 호출 공통 부품 (서버에서만 실행돼요. 키가 브라우저로 가지 않아요)
// 파일 이름이 _ 로 시작하는 폴더는 Vercel에서 주소(API)로 열리지 않아요.
//
// 환경변수
//   GEMINI_API_KEY  : Google AI Studio에서 받은 키 (없으면 아래 목업 모드나 오류)
//   GEMINI_MODEL    : 모델 이름 (기본 gemini-3.5-flash-lite — 무료 등급에서 쓸 수 있는 정식 Flash-Lite)
//   GEMINI_MOCK=1   : 키가 없을 때 가짜 응답으로 화면 흐름을 확인하는 모드

import { readFile } from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";
import { performance } from "node:perf_hooks";

const geminiRequestTrace = new AsyncLocalStorage();
for (const [name, mark] of [
  ["undici:request:create", (trace) => { trace.requestCreatedAt ??= performance.now(); }],
  ["undici:client:connected", (trace) => { trace.connectedAt ??= performance.now(); }],
  ["undici:client:sendHeaders", (trace) => { trace.headersSentAt ??= performance.now(); }],
  ["undici:request:headers", (trace, message) => { trace.responseAt ??= performance.now(); trace.status = message.response?.statusCode ?? null; }],
  ["undici:request:error", (trace, message) => { trace.networkCode ??= getNetworkCode(message.error); }],
]) {
  diagnosticsChannel.channel(name).subscribe((message) => {
    const trace = geminiRequestTrace.getStore();
    if (trace) mark(trace, message);
  });
}

export const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
export const VISION_RETRY_POLICY = Object.freeze({ budgetMs: 45000, attemptTimeoutMs: 21000, maxAttempts: 2, retryDelayMs: 1500 });
// 이미지 작업은 별도 모델을 지정할 수 있어 기존 텍스트 API 모델 설정과 독립적으로 관리해요.
export const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || MODEL();
const IMAGE_MODELS = new Set(["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"]);
export const supportsImageInput = (model) => IMAGE_MODELS.has(String(model || "").replace(/^models\//, ""));
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
export async function askGeminiJSON({ system, user, schema, temperature = 0.2, timeoutMs = 15000, maxAttempts = 2, retryStatuses = [429, 503], retryDelayMs = 1200, image, images, model = MODEL(), phase = "generation" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY is not set"), { status: 501 });
  const loggedModel = safeModelName(model);

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [
      { text: user },
      ...(Array.isArray(images) ? images.flatMap((item) => [
        { text: item.label },
        { inline_data: { mime_type: item.mimeType, data: item.data } },
      ]) : image ? [{ inline_data: { mime_type: image.mimeType, data: image.data } }] : []),
    ] }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      ...(schema ? { responseSchema: schema } : {}),
    },
  };

  // 무료 등급은 잠깐 몰리면 429(한도)·503(혼잡)이 날 수 있어요 → 한 번만 쉬었다가 다시
  const attempts = Math.max(1, Math.min(2, Number.isInteger(maxAttempts) ? maxAttempts : 2));
  const retryableStatuses = new Set(Array.isArray(retryStatuses) ? retryStatuses.filter(Number.isInteger) : [429, 503]);
  const backoffMs = Number.isFinite(retryDelayMs) ? Math.max(0, Math.min(2000, Math.floor(retryDelayMs))) : 1200;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const startedAt = performance.now();
    let responseStatus = null;
    const requestTrace = {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await geminiRequestTrace.run(requestTrace, () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${String(model).replace(/^models\//, "")}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }));
      responseStatus = r.status;
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (retryableStatuses.has(r.status) && attempt + 1 < attempts) {
        console.info(`[gemini] phase=${safePhase(phase)} model=${loggedModel} attempt=${attempt + 1} outcome=http status=${r.status} elapsed_ms=${elapsedMs} retry=true backoff_ms=${backoffMs} ${traceTimings(requestTrace, startedAt)}`);
        await sleep(backoffMs);
        continue;
      }
      if (!r.ok) {
        console.warn(`[gemini] phase=${safePhase(phase)} model=${loggedModel} attempt=${attempt + 1} outcome=http status=${r.status} elapsed_ms=${elapsedMs} retry=false ${traceTimings(requestTrace, startedAt)}`);
        throw Object.assign(new Error(`gemini ${r.status}`), { status: 502, geminiStatus: r.status, phase: safePhase(phase), elapsedMs });
      }
      const data = await r.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!text) throw Object.assign(new Error("empty Gemini response"), { status: 502, code: "gemini_empty_response" });
      const parsed = JSON.parse(stripFence(text));
      console.info(`[gemini] phase=${safePhase(phase)} model=${loggedModel} attempt=${attempt + 1} outcome=success status=${r.status} elapsed_ms=${Math.round(performance.now() - startedAt)} ${traceTimings(requestTrace, startedAt)}`);
      return parsed;
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (error.geminiStatus) throw error;
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        console.warn(`[gemini] phase=${safePhase(phase)} model=${loggedModel} attempt=${attempt + 1} outcome=timeout transport=${transportState(requestTrace)} network_code=${requestTrace.networkCode || "none"} http_status=${responseStatus ?? "none"} elapsed_ms=${elapsedMs} ${traceTimings(requestTrace, startedAt)}`);
        throw Object.assign(new Error("Gemini request timed out."), {
          code: "gemini_timeout", phase: safePhase(phase), elapsedMs,
        });
      }
      const networkCode = getNetworkCode(error);
      if (error instanceof TypeError || networkCode) {
        const code = ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"].includes(networkCode) ? "gemini_dns_error" : "gemini_network_error";
        console.warn(`[gemini] phase=${safePhase(phase)} model=${loggedModel} attempt=${attempt + 1} outcome=${code} transport=${transportState(requestTrace)} network_code=${networkCode || requestTrace.networkCode || "unknown"} http_status=none elapsed_ms=${elapsedMs} ${traceTimings(requestTrace, startedAt)}`);
        throw Object.assign(new Error("Gemini API could not be reached."), { code, causeCode: networkCode || "unknown", phase: safePhase(phase), elapsedMs });
      }
      if (error.code === "gemini_empty_response" || error instanceof SyntaxError) {
        console.warn(`[gemini] phase=${safePhase(phase)} model=${loggedModel} attempt=${attempt + 1} outcome=invalid_response status=${responseStatus ?? "unknown"} elapsed_ms=${elapsedMs}`);
      } else {
        console.warn(`[gemini] phase=${safePhase(phase)} model=${loggedModel} attempt=${attempt + 1} outcome=error error_class=${safeErrorClass(error)} http_status=${responseStatus ?? "none"} elapsed_ms=${elapsedMs}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw Object.assign(new Error("gemini busy"), { status: 503 });
}

// 가끔 ```json ... ``` 로 감싸서 오는 경우 대비
function stripFence(s) { return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function safePhase(value) { return /^[a-z_]+$/i.test(String(value)) ? String(value) : "generation"; }
function safeModelName(value) {
  const name = String(value || "").replace(/^models\//, "");
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) ? name : "invalid_model_name";
}
function safeErrorClass(error) {
  return ["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError"].includes(error?.name) ? error.name : "UnknownError";
}
function transportState(trace) {
  if (trace.responseAt) return "http_headers_received";
  if (trace.headersSentAt) return "headers_sent_no_response_yet";
  if (trace.connectedAt) return "socket_connected_before_request";
  if (trace.requestCreatedAt) return "connecting";
  return "not_observed";
}
function traceTimings(trace, startedAt) {
  const ms = (value) => value ? Math.max(0, Math.round(value - startedAt)) : "none";
  return `socket_connected_ms=${ms(trace.connectedAt)} request_headers_sent_ms=${ms(trace.headersSentAt)} response_headers_ms=${ms(trace.responseAt)}`;
}
function getNetworkCode(error) {
  const causes = [error?.cause, error?.cause?.cause, error?.cause?.errors?.[0]];
  return causes.map((cause) => cause?.code).find((code) => typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) || null;
}

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
