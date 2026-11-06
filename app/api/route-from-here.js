// POST /api/route-from-here  { from: {lat,lng}, to: {lat,lng} }
// → { best, direct, tried, osm, engine }
// 현재 위치에서 목적지까지 러닝에 맞는 코스를 찾아요 (알고리즘: api/_lib/run-route.js)
// ORS_API_KEY 가 있으면 기존 Python 알고리즘과 같은 ORS 보행 경로·고도를 쓰고, 없으면 OSRM + Open-Meteo 고도로 대신해요.
import { handler } from "./_lib/gemini.js";
import { findRunRoute } from "./_lib/run-route.js";

const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

export default handler(async ({ from, to }) => {
  if (!ok(from) || !ok(to)) { const e = new Error("from/to 좌표가 필요해요"); e.status = 400; throw e; }
  return findRunRoute({ from, to, orsKey: process.env.ORS_API_KEY || null });
});

export const config = { maxDuration: 30 };
