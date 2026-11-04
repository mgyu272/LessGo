// 달리기 진행 (시작 → 위치 받기 → 길 안내 → 영역 → 스팟 도착 → 완주)
// 달리기는 화면을 옮겨 다녀도(스팟·가게·쿠폰 화면) 계속 이어져야 해서, 화면 밖(여기)에서 관리해요.

import { useCallback, useRef, useState } from "react";
import { createTracker } from "../lib/gps.js";
import { distance, fmtDist, fmtTime } from "../lib/geo.js";
import { cellsBetween } from "../lib/territory.js";
import { ascentOf } from "../lib/data.js";
import { t, loc, getLang } from "../lib/i18n.js";
import * as voice from "../lib/voice.js";
import { STAR_RULES } from "./useUserData.js";
import { HOME_CENTER } from "./AppContext.jsx";

export function useRun({ dataRef, userRef, go, setSpot, setFinish }) {
  const ref = useRef(null);        // 달리는 중 계속 바뀌는 값 (화면을 다시 그리지 않아도 되는 것)
  const [view, setView] = useState(null); // 화면에 보여줄 숫자들

  const push = useCallback(() => {
    const r = ref.current; if (!r) return;
    const seconds = r.tracker ? r.tracker.elapsed() : 0;
    let pill = r.pill;
    if (!r.course) pill = t("no_spot", { km: (r.meters / 1000).toFixed(1), t: fmtTime(seconds) });
    setView({
      course: r.course, demo: r.demo, meters: r.meters, seconds, ascent: currentAscent(r),
      pill, cue: r.cue, newCells: r.newCells.length, paused: r.paused,
      trail: r.trail.slice(), me: r.me, freeShops: r.freeShops, courseDone: r.courseDone,
      fresh: r.newCells.slice(-6), visited: [...r.visited],
      progress: r.course ? Math.min(1, r.meters / r.course.len) : null,
    });
  }, []);

  const showCue = useCallback((text) => {
    const r = ref.current;
    r.cue = text;
    voice.speak(text, { lang: getLang() });
    clearTimeout(r.cueTimer);
    r.cueTimer = setTimeout(() => { if (ref.current) { ref.current.cue = null; push(); } }, 9000);
  }, [push]);

  const onPosition = useCallback((p, info = {}) => {
    const r = ref.current; if (!r || r.ended) return;
    const { spots, spotById, shops } = dataRef.current;
    const user = userRef.current;
    r.me = [p.lat, p.lng];
    if (r.paused) return push();

    // 거리 누적 (2m 미만 떨림은 무시)
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

    // 육각형 영역
    const { cell, path } = cellsBetween(r.lastCell, p);
    r.lastCell = cell;
    const fresh = path.filter((c) => !user.hasCell(c));
    if (fresh.length) { r.newCells.push(...fresh); user.addCells(fresh); }

    // 길 안내: 안내 지점 25m 안에 들어오면 한 번 말해요
    if (r.course) {
      r.course.cues.forEach((c, i) => {
        if (r.cuesFired.has(i) || distance(p, c.pos) > 25) return;
        r.cuesFired.add(i);
        if (i > 0) showCue(loc(c.text)); // 출발 안내는 시작할 때 이미 말했어요
      });
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
      showCue(getLang() === "ko" ? "코스 완주! 종료 버튼을 눌러 기록을 저장하세요." : "Course complete! Tap Finish to save your run.");
    }
    push();
  }, [dataRef, userRef, go, setSpot, push, showCue]);

  const start = useCallback((course, { demo, speedup }) => {
    voice.unlock();          // 아이폰: 버튼을 누른 이 순간에 음성을 깨워야 해요
    voice.keepScreenOn();
    const { courses } = dataRef.current;
    // 자유 달리기 시연은 첫 코스 길을 따라가요 (코스 데이터가 없으면 성북구 중심에서 제자리)
    const simPath = course ? course.path : courses[0]?.path || [{ lat: HOME_CENTER[0], lng: HOME_CENTER[1] }];
    const r = ref.current = {
      course, demo, simPath, meters: 0, last: null, trail: [], newCells: [], visited: new Set(),
      cuesFired: new Set(), paused: false, ended: false, altUp: 0, lastAlt: null, lastCell: null,
      cue: null, pill: demo ? "" : t("gps_waiting"), newStamps: 0, courseDone: false,
      me: [simPath[0].lat, simPath[0].lng], freeShops: [],
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
  }, [dataRef, onPosition, push, go]);

  const togglePause = useCallback(() => {
    const r = ref.current; if (!r) return;
    r.paused = !r.paused;
    if (r.paused) r.tracker.pause(); else { r.tracker.resume(); r.last = null; } // 쉬는 동안 이동한 거리는 빼요
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
    const { shops } = dataRef.current;
    const user = userRef.current;
    r.ended = true;
    r.tracker.stop(); clearInterval(r.clock); clearTimeout(r.cueTimer);
    voice.stop(); voice.releaseScreen();
    const seconds = r.tracker.elapsed();
    const km = r.meters / 1000;

    // 달린 거리만큼 쿠폰 (예시 규칙: 1km당 500원, 최대 3,000원)
    let coupon = null;
    if (km >= 1) {
      const amount = Math.min(3000, Math.floor(km) * 500);
      const from = r.last || r.simPath[0];
      const shop = shops.filter((s) => s.partner).map((s) => ({ s, d: distance(from, s) })).sort((a, b) => a.d - b.d)[0]?.s;
      coupon = {
        id: "c" + Date.now(), shopId: shop?.id, issued: Date.now(),
        title: { en: `${amount.toLocaleString()} KRW off (sample)`, ko: `${amount.toLocaleString()}원 할인 (예시)` },
      };
      user.addCoupon(coupon);
    }
    const record = {
      id: "r" + Date.now(), date: Date.now(), courseId: r.course?.id || null,
      name: r.course ? r.course.properties.name : { en: "Free run", ko: "자유 달리기" },
      meters: Math.round(r.meters), seconds: Math.round(seconds), cells: r.newCells.length, stamps: r.visited.size,
    };
    user.addRun(record);
    setFinish({
      record, coupon, trail: r.trail.slice(), course: r.course,
      stars: Math.floor(km) * STAR_RULES.perKm + r.newStamps * STAR_RULES.perStamp,
    });
    ref.current = null;
    setView(null);
    go("finish");
  }, [dataRef, userRef, setFinish, go]);

  return { view, start, togglePause, resume, finish, isRunning: () => !!ref.current, arrivedAt: () => ref.current?.arrivedAt };
}

function currentAscent(r) {
  if (r.altUp > 0 || !r.course) return Math.round(r.altUp);
  const frac = Math.min(1, r.meters / r.course.len);
  return ascentOf(r.course.properties.elevation || [], frac);
}
