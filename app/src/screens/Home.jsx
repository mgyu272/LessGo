// ① 홈: 지도 + 끌어 올리는 바텀시트 (디자인 원본 docs/design/Main.dc.html)
// "오늘은 얼마나 달려볼까요?" 3/5/10km → 오늘의 추천 코스(다른 코스 보기 / 바로 시작) → 자유 달리기
// 시트를 끝까지 올리면 지도에 있는 스팟 목록이 보여요.

import { useState } from "react";
import { useApp, HOME_CENTER, HOME_LEVEL } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { MapView, FitSpots, FlyTo, HexLayer, SpotMarker, Me } from "../components/MapView.jsx";
import { CategoryIcon, spotIconSvg } from "../components/SpotIcons.jsx";
import { LangPill, ElevationChart } from "../components/Bits.jsx";
import { useBottomSheet, BottomSheet, Segment, Badge } from "../components/ui.jsx";
import { DESTINATIONS, DISTANCES } from "../lib/routes.js";
import { getCourse } from "../lib/data.js";

const FILTERS = [["all", "filter_all"], ["history", "filter_history"], ["stream", "filter_stream"], ["park", "filter_park"]];
// 바텀시트가 멈추는 높이 (px). 가운데(처음) 높이는 420인데, 낮은 화면(아이폰 SE 등)에서는
// 지도에 핀 자리가 남도록 화면 높이에 맞춰 낮춰요 (최소 300)
const snapsFor = (screenH) => [150, Math.max(300, Math.min(420, screenH - 330)), Math.min(640, screenH - 120)];

// 스팟 배지가 보여야 하는 지도 영역: 위쪽 검색·칩 아래부터 아래 시트 위까지 (지도 안쪽 px)
// 레이아웃 위치(offset)로 재요. 화면상 위치는 PC 아이폰 프레임 축소나 시트 애니메이션에 따라 달라져서요.
function homeSafeArea() {
  const map = document.querySelector(".home-map");
  const top = document.querySelector(".home-top");
  const sheet = document.querySelector(".home-screen .bsheet");
  return { top: top.offsetTop + top.offsetHeight + 8, bottom: sheet.offsetTop - 8, left: 8, right: map.offsetWidth - 8 };
}

// 오늘의 추천: 고른 거리의 완만한 길(low) 중 정식 추천(formal_recommendation) 경로. 없으면 null
export function todaysPick(data, km) {
  for (const dest of DESTINATIONS) {
    const c = getCourse(data, dest, km, "low");
    if (c?.properties.formal) return c;
  }
  return null;
}

