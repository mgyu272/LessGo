// 달리기 진행 (시작 → 위치 받기 → 길 안내 → 별 줍기 → 스팟 도착 → 완주)
// 별: 코스는 출발점에서 500m마다 경로 위에 별을 놓고 30m 안에 들어오면 주워요 (시연 모드도 같은 방식).
//     자유 달리기는 달린 거리 500m마다 1개. 한 번 달리기에서 같은 별은 한 번만.
//     별은 러너 활동 지수에만 사용하며 쿠폰으로 자동 교환하지 않아요.
// 걷기 모드(move: "walk")도 같은 흐름이에요. 별·쿠폰·음성 안내·일시정지는 똑같고, 화면 표시와 기록의 move만 달라요.
// 달리기는 화면을 옮겨 다녀도(스팟·가게·쿠폰 화면) 계속 이어져야 해서, 화면 밖(여기)에서 관리해요.

import { useCallback, useRef, useState } from "react";
import { createTracker } from "../lib/gps.js";
import { distance, fmtDist, fmtTime } from "../lib/geo.js";
import { ascentOf } from "../lib/data.js";
import { t, loc, getLang } from "../lib/i18n.js";
import * as voice from "../lib/voice.js";
import { STAR_RULES } from "./useUserData.js";
import { HOME_CENTER } from "./AppContext.jsx";

