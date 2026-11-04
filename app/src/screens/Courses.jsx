// ② 맞춤 코스 설정 · ③ 오늘의 코스 3개 · ④ 코스 상세 (시안 2·3·4번)

import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { pickThree } from "../lib/recommend.js";
import { aiRecommend } from "../lib/ai.js";
import { MapView, FitBounds, HexLayer, SpotMarker, Route, Dot } from "../components/MapView.jsx";
import { getCourse } from "../lib/data.js";
import { ElevationChart, Seal, sealText } from "../components/Bits.jsx";
import { speedParam } from "./Home.jsx";
import { DISTANCES, MODES } from "../lib/routes.js";

// 지도 선 색: 완만한 길(low) = 초록, 언덕 허용(high) = 주황 (단색)
export const MODE_COLOR = { low: "#2F8A3A", high: "#E8780C" };
import { useEffect, useState } from "react";

// ---------------- ② 설정 ----------------
export function Settings() {
  const app = useApp();
  const s = app.settings;
  const set = (patch) => app.setSettings({ ...s, ...patch });
  const custom = !DISTANCES.includes(s.km);
  const toggleTheme = (k) => { const th = new Set(s.themes); th.has(k) ? th.delete(k) : th.add(k); set({ themes: th }); };

  return (
    <section className="screen overlay">
      <div className="dim" onClick={() => app.go("home")} />
      <div className="sheet tall">
        <div className="grip" />
        <div className="sheet-head">
          <h2>{t("settings_title")}</h2>
          <button className="icon-btn" onClick={() => app.go("home")} aria-label="close">×</button>
        </div>
        <div className="scroll-y">
          <h4>{t("distance")}</h4>
          <div className="seg">
            {DISTANCES.map((km) => <button key={km} className={s.km === km ? "on" : ""} onClick={() => set({ km })}>{km}km<small>{t("km_" + km)}</small></button>)}
            <button className={custom ? "on" : ""} onClick={() => set({ km: 4 })}>{t("custom")}</button>
          </div>
          {custom && <input type="number" className="input" min="1" max="21" step="0.5" value={s.km}
            onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) set({ km: v }); }} placeholder={t("custom_km_ph")} />}

          <h4>{t("purpose")}</h4>
          <div className="chips">
            {["run", "walk", "date", "family"].map((k) => <button key={k} className={`chip ${s.purpose === k ? "on" : ""}`} onClick={() => set({ purpose: k })}>{t("p_" + k)}</button>)}
          </div>

          <h4>{t("timeofday")}</h4>
          <div className="chips">
            {["dawn", "day", "evening", "night"].map((k) => <button key={k} className={`chip ${s.time === k ? "on" : ""}`} onClick={() => set({ time: k })}>{t("t_" + k)}</button>)}
          </div>
          {(s.time === "evening" || s.time === "night") && <p className="note cream">{t("night_note")}</p>}

          <h4>{t("hill")}</h4>
          <div className="seg seg-sub">
            {["flat", "mild", "hard"].map((k) => <button key={k} className={s.hill === k ? "on" : ""} onClick={() => set({ hill: k })}>{t("h_" + k)}<small>{t("h_" + k + "_s")}</small></button>)}
          </div>

          <h4>{t("themes")}</h4>
          <div className="chips">
            {["fortress", "stream", "park", "alley"].map((k) => <button key={k} className={`chip purple ${s.themes.has(k) ? "on" : ""}`} onClick={() => toggleTheme(k)}>{t("th_" + k)}</button>)}
          </div>

          <Toggle checked={s.quiet} onChange={(v) => set({ quiet: v })} title={t("quiet")} sub={t("quiet_sub")} />
        </div>
        <button className="btn btn-ink" onClick={() => app.go("list")}>{t("see_3")}</button>
      </div>
    </section>
  );
}

export function Toggle({ checked, onChange, title, sub, className = "" }) {
  return (
    <label className={`toggle-row ${className}`}>
      <span><b>{title}</b><small>{sub}</small></span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i className="switch" />
    </label>
  );
}

