import assert from "node:assert/strict";
import test from "node:test";

const utterances = [];
let cancelled = 0;
class Utterance {
  constructor(text) { this.text = text; }
}
const synth = {
  speaking: false, pending: false,
  getVoices: () => [{ name: "Korean", lang: "ko-KR" }],
  speak(utterance) { utterances.push(utterance); },
  cancel() { cancelled++; },
};
globalThis.window = { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
globalThis.SpeechSynthesisUtterance = Utterance;
globalThis.document = { addEventListener() {} };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "SamsungBrowser/27 Android" } });
const voice = await import("../src/lib/voice.js");

await test("Android run start does not queue the iPhone-only silent utterance", () => {
  utterances.length = 0;
  voice.unlock();
  assert.equal(utterances.length, 0);
});

await test("iPhone run start still unlocks speech", () => {
  utterances.length = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "iPhone Safari" } });
  voice.unlock();
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].text, " ");
});

await test("run cues stay queued in Korean until voice is turned off", () => {
  utterances.length = 0;
  const priorCancels = cancelled;
  voice.speak("러닝을 시작합니다.", { lang: "ko" });
  voice.speak("오른쪽으로 가세요.", { lang: "ko" });
  assert.deepEqual(utterances.map((item) => item.text), ["러닝을 시작합니다.", "오른쪽으로 가세요."]);
  assert.ok(utterances.every((item) => item.lang === "ko-KR"));
  assert.equal(cancelled, priorCancels);
  voice.stop();
  assert.equal(cancelled, priorCancels + 1);
});
