// POST /api/plan-course  { to: {lat,lng}, km: 3|5|10, avoidStart?: {lat,lng} }
// → { targetKm, low: { start, path, metrics }, high: { start, path, metrics }, starts }
// 새 장소의 저장 코스를 만들 때 써요 (역 출구 → 목적지, 목표 거리 ±300m, 경사·횡단보도·하천·보행로 점수).
// 만든 결과는 public/data/lessgo/generated_routes.json 에 저장해서 앱이 읽어요 (scripts/ 참고).
import { handler } from "./_lib/gemini.js";
import { planCourse } from "./_lib/run-route.js";

export default handler(async ({ to, km, avoidStart }) => {
  if (!to || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) { const e = new Error("to 좌표가 필요해요"); e.status = 400; throw e; }
  const targetKm = [3, 5, 10].includes(Number(km)) ? Number(km) : 5;
  return planCourse({ to, targetKm, orsKey: process.env.ORS_API_KEY || null, avoidStart });
});

export const config = { maxDuration: 60 };