// ---------------- ③ 코스 3개 ----------------
export function CourseList() {
  const app = useApp();
  const s = app.settings;
  const rulePicks = pickThree(app.data, s, app.weather, app.shuffle);
  const w = app.weather;
  // AI 추천: 규칙 결과를 먼저 보여주고, AI 답이 오면 순서와 "추천 이유"를 바꿔 끼워요
  const [ai, setAi] = useState({ status: "loading", picks: null });
  const settingsKey = JSON.stringify({ ...s, themes: [...s.themes], w, lang: app.lang, shuffle: app.shuffle });
  useEffect(() => {
    let alive = true;
    setAi({ status: "loading", picks: null });
    const avoid = app.shuffle ? rulePicks.map((c) => c.id) : [];
    aiRecommend(s, w, app.lang, avoid).then((res) => { if (alive) setAi(res ? { status: "done", ...res } : { status: "off", picks: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);
  const byId = app.data.courseByKey;
  const picks = ai.picks ? ai.picks.map((p) => byId[p.id]).filter(Boolean) : rulePicks;
  const reasons = Object.fromEntries((ai.picks || []).map((p) => [p.id, p.reason]));
  return (
    <section className="screen light courses-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <header className="topbar">
        <button className="round-back glass" onClick={() => app.go("settings")} aria-label="back">‹</button>
        <div><h3>{t("today_3")}</h3><small>{[`${s.km}km`, t("p_" + s.purpose), t("h_" + s.hill)].join(" · ")}</small></div>
        {w && <span className="pill-outline glass">{w.rain ? t("rainy") : t("clear", { t: Math.round(w.temp) })}</span>}
      </header>
      <div className="scroll-y pad">
        <p className={`note mint ai-note ${ai.status}`}>
          {ai.status === "loading" ? t("ai_thinking") : ai.status === "done" ? t("ai_done", { model: ai.model }) : t("rotate_note")}
        </p>
        {picks.map((c, i) => <CourseCard key={c.id} c={c} top={i === 0} reason={reasons[c.id]} onClick={() => { app.setCourse(c); app.go("detail"); }} />)}
        <button className="btn btn-outline" onClick={() => app.setShuffle(app.shuffle + 1)}>{t("other_courses")}</button>
      </div>
    </section>
  );
}

function CourseCard({ c, top, reason, onClick }) {
  const app = useApp();
  const p = c.properties;
  const spotName = (id) => app.data.spotById[id]?.name;
  return (
    <article className={`course-card tone-${p.tone} ${top ? "top" : ""}`} onClick={onClick} data-course={c.id}>
      {/* 정식 추천 경로(formal_recommendation)일 때만 "오늘 가장 잘 맞는 코스" 배지 */}
      {top && p.formal && <div className="best">{t("best_match")}</div>}
      <div className="row-between"><h3>{loc(p.title)}</h3><span className={`tone ${p.tone}`}>{loc(p.modeName)}</span></div>
      <p className="sub">{t("to_place", { name: loc(spotName(p.dest)) })}</p>
      {reason && <p className="ai-reason"><span aria-hidden="true">✦</span> {reason}</p>}
      <ElevationChart values={p.elevation} {...(top ? { color: "#E6F7CC", fill: "rgba(230,247,204,.3)" } : {})} />
      <div className="row-between">
        <span className="km">{p.distance_km}<small>km</small></span>
        <div className="meta">
          <span>{t("about_min", { n: p.minutes })}</span>
          <span>{t("uphill", { lv: p.climbLevel ? t("lv_" + p.climbLevel) : t("unknown") })}</span>
          <span className="lamps" title={t("lamps")}>{"●".repeat(p.lamps)}{"○".repeat(3 - p.lamps)}</span>
        </div>
      </div>
    </article>
  );
}

// ---------------- ④ 상세 ----------------
export function CourseDetail() {
  const app = useApp();
  const c = app.course;
  const [fav, setFav] = useState(() => readFavs().has(c.id));
  const p = c.properties;
  const spots = p.spots.map((id) => app.data.spotById[id]).filter(Boolean);
  const pair = MODES.map((m) => getCourse(app.data, p.dest, p.km, m)).filter(Boolean);
  const place = loc(app.data.spotById[p.dest]?.name).replace(/\s*\(.*\)/, "");
  const pick = (other) => { app.setCourse(other); setFav(readFavs().has(other.id)); };
  const toggleFav = () => { const f = readFavs(); f.has(c.id) ? f.delete(c.id) : f.add(c.id); writeFavs(f); setFav(f.has(c.id)); };

  return (
    <section className="screen">
      <MapView className="map-half">
        <HexLayer cells={app.user.cells} landmarkCells={app.data.landmarkCells} />
        {/* 고르지 않은 쪽은 얇은 점선, 고른 쪽은 굵은 실선 (고른 선이 위에 오게 나중에 그려요) */}
        {pair.filter((o) => o.id !== c.id).map((o) => <Route key={o.id} path={o.path} color={MODE_COLOR[o.properties.mode]} weight={3} opacity={0.85} dashed />)}
        <Route key={c.id} path={c.path} color={MODE_COLOR[p.mode]} weight={7} opacity={0.95} />
        <Dot at={[c.path[0].lat, c.path[0].lng]} />
        {spots.map((s) => <SpotMarker key={s.id} spot={s} />)}
        <FitBounds points={pair.flatMap((o) => o.path).map((q) => [q.lat, q.lng])} padTL={[40, 90]} padBR={[40, 40]} fitKey={p.dest + p.km} />
      </MapView>
      <button className="round-back" onClick={() => app.go("list")} aria-label="back">‹</button>
      <div className="sheet detail-sheet">
        <div className="scroll-y">
          <p className="eyebrow purple">{p.km}km · {loc(p.modeName)}</p>
          <h2>{t("ways_to", { name: place, n: pair.length })}</h2>
          <div className="seg mode-seg" role="radiogroup" aria-label={t("route_type")}>
            {pair.map((o) => (
              <button key={o.id} role="radio" aria-checked={o.id === c.id} className={o.id === c.id ? "on" : ""} onClick={() => pick(o)}>
                <i className={`mode-line ${o.properties.mode}`} aria-hidden="true" />{loc(o.properties.modeName)}
                <small>{o.properties.distance_km}km · {o.properties.ascent_m == null ? t("unknown") : `+${o.properties.ascent_m}m`}</small>
              </button>
            ))}
          </div>
          <div className="stat-boxes">
            <div><b>{p.distance_km}km</b><small>{t("distance")}</small></div>
            <div><b>{t("about_min", { n: p.minutes })}</b><small>{t("est_time")}</small></div>
            <div><b>{p.ascent_m == null ? t("unknown") : `+${p.ascent_m}m`}</b><small>{t("ascent_total")}</small></div>
          </div>
          <h4>{t("elev")}</h4>
          <ElevationChart values={p.elevation} />
          <h4>{t("road_info")}</h4>
          <dl className="info-rows">
            <dt>{t("r_lamps")}</dt><dd className={p.lamps < 3 ? "warn" : ""}>{t("lamps_" + p.lamps)}</dd>
            <dt>{t("r_crowd")}</dt><dd>{t("crowd_" + p.crowd)}</dd>
            <dt>{t("r_resi")}</dt><dd className="plain">{t(p.residential ? "resi_yes" : "resi_no")}</dd>
          </dl>
          <h4>{t("spots_on", { n: spots.length })}</h4>
          <div className="spot-chips">
            {spots.map((s) => <div key={s.id}><Seal text={sealText(s)} size={36} off={!app.user.stamps.has(s.id)} /><span>{loc(s.name)}<small>{t("story_on_arrival")}</small></span></div>)}
          </div>
          <Toggle className="demo-row" checked={app.demo} onChange={app.setDemo} title={t("demo_mode")} sub={t("demo_sub")} />
        </div>
        <div className="cta-row">
          <button className={`heart ${fav ? "on" : ""}`} onClick={toggleFav} aria-label="save">{fav ? "♥" : "♡"}</button>
          <button className="btn btn-teal" onClick={() => app.run.start(c, { demo: app.demo, speedup: speedParam() })}>{t("start_this")}</button>
        </div>
      </div>
    </section>
  );
}

function readFavs() { try { return new Set(JSON.parse(localStorage.getItem("runtrip.favs") || "[]")); } catch { return new Set(); } }
function writeFavs(f) { try { localStorage.setItem("runtrip.favs", JSON.stringify([...f])); } catch {} }