export function useRun({ dataRef, userRef, moveRef, go, setSpot, setFinish, toast }) {
  const ref = useRef(null);        // 달리는 중 계속 바뀌는 값 (화면을 다시 그리지 않아도 되는 것)
  const [view, setView] = useState(null); // 화면에 보여줄 숫자들

  const push = useCallback(() => {
    const r = ref.current; if (!r) return;
    const seconds = r.tracker ? r.tracker.elapsed() : 0;
    let pill = r.pill;
    if (!r.course) pill = t("no_spot", { km: (r.meters / 1000).toFixed(1), t: fmtTime(seconds) });
    setView({
      course: r.course, demo: r.demo, move: r.move, meters: r.meters, seconds, ascent: currentAscent(r),
      pill, cue: r.cue, paused: r.paused, nextCue: nextCue(r), cueDone: r.cueDone,
      trail: r.trail.slice(), me: r.me, freeShops: r.freeShops, courseDone: r.courseDone, visited: [...r.visited],
      stars: r.stars.map((x) => ({ at: x.at, got: x.got })), starsGot: r.starsGot, starsTotal: r.stars.length,
      nextStarM: nextStarM(r), starBalance: userRef.current.getStarBalance(), couponsMade: r.coupons.length,
      progress: r.course ? Math.min(1, r.meters / r.course.len) : null, voice: r.voice,
    });
  }, []);

  // 길 안내 음성. 음성을 끄면 화면 안내만 남아요 (화면 표시는 nextCue가 맡아요)
  const speakCue = useCallback((text) => {
    if (ref.current.voice) voice.speak(text, { lang: getLang() });
  }, []);

  // 완주 같은 알림: 음성 + 잠깐 화면에 표시
  const showCue = useCallback((text) => {
    const r = ref.current;
    r.cue = text;
    speakCue(text);
    clearTimeout(r.cueTimer);
    r.cueTimer = setTimeout(() => { if (ref.current) { ref.current.cue = null; push(); } }, 9000);
  }, [push, speakCue]);

  // 안내 지점을 지나면 "잘 꺾었어요"를 2초 보여주고 다음 안내로 넘어가요
  const trackCuePassed = useCallback((r, p) => {
    const done = advanceCues(r, p);
    if (!done) return;
    r.cueDone = done;
    clearTimeout(r.cueDoneTimer);
    r.cueDoneTimer = setTimeout(() => { if (ref.current) { ref.current.cueDone = null; push(); } }, CUE_DONE_MS);
  }, [push]);

  // 별 1개 줍기 → 저장, "별 +1" 알림, 10개가 모이면 쿠폰
  const pickStar = useCallback((r) => {
    const user = userRef.current;
    r.starsGot++;
    user.addBonus(1, "run_star");
    toast(t("star_plus"));

  }, [dataRef, userRef, toast]);

  const onPosition = useCallback((p, info = {}) => {
    const r = ref.current; if (!r || r.ended) return;
    const { spots, spotById, shops } = dataRef.current;
    const user = userRef.current;
    r.me = [p.lat, p.lng];
    if (r.paused) return push();

    // 거리 누적 (2m 미만 떨림은 무시)
    const prev = r.last;
    if (r.last) {
      const d = distance(r.last, p);
      if (d < 2) return;
      r.meters += d;
    }
    r.last = p;
    r.trail.push([p.lat, p.lng]);

    // 실제 GPS 고도가 있으면 오르막 누적
    if (p.altitude != null) {
      if (r.lastAlt != null && p.altitude - r.lastAlt > 1) r.altUp += p.altitude - r.lastAlt;
      if (r.lastAlt == null || Math.abs(p.altitude - r.lastAlt) > 1) r.lastAlt = p.altitude;
    }

    // 별 줍기: 코스는 지난 위치~지금 위치 사이 선분이 별 30m 안을 지나면 (위치가 띄엄띄엄 와도 놓치지 않게)
    if (r.course) {
      r.stars.forEach((st) => {
        if (st.got || segmentDistance(st.at, prev || p, p) > STAR_RULES.pickM) return;
        st.got = true; pickStar(r);
      });
    } else {
      // 자유 달리기: 달린 거리 500m마다 1개
      while (r.meters >= (r.starsGot + 1) * STAR_RULES.everyM) pickStar(r);
    }

    // 길 안내: 안내 지점 25m 안에 들어오면 한 번 말해요
    if (r.course) {
      r.course.cues.forEach((c, i) => {
        if (r.cuesFired.has(i) || distance(p, c.pos) > 25) return;
        r.cuesFired.add(i);
        if (i > 0) speakCue(loc(c.text)); // 출발 안내는 시작할 때 이미 말했어요
      });
      trackCuePassed(r, p);
    }

    // 스팟 도착 → 도장 찍고 도착 화면(해설)으로
    const arrive = (spot) => {
      r.visited.add(spot.id);
      if (user.addStamp(spot.id)) r.newStamps++;
      if (r.demo) r.tracker.pause(); // 시연 모드는 해설 듣는 동안 멈춰요
      r.arrivedAt = Date.now();
      push();
      setSpot(spot);
      go("spot");
    };
    const candidates = r.course ? r.course.properties.spots.map((id) => spotById[id]) : spots;
    const next = candidates.filter((s) => s && !r.visited.has(s.id))
      .map((s) => ({ s, d: distance(p, s) })).sort((a, b) => a.d - b.d)[0];
    if (next && next.d <= next.s.radius_m) return arrive(next.s);
    if (r.course) r.pill = next ? t("next_spot", { d: fmtDist(next.d) }) : t("all_spots");
    else r.freeShops = shops.filter((s) => s.partner).map((s) => ({ s, d: distance(p, s) }))
      .filter((x) => x.d < 600).sort((a, b) => a.d - b.d).slice(0, 3);

    // 코스 끝까지 가면(완주): 목적지 도착을 아직 못 했으면 도착 화면으로 넘어가요
    // (코스는 지하철 출구 → 목적지라 끝점이 목적지예요. 반경 판정이 빗나가도 완주하면 해설을 들을 수 있게)
    if (info.progress >= 1 && !r.courseDone) {
      r.courseDone = true;
      const dest = r.course && spotById[r.course.properties.dest];
      if (dest && !r.visited.has(dest.id)) return arrive(dest);
      showCue(getLang() === "ko" ? "코스 완주! 종료 버튼을 길게 눌러 기록을 저장하세요." : "Course complete! Press and hold Finish to save your run.");
    }
    push();
  }, [dataRef, userRef, go, setSpot, push, showCue, speakCue, trackCuePassed, pickStar]);

  // move: "run" | "walk". 안 넘기면 코스는 코스 고르기에서 고른 값, 자유 달리기는 달리기
  const start = useCallback((course, { demo, speedup, move }) => {
    voice.unlock();          // 아이폰: 버튼을 누른 이 순간에 음성을 깨워야 해요
    voice.keepScreenOn();
    const { courses } = dataRef.current;
    // 자유 달리기 시연은 첫 코스 길을 따라가요 (코스 데이터가 없으면 성북구 중심에서 제자리)
    const simPath = course ? course.path : courses[0]?.path || [{ lat: HOME_CENTER[0], lng: HOME_CENTER[1] }];
    const r = ref.current = {
      course, demo, simPath, move: (move || (course && moveRef?.current)) === "walk" ? "walk" : "run", meters: 0, last: null, trail: [], visited: new Set(),
      cuesFired: new Set(), cuesPassed: new Set([0]), cueClosest: new Map(), cueDone: null, paused: false, ended: false, altUp: 0, lastAlt: null,
      stars: course ? starPoints(course.path).map((at) => ({ at, got: false })) : [], starsGot: 0, coupons: [],
      cue: null, pill: demo ? "" : t("gps_waiting"), newStamps: 0, courseDone: false,
      me: [simPath[0].lat, simPath[0].lng], freeShops: [], voice: true,
    };
    r.tracker = createTracker({
      demo, path: simPath, speedup, onPosition,
      onError: (e) => { r.pill = e.code === 1 ? t("gps_denied") : t("gps_waiting"); push(); },
    });
    r.tracker.start();
    r.clock = setInterval(push, 1000);
    if (course) { r.cuesFired.add(0); voice.speak(loc(course.cues[0]?.text) || "", { lang: getLang() }); }
    push();
    go("run");
  }, [dataRef, moveRef, onPosition, push, go]);

  const togglePause = useCallback(() => {
    const r = ref.current; if (!r) return;
    r.paused = !r.paused;
    if (r.paused) r.tracker.pause(); else { r.tracker.resume(); r.last = null; } // 쉬는 동안 이동한 거리는 빼요
    push();
  }, [push]);

  // 달리는 중 음성 안내 켜기·끄기
  const toggleVoice = useCallback(() => {
    const r = ref.current; if (!r) return;
    r.voice = !r.voice;
    if (!r.voice) voice.stop();
    push();
  }, [push]);

  // 스팟·가게·쿠폰 화면에서 "달리기 이어가기"
  const resume = useCallback(() => {
    voice.stop();
    const r = ref.current;
    if (!r || r.ended) return go("home");
    if (r.demo && !r.paused) r.tracker.resume();
    go("run");
  }, [go]);

  const finish = useCallback(() => {
    const r = ref.current; if (!r || r.ended) return;
    const user = userRef.current;
    r.ended = true;
    r.tracker.stop(); clearInterval(r.clock); clearTimeout(r.cueTimer); clearTimeout(r.cueDoneTimer);
    voice.stop(); voice.releaseScreen();
    const seconds = r.tracker.elapsed();

    const record = {
      id: "r" + Date.now(), date: Date.now(), courseId: r.course?.id || null,
      name: r.course ? r.course.properties.name : { en: "Free run", ko: "자유 달리기" },
      meters: Math.round(r.meters), seconds: Math.round(seconds), stamps: r.visited.size, starsGot: r.starsGot, move: r.move,
    };
    user.addRun(record);
    setFinish({ record, coupons: r.coupons.slice(), trail: r.trail.slice(), course: r.course, starsGot: r.starsGot, move: r.move });
    ref.current = null;
    setView(null);
    go("finish");
  }, [userRef, setFinish, go]);

  return { view, start, togglePause, toggleVoice, resume, finish, isRunning: () => !!ref.current, arrivedAt: () => ref.current?.arrivedAt };
}

