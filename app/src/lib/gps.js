// 위치 받기: 실제 GPS와 시연 모드(가짜 이동)를 같은 모양으로 만들어 둬요.
// 앱의 나머지 코드는 둘 중 무엇을 쓰는지 몰라도 돼요.
//
//   const tracker = createTracker({ demo: true, path, onPosition, onError });
//   tracker.start();  tracker.pause();  tracker.resume();  tracker.stop();
//   tracker.elapsed()  → 달린 시간(초)

import { distance, lineLength, pointAlong } from "./geo.js";

const MAX_ACCURACY_M = 35;   // 오차가 이보다 큰 위치는 버려요
const MAX_SPEED_MPS = 8;     // 초속 8m(시속 29km)보다 빠르게 튄 값은 버려요 (GPS 튐·자전거·차)

export function createTracker({ demo, path, onPosition, onError, speedup = 10, runSpeed = 2.9 }) {
  return demo
    ? simulator({ path, onPosition, speedup, runSpeed })
    : realGps({ onPosition, onError });
}

// ---------------- 실제 GPS ----------------
function realGps({ onPosition, onError }) {
  let watchId = null, paused = false, last = null;
  let activeMs = 0, since = null;

  function handle(pos) {
    const { latitude: lat, longitude: lng, accuracy, altitude } = pos.coords;
    if (accuracy > MAX_ACCURACY_M) return;
    const p = { lat, lng, accuracy, altitude, t: pos.timestamp };
    if (last) {
      const dt = (p.t - last.t) / 1000;
      const d = distance(last, p);
      if (dt > 0 && d / dt > MAX_SPEED_MPS) return;
    }
    last = p;
    onPosition(p, { paused });
  }

  return {
    start() {
      if (!("geolocation" in navigator)) { onError?.({ code: 0 }); return; }
      since = Date.now();
      watchId = navigator.geolocation.watchPosition(handle, (e) => onError?.(e), {
        enableHighAccuracy: true, maximumAge: 0, timeout: 20000,
      });
    },
    pause() { if (!paused) { activeMs += Date.now() - since; paused = true; } },
    resume() { if (paused) { since = Date.now(); paused = false; } },
    stop() { this.pause(); if (watchId != null) navigator.geolocation.clearWatch(watchId); },
    elapsed() { return (activeMs + (paused ? 0 : Date.now() - since)) / 1000; },
    isDemo: false,
  };
}

// ---------------- 시연 모드 ----------------
// 코스 선을 따라 runSpeed(m/s)로 달리는 것처럼 움직여요. speedup배 빠르게 재생해요.
function simulator({ path, onPosition, speedup, runSpeed }) {
  const total = lineLength(path);
  let timer = null, paused = false, virtualMs = 0, lastTick = 0, done = false;

  function tick() {
    const now = Date.now();
    if (!paused && !done) virtualMs += (now - lastTick) * speedup;
    lastTick = now;
    if (paused || done) return;
    const meters = Math.min(total, (virtualMs / 1000) * runSpeed);
    const p = pointAlong(path, meters);
    // 실제 GPS처럼 아주 약간 흔들어요
    p.lat += (Math.random() - 0.5) * 0.00002;
    p.lng += (Math.random() - 0.5) * 0.00002;
    onPosition({ ...p, accuracy: 5, altitude: null, t: now }, { paused, progress: meters / total });
    if (meters >= total) done = true;
  }

  return {
    start() { lastTick = Date.now(); tick(); timer = setInterval(tick, 400); },
    pause() { tick(); paused = true; },
    resume() { lastTick = Date.now(); paused = false; },
    stop() { clearInterval(timer); },
    elapsed() { return virtualMs / 1000; },
    isDemo: true,
  };
}
