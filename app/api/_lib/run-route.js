// 러닝 코스 찾기 (현위치 → 목적지, 그리고 새 장소의 3·5·10km 코스 만들기)
// 기존 Python 추천 알고리즘(src/recommender.py · src/running_metrics.py · docs/ROUTING_ALGORITHM.md)의
// 경사 평가(Low/Any 페널티 계수)·목표 거리 허용(±300m)·러닝 친화도 평가를 옮기고, 횡단보도·하천 점수를 더했어요.
//
// 흐름
//  1) 출발→도착 최단 도보 경로를 받아요 (일반 지도 앱 길찾기와 같은 기준)
//  2) OSM에서 둘레의 하천·보행로·공원·횡단보도를 받아 "경유 후보"를 만들어요
//     - 목표 거리가 있으면: 출발·도착 둘레 타원(거리 합 ≈ 목표 거리) 위의 하천변·공원·보행로 지점을 1~2곳 경유
//     - 하천 따라가기: 출발 쪽 하천변 → 도착 쪽 하천변
//  3) 후보마다 실제 도보 경로를 받고, 먼저 고도 없이 점수를 매겨 상위만 고도를 받아 최종 점수
//  4) 완만한 길(low) 1등, 언덕 허용(high) 1등. 둘이 거의 같은 길이면 언덕 허용은 다른 길 중 좋은 것을 골라요
//
// 목적지는 좌표만 있으면 돼요 → 장소가 늘어나도 그대로 동작해요.

const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
const ORS = "https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const ELEVATION = "https://api.open-meteo.com/v1/elevation";

// 기존 알고리즘의 경사 페널티 (low = 완만한 길, high = 언덕 허용(any))
const SLOPE_PENALTY = {
  low: { share8: 35, share10: 25, sustained: 20, longClimb: 10, ascent: 10 },
  high: { share8: 12, share10: 8, sustained: 8, longClimb: 4, ascent: 8 },
};
// 최종 점수 가중치. fit = 목표 거리에 맞는 정도(목표가 없으면 직진성), crossing = 횡단보도가 적을수록
// 언덕 허용은 경사 비중이 아주 작고 길·흐름 비중이 커요 (기존 Any 가중치 비율)
const WEIGHTS = {
  low: { slope: 30, running: 18, river: 14, crossing: 14, fit: 16, natural: 8 },
  high: { slope: 3, running: 26, river: 14, crossing: 16, fit: 26, natural: 15 },
};
const FRIENDLY = /^(footway|path|cycleway|pedestrian|track|living_street)$/;
const MAX_DETOUR = 1.6;      // 목표 거리가 없을 때: 최단 경로 대비 최대 1.6배
const MAX_EXTRA_M = 2500;    //                       그리고 최대 2.5km 추가
const TOL_M = 300;           // 목표 거리 허용 (기존 알고리즘 distance_tolerance_min_m)
const ROAD_FACTOR = 1.28;    // 직선거리 → 실제 걷는 거리 대략 비율

// ---------- 기하 ----------
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function dist(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function lengthOf(path) { let m = 0; for (let i = 1; i < path.length; i++) m += dist(path[i - 1], path[i]); return m; }
function segDist(p, a, b) {
  const kx = 111320 * Math.cos(rad(p.lat)), ky = 110540;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
// 경로를 step m 간격으로 다시 찍기 (고도는 사이값)
export function resample(path, step = 20) {
  if (path.length < 2) return path.map((p) => ({ ...p, at: 0 }));
  const out = [{ ...path[0], at: 0 }];
  let carry = 0, total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], d = dist(a, b);
    let pos = step - carry;
    while (pos <= d) {
      const t = pos / d;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, ele: lerp(a.ele, b.ele, t), at: total + pos });
      pos += step;
    }
    carry = d - (pos - step);
    total += d;
  }
  const last = path[path.length - 1];
  if (total - out[out.length - 1].at > 1) out.push({ ...last, at: total });
  return out;
}
const lerp = (x, y, t) => (x == null || y == null ? (x ?? y ?? null) : x + (y - x) * t);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const minBy = (xs, f) => xs.reduce((best, x) => (f(x) < f(best) ? x : best), xs[0]);

