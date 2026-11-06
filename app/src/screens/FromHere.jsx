// 현재 위치에서 달리기: 내 위치 = 출발지, 목적지는 고른 코스의 장소.
// 서버(/api/route-from-here)가 기존 추천 알고리즘(경사·러닝 친화도)에 하천·공원 보너스를 더해 코스를 찾아요.
// 지도에 "일반 길찾기(최단, 회색 점선)"와 "LessGo 러닝 코스(초록)"를 같이 보여줘요.
// 시연 모드: 위치를 못 받거나 너무 멀면(8km 넘음) 원래 코스 출발점을 내 위치로 가정해요. 달리기는 자동으로 움직여요.
import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { MapView, Route, Dot, Me, FitBounds } from "../components/MapView.jsx";
import { distance } from "../lib/geo.js";
import { loc } from "../lib/i18n.js";
import { speedParam } from "./Home.jsx";
import { MIN_PER_KM } from "../lib/routes.js";

const MAX_ACCURACY_M = 100;
const DEMO_MAX_M = 8000;

function getPosition(ms = 15000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      reject, { enableHighAccuracy: true, maximumAge: 5000, timeout: ms });
  });
}

const gpsError = (e) => e?.code === 1 ? "위치 권한이 거부됐어요. 휴대폰·브라우저 설정에서 허용해 주세요."
  : e?.code === 0 ? "GPS는 HTTPS 주소에서만 동작해요."
  : "GPS 위치를 가져오지 못했어요. 실외에서 다시 시도해 주세요.";

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

export default function FromHere() {
  const app = useApp();
  const base = app.course;
  const dest = base && app.data.spotById?.[base.properties.dest];
  const [state, setState] = useState({ step: "gps" }); // gps → route → ready | error
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!base || !dest) return;
    let alive = true;
    (async () => {
      setState({ step: "gps" });
      // 1) 내 위치
      let here = null, assumed = false;
      try {
        here = await getPosition(app.demo ? 6000 : 15000);
        if (!app.demo && here.accuracy > MAX_ACCURACY_M) throw { code: 9 };
      } catch (e) {
        if (!app.demo) return alive && setState({ step: "error", msg: e?.code === 9 ? "GPS 정확도가 낮아요. 실외에서 다시 시도해 주세요." : gpsError(e) });
      }
      if (app.demo && (!here || distance(here, dest) > DEMO_MAX_M)) { here = { ...base.path[0] }; assumed = true; }
      if (!alive) return;
      // 2) 러닝 코스 찾기
      setState({ step: "route", here, assumed });
      try {
        const res = await fetch("/api/route-from-here", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: { lat: here.lat, lng: here.lng }, to: { lat: dest.lat, lng: dest.lng } }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "route");
        if (alive) setState({ step: "ready", here, assumed, ...json });
      } catch {
        if (alive) setState({ step: "error", here, msg: "코스를 찾지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요." });
      }
    })();
    return () => { alive = false; };
  }, [base?.id, attempt]);

  if (!base || !dest) return (
    <section className="screen to-start-screen">
      <div className="to-start-panel">
        <h2>코스를 찾을 수 없어요.</h2>
        <button className="btn btn-soft" onClick={() => app.go("courses")}>코스 선택으로 돌아가기</button>
      </div>
    </section>
  );

  const { step, here, best, direct, assumed } = state;
  const toLatLng = (p) => p.map(([lng, lat]) => ({ lat, lng }));
  const bestPath = best ? toLatLng(best.path) : null;
  const directPath = direct ? toLatLng(direct.path) : null;
  const fit = bestPath ? [...bestPath, ...(directPath || [])].map((p) => [p.lat, p.lng])
    : here ? [[here.lat, here.lng], [dest.lat, dest.lng]] : [[dest.lat, dest.lng]];

  const run = () => {
    const course = makeCourse(base, dest, best);
    app.setCourse(course);
    app.run.start(course, { demo: app.demo, speedup: speedParam() });
  };

  const b = best?.metrics, d = direct?.metrics;
  const same = b && d && b.kind === "direct";
  return (
    <section className="screen to-start-screen">
      <MapView className="to-start-map" center={[dest.lat, dest.lng]} zoom={15}>
        {directPath && !same && <Route path={directPath} color="#8A8F8C" weight={4} opacity={0.8} dashed />}
        {bestPath && <Route path={bestPath} color="#2F6512" weight={6} opacity={0.9} />}
        <Dot at={[dest.lat, dest.lng]} color="#E38B2C" radius={10} />
        {here && <Me at={[here.lat, here.lng]} />}
        <FitBounds points={fit} fitKey={`${step}-${fit.length}`} padTL={[22, 90]} padBR={[22, 300]} />
      </MapView>
      <div className="to-start-top">
        <button type="button" className="round-btn glass" onClick={() => app.go("courses")} aria-label="코스 화면으로">←</button>
        <strong className="glass">현재 위치에서 달리기</strong>
      </div>
      <div className="to-start-panel hanji-sheet">
        <h2>내 위치 → {loc(dest.name)}</h2>
        {assumed && <p className="to-start-course">시연 모드: 코스 출발점을 내 위치로 가정했어요.</p>}

        {step === "gps" && <p className="to-start-status" role="status">내 위치를 확인하고 있어요…</p>}
        {step === "route" && <p className="to-start-status" role="status">경사·보행로·하천을 따져 러닝 코스를 찾는 중이에요… (최대 20초)</p>}
        {step === "error" && <p className="to-start-error" role="alert">{state.msg}</p>}

        {step === "ready" && b && (
          <>
            <table className="here-compare">
              <thead><tr><th></th><th>일반 길찾기</th><th>LessGo 러닝</th></tr></thead>
              <tbody>
                <tr><td>거리</td><td>{km(d.distance_m)}</td><td><b>{km(b.distance_m)}</b></td></tr>
                <tr><td>오르막</td><td>{d.ascent_m ?? "-"} m</td><td><b>{b.ascent_m ?? "-"} m</b></td></tr>
                <tr><td>급경사(8%↑)</td><td>{pct(d.share8)}</td><td><b>{pct(b.share8)}</b></td></tr>
                <tr><td>하천변 길</td><td>{d.river_share}%</td><td><b>{b.river_share}%</b></td></tr>
                <tr><td>보행·산책로</td><td>{d.friendly_share}%</td><td><b>{b.friendly_share}%</b></td></tr>
                <tr><td>러닝 점수</td><td>{Math.round(d.score)}</td><td><b>{Math.round(b.score)}</b></td></tr>
              </tbody>
            </table>
            <p className="to-start-hint">
              {same ? "이 구간은 최단 경로가 러닝에도 가장 좋아요." : "초록 선 = LessGo 러닝 코스 · 회색 점선 = 일반 최단 길찾기"}
            </p>
          </>
        )}

        <div className="to-start-actions">
          <button type="button" className="btn btn-soft" onClick={() => setAttempt((n) => n + 1)} disabled={step === "gps" || step === "route"}>다시 찾기</button>
          <button type="button" className="btn btn-cta" onClick={run} disabled={step !== "ready"}>이 코스로 달리기</button>
        </div>
        <small className="to-start-hint">자동 분석 결과예요. 실제 통행·안전은 현장에서 확인하세요.</small>
      </div>
    </section>
  );
}

