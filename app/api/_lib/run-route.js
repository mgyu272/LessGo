// 현재 위치 → 목적지 "러닝 최적" 코스 찾기
// 기존 Python 추천 알고리즘(src/recommender.py · src/running_metrics.py · docs/ROUTING_ALGORITHM.md)의
// 경사 평가(Low 페널티 계수)와 러닝 친화도 평가를 그대로 옮기고, 하천·공원 보행로 보너스를 더했어요.
//
// 흐름
//  1) 최단 도보 경로(일반 지도 앱 길찾기와 같은 기준)를 먼저 받아요
//  2) OSM에서 출발~도착 사이 하천·보행로·공원을 받아 "경유 후보"를 만들어요
//     - 하천 따라가기: 출발 쪽 하천변 길 → 도착 쪽 하천변 길
//     - 하천변/공원 보행로 한 곳 경유
//  3) 후보마다 실제 도보 경로 + 고도를 받아 점수를 매기고 1등을 골라요
//  4) 최단 경로와 같이 돌려줘서 화면에서 "일반 길찾기 vs LessGo"를 비교해요
//
// 목적지는 좌표만 있으면 돼요 → 장소(spots.json)가 늘어나도 그대로 동작해요.

const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
const ORS = "https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const ELEVATION = "https://api.open-meteo.com/v1/elevation";

// 기존 알고리즘 data/route_defaults.json · ROUTING_ALGORITHM.md 의 Low 경사 페널티
const SLOPE_PENALTY = { share8: 35, share10: 25, sustained: 20, longClimb: 10, ascent: 10 };
// 최종 점수 가중치 (기존 Low 가중치 비율 + 하천 보너스)
const WEIGHTS = { slope: 30, running: 26, river: 18, directness: 16, natural: 10 };
const FRIENDLY = /^(footway|path|cycleway|pedestrian|track|living_street)$/;
const MAX_DETOUR = 1.6;      // 최단 경로 대비 최대 1.6배까지만 돌아가요
const MAX_EXTRA_M = 2500;    // 그리고 최대 2.5km 추가까지