// 가까운 선·점 찾기용 격자
function gridIndex(lines, cell = 0.0015) {
  const g = new Map();
  lines.forEach((line, li) => {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const x0 = Math.floor(Math.min(a.lng, b.lng) / cell), x1 = Math.floor(Math.max(a.lng, b.lng) / cell);
      const y0 = Math.floor(Math.min(a.lat, b.lat) / cell), y1 = Math.floor(Math.max(a.lat, b.lat) / cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = x + ":" + y; if (!g.has(k)) g.set(k, []); g.get(k).push([li, i]);
      }
    }
  });
  return {
    near(p, m) {
      const x = Math.floor(p.lng / cell), y = Math.floor(p.lat / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const [li, i] of g.get(x + dx + ":" + (y + dy)) || []) if (segDist(p, lines[li][i - 1], lines[li][i]) <= m) return true;
      }
      return false;
    },
  };
}
function pointIndex(points, cell = 0.001) {
  const g = new Map();
  points.forEach((p, i) => { const k = Math.floor(p.lng / cell) + ":" + Math.floor(p.lat / cell); if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
  return {
    // p에서 m 안에 있는 점 번호들
    within(p, m) {
      const x = Math.floor(p.lng / cell), y = Math.floor(p.lat / cell), out = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const i of g.get(x + dx + ":" + (y + dy)) || []) if (dist(p, points[i]) <= m) out.push(i);
      }
      return out;
    },
  };
}

// ---------- 외부 API ----------
async function fetchJSON(url, opts = {}, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// 도보 경로: ORS 키가 있으면 기존 알고리즘과 같은 ORS(고도 포함), 없으면 OSRM 보행 경로
async function walkRoute(stops, orsKey) {
  if (orsKey) {
    try {
      const j = await fetchJSON(ORS, {
        method: "POST",
        headers: { Authorization: orsKey, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: stops.map((s) => [s.lng, s.lat]), elevation: true, instructions: false }),
      });
      const c = j?.features?.[0]?.geometry?.coordinates;
      if (c?.length > 1) return c.map(([lng, lat, ele]) => ({ lat, lng, ele: ele ?? null }));
    } catch { /* OSRM으로 */ }
  }
  const q = stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(";");
  const j = await fetchJSON(`${OSRM}${q}?overview=full&geometries=geojson&continue_straight=false`);
  const c = j?.routes?.[0]?.geometry?.coordinates;
  if (!c || c.length < 2) throw new Error("no route");
  return c.map(([lng, lat]) => ({ lat, lng, ele: null }));
}

// 고도: Open-Meteo(90m DEM). 요청당 100점, 같은 자리는 다시 묻지 않아요
const eleCache = new Map();
const eleKey = (p) => p.lat.toFixed(4) + "," + p.lng.toFixed(4);
async function fillElevation(samples) {
  const need = [...new Map(samples.filter((s) => s.ele == null && !eleCache.has(eleKey(s))).map((s) => [eleKey(s), s])).values()];
  const chunks = [];
  for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
  try {
    for (const part of chunks) {
      const lat = part.map((s) => s.lat.toFixed(4)).join(","), lng = part.map((s) => s.lng.toFixed(4)).join(",");
      const j = await fetchJSON(`${ELEVATION}?latitude=${lat}&longitude=${lng}`, {}, 8000);
      part.forEach((s, i) => { if (j.elevation?.[i] != null) eleCache.set(eleKey(s), j.elevation[i]); });
    }
  } catch { /* 일부 못 받으면 아래에서 확인 */ }
  samples.forEach((s) => { if (s.ele == null && eleCache.has(eleKey(s))) s.ele = eleCache.get(eleKey(s)); });
  return samples.every((s) => s.ele != null);
}

// 여러 서버에 동시에 물어보고 먼저 온 답을 써요 (하나가 막혀도 괜찮게)
async function overpass(q, ms = 14000) {
  try {
    return await Promise.any(OVERPASS.map((url) => fetchJSON(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, ms)));
  } catch { return null; }
}

// OSM: 하천 · 러닝 친화 보행로 · 공원 · 횡단보도(신호 포함)
export async function fetchOsm(bbox) {
  const b = `${bbox.s.toFixed(5)},${bbox.w.toFixed(5)},${bbox.n.toFixed(5)},${bbox.e.toFixed(5)}`;
  const q = `[out:json][timeout:25];(way["waterway"~"^(river|stream|canal)$"](${b});way["highway"~"^(footway|path|cycleway|pedestrian|track)$"](${b});way["leisure"="park"](${b});node["highway"~"^(crossing|traffic_signals)$"](${b}););out tags geom qt;`;
  const j = await overpass(q);
  return j ? classifyOsm(j.elements || []) : null;
}

