// 문화 활동 일정 불러오기 (public/data/events.json)
// sample: true 항목(예시)은 개발 모드(npm run dev)에서만 보여요. 배포 화면에는 실제 일정만 나와요.

import { useEffect, useState } from "react";

export const EVENT_CATEGORIES = ["all", "tour", "show", "stage", "fest", "class"];

let cache = null;
export function loadEvents() {
  if (!cache) {
    cache = fetch("/data/events.json")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => (d.events || []).filter((e) => !e.sample || import.meta.env.DEV)
        .map((e) => ({ ...e, startAt: new Date(e.start), endAt: new Date(e.end || e.start) })))
      .catch(() => []);
  }
  return cache;
}

export function useEvents() {
  const [events, setEvents] = useState(null); // null = 불러오는 중
  useEffect(() => { let alive = true; loadEvents().then((e) => alive && setEvents(e)); return () => { alive = false; }; }, []);
  return events;
}

// 날짜 도우미 (한국 시간 기준 하루)
export const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const mondayOf = (d) => { const s = startOfDay(d); const w = (s.getDay() + 6) % 7; s.setDate(s.getDate() - w); return s; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// 그날 열리는 활동인지 (여러 날 이어지는 전시도 포함)
export const onDay = (e, day) => e.startAt < addDays(startOfDay(day), 1) && e.endAt >= startOfDay(day);
