// 음성 안내 (브라우저 내장 음성 읽기, 무료)
// 아이폰은 사용자가 버튼을 누른 순간에 한 번 "깨워야" 그 뒤로 소리가 나요.
// 그래서 "달리기 시작" 버튼을 누를 때 unlock()을 불러요.

const synth = window.speechSynthesis;
let voices = [];
function loadVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

function pickVoice(lang) {
  const want = lang === "ko" ? "ko" : "en";
  return voices.find((v) => v.lang.startsWith(want) && /Google|Samantha|Natural|Siri/i.test(v.name))
      || voices.find((v) => v.lang.startsWith(want));
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
