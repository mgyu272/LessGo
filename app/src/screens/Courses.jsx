// ③ 코스 고르기 (디자인 원본 docs/design/Courses.dc.html)
// 한 화면에서 조건을 고르고 두 길을 비교해요. (예전 코스 조건 시트 · 코스 3개 · 코스 상세를 합쳤어요)
// - 지도 위 조건 칩 4개(목적지 · 거리 · 언덕 · 테마) → 옵션 시트
// - 바텀시트: 가로로 넘기는 경로 카드(완만한 길 low / 언덕 허용 high). 고른 카드의 경로가 지도에서 굵게
// - 시트를 끌어올리면 비교표(거리 · 예상 시간 · 오르막 · 급경사)와 지나가는 곳
// - 아래 고정: 저장(하트) + "…로 시작"
// 데이터: public/data/lessgo 번들 (lib/routes.js). 예상 시간은 1km 6분 30초 기준.

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { aiRecommend } from "../lib/ai.js";
import { distance } from "../lib/geo.js";
import { DESTINATIONS, DISTANCES, MODES, nearestKm } from "../lib/routes.js";
import { getCourse } from "../lib/data.js";
import { MapView, FitBounds, SpotMarker, Route, Dot } from "../components/MapView.jsx";
import { spotIconSvg } from "../components/SpotIcons.jsx";
import { ElevationChart } from "../components/Bits.jsx";
import { useBottomSheet, BottomSheet, Chip, Badge, OptionSheet } from "../components/ui.jsx";
import { speedParam } from "./Home.jsx";
import { startSavedCourse } from "../lib/startSavedCourse.js";

// 지도 선 색: 완만한 길(low) = 초록, 언덕 허용(high) = 주황 (단색)
export const MODE_COLOR = { low: "#2F6512", high: "#E38B2C" };
const HILLS = ["flat", "some", "hard"];           // 평지 위주 → low, 약간 언덕·도전 → high
const THEMES = ["wall", "hanok", "tomb", "indep", "river", "park", "temple", "cafe", "market", "night"];
const NEAR_ROUTE_M = 150;                          // 이 거리 안의 제휴 가게를 "지나가는 곳"에 보여줘요

// 시트 높이: 처음엔 지도가 넉넉히 보이게(위에서 470px), 끌어올리면 위 칩 아래(118px)까지
const snapsFor = (screenH) => [Math.max(300, screenH - 470), screenH - 118];

