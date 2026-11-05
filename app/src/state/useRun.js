// 달리기 진행 (시작 → 위치 받기 → 길 안내 → 별 줍기 → 스팟 도착 → 완주)
// 별: 코스는 출발점에서 500m마다 경로 위에 별을 놓고 30m 안에 들어오면 주워요 (시연 모드도 같은 방식).
//     자유 달리기는 달린 거리 500m마다 1개. 한 번 달리기에서 같은 별은 한 번만.
//     별 10개가 모이면 바로 쿠폰 1장(제휴 협의 중)을 만들고 별 10개를 빼요.
// 달리기는 화면을 옮겨 다녀도(스팟·가게·쿠폰 화면) 계속 이어져야 해서, 화면 밖(여기)에서 관리해요.

import { useCallback, useRef, useState } from "react";
import { createTracker } from "../lib/gps.js";
import { distance, fmtDist, fmtTime } from "../lib/geo.js";
import { ascentOf } from "../lib/data.js";
import { t, loc, getLang } from "../lib/i18n.js";
import * as voice from "../lib/voice.js";
import { STAR_RULES } from "./useUserData.js";
import { HOME_CENTER } from "./AppContext.jsx";

export function useRun({ dataRef, userRef, go, setSpot, setFinish, toast }) {
  const ref = useRef(null);        // 달리는 중 계속 바뀌는 값 (화면을 다시 그리지 않아도 되는 것)
  const [view, setView] = useState(null); // 화면에 보여줄 숫자들

  const push = useCallback(() => {
    const r = ref.current; if (!r) return;
    const seconds = r.tracker ? r.tracker.elapsed() : 0;
    let pill = r.pill;
    if (!r.course) pill = t("no_spot", { km: (r.meters / 1000).toFixed(1), t: fmtTime(seconds) });
    setView({
      course: r.course, demo: r.demo, meters: r.meters, seconds, ascent: currentAscent(r),
      pill, cue: r.cue, paused: r.paused,
      trail: r.trail.slice(), me: r.me, freeShops: r.freeShops, courseDone: r.courseDone, visited: [...r.visited],
      stars: r.stars.map((x) => ({ at: x.at, got: x.got })), starsGot: r.starsGot, starsTotal: r.stars.length,
      nextStarM: nextStarM(r), starBalance: userRef.current.getStarBalance(), couponsMade: r.coupons.length,
      progress: r.course ? Math.min(1, r.courseM / r.course.len) : null, courseM: r.courseM,
      approach: r.course && !r.joined, voice: r.voice,
    });
  }, []);

  const showCue = useCallback((text) => {
    const r = ref.current;
    r.cue = text;
    if (r.voice) voice.speak(text, { lang: getLang() }); // 음성을 끄면 화면 안내만
    clearTimeout(r.cueTimer);
    r.cueTimer = setTimeout(() => { if (ref.current) { ref.current.cue = null; push(); } }, 9000);
  }, [push]);

  // 별 1개 줍기 → 저장, "별 +1" 알림, 10개가 모이면 쿠폰
  const pickStar = useCallback((r) => {
    const user = userRef.current;
    r.starsGot++;
    user.addBonus(1, "run_star");
    toast(t("star_plus"));
    while (user.getStarBalance() >= STAR_RULES.perCoupon) {
      const shop = couponShop(r, dataRef.current);
      const coupon = { id: "c" + Date.now() + "-" + r.coupons.length, shopId: shop?.id || null, issued: Date.now(), pending: true, title: null };
      user.addCoupon(coupon);
      user.addBonus(-STAR_RULES.perCoupon, "coupon");
      r.coupons.push(coupon);
      toast(t("coupon_made"));
    }
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

    // 코스 위 진행 거리: 코스 선 40m 안에 있을 때만 코스 위 위치로 계산해요 (뒤로 가거나 튀는 값은 무시)
    if (r.course) {
      const on = alongPath(r.course.path, r.cum, p);
      if (on.off <= 40) {
        if (!r.joined) { r.joined = true; showCue(getLang() === "ko" ? "코스에 들어왔어요. 안내를 시작할게요." : "You're on the course. Guidance starts now."); }
        if (on.along > r.courseM && on.along - r.courseM < 400) r.courseM = on.along;
      }
    }

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
    if (r.course && !r.joined) r.pill = (getLang() === "ko" ? "코스 출발지까지 " : "To course start ") + fmtDist(distance(p, r.course.path[0]));
    else if (r.course) r.pill = next ? t("next_spot", { d: fmtDist(next.d) }) : t("all_spots");
    else r.freeShops = shops.filter((s) => s.partner).map((s) => ({ s, d: distance(p, s) }))
      .filter((x) => x.d < 600).sort((a, b) => a.d - b.d).slice(0, 3);

    // 코스 끝까지 가면(완주): 목적지 도착을 아직 못 했으면 도착 화면으로 넘어가요
    // (코스는 지하철 출구 → 목적지라 끝점이 목적지예요. 반경 판정이 빗나가도 완주하면 해설을 들을 수 있게)
    const finished = info.progress >= 1 || (r.course && r.joined && r.courseM >= r.course.len - 30);
    if (finished && !r.courseDone) {
      r.courseDone = true;
      const dest = r.course && spotById[r.course.properties.dest];
      if (dest && !r.visited.has(dest.id)) return arrive(dest);
      showCue(getLang() === "ko" ? "코스 완주! 종료 버튼을 눌러 기록을 저장하세요." : "Course complete! Tap Finish to save your run.");
    }
    push();
  }, [dataRef, userRef, go, setSpot, push, showCue, pickStar]);

  // 항상 실제 GPS로 달려요 (시연 모드 없음). here: 시작 전에 받은 현재 위치, approach: 코스 출발지에서 먼 곳에서 시작
  const start = useCallback((course, { here = null, approach = false } = {}) => {
    const demo = false, speedup = 1;
    voice.unlock();          // 아이폰: 버튼을 누른 이 순간에 음성을 깨워야 해요
    voice.keepScreenOn();
    const { courses } = dataRef.current;
    // 자유 달리기 시연은 첫 코스 길을 따라가요 (코스 데이터가 없으면 성북구 중심에서 제자리)
    const simPath = course ? course.path : courses[0]?.path || [{ lat: HOME_CENTER[0], lng: HOME_CENTER[1] }];
    const r = ref.current = {
      course, demo, simPath, meters: 0, last: null, trail: [], visited: new Set(),
      cuesFired: new Set(), paused: false, ended: false, altUp: 0, lastAlt: null,
      stars: course ? starPoints(course.path).map((at) => ({ at, got: false })) : [], starsGot: 0, coupons: [],
      cue: null, pill: demo ? "" : t("gps_waiting"), newStamps: 0, courseDone: false,
      me: here ? [here.lat, here.lng] : null, freeShops: [], voice: true,
      courseM: 0, joined: course ? !approach : true, cum: course ? cumulative(course.path) : null,
    };
    r.tracker = createTracker({
      demo, path: simPath, speedup, onPosition,
      onError: (e) => { r.pill = e.code === 1 ? t("gps_denied") : t("gps_waiting"); push(); },
    });
    r.tracker.start();
    r.clock = setInterval(push, 1000);
    if (course && !approach) { r.cuesFired.add(0); voice.speak(loc(course.cues[0]?.text) || "", { lang: getLang() }); }
    if (course && approach) voice.speak(getLang() === "ko" ? "코스 출발지로 이동하세요. 가는 길도 기록돼요." : "Head to the course start. This part is recorded too.", { lang: getLang() });
    push();
    go("run");
  }, [dataRef, onPosition, push, go]);

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
    r.tracker.stop(); clearInterval(r.clock); clearTimeout(r.cueTimer);
    voice.stop(); voice.releaseScreen();
    const seconds = r.tracker.elapsed();

    const record = {
      id: "r" + Date.now(), date: Date.now(), courseId: r.course?.id || null,
      name: r.course ? r.course.properties.name : { en: "Free run", ko: "자유 달리기" },
      meters: Math.round(r.meters), seconds: Math.round(seconds), stamps: r.visited.size, starsGot: r.starsGot,
    };
    user.addRun(record);
    setFinish({ record, coupons: r.coupons.slice(), trail: r.trail.slice(), course: r.course, starsGot: r.starsGot });
    ref.current = null;
    setView(null);
    go("finish");
  }, [userRef, setFinish, go]);

  return { view, start, togglePause, toggleVoice, resume, finish, isRunning: () => !!ref.current, arrivedAt: () => ref.current?.arrivedAt };
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
  if (!r.me) return null;
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
  const from = dest || (r.me ? { lat: r.me[0], lng: r.me[1] } : { lat: HOME_CENTER[0], lng: HOME_CENTER[1] });
  return pool.map((s) => ({ s, d: distance(from, s) })).sort((a, b) => a.d - b.d)[0]?.s || null;
}

// 코스 선의 시작점부터 각 점까지 누적 거리 (m)
function cumulative(path) {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + distance(path[i - 1], path[i]));
  return out;
}

// 지금 위치를 코스 선 위에 내려 찍었을 때: 출발점부터 거리(along)와 코스 선까지 거리(off)
function alongPath(path, cum, p) {
  const k = 111320, kx = k * Math.cos((p.lat * Math.PI) / 180);
  let best = { off: Infinity, along: 0 };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * k;
    const px = (p.lng - a.lng) * kx, py = (p.lat - a.lat) * k;
    const len2 = bx * bx + by * by;
    const tt = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const off = Math.hypot(px - bx * tt, py - by * tt);
    if (off < best.off) best = { off, along: cum[i - 1] + tt * (cum[i] - cum[i - 1]) };
  }
  return best;
}