// 안내 지점을 지났다고 보는 기준: 음성은 25m 앞에서 나오고, 화면은 실제로 지날 때까지 거리를 보여줘요
const CUE_REACHED_M = 8; // 이만큼 가까이 가면 지난 걸로
const CUE_LEFT_M = 5;    // 가장 가까웠던 때보다 이만큼 멀어져도 지난 걸로
const CUE_DONE_MS = 2000;

// 안내 방향: cue에 값이 있으면 그걸, 없으면 문구에서 찾아요
function cueDir(c) {
  if (c.dir) return c.dir;
  const text = `${c.text?.ko || ""} ${c.text?.en || ""}`;
  if (/오른쪽|우회전|\bright\b/i.test(text)) return "right";
  if (/왼쪽|좌회전|\bleft\b/i.test(text)) return "left";
  return "straight";
}

// 아직 지나지 않은 안내 중 가장 가까운 것 { i, text, m, dir }
export function nextCue(r) {
  if (!r.course) return null;
  const here = { lat: r.me[0], lng: r.me[1] };
  let best = null;
  r.course.cues.forEach((c, i) => {
    if (r.cuesPassed.has(i)) return;
    const m = distance(here, c.pos);
    if (!best || m < best.m) best = { i, m, c };
  });
  return best && { i: best.i, text: loc(best.c.text), m: Math.round(best.m), dir: cueDir(best.c) };
}

