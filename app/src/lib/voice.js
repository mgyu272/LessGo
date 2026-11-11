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
function browserSpeak(text, { lang = "en", queue = true, chunk = false, onstart, onend, onerror, onboundary } = {}) {
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

function browserStop() {
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

 
// Gemini-generated audio. Browser synthesis remains the offline/error fallback.
// Navigation requests are serialized; a history narration interrupts queued cues.
let audioQueue = Promise.resolve();
let audioGeneration = 0;
let currentAudio = null;
let currentController = null;
const audioCache = new Map();
const MAX_AUDIO_CACHE = 24;
function fallbackSpeak(text, options) { return browserSpeak(text, options); }
// Shorter requests reduce first-audio latency and avoid sending an entire story at once.
function ttsChunks(text, limit = 220) {
  const chunks = [];
  let remaining = String(text || "").trim();
  while (remaining.length) {
    if (remaining.length <= limit) { chunks.push(remaining); break; }
    const windowText = remaining.slice(0, limit + 1);
    const breaks = [...windowText.matchAll(/[.!?。！？]\s*|\s+/g)].filter(m => m.index >= Math.floor(limit * 0.55));
    const cut = breaks.length ? breaks[breaks.length - 1].index + breaks[breaks.length - 1][0].length : limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks.filter(Boolean);
}
async function playGemini(text, options, generation) {
  if (generation !== audioGeneration) return;
  const { lang = "en", queue = true, onstart, onend, onerror, onboundary } = options;
  const chunks = ttsChunks(text, queue ? 160 : 220);
  let started = false;
  try {
    for (const chunk of chunks) {
      if (generation !== audioGeneration) return;
      const key = JSON.stringify([chunk, lang, queue ? "navigation" : "history"]);
      let blob = audioCache.get(key);
      if (!blob) {
        const controller = new AbortController();
        currentController = controller;
        const response = await fetch("/api/tts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk, lang, purpose: queue ? "navigation" : "history" }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const details = await response.json().catch(() => ({}));
          throw new Error(details.error || "gemini-tts-unavailable");
        }
        blob = await response.blob();
        if (!blob.size || !blob.type.startsWith("audio/")) throw new Error("invalid-tts-audio");
        audioCache.set(key, blob);
        if (audioCache.size > MAX_AUDIO_CACHE) audioCache.delete(audioCache.keys().next().value);
      }
      if (generation !== audioGeneration) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      try {
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = () => reject(new Error("audio-playback-failed"));
          audio.onplay = () => { if (!started) { started = true; onstart?.(); } };
          audio.play().catch(reject);
        });
      } finally {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
      }
    }
    if (generation === audioGeneration) { onboundary?.(text.length); onend?.(); }
  } catch (error) {
    if (generation !== audioGeneration || error?.name === "AbortError") return;
    console.error("[Gemini TTS] playback failed", error);
    if (started) { onerror?.(error); onend?.(); return; }
    fallbackSpeak(text, { ...options, onerror: (event) => { if (onerror) onerror(event); else onend?.(); } });
  } finally {
    currentController = null;
  }
}
export function speak(text, options = {}) {
  if (!text) { options.onend?.(); return false; }
  const queue = options.queue !== false;
  if (!queue) stop();
  const generation = audioGeneration;
  const run = () => playGemini(text, options, generation);
  audioQueue = audioQueue.catch(() => {}).then(run);
  return true;
}
export function stop() {
  audioGeneration++;
  currentController?.abort();
  currentController = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute("src");
    currentAudio.load();
    currentAudio = null;
  }
  audioQueue = Promise.resolve();
  browserStop();
}