export default function CoursePicker() {
  const app = useApp();
  const { data, pick, setPick } = app;
  const km = nearestKm(pick.km);
  const dest = DESTINATIONS.includes(pick.dest) ? pick.dest : DESTINATIONS[0];
  const pair = MODES.map((m) => getCourse(data, dest, km, m)).filter(Boolean);
  const [sel, setSel] = useState(pick.hill === "flat" ? "low" : "high");
  const [chip, setChip] = useState("");
  const [favs, setFavs] = useState(readFavs);
  const sheet = useBottomSheet({ snaps: snapsFor, initial: 0 });
  const course = pair.find((c) => c.properties.mode === sel) || pair[0];
  const place = (id) => loc(data.spotById[id]?.name).replace(/\s*\(.*\)/, "");

  // 언덕 조건을 바꾸면 그에 맞는 카드를 다시 골라요
  useEffect(() => { setSel(pick.hill === "flat" ? "low" : "high"); }, [pick.hill]);

  // AI 추천 이유 (있으면 카드 아래 안내에 써요). 없으면 데이터로 만든 문장
  const [reasons, setReasons] = useState({});
  useEffect(() => {
    let alive = true;
    aiRecommend({ ...app.settings, km, hill: pick.hill === "flat" ? "flat" : "hard" }, app.weather, app.lang)
      .then((res) => { if (alive) setReasons(Object.fromEntries((res?.picks || []).map((p) => [p.id, p.reason]))); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [km, pick.hill, app.lang]);

  if (!course) {
    return (
      <section className="screen picker-screen">
        <PickerTop onBack={() => app.go("home")} />
        <p className="note cream picker-empty">{t("no_route_data")}</p>
      </section>
    );
  }

  const p = course.properties;
  const saved = favs.has(course.id);
  const toggleSave = () => { const f = new Set(favs); f.has(course.id) ? f.delete(course.id) : f.add(course.id); writeFavs(f); setFavs(f); };
  const start = () => startSavedCourse(app, course, speedParam());
  const startSimulation = () => app.run.start(course, { demo: true, speedup: speedParam() });
  const reason = reasons[course.id] || factualReason(course, pair);
  const themeText = pick.themes.length ? (pick.themes.length > 1 ? t("theme_more", { first: t("th2_" + pick.themes[0]), n: pick.themes.length - 1 }) : t("th2_" + pick.themes[0])) : t("theme");

  return (
    <section className="screen picker-screen">
      <MapView className="picker-map">
        {/* 고르지 않은 쪽: 얇은 점선, 고른 쪽: 흰 테두리 + 굵은 선 (고른 선이 위에 오게 나중에 그려요) */}
        {pair.filter((o) => o.id !== course.id).flatMap((o) => [
          <Route key={o.id + "-case"} path={o.path} color="#FFFFFF" weight={6.5} opacity={0.7} />,
          <Route key={o.id} path={o.path} color={MODE_COLOR[o.properties.mode]} weight={3.5} opacity={0.7} dashed />,
        ])}
        <Route key={course.id + "-case"} path={course.path} color="#FFFFFF" weight={12} opacity={1} />
        <Route key={course.id} path={course.path} color={MODE_COLOR[p.mode]} weight={7} opacity={1} />
        <Dot at={[course.path[0].lat, course.path[0].lng]} color={MODE_COLOR[p.mode]} />
        {data.spotById[dest] && <SpotMarker spot={data.spotById[dest]} />}
        <FitBounds points={pair.flatMap((o) => o.path).map((q) => [q.lat, q.lng])} padTL={[30, 130]} padBR={[30, sheet.snaps[0] + 20]} fitKey={dest + km} />
      </MapView>

      <PickerTop onBack={() => app.go("home")}>
        <div className="picker-chips scroll" role="toolbar" aria-label={t("course_conditions")}>
          <Chip caret aria-haspopup="dialog" onClick={() => setChip("dest")}>{place(dest)}</Chip>
          <Chip caret aria-haspopup="dialog" onClick={() => setChip("km")}>{km}km</Chip>
          <Chip caret aria-haspopup="dialog" onClick={() => setChip("hill")}>{t("hill2_" + pick.hill)}</Chip>
          <Chip caret aria-haspopup="dialog" onClick={() => setChip("theme")}>{themeText}</Chip>
        </div>
      </PickerTop>

      <BottomSheet sheet={sheet} className="picker-sheet" aria-label={t("pick_course")}>
        <div className="picker-body scroll">
          <div className="picker-head">
            <h2>{t("course_to", { name: place(dest), km })}</h2>
            <button className="picker-more" onClick={sheet.toggle}>{t(sheet.expanded ? "fold" : "details")}</button>
          </div>

          <div className="rail scroll" role="radiogroup" aria-label={t("route_type")}>
            {pair.map((o) => <RouteCard key={o.id} c={o} on={o.id === course.id} onPick={() => setSel(o.properties.mode)} />)}
            <button className="rc rc-other" onClick={() => setChip("dest")}>
              <span className="rc-icons" aria-hidden="true">
                {DESTINATIONS.filter((d) => d !== dest && data.spotById[d]).map((d) => <span key={d} dangerouslySetInnerHTML={{ __html: spotIconSvg(data.spotById[d]) }} />)}
              </span>
              <b>{t("run_elsewhere")}</b>
              <small>{t("also_courses", { names: DESTINATIONS.filter((d) => d !== dest).map(place).join(" · ") })}</small>
              <span className="rc-link">{t("change_dest")} →</span>
            </button>
          </div>

          <p className="soft picker-reason"><InfoIcon /><span>{reason}</span></p>
          {p.status === "review_required" && <p className="picker-warn"><WarnIcon /><span>{t("warn_review")}</span></p>}
          {p.elevationLow && <p className="picker-warn"><WarnIcon /><span>{t("warn_elev")}</span></p>}

          <CompareTable pair={pair} sel={course.id} />
          <Timeline course={course} />
          <p className="soft picker-reason">실제 러닝은 GPS로 출발지를 확인해요. 시뮬레이션 모드는 GPS 없이 가상으로 코스를 체험합니다.</p>
          <span className="picker-spacer" aria-hidden="true" />
        </div>
      </BottomSheet>

      <div className="picker-cta">
        <button className="soft picker-heart" aria-label={t(saved ? "unsave_course" : "save_course")} aria-pressed={saved} onClick={toggleSave}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill={saved ? "#9FD25E" : "none"}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
        </button>
        <button className="btn btn-cta picker-cta-gps" onClick={start}>{t("gps_start")}</button>
        <button className="btn btn-soft picker-cta-demo" onClick={startSimulation}>{t("simulation_mode")}</button>
      </div>

      <OptionSheet open={chip === "dest"} title={t("ask_dest")} cols={2} value={dest} onClose={() => setChip("")}
        options={DESTINATIONS.map((d) => ({ value: d, label: place(d), sub: t("dest_sub_" + d) }))}
        onPick={(v) => setPick({ ...pick, dest: v })} />
      <OptionSheet open={chip === "km"} title={t("ask_km")} cols={3} value={km} onClose={() => setChip("")}
        options={DISTANCES.map((k) => ({ value: k, label: `${k}km`, sub: t("km_" + k) }))}
        onPick={(v) => setPick({ ...pick, km: v })} />
      <OptionSheet open={chip === "hill"} title={t("ask_hill")} cols={3} value={pick.hill} onClose={() => setChip("")}
        options={HILLS.map((h) => ({ value: h, label: t("hill2_" + h), sub: t("hill2_" + h + "_s") }))}
        onPick={(v) => setPick({ ...pick, hill: v })} />
      {/* TODO: 테마는 아직 코스 데이터에 없어서 고르기만 하고 코스 필터에는 쓰지 않아요 (번들에 테마가 생기면 연결) */}
      <OptionSheet open={chip === "theme"} title={t("ask_theme")} cols={2} multi values={new Set(pick.themes)} onClose={() => setChip("")}
        options={THEMES.map((m) => ({ value: m, label: t("th2_" + m), sub: t("th2_" + m + "_s") }))}
        onPick={(v) => setPick({ ...pick, themes: pick.themes.includes(v) ? pick.themes.filter((x) => x !== v) : [...pick.themes, v] })} />
    </section>
  );
}

function PickerTop({ onBack, children }) {
  return (
    <div className="picker-top">
      <div className="picker-title">
        <button className="round-btn glass" onClick={onBack} aria-label={t("back_home")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <h1 className="glass">{t("pick_course")}</h1>
      </div>
      {children}
    </div>
  );
}

// 경로 카드: 색 점 + 이름 + 배지, 한 줄 설명, 거리·예상 시간·오르막, 고도 그래프
function RouteCard({ c, on, onPick }) {
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
        <span><b>{t("min_n", { n: p.minutes })}</b><small>{t("est_time")}</small></span>
        <span><b>{p.ascent_m == null ? t("unknown") : `+${p.ascent_m}m`}</b><small>{t("uphill_short")}</small></span>
      </span>
      <ElevationChart values={p.elevation} height={30} color={color} fill={p.mode === "low" ? "rgba(47,101,18,.14)" : "rgba(227,139,44,.14)"} />
    </button>
  );
}

// 두 길 비교표: 거리 · 예상 시간 · 오르막 · 급경사(8% 이상) 구간
function CompareTable({ pair, sel }) {
  const rows = [
    ["distance", (p) => `${p.distance_km}km`],
    ["est_time", (p) => t("about_min", { n: p.minutes })],
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
function factualReason(course, pair) {
  const p = course.properties;
  const other = pair.find((o) => o.id !== course.id)?.properties;
  if (other && p.ascent_m != null && other.ascent_m != null) {
    const diff = other.ascent_m - p.ascent_m;
    if (diff > 0) return t("reason_less_climb", { n: diff });
    if (diff < 0) return t("reason_more_climb", { n: -diff });
  }
  return t("reason_basic", { km: p.distance_km, n: p.minutes });
}

const InfoIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
const WarnIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17h.01" /></svg>;
const PlayIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none" /></svg>;
const BagIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z" /><path d="M8 9V7a4 4 0 0 1 8 0v2" /></svg>;
const CheckIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;

function readFavs() { try { return new Set(JSON.parse(localStorage.getItem("runtrip.favs") || "[]")); } catch { return new Set(); } }
function writeFavs(f) { try { localStorage.setItem("runtrip.favs", JSON.stringify([...f])); } catch {} }
