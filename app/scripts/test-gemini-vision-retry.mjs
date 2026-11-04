import assert from "node:assert/strict";
import { askGeminiJSON, VISION_RETRY_POLICY } from "../api/_lib/gemini.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = "unit-test-only-placeholder";

const successResponse = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ candidateName: "unit test" }) }] } }],
}), { status: 200, headers: { "Content-Type": "application/json" } });
const httpResponse = (status) => new Response(JSON.stringify({ error: { code: status } }), { status });

function setResponses(responses, requests) {
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init.body });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
}

async function runVisionRequest() {
  return askGeminiJSON({
    system: "test system", user: "test prompt", model: "gemini-3.5-flash-lite", phase: "vision",
    image: { mimeType: "image/jpeg", data: "test-only-bytes" },
    timeoutMs: VISION_RETRY_POLICY.attemptTimeoutMs,
    maxAttempts: VISION_RETRY_POLICY.maxAttempts,
    retryStatuses: [503],
    retryDelayMs: 0,
  });
}

try {
  assert.ok(VISION_RETRY_POLICY.maxAttempts * VISION_RETRY_POLICY.attemptTimeoutMs +
    (VISION_RETRY_POLICY.maxAttempts - 1) * VISION_RETRY_POLICY.retryDelayMs <= VISION_RETRY_POLICY.budgetMs,
  "Vision retry policy must fit the 45-second budget");

  let requests = [];
  setResponses([successResponse()], requests);
  await runVisionRequest();
  assert.equal(requests.length, 1, "first-attempt success must not retry");

  requests = [];
  setResponses([httpResponse(503), successResponse()], requests);
  await runVisionRequest();
  assert.equal(requests.length, 2, "503 followed by success must make exactly two attempts");
  assert.equal(requests[0].url, requests[1].url, "retry must use the same model endpoint");
  assert.equal(requests[0].body, requests[1].body, "retry must reuse the same prompt and image payload");

  requests = [];
  setResponses([httpResponse(503), httpResponse(503)], requests);
  await assert.rejects(runVisionRequest(), (error) => error.geminiStatus === 503);
  assert.equal(requests.length, 2, "two 503 responses must stop after one retry");

  for (const status of [401, 403, 404, 429]) {
    requests = [];
    setResponses([httpResponse(status), successResponse()], requests);
    await assert.rejects(runVisionRequest(), (error) => error.geminiStatus === status);
    assert.equal(requests.length, 1, `HTTP ${status} must not retry`);
  }

  requests = [];
  const networkError = new TypeError("network failure");
  networkError.cause = Object.assign(new Error("dns failure"), { code: "ENOTFOUND" });
  setResponses([networkError, successResponse()], requests);
  await assert.rejects(runVisionRequest(), (error) => error.code === "gemini_dns_error");
  assert.equal(requests.length, 1, "DNS/network errors must not retry");

  console.log("Vision retry tests passed: success/no retry, 503 retry/success, repeated 503 stop, 401/403/404/429 no retry, network no retry, and 45-second budget.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
}