const pct = (x) => (x == null ? "-" : `${Math.round(x * 100)}%`);

// 서버 결과 → 앱 코스 모양 (기존 코스의 속성은 그대로 두고 길·거리만 바꿔요)
function makeCourse(base, dest, best) {
  const path = best.path.map(([lng, lat]) => ({ lat, lng }));
  let len = 0;
  for (let i = 1; i < path.length; i++) len += distance(path[i - 1], path[i]);
  const m = best.metrics;
  const distance_km = Math.round(len / 100) / 10;
  const short = { ko: dest.name.ko.replace(/\s*\(.*\)/, ""), en: dest.name.en.replace(/\s*\(.*\)/, "") };
  const ele = best.path.map((p) => p[2]);
  const elevation = ele.every((x) => x != null) ? sample(ele, 60) : [];
  const properties = {
    ...base.properties,
    id: `here-${base.properties.dest}-${Date.now()}`,
    name: { ko: `내 위치 → ${short.ko}`, en: `From here → ${short.en}` },
    title: { ko: `내 위치 → ${short.ko}`, en: `From here → ${short.en}` },
    distance_km, minutes: Math.round(distance_km * MIN_PER_KM),
    ascent_m: m.ascent_m ?? null, elevation, spots: [base.properties.dest],
    fromHere: true, hereMetrics: m,
  };
  return { id: properties.id, properties, path, len, cues: [] };
}
function sample(xs, n) {
  return Array.from({ length: n }, (_, k) => xs[Math.round((k / (n - 1)) * (xs.length - 1))]);
}