function classifyOsm(elements) {
  const water = [], friendly = [], park = [], crossings = [];
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === "node") { crossings.push({ lat: el.lat, lng: el.lon }); continue; }
    if (!el.geometry?.length) continue;
    const line = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
    if (t.waterway) { if (t.tunnel !== "yes" && t.tunnel !== "culvert") water.push(line); continue; }
    if (t.leisure === "park") { park.push(line); continue; }
    if (t.footway === "crossing") { crossings.push(line[Math.floor(line.length / 2)]); continue; }
    if (FRIENDLY.test(t.highway || "") && t.access !== "no" && t.access !== "private" && t.foot !== "no" && t.highway !== "steps") friendly.push(line);
  }
  const waterIdx = gridIndex(water);
  // 하천변 길: 점의 절반 이상이 하천 60m 안에 있는 보행로
  const river = friendly.filter((line) => line.filter((p) => waterIdx.near(p, 60)).length >= line.length / 2);
  const parkIdx = gridIndex(park);
  const parkPaths = friendly.filter((line) => line.some((p) => parkIdx.near(p, 120)));
  return {
    water, friendly, river, parkPaths, crossings,
    idx: { friendly: gridIndex(friendly), river: gridIndex(river), water: waterIdx, crossings: pointIndex(crossings) },
  };
}

// ---------- 점수 (기존 Python 공식) ----------
function median(xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
export function gradeMetrics(samples, mode = "low") {
  // 표본 간격 + 3점 중앙값 평활화
  if (samples.length < 3 || samples.some((s) => s.ele == null)) return null;
  const ele = samples.map((_, i) => median(samples.slice(Math.max(0, i - 1), i + 2).map((s) => s.ele)));
  let ascent = 0, len8 = 0, len10 = 0, run8 = 0, long8 = 0, total = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].at - samples[i - 1].at; if (d <= 0) continue;
    const g = ((ele[i] - ele[i - 1]) / d) * 100;
    total += d;
    if (g > 0) ascent += ele[i] - ele[i - 1];
    if (g >= 8) { len8 += d; run8 += d; long8 = Math.max(long8, run8); } else run8 = 0;
    if (g >= 10) len10 += d;
  }
  let sustained = 0; // 100m 창 평균 경사의 최대값
  for (let i = 0; i < samples.length; i++) {
    let j = i; while (j < samples.length - 1 && samples[j].at - samples[i].at < 100) j++;
    if (samples[j].at - samples[i].at >= 80) sustained = Math.max(sustained, ((ele[j] - ele[i]) / (samples[j].at - samples[i].at)) * 100);
  }
  const km = Math.max(total / 1000, 0.1);
  const share8 = len8 / total, share10 = len10 / total, perKm = ascent / km;
  const P = SLOPE_PENALTY[mode];
  const score = clamp(100 - share8 * P.share8 - share10 * P.share10 - Math.min(1, sustained / 12) * P.sustained
    - Math.min(1, long8 / 300) * P.longClimb - Math.min(1, perKm / 80) * P.ascent, 0, 100);
  return { ascent_m: Math.round(ascent), share8, share10, sustained_pct: Math.round(sustained * 10) / 10, longest8_m: Math.round(long8), slope_score: Math.round(score) };
}

// 같은 길을 되돌아오는 비율 (자연스러움: 갔다가 같은 길로 돌아오는 코스를 피해요)
function overlapShare(samples) {
  let dup = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = 0; j < i; j++) {
      if (samples[i].at - samples[j].at < 150) break;
      if (dist(samples[i], samples[j]) < 15) { dup++; break; }
    }
  }
  return dup / samples.length;
}
// 두 경로가 얼마나 겹치는지 (a의 점 중 b 25m 안에 있는 비율)
function sharedShare(a, b) {
  const idx = gridIndex([b.map((s) => ({ lat: s.lat, lng: s.lng }))]);
  const step = Math.max(1, Math.floor(a.length / 120));
  let n = 0, hit = 0;
  for (let i = 0; i < a.length; i += step) { n++; if (idx.near(a[i], 25)) hit++; }
  return hit / n;
}

