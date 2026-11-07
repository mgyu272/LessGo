import assert from "node:assert/strict";
import test from "node:test";

const spoken = [];
const synth = {
  speaking: false,
  pending: false,
  getVoices: () => [],
  speak(utterance) { spoken.push(utterance); },
  cancel() {},
};
class Utterance {
  constructor(text) { this.text = text; }
}
globalThis.window = { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
globalThis.SpeechSynthesisUtterance = Utterance;
globalThis.document = { addEventListener() {} };

const voice = await import("../src/lib/voice.js");

await test("place narration is queued in short parts without losing words", () => {
  spoken.length = 0;
  const text = Array(24).fill("성북의 길을 따라 걸으며 장소의 이야기를 들어 보세요.").join(" ");
  let started = 0, ended = 0;
  voice.speak(text, { lang: "ko", queue: false, chunk: true, onstart: () => started++, onend: () => ended++ });
  assert.ok(spoken.length > 1);
  assert.ok(spoken.every((item) => item.text.length <= 160));
  assert.equal(spoken.map((item) => item.text).join(" ").replace(/\s+/g, " "), text);
  spoken.forEach((item) => { item.onstart?.(); item.onend?.(); });
  assert.equal(started, 1);
  assert.equal(ended, 1);
});

await test("a speech engine error is reported instead of looking like a completed story", () => {
  spoken.length = 0;
  let ended = 0, error = null;
  voice.speak("성북의 이야기", {
    lang: "ko", queue: false, onend: () => ended++, onerror: (event) => { error = event.error; },
  });
  spoken[0].onerror({ error: "language-unavailable" });
  assert.equal(error, "language-unavailable");
  assert.equal(ended, 0);
});