// ---------- 기하 ----------
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function dist(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function lengthOf(path) { let m = 0; for (let i = 1; i < path.length; i++) m += dist(path[i - 1], path[i]); return m; }

// 점 → 선분 거리 (m, 짧은 거리라 평면 근사)
function segDist(p, a, b) {
  const kx = 111320 * Math.cos(rad(p.lat)), ky = 110540;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// 경로를 step m 간격으로 다시 찍기
export function resample(path, step = 20) {
  if (path.length < 2) return path.slice();
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

// 가까운 선 찾기용 격자 (OSM 선이 많아서 빠르게)
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

// ---------- 외부 API ----------
async function fetchJSON(url, opts = {}, ms = 8000) {
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

// 고도가 없는 경로는 Open-Meteo 고도 API로 채워요 (요청당 100점)
async function fillElevation(samples) {
  if (samples.every((s) => s.ele != null)) return true;
  const chunks = [];
  for (let i = 0; i < samples.length; i += 100) chunks.push(samples.slice(i, i + 100));
  try {
    await Promise.all(chunks.map(async (part) => {
      const lat = part.map((s) => s.lat.toFixed(5)).join(","), lng = part.map((s) => s.lng.toFixed(5)).join(",");
      const j = await fetchJSON(`${ELEVATION}?latitude=${lat}&longitude=${lng}`, {}, 6000);
      part.forEach((s, i) => { s.ele = j.elevation?.[i] ?? null; });
    }));
    return samples.every((s) => s.ele != null);
  } catch { return false; }
}

// OSM: 하천 · 러닝 친화 보행로 · 공원
async function fetchOsm(bbox) {
  const b = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  const q = `[out:json][timeout:12];(way["waterway"~"^(river|stream|canal)$"](${b});way["highway"~"^(footway|path|cycleway|pedestrian|track|living_street)$"](${b});way["leisure"="park"](${b}););out tags geom;`;
  for (const url of OVERPASS) {
    try {
      const j = await fetchJSON(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 9000);
      return j.elements || [];
    } catch { /* 다음 서버 */ }
  }
  return null;
}

function classifyOsm(elements) {
  const water = [], friendly = [], park = [];
  for (const el of elements || []) {
    if (!el.geometry?.length) continue;
    const line = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
    const t = el.tags || {};
    if (t.waterway) { if (t.tunnel !== "yes" && t.tunnel !== "culvert") water.push(line); continue; }
    if (t.leisure === "park") { park.push(line); continue; }
    if (FRIENDLY.test(t.highway || "") && t.access !== "no" && t.access !== "private" && t.foot !== "no") friendly.push(line);
  }
  const waterIdx = gridIndex(water);
  // 하천변 길: 점의 절반 이상이 하천 60m 안에 있는 보행로
  const river = friendly.filter((line) => line.filter((p) => waterIdx.near(p, 60)).length >= line.length / 2);
  // 공원 길: 공원 경계 120m 안 (경계만 받아서 근사)
  const parkIdx = gridIndex(park);
  const parkPaths = friendly.filter((line) => line.some((p) => parkIdx.near(p, 120)));
  return { water, friendly, river, parkPaths, idx: { friendly: gridIndex(friendly), river: gridIndex(river), water: waterIdx } };
}

// ---------- 점수 (기존 Python 공식) ----------
function median(xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

export function gradeMetrics(samples) {
  // 20m 간격 + 60m 중앙값 평활화 (ROUTING_ALGORITHM.md)
  if (samples.length < 3 || samples.some((s) => s.ele == null)) return null;
  const ele = samples.map((_, i) => median(samples.slice(Math.max(0, i - 1), i + 2).map((s) => s.ele)));
  let ascent = 0, len8 = 0, len10 = 0, run8 = 0, long8 = 0, total = 0;
  const grades = [];
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].at - samples[i - 1].at; if (d <= 0) continue;
    const g = ((ele[i] - ele[i - 1]) / d) * 100;
    total += d; grades.push({ g, d });
    if (g > 0) ascent += ele[i] - ele[i - 1];
    if (g >= 8) { len8 += d; run8 += d; long8 = Math.max(long8, run8); } else run8 = 0;
    if (g >= 10) len10 += d;
  }
  // 최대 지속 오르막: 100m 창 평균 경사의 최대값
  let sustained = 0;
  for (let i = 0; i < samples.length; i++) {
    let j = i; while (j < samples.length - 1 && samples[j].at - samples[i].at < 100) j++;
    if (samples[j].at - samples[i].at >= 80) sustained = Math.max(sustained, ((ele[j] - ele[i]) / (samples[j].at - samples[i].at)) * 100);
  }
  const km = Math.max(total / 1000, 0.1);
  const share8 = len8 / total, share10 = len10 / total, perKm = ascent / km;
  const P = SLOPE_PENALTY;
  const score = clamp(
    100 - share8 * P.share8 - share10 * P.share10
      - Math.min(1, sustained / 12) * P.sustained
      - Math.min(1, long8 / 300) * P.longClimb
      - Math.min(1, perKm / 80) * P.ascent,
    0, 100,
  );
  return { ascent_m: Math.round(ascent), share8, share10, sustained_pct: Math.round(sustained * 10) / 10, longest8_m: Math.round(long8), slope_score: Math.round(score) };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// 같은 길을 되돌아오는 비율 (자연스러움)
function overlapShare(samples) {
  let dup = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = 0; j < i; j++) {
      if (samples[i].at - samples[j].at < 120) break;
      if (dist(samples[i], samples[j]) < 12) { dup++; break; }
    }
  }
  return dup / samples.length;
}

function evaluate(path, ctx, osm) {
  const samples = resample(path, 20);
  const len = samples[samples.length - 1].at;
  const share = (idx, m) => (idx ? samples.filter((s) => idx.near(s, m)).length / samples.length : 0);
  const friendlyShare = osm ? share(osm.idx.friendly, 12) : 0;
  const riverShare = osm ? share(osm.idx.river, 15) : 0;
  const grade = gradeMetrics(samples);
  const overlap = overlapShare(samples);
  const detour = len / ctx.directLen;
  const directness = clamp(100 * (1 - (detour - 1) / (MAX_DETOUR - 1)), 0, 100);
  const parts = {
    slope: grade ? grade.slope_score : null,
    running: osm ? friendlyShare * 100 : null,
    river: osm ? Math.min(100, riverShare * 250) : null, // 하천변 40% 이상이면 만점
    directness,
    natural: clamp(100 - overlap * 300, 0, 100),
  };
  let sum = 0, w = 0;
  for (const [k, v] of Object.entries(parts)) if (v != null) { sum += v * WEIGHTS[k]; w += WEIGHTS[k]; }
  return {
    score: Math.round((sum / w) * 10) / 10,
    distance_m: Math.round(len),
    detour: Math.round(detour * 100) / 100,
    friendly_share: Math.round(friendlyShare * 100),
    river_share: Math.round(riverShare * 100),
    overlap_share: Math.round(overlap * 100),
    ...(grade || {}),
    parts,
    samples,
  };
}

// ---------- 경유 후보 ----------
function candidateVias(from, to, osm, directLen) {
  const straight = dist(from, to);
  const budget = Math.min(directLen * MAX_DETOUR, directLen + MAX_EXTRA_M);
  const inEllipse = (p) => dist(from, p) + dist(p, to) <= budget * 0.92;
  const pointsOf = (lines) => lines.flatMap((l) => l.filter((_, i) => i % 3 === 0)).filter(inEllipse);
  const riverPts = pointsOf(osm.river), parkPts = pointsOf(osm.parkPaths);
  const sets = [];

  // 1) 하천 따라가기: 출발 쪽 하천변 입구 → (가운데) → 도착 쪽 하천변 출구
  if (riverPts.length >= 2) {
    const entry = minBy(riverPts, (p) => dist(from, p) + 0.3 * dist(p, to));
    const exit = minBy(riverPts, (p) => dist(p, to) + 0.3 * dist(from, p));
    if (dist(entry, exit) > Math.max(300, straight * 0.25)) {
      const mid = { lat: (entry.lat + exit.lat) / 2, lng: (entry.lng + exit.lng) / 2 };
      const center = minBy(riverPts, (p) => dist(p, mid));
      sets.push({ kind: "river", vias: [entry, center, exit] });
      sets.push({ kind: "river", vias: [entry, exit] });
    }
  }
  // 2) 하천변·공원 보행로 한 곳 경유 (250m 격자에서 대표점, 넓게 퍼지게)
  const reps = new Map();
  for (const [pts, kind] of [[riverPts, "river"], [parkPts, "park"]]) {
    for (const p of pts) {
      const k = Math.round(p.lat / 0.0025) + ":" + Math.round(p.lng / 0.003);
      const cur = reps.get(k);
      if (!cur) reps.set(k, { p, kind, n: 1 }); else cur.n++;
    }
  }
  const singles = [...reps.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  singles.forEach((r) => sets.push({ kind: r.kind, vias: [r.p] }));
  return sets.slice(0, 8);
}
const minBy = (xs, f) => xs.reduce((best, x) => (f(x) < f(best) ? x : best), xs[0]);

// ---------- 메인 ----------
export async function findRunRoute({ from, to, orsKey }) {
  const direct = await walkRoute([from, to], orsKey);
  const directLen = lengthOf(direct);
  const ctx = { directLen };

  // 출발~도착을 감싸는 상자 (최단 경로 길이의 30%, 최소 500m 여유)
  const pad = Math.max(500, directLen * 0.3);
  const dLat = pad / 110540, dLng = pad / (111320 * Math.cos(rad((from.lat + to.lat) / 2)));
  const bbox = { s: Math.min(from.lat, to.lat) - dLat, n: Math.max(from.lat, to.lat) + dLat, w: Math.min(from.lng, to.lng) - dLng, e: Math.max(from.lng, to.lng) + dLng };
  const elements = await fetchOsm(bbox);
  const osm = elements ? classifyOsm(elements) : null;

  const sets = osm ? candidateVias(from, to, osm, directLen) : [];
  const routed = await Promise.all(sets.map(async (s) => {
    try { return { ...s, path: await walkRoute([from, ...s.vias, to], orsKey) }; } catch { return null; }
  }));
  const budget = Math.min(directLen * MAX_DETOUR, directLen + MAX_EXTRA_M);
  const cands = [{ kind: "direct", vias: [], path: direct }, ...routed.filter((c) => c && lengthOf(c.path) <= budget)];

  // 고도 채우고 점수
  const evaluated = await Promise.all(cands.map(async (c) => {
    const ev = evaluate(c.path, ctx, osm);
    if (ev.slope_score == null) {
      const ok = await fillElevation(ev.samples);
      if (ok) Object.assign(ev, evaluate(ev.samples, ctx, osm)); // 고도 채운 표본으로 다시
    }
    return { ...c, ev };
  }));
  evaluated.sort((a, b) => b.ev.score - a.ev.score);
  const best = evaluated[0];
  const directEv = evaluated.find((c) => c.kind === "direct");

  const pack = (c) => ({
    kind: c.kind,
    path: c.ev.samples.filter((_, i, a) => i % 2 === 0 || i === a.length - 1).map((s) => [s.lng, s.lat, s.ele == null ? null : Math.round(s.ele * 10) / 10]),
    metrics: { ...c.ev, samples: undefined },
  });
  return {
    best: pack(best),
    direct: pack(directEv),
    tried: evaluated.length,
    osm: osm ? { rivers: osm.water.length, riverside_paths: osm.river.length, friendly_paths: osm.friendly.length } : null,
    engine: orsKey ? "ors" : "osrm+open-meteo",
  };
}