export function advanceCues(r, p) {
  const cur = nextCue(r);
  if (!cur) return null;
  let completed = false;
  r.course.cues.forEach((cue, i) => {
    if (r.cuesPassed.has(i) || !r.cuesFired.has(i)) return;
    const d = distance(p, cue.pos);
    const closest = Math.min(r.cueClosest.get(i) ?? Infinity, d);
    r.cueClosest.set(i, closest);
    if (d > CUE_REACHED_M && (closest > 25 || d < closest + CUE_LEFT_M)) return;
    r.cuesPassed.add(i);
    r.cueClosest.delete(i);
    if (i === cur.i) completed = true;
  });
  return completed ? { dir: cur.dir } : null;
}

function currentAscent(r) {
  if (r.altUp > 0 || !r.course) return Math.round(r.altUp);
  const frac = Math.min(1, r.meters / r.course.len);
  return ascentOf(r.course.properties.elevation || [], frac);
}

// 코스 경로 위 출발점에서 500m마다 별 자리 [lat, lng] (3km 코스면 6개). 코스 데이터는 그대로 두고 계산만 해요
export function starPoints(path, every = STAR_RULES.everyM) {
  const out = [];
  let acc = 0, next = every;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], d = distance(a, b);
    while (d > 0 && acc + d >= next) {
      const f = (next - acc) / d;
      out.push([a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f]);
      next += every;
    }
    acc += d;
  }
  // 끝이 500m 단위에 몇 m 못 미쳐도(예: 2.97km) 마지막 별은 끝점에 둬요
  if (acc >= next - 60) out.push([path[path.length - 1].lat, path[path.length - 1].lng]);
  return out;
}

// 점과 선분 사이 최단 거리 (m). 짧은 거리라 평면으로 근사해요
function segmentDistance([lat, lng], a, b) {
  const k = 111320, kx = k * Math.cos((lat * Math.PI) / 180);
  const px = (lng - a.lng) * kx, py = (lat - a.lat) * k, bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * k;
  const len2 = bx * bx + by * by;
  const tt = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - bx * tt, py - by * tt);
}

// 다음 별까지 (m): 코스는 안 주운 별 중 가장 가까운 별까지 직선거리, 자유 달리기는 다음 500m까지 남은 거리
function nextStarM(r) {
  if (!r.course) return Math.round(STAR_RULES.everyM - (r.meters % STAR_RULES.everyM));
  const here = { lat: r.me[0], lng: r.me[1] };
  const left = r.stars.filter((x) => !x.got).map((x) => distance(here, { lat: x.at[0], lng: x.at[1] }));
  return left.length ? Math.round(Math.min(...left)) : null;
}

// 쿠폰 가게: shops.json의 kakao- 가게 중 이번 목적지(near)와 같은 곳(목적지에서 가장 가까운 곳),
// 자유 달리기면 지금 위치에서 가장 가까운 곳
function couponShop(r, data) {
  const kakao = data.shops.filter((s) => s.id.startsWith("kakao-"));
  const dest = r.course && data.spotById[r.course.properties.dest];
  const pool = dest ? kakao.filter((s) => s.near === dest.id) : kakao;
  const from = dest || { lat: r.me[0], lng: r.me[1] };
  return pool.map((s) => ({ s, d: distance(from, s) })).sort((a, b) => a.d - b.d)[0]?.s || null;
}
