// ③ 코스 고르기 (디자인 원본 docs/design/Courses.dc.html)
// 한 화면에서 조건을 고르고 두 길을 비교해요. (예전 코스 조건 시트 · 코스 3개 · 코스 상세를 합쳤어요)
// - 지도 위: 뒤로 + 출발 → 도착 카드. 출발은 고른 코스의 출발지(바꾸기 없음, 위치를 알면 "내 위치에서 N m"),
//   도착 줄을 누르면 목적지 고르기 시트. 시트 안에서 달리기/걷기 → 거리 탭, 경사는 완만한 길/언덕 허용 카드로 골라요
// - 바텀시트: 가로로 넘기는 경로 카드(완만한 길 low / 언덕 허용 high). 고른 카드의 경로가 지도에서 굵게
// - 시트를 끌어올리면 비교표(거리 · 예상 시간 · 오르막 · 급경사)와 지나가는 곳
// - 아래 고정: "A 완만한 길 · 출발지로 이동" → 출발지로 이동 화면(ToCourseStart). 고른 move는 pick.move로 넘어가요
// 데이터: public/data/lessgo 번들 (lib/routes.js). 예상 시간은 달리기 1km 6분 30초, 걷기 1km 15분 기준.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, MAIN } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { aiRecommend } from "../lib/ai.js";
import { distance } from "../lib/geo.js";
import { DESTINATIONS, DISTANCES, MODES, nearestKm, minutesFor, durText } from "../lib/routes.js";
import { getCourse } from "../lib/data.js";
import { MapView, FitBounds, SpotMarker, Route, Dot, Me } from "../components/MapView.jsx";
import { spotIconSvg } from "../components/SpotIcons.jsx";
import { ElevationChart } from "../components/Bits.jsx";
import { useBottomSheet, BottomSheet, Chip, Badge, OptionSheet, Segment, Toggle } from "../components/ui.jsx";
import { speedParam } from "./Home.jsx";
import { buildCoursesFromHere } from "../lib/fromHere.js";

// 지도 선 색: 완만한 길(low) = 파랑, 언덕 허용(high) = 웜톤 빨강 (단색)
export const MODE_COLOR = { low: "#2B6FD6", high: "#E04A2F" };
const HERE_COLOR = "#2F6512"; // 현위치 코스 미리보기 선 = 달리기 화면 코스 색(초록)과 통일
const HILLS = ["flat", "some", "hard"];           // 평지 위주 → low, 약간 언덕·도전 → high
const THEMES = ["wall", "hanok", "tomb", "indep", "river", "park", "temple", "cafe", "market", "night"];
const NEAR_ROUTE_M = 150;
// 조건 칩 줄(거리·경사·테마)을 보일지. 지금은 숨겨요 (테마는 실제 필터가 없어서). 다시 쓰려면 true
const SHOW_CONDITION_CHIPS = false;                          // 이 거리 안의 제휴 가게를 "지나가는 곳"에 보여줘요

// 시트 높이: 처음엔 지도가 넉넉히 보이게(위에서 470px), 끌어올리면 위 칩 아래(118px)까지
const snapsFor = (screenH) => [Math.max(300, screenH - 470), screenH - 118];

