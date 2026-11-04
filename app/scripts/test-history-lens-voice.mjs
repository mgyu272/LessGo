import assert from "node:assert/strict";

class MockUtterance {
  constructor(text) { this.text = text; }
}

const voices = [
  { name: "Default English", lang: "en-US" },
  { name: "Samantha", lang: "en-US" },
  { name: "Default Korean", lang: "ko-KR" },
  { name: "Yuna", lang: "ko-KR" },
];
const synth = {
  paused: false,
  cancelCount: 0,
  spoken: [],
  current: null,
  getVoices() { return voices; },
  cancel() { this.cancelCount++; this.paused = false; },
  speak(utterance) { this.current = utterance; this.spoken.push(utterance); utterance.onstart?.(); },
  pause() { this.paused = true; this.current?.onpause?.(); },
  resume() { this.paused = false; this.current?.onresume?.(); },
};
globalThis.window = { speechSynthesis: synth, SpeechSynthesisUtterance: MockUtterance };
globalThis.document = { addEventListener() {} };
const voice = await import("../src/lib/voice.js?history-lens-test");

assert.equal(voice.speechSupported(), true);
let state = "idle";
const koreanText = "정자각은 왕릉 제향 공간입니다.";
const korean = voice.speakManaged(koreanText, {
  lang: "ko",
  onstart: () => { state = "speaking"; },
  onpause: () => { state = "paused"; },
  onresume: () => { state = "speaking"; },
  onend: () => { state = "idle"; },
});
assert.equal(synth.current.text, koreanText, "only explanation text is submitted to TTS");
assert.equal(synth.current.lang, "ko-KR");
assert.equal(synth.current.voice.name, "Yuna", "prefer a feminine-sounding matching locale voice when available");
assert.equal(state, "speaking");
korean.pause(); assert.equal(state, "paused"); assert.equal(synth.paused, true);
korean.resume(); assert.equal(state, "speaking"); assert.equal(synth.paused, false);
korean.stop(); assert.equal(synth.paused, false);

const englishText = "Jeongjagak is a royal tomb ritual building.";
const english = voice.speakManaged(englishText, { lang: "en", onend: () => { state = "idle"; } });
assert.equal(synth.current.text, englishText);
assert.equal(synth.current.lang, "en-US");
assert.equal(synth.current.voice.name, "Samantha");
synth.current.onend();
assert.equal(state, "idle", "ended speech can be played again");
const beforeRestart = synth.spoken.length;
voice.speakManaged(englishText, { lang: "en" });
assert.equal(synth.spoken.length, beforeRestart + 1);
assert.ok(synth.cancelCount >= 3, "managed playback cancels other app speech before starting to avoid overlap");
english.stop();

console.log("History Lens TTS tests passed: Korean/English locale, preferred voice fallback, pause/resume/stop, end/replay, and shared TTS cancellation.");