export default function Home() {
  const app = useApp();
  const { data, settings, setSettings, user } = app;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState(null); // { at: [lat, lng], level }
  const [refit, setRefit] = useState(0);
  const [me, setMe] = useState(null);
  const [locating, setLocating] = useState(false);
  const sheet = useBottomSheet({ snaps: snapsFor, initial: 1 });
  const shown = data.spots.filter((s) => filter === "all" || s.category === filter);
  const pick = todaysPick(data, settings.km);
  const startFree = () => app.run.start(null, { demo: app.demo, speedup: speedParam() });

  // 코스 고르기로 (목적지를 미리 골라 둘 수 있어요)
  const openCourses = (dest) => { app.setPick({ ...app.pick, km: settings.km, ...(dest ? { dest } : {}) }); app.go("courses"); };
  const openSpot = (spot) => openCourses(spot.id);
  const search = (e) => {
    if (e.key !== "Enter") return;
    const q = query.trim().toLowerCase();
    const hit = data.spots.find((s) => s.name.ko.includes(q) || s.name.en.toLowerCase().includes(q));
    if (hit) setFlyTo({ at: [hit.lat, hit.lng], level: 2 });
  };
  const locate = () => {
    // 위치를 못 쓰면 성북구로 돌아와요 (핀이 모두 보이게 다시 맞춤)
    const fallback = () => { setLocating(false); setFlyTo(null); setRefit((n) => n + 1); app.toast(t("gps_denied")); };
    if (!navigator.geolocation) return fallback();
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); const at = [p.coords.latitude, p.coords.longitude]; setMe(at); setFlyTo({ at, level: 3 }); },
      fallback,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  return (
    <section className="screen home-screen">
      <MapView className="home-map" center={HOME_CENTER} level={HOME_LEVEL}>
        <HexLayer cells={user.cells} landmarkCells={data.landmarkCells} goals />
        {shown.map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openSpot(s)} />)}
        <Me at={me} />
        {/* 위쪽 검색·칩과 아래 시트에 배지·이름표가 가리지 않게 맞춰요 */}
        <FitSpots spots={data.spots} safe={homeSafeArea} refitKey={refit} />
        <FlyTo to={flyTo?.at} level={flyTo?.level} />
      </MapView>
      {data.failed?.includes("spots") && <p className="map-notice glass" role="status">{t("spots_load_error")}</p>}

      <div className="home-top">
        <div className="search-row">
          <label className="search glass">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={search} placeholder={t("search_ph")} aria-label={t("search_ph")} />
          </label>
          <LangPill glass />
        </div>
        <div className="chips scroll home-chips">
          {FILTERS.map(([k, key]) => (
            <button key={k} className={`chip ${filter === k ? "on" : "glass"}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {k !== "all" && <CategoryIcon category={k} />}{t(key)}
            </button>
          ))}
        </div>
      </div>

      {!sheet.expanded && (
        <button className={`locate-btn glass ${locating ? "busy" : ""}`} style={{ bottom: sheet.height + 14 }} onClick={locate} aria-label={t("my_location")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3" />
          </svg>
        </button>
      )}

      <BottomSheet sheet={sheet} className="home-sheet-v2">
        <div className="sheet-body">
          <h2>{t("home_title")}</h2>
          <Segment label={t("distance")} value={settings.km} onChange={(km) => setSettings({ ...settings, km })}
            options={DISTANCES.map((km) => ({ value: km, label: <>{km}<small>km</small></>, sub: t("km_" + km) }))} />

          {pick ? <TodayCard course={pick} onMore={() => openCourses(pick.properties.dest)}
            onStart={() => app.run.start(pick, { demo: app.demo, speedup: speedParam() })} /> : (
            // 이 거리에는 정식 추천 경로가 없어서 추천 카드를 숨기고, 코스 고르기로 가는 버튼만 둬요
            <button className="btn btn-soft today-none" onClick={() => openCourses()}>{t("pick_course_km", { km: settings.km })}</button>
          )}

          <button className="free-card glass" onClick={startFree}>
            <span className="free-ic" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18c4 0 4-7 8-7s4-6 8-6" /><circle cx="20" cy="5" r="1.6" fill="currentColor" /></svg>
            </span>
            <span className="free-text"><b>{t("free_title")}</b><small>{t("free_sub")}</small></span>
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>

          {sheet.expanded && (
            <section className="map-spots rise">
              <h3>{t("spots_on_map")}</h3>
              <ul>
                {data.spots.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => openSpot(s)}>
                      <span className="ms-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(s) }} />
                      <span className="ms-text"><b>{loc(s.name)}</b><small>{t("filter_" + s.category)}</small></span>
                      <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </BottomSheet>
    </section>
  );
}

// 오늘의 추천 카드: 장소 그림 + 배지 + 이름 · 거리·시간·오르막 + 고도 그래프 + 다른 코스 보기 / 바로 시작
function TodayCard({ course, onMore, onStart }) {
  const { data } = useApp();
  const p = course.properties;
  const spot = data.spotById[p.dest];
  const place = loc(spot?.name).replace(/\s*\(.*\)/, "");
  const climb = p.climbLevel ? t("climb_" + p.climbLevel) : t("climb_unknown");
  return (
    <article className="today-card card">
      <div className="tc-head">
        <span className="tc-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spot ? spotIconSvg(spot) : "" }} />
        <div className="tc-text">
          <Badge>{t("today_pick")}</Badge>
          <b>{t("to_place_mode", { name: place, mode: loc(p.modeName) })}</b>
          <small>{p.distance_km}km · {t("about_min", { n: p.minutes })} · {climb}</small>
        </div>
      </div>
      <ElevationChart values={p.elevation} height={28} color="#2F6512" fill="rgba(47,101,18,.12)" />
      <div className="tc-actions">
        <button className="btn btn-soft" onClick={onMore}>{t("other_courses")}</button>
        <button className="btn btn-cta" onClick={onStart}>{t("start_now")}
          <svg viewBox="0 0 24 24" className="play" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" /></svg>
        </button>
      </div>
    </article>
  );
}

// 주소 끝에 ?speed=30 을 붙이면 시연 모드가 30배 빠르게 움직여요 (기본 10배)
export function speedParam() {
  return Number(new URLSearchParams(location.search).get("speed")) || 10;
}