function evaluate(samples, ctx, osm) {
  const len = samples[samples.length - 1].at;
  const share = (idx, m) => (idx ? samples.filter((s) => idx.near(s, m)).length / samples.length : 0);
  const friendlyShare = osm ? share(osm.idx.friendly, 12) : 0;
  const riverShare = osm ? share(osm.idx.river, 15) : 0;
  // 지나는 횡단보도·신호 수 (경로 12m 안, 같은 점은 한 번)
  let crossings = null;
  if (osm) {
    const seen = new Set();
    samples.forEach((s) => osm.idx.crossings.within(s, 12).forEach((i) => seen.add(i)));
    crossings = seen.size;
  }
  const perKm = crossings == null ? null : crossings / Math.max(len / 1000, 0.3);
  const gradeLow = gradeMetrics(samples, "low"), gradeHigh = gradeMetrics(samples, "high");
  const overlap = overlapShare(samples);
  let fit;
  if (ctx.target) {
    const off = Math.abs(len - ctx.target);
    fit = off <= TOL_M ? 100 - (off / TOL_M) * 10 : clamp(90 - (off - TOL_M) / 12, 0, 90);
  } else {
    const detour = len / ctx.directLen;
    fit = clamp(100 * (1 - (detour - 1) / (MAX_DETOUR - 1)), 0, 100);
  }
  const parts = {
    slope: gradeLow ? gradeLow.slope_score : null,
    slope_high: gradeHigh ? gradeHigh.slope_score : null,
    running: osm ? friendlyShare * 100 : null,
    river: osm ? Math.min(100, riverShare * 250) : null,       // 하천변 40% 이상이면 만점
    crossing: perKm == null ? null : clamp(100 - perKm * 9, 0, 100), // 1km에 횡단 11곳이면 0점
    fit,
    natural: clamp(100 - overlap * 300, 0, 100),
  };
  const scoreFor = (mode) => {
    let sum = 0, w = 0;
    for (const [k, wt] of Object.entries(WEIGHTS[mode])) {
      const v = k === "slope" && mode === "high" ? parts.slope_high : parts[k];
      if (v != null) { sum += v * wt; w += wt; }
    }
    return Math.round((sum / w) * 10) / 10;
  };
  return {
    score: scoreFor("low"), score_high: scoreFor("high"),
    distance_m: Math.round(len), crossings,
    friendly_share: Math.round(friendlyShare * 100), river_share: Math.round(riverShare * 100), overlap_share: Math.round(overlap * 100),
    ...(gradeLow || {}), parts,
  };
}

