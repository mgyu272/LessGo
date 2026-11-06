// POST /api/route-from-here  { from: {lat,lng}, to: {lat,lng}, km?: 3|5|10 }
// → { low, high, direct, best, same, tried, osm, engine }
// 현재 위치에서 목적지까지 러닝 코스(완만한 길 · 언덕 허용)를 찾아요. km를 주면 그 거리(±300m)에 맞춰요.
// 알고리즘: api/_lib/run-route.js. ORS_API_KEY가 있으면 기존 Python 알고리즘과 같은 ORS(고도 포함), 없으면 OSRM + Open-Meteo 고도
import { handler } from "./_lib/gemini.js";
import { findRunRoute } from "./_lib/run-route.js";

const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

export default handler(async ({ from, to, km }) => {
  if (!ok(from) || !ok(to)) { const e = new Error("from/to 좌표가 필요해요"); e.status = 400; throw e; }
  const targetKm = [3, 5, 10].includes(Number(km)) ? Number(km) : null;
  return findRunRoute({ from, to, targetKm, orsKey: process.env.ORS_API_KEY || null });
});

export const config = { maxDuration: 60 };
