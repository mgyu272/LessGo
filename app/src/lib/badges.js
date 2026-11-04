// 내 기록 화면의 목표와 배지 규칙 (한곳에 모아 둬요. 숫자를 바꾸면 화면이 그대로 따라와요)
// 입력: useUserData의 runs(기록 목록), cells(얻은 칸 Set), stamps(도장 찍은 장소 Set)

export const DAILY_GOAL_KM = 3; // 오늘 목표 거리 (km)

const DAY = 24 * 3600 * 1000;
const dayStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

// 날짜별 합계 { [하루 시작 ms]: { km, seconds, cells } }
export function byDay(runs) {
  const out = {};
  for (const r of runs) {
    const k = dayStart(r.date);
    const o = (out[k] ||= { km: 0, seconds: 0, cells: 0 });
    o.km += (r.meters || 0) / 1000; o.seconds += r.seconds || 0; o.cells += r.cells || 0;
  }
  return out;
}

// 오늘부터 거꾸로 이어서 달린 날 수
export function streakDays(runs, now = Date.now()) {
  const days = new Set(runs.map((r) => dayStart(r.date)));
  let n = 0, d = dayStart(now);
  if (!days.has(d)) d -= DAY; // 오늘 아직 안 달렸으면 어제부터 셈
  while (days.has(d)) { n++; d -= DAY; }
  return n;
}

const DESTS = ["simujang", "jeongneung", "uiryeong"];
const TOMBS = ["jeongneung", "uiryeong"];

// 배지: progress(ctx) → { have, need, ... }
export const BADGES = [
  { id: "first_run", progress: ({ runs }) => ({ have: Math.min(1, runs.length), need: 1 }) },
  { id: "tombs_2", progress: ({ stamps }) => ({ have: TOMBS.filter((x) => stamps.has(x)).length, need: TOMBS.length, missing: TOMBS.filter((x) => !stamps.has(x)) }) },
  { id: "streak_3", progress: ({ runs }) => ({ have: Math.min(3, streakDays(runs)), need: 3 }) },
  { id: "all_3", progress: ({ stamps }) => ({ have: DESTS.filter((x) => stamps.has(x)).length, need: DESTS.length, missing: DESTS.filter((x) => !stamps.has(x)) }) },
  { id: "run_10k", progress: ({ runs }) => { const best = Math.max(0, ...runs.map((r) => (r.meters || 0) / 1000)); return { have: Math.min(10, best), need: 10, best }; } },
  { id: "cells_100", progress: ({ cells }) => ({ have: Math.min(100, cells.size), need: 100, now: cells.size }) },
];

export function badgeStates(ctx) {
  return BADGES.map((b) => { const p = b.progress(ctx); return { id: b.id, ...p, done: p.have >= p.need }; });
}

export { dayStart, DAY };