// ---------- 경유 후보 ----------
function candidateVias(from, to, osm, ctx) {
  const straight = dist(from, to);
  const sample = (lines, every) => lines.flatMap((l) => l.filter((_, i) => i % every === 0));
  const riverPts = sample(osm.river, 3).map((p) => ({ ...p, kind: "river" }));
  const parkPts = sample(osm.parkPaths, 4).map((p) => ({ ...p, kind: "park" }));
  const pathPts = sample(osm.friendly, 6).map((p) => ({ ...p, kind: "path" }));
  const all = [...riverPts, ...parkPts, ...pathPts];
  const mid = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
  const pref = { river: 0, park: 1, path: 2 };
  const sets = [];

  if (ctx.target && ctx.target > ctx.directLen * 1.15) {
    // 목표 거리를 채워야 해요: 출발·도착까지 거리 합이 S쯤인 지점을 경유 (타원 위)
    const S = ctx.target / ROAD_FACTOR;
    const ring = all.filter((p) => Math.abs(dist(from, p) + dist(p, to) - S) <= S * 0.18);
    // 8방향마다 하나씩 (하천 > 공원 > 보행로, 거리 합이 S에 가까운 것)
    const bySector = new Map();
    ring.forEach((p) => {
      const a = Math.atan2(p.lat - mid.lat, (p.lng - mid.lng) * Math.cos(rad(mid.lat)));
      const sec = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8;
      const cost = pref[p.kind] * 1000 + Math.abs(dist(from, p) + dist(p, to) - S);
      const cur = bySector.get(sec);
      if (!cur || cost < cur.cost) bySector.set(sec, { p, cost, sec });
    });
    const reps = [...bySector.values()].sort((a, b) => a.cost - b.cost);
    reps.forEach((r) => sets.push({ kind: r.p.kind, vias: [r.p] }));
    // 두 곳 경유: 이웃한 방향 두 점 (d(from,a)+d(a,b)+d(b,to) ≈ S가 되게 조금 안쪽 점으로)
    const inner = all.filter((p) => { const e = dist(from, p) + dist(p, to); return e > S * 0.55 && e < S * 0.85; });
    for (const r of reps.slice(0, 4)) {
      const b = minBy(inner.filter((q) => dist(q, r.p) > 300), (q) => Math.abs(dist(from, q) + dist(q, r.p) + dist(r.p, to) - S) + pref[q.kind] * 400);
      if (b) sets.push({ kind: b.kind === "river" || r.p.kind === "river" ? "river" : r.p.kind, vias: dist(from, b) < dist(from, r.p) ? [b, r.p] : [r.p, b] });
    }
  } else {
    // 목표 거리가 최단 경로와 비슷하거나 없을 때: 조금 돌아가며 하천·공원 길로
    const budget = ctx.target ? ctx.target * 1.12 : Math.min(ctx.directLen * MAX_DETOUR, ctx.directLen + MAX_EXTRA_M);
    const inEllipse = (p) => dist(from, p) + dist(p, to) <= budget / ROAD_FACTOR * 1.05;
    const rp = riverPts.filter(inEllipse), pp = parkPts.filter(inEllipse);
    if (rp.length >= 2) {
      const entry = minBy(rp, (p) => dist(from, p) + 0.3 * dist(p, to));
      const exit = minBy(rp, (p) => dist(p, to) + 0.3 * dist(from, p));
      if (dist(entry, exit) > Math.max(300, straight * 0.25)) sets.push({ kind: "river", vias: [entry, exit] });
    }
    const reps = new Map();
    [...rp, ...pp].forEach((p) => {
      const k = Math.round(p.lat / 0.0025) + ":" + Math.round(p.lng / 0.003);
      const cur = reps.get(k);
      if (!cur) reps.set(k, { p, n: 1 }); else cur.n++;
    });
    [...reps.values()].sort((a, b) => b.n - a.n).slice(0, 6).forEach((r) => sets.push({ kind: r.p.kind, vias: [r.p] }));
  }
  return sets.slice(0, 11);
}

// 지도 데이터(OSM) 없이도 서로 다른 길을 만들 수 있게, 좌표만으로 경유점을 만들어요 (길찾기가 가까운 길에 붙여요)
function geometricVias(from, to, ctx) {
  const kx = 111320 * Math.cos(rad((from.lat + to.lat) / 2)), ky = 110540;
  const ax = (to.lng - from.lng) * kx, ay = (to.lat - from.lat) * ky;
  const L = Math.hypot(ax, ay) || 1;
  const ux = ax / L, uy = ay / L, nx = -uy, ny = ux;          // 진행 방향, 옆 방향
  const at = (t, side) => ({ lng: from.lng + (ux * t + nx * side) / kx, lat: from.lat + (uy * t + ny * side) / ky });
  const sets = [];
  if (ctx.target && ctx.target > ctx.directLen * 1.15) {
    // 목표 거리를 채우는 타원 위의 점: 거리 합이 S가 되는 옆 거리 h (가운데 지점 기준)
    const S = ctx.target / ROAD_FACTOR;
    const h = Math.sqrt(Math.max(0, (S / 2) ** 2 - (L / 2) ** 2));
    for (const side of [1, -1]) {
      sets.push({ kind: "loop", vias: [at(L / 2, side * h)] });
      sets.push({ kind: "loop", vias: [at(L * 0.25, side * h * 0.9), at(L * 0.75, side * h * 0.9)] });
    }
  } else {
    // 최단 길 양옆으로 조금씩 비켜 가는 길
    for (const side of [1, -1]) for (const f of [0.22, 0.4]) sets.push({ kind: "side", vias: [at(L / 2, side * L * f)] });
  }
  return sets;
}