export default function CoursePicker() {
  const app = useApp();
  const { data, pick, setPick } = app;
  const km = nearestKm(pick.km);
  const dests = data.destinations || DESTINATIONS;
  const dest = dests.includes(pick.dest) ? pick.dest : dests[0];
  const savedPair = MODES.map((m) => getCourse(data, dest, km, m)).filter(Boolean);
  const place = (id) => loc(data.spotById[id]?.name).replace(/\s*\(.*\)/, "");
  // 이동 방법 (카카오맵 길찾기의 자동차·버스·도보처럼 맨 위): 달리기 / 걷기
  const move = pick.move === "walk" ? "walk" : "run";
  const setMove = (v) => setPick({ ...pick, move: v });
  // 출발: 코스 출발지(저장 코스) / 현위치(내 위치 → 목적지 두 길을 새로 찾아요)
  const [source, setSource] = useState("course");
  const [hereSets, setHereSets] = useState({}); // "dest-km" → { low, high, here } (현위치에서도 3·5·10km)
  const [finding, setFinding] = useState(false);
  const hereKey = `${dest}-${km}`;
  const hereSet = hereSets[hereKey];
  const herePair = hereSet ? [hereSet.low, hereSet.high].filter(Boolean) : [];
  const pair = source === "here" ? herePair : savedPair;
  const [sel, setSel] = useState(pick.hill === "flat" ? "low" : "high");
  const course = pair.find((c) => c.properties.mode === sel) || pair[0];
  const [chip, setChip] = useState("");

  // 내 위치 (출발지까지 거리 표시용). 권한이 없으면 표시만 안 해요
  const [here, setHere] = useState(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    let alive = true;
    navigator.geolocation.getCurrentPosition((pos) => alive && setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    return () => { alive = false; };
  }, []);

  // 현위치를 고르면(또는 목적지를 바꾸면) 내 위치에서 완만한 길·언덕 허용 두 길을 찾아요
  useEffect(() => {
    if (source !== "here" || hereSet) return;
    const bases = { low: getCourse(data, dest, km, "low") || savedPair[0], high: getCourse(data, dest, km, "high") || savedPair[0] };
    if (!bases.low) return;
    let alive = true;
    setFinding(true);
    buildCoursesFromHere(bases, data.spotById[dest], app.demo, km).then((r) => {
      if (!alive) return;
      setFinding(false);
      if (r.error) { app.toast(r.error); setSource("course"); return; }
      setHereSets((m) => ({ ...m, [hereKey]: r }));
    });
    return () => { alive = false; setFinding(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, dest, km]);

  // 아래 목록 칸 높이: 손잡이를 위아래로 끌어요 (지도를 크게 보고 싶으면 내리기)
  const [panelH, setPanelH] = useState(null); // null = 기본 높이 (CSS)
  const panelRef = useRef(null);
  const onGrip = (e) => {
    e.preventDefault();
    const el = panelRef.current, screen = el?.parentElement;
    if (!el || !screen) return;
    const startY = e.clientY, startH = el.offsetHeight;
    const min = 86, max = Math.round(screen.offsetHeight * 0.72);
    const move = (ev) => setPanelH(clamp(startH - (ev.clientY - startY), min, max));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  const fromName = source === "here" ? loc({ ko: "현위치", en: "My location" }) : course ? startNameOf(course) : t("start_point");
  const fromM = source === "course" && here && course ? distance(here, course.path[0]) : null;
  // 안내 시작: 코스 출발지면 출발지 화면(카카오맵 길찾기 → 150m 안이면 시작, 시연 모드면 바로 자동), 현위치면 바로 시작
  const startRoute = (c) => {
    app.setCourse(c);
    if (source === "here" || app.demo) return app.run.start(c, { demo: app.demo, speedup: speedParam(), move });
    app.go("toStart");
  };
  const allPaths = pair.flatMap((o) => o.path).map((q) => [q.lat, q.lng]);

  return (
    <section className="screen cx-screen">
      {/* ① 이동 방법 + 출발·도착 (한 칸) */}
      <header className="cx-head">
        <div className="cx-modes" role="radiogroup" aria-label={t("move_label")}>
          {[["run", RunIcon, t("move_run")], ["walk", WalkIcon, t("move_walk")]].map(([v, Ic, label]) => (
            <button key={v} type="button" role="radio" aria-checked={move === v} className={`cx-mode ${move === v ? "on" : ""}`} onClick={() => setMove(v)}>
              <Ic /><span>{label}</span>
            </button>
          ))}
          <button type="button" className="cx-close" onClick={() => app.go(MAIN)} aria-label={t("close")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="cx-box">
          <div className="cx-row">
            <span className="cx-k">{loc({ ko: "출발", en: "From" })}</span>
            <b className="cx-v">{fromName}</b>
            {fromM != null && <small className="cx-m">{loc({ ko: `내 위치에서 ${fmtM(fromM)}`, en: `${fmtM(fromM)} away` })}</small>}
            <button type="button" className="cx-link" onClick={() => setSource(source === "here" ? "course" : "here")}>
              {source === "here" ? loc({ ko: "코스 출발지", en: "Course start" }) : loc({ ko: "현위치로", en: "From here" })}
            </button>
          </div>
          <div className="cx-row">
            <span className="cx-k">{loc({ ko: "도착", en: "To" })}</span>
            <b className="cx-v">{place(dest)}</b>
            <button type="button" className="cx-link" onClick={() => setChip("dest")}>{loc({ ko: "바꾸기", en: "Change" })}</button>
          </div>
        </div>
      </header>

      {/* ② 지도 */}
      <div className="cx-map">
        <MapView className="cx-mapview">
          {course && [
            ...pair.filter((o) => o.id !== course.id).flatMap((o) => [
              <Route key={o.id + "-case"} path={o.path} color="#FFFFFF" weight={7} opacity={0.85} zIndex={1} />,
              <Route key={o.id} path={o.path} color={MODE_COLOR[o.properties.mode]} weight={4.5} opacity={0.95} dashed zIndex={2} />,
            ]),
            <Route key={course.id + "-case"} path={course.path} color="#FFFFFF" weight={12} opacity={1} zIndex={5} />,
            <Route key={course.id} path={course.path} color={MODE_COLOR[course.properties.mode]} weight={7} opacity={1} zIndex={6} />,
            source === "here"
              ? <Me key="me" at={[course.path[0].lat, course.path[0].lng]} />
              : <Dot key="start" at={[course.path[0].lat, course.path[0].lng]} color={MODE_COLOR[course.properties.mode]} />,
            <FitBounds key="fit" points={allPaths} padTL={[24, 24]} padBR={[24, 24]} fitKey={source + dest + km + pair.length} />,
          ]}
          {data.spotById[dest] && <SpotMarker spot={data.spotById[dest]} />}
        </MapView>
      </div>

      {/* ③ 길 목록 (카카오맵 길찾기 결과처럼) */}
      <div className="cx-panel" ref={panelRef} style={panelH ? { flex: `0 0 ${panelH}px` } : undefined}>
        <div className="cx-grip" onPointerDown={onGrip} aria-hidden="true"><span /></div>
        {/* 거리 탭: 코스 출발지·현위치 둘 다 3·5·10km */}
        <div className="cx-tabs" role="tablist" aria-label={t("distance")}>
          {DISTANCES.map((k) => (
            <button key={k} role="tab" aria-selected={km === k} className="cx-tab" onClick={() => setPick({ ...pick, km: k })}>{k}km</button>
          ))}
        </div>
        {finding && <p className="cx-empty cx-finding">{loc({ ko: "현위치에서 러닝에 최적화된 길을 찾고 있어요...", en: "Finding the best running route from here..." })}</p>}
        {!finding && pair.length === 0 && <p className="cx-empty">{t("no_route_data")}</p>}
        {/* 완만한 길 · 언덕 허용: 옆으로 넘기는 카드 */}
        {!finding && pair.length > 0 && <div className="cx-rail" role="radiogroup" aria-label={t("route_type")}>
        {pair.map((o) => {
          const p = o.properties, on = o.id === course?.id, color = MODE_COLOR[p.mode];
          return (
            <article key={o.id} className={`cx-item ${on ? "on" : ""}`} role="radio" aria-checked={on} onClick={() => setSel(p.mode)} style={{ "--c": color }}>
              <div className="cx-item-top">
                <span className="cx-tag" style={{ color, background: color + "1A" }}>{loc(p.modeName)}</span>
                <small>{t("mode_sub_" + p.mode)}</small>
              </div>
              <div className="cx-time">{durText(minutesFor(p.distance_km, move))}</div>
              <div className="cx-sub">{p.distance_km}km · {p.ascent_m == null ? t("unknown") : `${loc({ ko: "오르막", en: "Climb" })} +${p.ascent_m}m`}</div>
              <ElevationChart values={p.elevation} height={18} color={color} fill={color + "22"} />
              <button type="button" className="cx-go" onClick={(e) => { e.stopPropagation(); setSel(p.mode); startRoute(o); }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 18-7-4-7 4z" /></svg>
                {loc({ ko: "안내시작", en: "Start" })}
              </button>
            </article>
          );
        })}
        </div>}
        <Toggle className="demo-row cx-demo" checked={app.demo} onChange={app.setDemo} title={t("demo_mode")} sub={t("demo_sub")} />
      </div>

      <DestSheet open={chip === "dest"} dest={dest} place={place} onClose={() => setChip("")} onPick={(v) => setPick({ ...pick, dest: v })} />
    </section>
  );
}

function PickerTop({ onBack, fromName, fromM, name, onDest, children }) {
  return (
    <div className="picker-top">
      <div className="picker-title">
        <button className="round-btn glass picker-back" onClick={onBack} aria-label={t("back_home")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="trip-card">
          <div className="trip-row">
            <i className="trip-from" aria-hidden="true" />
            <small>{t("from_label")}</small><b>{fromName}</b>
            {fromM != null && <span className="trip-near">{t("from_here_d", { d: fmtM(fromM) })}</span>}
          </div>
          <button className="trip-row" onClick={onDest} aria-haspopup="dialog" aria-label={t("dest_btn_label", { name })}>
            <svg className="trip-pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
            <small>{t("to_label")}</small><b>{name}</b>
            <span className="trip-change" aria-hidden="true">{t("change")} ▾</span>
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

// 코스 출발지 이름 (번들 route.start.name). "OSM …" 같은 자동 이름은 ToCourseStart처럼 기본 문구로
function startNameOf(course) {
  const n = course?.properties?.route?.start?.name;
  return n && !n.startsWith("OSM ") ? n : t("start_point");
}

// 거리 표시: 1km 미만은 m, 그 이상은 km 한 자리
const fmtM = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);

// 목적지 고르기 시트 ("어디든" 같은 데이터 없는 옵션은 넣지 않아요)
function DestSheet({ open, dest, place, onClose, onPick }) {
  const { data } = useApp();
  return (
    <OptionSheet open={open} title={t("choose_dest")} cols={2} value={dest} onClose={onClose}
      options={(data.destinations || DESTINATIONS).map((d) => ({ value: d, label: place(d), sub: DESTINATIONS.includes(d) ? t("dest_sub_" + d) : data.spotById[d]?.kindLabel || "" }))} onPick={onPick} />
  );
}

// 경로 카드: 색 점 + 이름 + 배지, 한 줄 설명, 거리·예상 시간·오르막, 고도 그래프
function RouteCard({ c, move, on, onPick }) {
  const p = c.properties;
  const color = MODE_COLOR[p.mode];
  return (
    <button className={`rc card ${on ? "on" : ""}`} role="radio" aria-checked={on} onClick={onPick}>
      <span className="rc-top">
        <i className="rc-dot" style={{ background: color, boxShadow: `0 0 0 3px #FFFFFF, 0 0 0 4px ${color}` }} aria-hidden="true" />
        <b>{loc(p.modeName)}</b>
        <span className="rc-badges">
          {p.formal && <Badge>{t("recommended")}</Badge>}
          {p.elevationLow && <Badge tone="orange">{t("flag_elev")}</Badge>}
          {p.status === "review_required" && <Badge tone="warn">{t("needs_review")}</Badge>}
        </span>
      </span>
      <small className="rc-sub">{t("mode_sub_" + p.mode)}</small>
      <span className="rc-stats">
        <span><b>{p.distance_km}km</b><small>{t("distance")}</small></span>
        <span><b>{durText(minutesFor(p.distance_km, move))}</b><small>{t("est_time")}</small></span>
        <span><b>{p.ascent_m == null ? t("unknown") : `+${p.ascent_m}m`}</b><small>{t("uphill_short")}</small></span>
      </span>
      <ElevationChart values={p.elevation} height={30} color={color} fill={p.mode === "low" ? "rgba(47,101,18,.14)" : "rgba(227,139,44,.14)"} />
    </button>
  );
}

// 두 길 비교표: 거리 · 예상 시간 · 오르막 · 급경사(8% 이상) 구간
function CompareTable({ pair, sel, move }) {
  const rows = [
    ["distance", (p) => `${p.distance_km}km`],
    ["est_time", (p) => t("about_dur", { d: durText(minutesFor(p.distance_km, move)) })],
    ["uphill_short", (p) => (p.ascent_m == null ? t("unknown") : `+${p.ascent_m}m`)],
    ["steep_parts", (p) => steepText(p.route)],
  ];
  return (
    <section className="card cmp-table" aria-label={t("compare_two")}>
      <div className="cmp"><span />{pair.map((o) => <b key={o.id} className={`cmp-h ${o.properties.mode}`}>{loc(o.properties.modeName)}</b>)}</div>
      {rows.map(([key, fn]) => (
        <div className="cmp" key={key}>
          <span className="cmp-k">{t(key)}</span>
          {pair.map((o) => <span key={o.id} className={o.id === sel ? "cmp-on" : "cmp-off"}>{fn(o.properties)}</span>)}
        </div>
      ))}
    </section>
  );
}

// 급경사 구간: 번들의 elevation.steep_segments_8_percent (개수와 길이). 배열이 없으면 알 수 없음
function steepText(route) {
  const segs = route?.elevation?.steep_segments_8_percent;
  if (!Array.isArray(segs)) return t("unknown");
  if (!segs.length) return t("none");
  const m = Math.round(segs.reduce((s, x) => s + (x.distance_m || 0), 0));
  return t("steep_n", { n: segs.length, m });
}

// 지나가는 곳: 출발(번들의 출발 지점) → 경로 150m 안의 제휴 가게 → 도착(목적지)
// 중간 지점 이름은 데이터가 없어서 넣지 않아요
function Timeline({ course }) {
  const { data } = useApp();
  const p = course.properties;
  const shops = useMemo(() => shopsAlong(course, data.shops), [course, data.shops]);
  const startName = p.route?.start?.name;
  return (
    <section className="timeline" aria-label={t("passing_by")}>
      <h3>{t("passing_by")}</h3>
      <ol>
        <li className="tl"><span className="tl-dot start" aria-hidden="true"><PlayIcon /></span>
          <span><b>{startName || t("start_point")}</b><small>{t("depart")}</small></span></li>
        {shops.map(({ s, km }) => (
          <li className="tl" key={s.id}><span className="tl-dot shop" aria-hidden="true"><BagIcon /></span>
            <span><b>{loc(s.name)}</b><small>{t("km_point", { km })}{s.visit_coupon ? " · " + t("coupon_if_visit") : ""}</small></span></li>
        ))}
        <li className="tl"><span className="tl-dot end" aria-hidden="true"><CheckIcon /></span>
          <span><b>{loc(data.spotById[p.dest]?.name)}</b><small>{t("arrive_stamp")}</small></span></li>
      </ol>
    </section>
  );
}

function shopsAlong(course, shops) {
  const cum = [0];
  for (let i = 1; i < course.path.length; i++) cum.push(cum[i - 1] + distance(course.path[i - 1], course.path[i]));
  return shops.filter((s) => s.partner).map((s) => {
    let best = Infinity, at = 0;
    course.path.forEach((q, i) => { const d = distance(q, s); if (d < best) { best = d; at = cum[i]; } });
    return { s, d: best, at, km: (at / 1000).toFixed(1) };
  }).filter((x) => x.d <= NEAR_ROUTE_M).sort((a, b) => a.at - b.at);
}

// 데이터로 만든 안내 문장 (AI 이유가 없을 때)
function factualReason(course, pair, move) {
  const p = course.properties;
  const other = pair.find((o) => o.id !== course.id)?.properties;
  if (other && p.ascent_m != null && other.ascent_m != null) {
    const diff = other.ascent_m - p.ascent_m;
    if (diff > 0) return t("reason_less_climb", { n: diff });
    if (diff < 0) return t("reason_more_climb", { n: -diff });
  }
  return t("reason_basic", { km: p.distance_km, n: minutesFor(p.distance_km, move) });
}

const InfoIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
const WarnIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17h.01" /></svg>;
const PlayIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none" /></svg>;
const BagIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z" /><path d="M8 9V7a4 4 0 0 1 8 0v2" /></svg>;
const RunIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="mv-ic"><circle cx="14.5" cy="4.5" r="2" /><path d="M8 21l3.5-6 3 2.5V22M6 12.5l3-3.5 4 1 2.5 3.5 3 .5M11.5 15l-1-5" /></svg>;
const WalkIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="mv-ic"><circle cx="12.5" cy="4.5" r="2" /><path d="M9.5 21l2-6.5 2.5 2.5V21M8.5 12l1.5-4 3.5 1 1.5 4M11.5 14.5l-1.5-6" /></svg>;
const CheckIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
