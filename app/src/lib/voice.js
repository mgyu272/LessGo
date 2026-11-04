// 음성 안내 (브라우저 내장 음성 읽기, 무료)
// 아이폰은 사용자가 버튼을 누른 순간에 한 번 "깨워야" 그 뒤로 소리가 나요.
// 그래서 "달리기 시작" 버튼을 누를 때 unlock()을 불러요.

const synth = window.speechSynthesis;
let voices = [];
function loadVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

function pickVoice(lang) {
  const want = lang === "ko" ? "ko" : "en";
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(want));
  const feminineNames = /female|woman|samantha|siri|zira|jenny|aria|ava|yuna|sora|heami|susan/i;
  return matching.find((v) => v.lang.toLowerCase() === (lang === "ko" ? "ko-kr" : "en-us") && feminineNames.test(v.name))
      || matching.find((v) => feminineNames.test(v.name))
      || matching.find((v) => v.lang.toLowerCase() === (lang === "ko" ? "ko-kr" : "en-us"))
      || matching[0];
}

export function speechSupported() {
  return Boolean(synth && typeof window.SpeechSynthesisUtterance === "function");
}

// Controllable narration for the AI History Lens. Existing speak() behavior used by
// running cues and story playback remains unchanged. The returned handle controls
// only the utterance this call created, while speechSynthesis is shared by the app.
export function speakManaged(text, { lang = "en", onstart, onend, onerror, onpause, onresume } = {}) {
  if (!speechSupported() || !String(text || "").trim()) return null;
  loadVoices(); // Some mobile browsers populate the list lazily; an empty list uses their default voice.
  synth.cancel(); // Prevent overlap with a running cue or the existing story TTS.
  const utterance = new window.SpeechSynthesisUtterance(text);
  const locale = lang === "ko" ? "ko-KR" : "en-US";
  utterance.lang = locale;
  const selectedVoice = pickVoice(lang);
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.rate = lang === "ko" ? 0.94 : 0.93;
  utterance.pitch = 1.04;

  let active = true;
  utterance.onstart = () => { if (active) onstart?.(); };
  utterance.onend = () => { if (active) { active = false; onend?.(); } };
  utterance.onerror = (event) => { if (active) { active = false; onerror?.(event); } };
  utterance.onpause = () => { if (active) onpause?.(); };
  utterance.onresume = () => { if (active) onresume?.(); };
  synth.speak(utterance);

  return {
    pause() { if (active && !synth.paused) synth.pause(); },
    resume() { if (active && synth.paused) synth.resume(); },
    stop() {
      if (!active) return;
      active = false;
      synth.cancel();
    },
  };
}

export function unlock() {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  synth.speak(u);
}

// queue: true면 앞의 말이 끝난 뒤 이어서 말해요 (길 안내용)
// onboundary(charIndex): 단어를 읽기 시작할 때마다 몇 번째 글자인지 알려줘요 (지원하는 브라우저에서만)
export function speak(text, { lang = "en", queue = true, onend, onboundary } = {}) {
  if (!synth || !text) { onend?.(); return; }
  if (!queue) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "ko" ? "ko-KR" : "en-US";
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.rate = 0.98;
  u.onend = () => onend?.();
  u.onerror = () => onend?.();
  if (onboundary) u.onboundary = (e) => onboundary(e.charIndex);
  synth.speak(u);
}

export function stop() { synth?.cancel(); }

// 대략적인 재생 길이(초) — 진행 막대용
export function estimateSeconds(text, lang = "en") {
  return lang === "ko" ? text.length / 6.5 : text.split(/\s+/).length / 2.6;
}

// 달리는 동안 화면이 꺼지지 않게 (지원하는 브라우저에서만)
let lock = null;
export async function keepScreenOn() {
  try { lock = await navigator.wakeLock?.request("screen"); } catch {}
}
export function releaseScreen() { try { lock?.release(); } catch {} lock = null; }
document.addEventListener("visibilitychange", () => {
  if (lock && document.visibilityState === "visible") keepScreenOn();
});