// ---------- 메인: 출발 → 도착 ----------
// targetKm가 있으면 그 거리(±300m)에 맞춘 코스, 없으면 조금 돌아가더라도 달리기 좋은 길
export async function findRunRoute({ from, to, targetKm = null, orsKey = null, osm: givenOsm = null }) {
  const direct = await walkRoute([from, to], orsKey);
  const directLen = lengthOf(direct);
  const ctx = { directLen, target: targetKm ? targetKm * 1000 : null };

  let osm = givenOsm;
  if (!osm) {
    const reach = ctx.target ? Math.max(ctx.target / ROAD_FACTOR / 2, directLen / 2) : directLen / 2;
    osm = await fetchOsm(bboxAround([from, to], Math.max(500, reach * 0.75)));
  }
  // OSM 후보(하천·공원·보행로) + 좌표 후보(양옆으로 비켜 가는 길). OSM을 못 받아도 좌표 후보로 다른 길을 만들어요
  const sets = [...(osm ? candidateVias(from, to, osm, ctx) : []), ...geometricVias(from, to, ctx)].slice(0, 14);
  const routed = [];
  // 공용 길찾기 서버에 무리가 가지 않게 2개씩
  for (let i = 0; i < sets.length; i += 2) {
    const got = await Promise.all(sets.slice(i, i + 2).map(async (s) => {
      try { return { ...s, path: await walkRoute([from, ...s.vias, to], orsKey) }; } catch { return null; }
    }));
    routed.push(...got.filter(Boolean));
  }
  let cands = [{ kind: "direct", vias: [], path: direct }, ...routed];
  if (ctx.target) {
    const ok = cands.filter((c) => Math.abs(lengthOf(c.path) - ctx.target) <= ctx.target * 0.2);
    if (ok.length) cands = ok;
  } else {
    const budget = Math.min(directLen * MAX_DETOUR, directLen + MAX_EXTRA_M);
    cands = cands.filter((c) => c.kind === "direct" || lengthOf(c.path) <= budget);
  }
  return scoreAndPick(cands, ctx, osm, orsKey);
}

async function scoreAndPick(cands, ctx, osm, orsKey) {
  // 1) 고도 없이 먼저 점수 → 2) 상위 6개만 고도를 받아 다시 (고도 API 요청을 아껴요)
  let ev = cands.map((c) => { const samples = resample(c.path, 20); return { ...c, samples, ev: evaluate(samples, ctx, osm) }; });
  ev = ev.filter((c) => c.ev.overlap_share <= 30 || c.kind === "direct");
  ev.sort((a, b) => b.ev.score_high - a.ev.score_high);
  const top = ev.slice(0, 6);
  for (const c of top) {
    if (c.samples.every((s) => s.ele != null)) continue;
    const coarse = resample(c.path, 50);
    if (await fillElevation(coarse)) {
      c.samples = resample(coarse, 20); // 50m 고도를 20m 간격으로
      c.ev = evaluate(c.samples, ctx, osm);
    }
  }
  const best = [...top].sort((a, b) => b.ev.score - a.ev.score)[0];
  const byHigh = [...top].sort((a, b) => b.ev.score_high - a.ev.score_high);
  // 언덕 허용: 완만한 길과 70% 넘게 겹치지 않는 다른 길 중 언덕 허용 점수 1등 (다른 길이 하나도 없을 때만 같은 길)
  let bestHigh = byHigh[0];
  if (bestHigh === best || sharedShare(bestHigh.samples, best.samples) > 0.7) {
    const alt = byHigh.find((c) => c !== best && sharedShare(c.samples, best.samples) <= 0.7 && c.ev.score_high >= 30);
    if (alt) bestHigh = alt;
  }
  // 완만한 길은 언제나 오르막이 더 적은 쪽 (점수가 비슷해 반대로 뽑히면 서로 바꿔요)
  let low = best, high = bestHigh;
  if (low !== high && (low.ev.ascent_m ?? 0) > (high.ev.ascent_m ?? 0)) [low, high] = [high, low];
  const direct = ev.find((c) => c.kind === "direct") || null;
  const pack = (c) => c && ({
    kind: c.kind,
    path: c.samples.filter((_, i, a) => i % 2 === 0 || i === a.length - 1).map((s) => [+s.lng.toFixed(6), +s.lat.toFixed(6), s.ele == null ? null : Math.round(s.ele * 10) / 10]),
    metrics: c.ev,
  });
  return {
    best: pack(low), low: pack(low), high: pack(high), direct: pack(direct),
    same: low === high,
    tried: cands.length,
    osm: osm ? { rivers: osm.water.length, riverside_paths: osm.river.length, friendly_paths: osm.friendly.length, crossings: osm.crossings.length } : null,
    engine: orsKey ? "ors" : "osrm+open-meteo",
  };
}

