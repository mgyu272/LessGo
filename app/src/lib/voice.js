// 음성 안내 (브라우저 내장 음성 읽기, 무료)
// 아이폰은 사용자가 버튼을 누른 순간에 한 번 "깨워야" 그 뒤로 소리가 나요.
// 그래서 "달리기 시작" 버튼을 누를 때 unlock()을 불러요.

const synth = window.speechSynthesis;
let voices = [];
const activeSessions = new Set();
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
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios || !speechSupported()) return;
  const u = new window.SpeechSynthesisUtterance(" ");
  u.volume = 0;
  try { synth.speak(u); } catch {}
}

function speechParts(text, maxLength = 160) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const piece = text.slice(start, end);
      const breaks = [...piece.matchAll(/[.!?。！？]\s*|\s+/g)]
        .filter((match) => match.index >= maxLength / 2);
      if (breaks.length) {
        const last = breaks[breaks.length - 1];
        end = start + last.index + last[0].length;
      }
    }
    const raw = text.slice(start, end);
    const spoken = raw.trim();
    if (spoken) parts.push({ text: spoken, offset: start + raw.length - raw.trimStart().length });
    start = end;
  }
  return parts;
}

// queue: true면 앞의 말이 끝난 뒤 이어서 말해요 (길 안내용)
// onboundary(charIndex): 단어를 읽기 시작할 때마다 몇 번째 글자인지 알려줘요 (지원하는 브라우저에서만)
export function speak(text, { lang = "en", queue = true, chunk = false, onstart, onend, onerror, onboundary } = {}) {
  if (!text) { onend?.(); return false; }
  if (!speechSupported()) {
    if (onerror) onerror({ error: "synthesis-unavailable" }); else onend?.();
    return false;
  }
  if (!queue && (activeSessions.size || synth.speaking || synth.pending)) stop();
  loadVoices();
  const parts = chunk ? speechParts(text) : [{ text, offset: 0 }];
  const session = { utterances: [], cancelled: false, started: false, completed: 0, timer: null };
  const release = () => { clearTimeout(session.timer); activeSessions.delete(session); session.utterances.length = 0; };
  const fail = (event) => {
    if (session.cancelled) return;
    session.cancelled = true;
    stop();
    if (onerror) onerror(event); else onend?.();
  };
  activeSessions.add(session);
  if (chunk && !queue) {
    session.timer = setTimeout(() => {
      if (!session.started && !synth.speaking) fail({ error: "not-started" });
    }, 8000);
  }
  const selected = pickVoice(lang);
  for (const part of parts) {
    const utterance = new window.SpeechSynthesisUtterance(part.text);
    utterance.lang = lang === "ko" ? "ko-KR" : "en-US";
    if (selected) utterance.voice = selected;
    utterance.rate = 0.98;
    utterance.onstart = () => {
      if (session.cancelled || session.started) return;
      session.started = true;
      clearTimeout(session.timer);
      onstart?.();
    };
    utterance.onend = () => {
      if (session.cancelled) return;
      session.completed++;
      if (session.completed === parts.length) { release(); onend?.(); }
    };
    utterance.onerror = fail;
    if (onboundary) utterance.onboundary = (event) => onboundary(part.offset + event.charIndex);
    session.utterances.push(utterance);
    try { synth.speak(utterance); } catch (error) { fail({ error: error?.name || "synthesis-failed" }); return false; }
  }
  return true;
}

export function stop() {
  activeSessions.forEach((session) => { session.cancelled = true; clearTimeout(session.timer); session.utterances.length = 0; });
  activeSessions.clear();
  synth?.cancel();
}

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
