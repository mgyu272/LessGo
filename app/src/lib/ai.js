// 브라우저 → 우리 서버 API(/api/...) 호출. Gemini 키는 서버에만 있어요.
// 실패하면(키 없음, 인터넷 끊김, 한도 초과) null을 돌려주고, 화면은 규칙 결과로 그대로 동작해요.

async function post(path, body, timeoutMs = 15000, signal) {
  const ctrl = new AbortController();
  const abortFromCaller = () => ctrl.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) {
      const payload = await r.json().catch(() => ({}));
      throw Object.assign(new Error(payload.error || `HTTP ${r.status}`), { code: payload.code, status: r.status });
    }
    return await r.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (ctrl.signal.aborted) {
      throw Object.assign(new Error("The local API request exceeded its client timeout."), { code: "client_request_timeout" });
    }
    if (error instanceof TypeError) {
      throw Object.assign(new Error("The local API server could not be reached."), { code: "local_api_network_error" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

// AI History Lens image analysis. Image bytes are sent only to the server API.
export function analyzeImage(payload, { signal } = {}) {
  // Vision gets its own 45s server budget; the explanation runs in a separate request.
  return post("/api/analyze-image", { ...payload, explanationMode: "deferred" }, 55000, signal);
}

export function generateImageExplanation(payload, { signal } = {}) {
  return post("/api/generate-image-explanation", payload, 55000, signal);
}

// Reuse the saved visual result when the UI language changes; no photo is sent again.
export function localizeImageAnalysis(payload, { signal } = {}) {
  return post("/api/localize-image-analysis", payload, 30000, signal);
}

// AI 코스 추천: { picks: [{id, reason}], model } 또는 null
export async function aiRecommend(settings, weather, lang, avoid = []) {
  try {
    const res = await post("/api/recommend", { settings: { ...settings, themes: [...settings.themes] }, weather, lang, avoid });
    return res?.picks?.length ? res : null;
  } catch (e) {
    console.info("[ai] 추천 서버 응답 없음 → 규칙 추천 사용:", e.message);
    return null;
  }
}

export { post };