export function bboxAround(points, padM) {
  const lat = points.reduce((n, p) => n + p.lat, 0) / points.length;
  const dLat = padM / 110540, dLng = padM / (111320 * Math.cos(rad(lat)));
  return {
    s: Math.min(...points.map((p) => p.lat)) - dLat, n: Math.max(...points.map((p) => p.lat)) + dLat,
    w: Math.min(...points.map((p) => p.lng)) - dLng, e: Math.max(...points.map((p) => p.lng)) + dLng,
  };
}

// ---------- 새 장소의 3·5·10km 코스 만들기 ----------
// 기존 코스처럼 "역 출구 → 목적지". 목적지에서 목표 거리의 30~70% 떨어진 지하철 출구를 출발 후보로 (가까운 순 2곳),
// 없으면 버스 정류장·공원 입구. 출발 후보마다 findRunRoute로 찾은 길을 모아 완만한 길·언덕 허용 1등을 골라요.
export async function planCourse({ to, targetKm, orsKey = null, avoidStart = null }) {
  const target = targetKm * 1000;
  const radius = Math.round(target * 0.75);
  const q = `[out:json][timeout:20];(node["railway"="subway_entrance"](around:${radius},${to.lat},${to.lng});node["highway"="bus_stop"](around:${radius},${to.lat},${to.lng});node["leisure"="park_entrance"](around:${radius},${to.lat},${to.lng});node["railway"="station"](around:${radius + 600},${to.lat},${to.lng}););out tags qt;`;
  const j = await overpass(q);
  // 출구 이름: 출구 노드에 이름이 없으면 가장 가까운 역 이름 + 출구 번호
  const stations = (j?.elements || []).filter((e) => e.tags?.railway === "station").map((e) => ({ lat: e.lat, lng: e.lon, name: (e.tags.name || "").replace(/역$/, "") + "역" }));
  const nearStation = (p) => (stations.length ? minBy(stations, (s) => dist(s, p)) : null);
  const pts = (j?.elements || []).filter((e) => e.tags?.railway !== "station").map((e) => ({
    lat: e.lat, lng: e.lon, d: dist(to, { lat: e.lat, lng: e.lon }),
    type: e.tags?.railway === "subway_entrance" ? "subway" : e.tags?.highway === "bus_stop" ? "bus" : "park",
    name: startName(e.tags || {}, nearStation({ lat: e.lat, lng: e.lon })),
  })).filter((p) => p.d >= target * 0.3 / ROAD_FACTOR * 1.6 && p.d <= target * 0.7 / ROAD_FACTOR * 1.6);
  const rank = { subway: 0, park: 1, bus: 2 };
  pts.sort((a, b) => rank[a.type] - rank[b.type] || Math.abs(a.d - target * 0.42) - Math.abs(b.d - target * 0.42));
  const starts = [];
  for (const p of pts) {
    if (avoidStart && dist(p, avoidStart) < 150) continue;
    if (starts.every((s) => dist(s, p) > 400)) starts.push(p);
    if (starts.length >= 2) break;
  }
  if (!starts.length) throw Object.assign(new Error("출발 후보를 찾지 못했어요"), { status: 422 });

  const osm = await fetchOsm(bboxAround([to, ...starts], Math.max(600, target / ROAD_FACTOR / 2 * 0.8)));
  const results = [];
  for (const s of starts) {
    try { results.push({ start: s, r: await findRunRoute({ from: s, to, targetKm, orsKey, osm }) }); } catch { /* 다음 출발 */ }
  }
  if (!results.length) throw Object.assign(new Error("길을 찾지 못했어요"), { status: 502 });
  const pickBy = (k, mode) => results.filter((x) => x.r[k]).sort((a, b) => (mode === "low" ? b.r[k].metrics.score - a.r[k].metrics.score : b.r[k].metrics.score_high - a.r[k].metrics.score_high))[0];
  const lo = pickBy("low", "low"), hi = pickBy("high", "high");
  const pack = (x, k) => ({ start: { name: x.start.name, type: x.start.type, lat: x.start.lat, lng: x.start.lng }, ...x.r[k] });
  return { targetKm, low: pack(lo, "low"), high: pack(hi, "high"), starts: starts.map((s) => s.name) };
}

function startName(t, station) {
  const n = t.name || t["name:ko"] || "";
  if (t.railway === "subway_entrance") {
    const ref = t.ref ? `${t.ref}번 출구` : "출구";
    if (n && n.includes("출구")) return n;
    return `${n || station?.name || "지하철역"} ${ref}`;
  }
  return n || (t.highway === "bus_stop" ? "버스 정류장" : "공원 입구");
}
