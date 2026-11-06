// ① 홈: 지도 + 끌어 올리는 바텀시트 (디자인 원본 docs/design/Main.dc.html)
// "오늘은 얼마나 달려볼까요?" 3/5/10km → 오늘의 추천 코스(다른 코스 보기 / 바로 시작) → 자유 달리기
// 시트를 끝까지 올리면 지도에 있는 스팟 목록이 보여요. 코스 목적지 핀·목록을 누르면 장소 상세(이야기 탭)로 가요.
// 둘러볼 곳(explore.json): 작은 색 점. 멀리 볼 때는 "성북동 18"처럼 묶고, 점을 누르거나 확대하면
//   시트 바로 위에 가로로 넘기는 카드 줄(고른 곳이 맨 앞)이 떠요. 확대 상태에서는 왼쪽 위에 "← 전체 지도".
//   공원·전망 칩은 묶지 않고 이름까지 보여주고, 하천길 칩은 아직 좌표가 없어서 안내 카드를 띄워요.
// 칩·고른 곳·확대 범위·시트 높이는 AppContext(app.homeMap)에 남겨서, 둘러볼 곳 상세에 갔다 와도 그대로예요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, HOME_CENTER, HOME_LEVEL } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { MapView, FitSpots, FlyTo, PanTo, SpotMarker, Me, ExploreLayer, MapWatch, CLUSTER_MIN_LEVEL } from "../components/MapView.jsx";
import { CategoryIcon, spotIconSvg } from "../components/SpotIcons.jsx";
import { LangPill, ElevationChart } from "../components/Bits.jsx";
import { useBottomSheet, BottomSheet, Segment, Badge } from "../components/ui.jsx";
import { DESTINATIONS, DISTANCES } from "../lib/routes.js";
import { getCourse } from "../lib/data.js";
import { distance } from "../lib/geo.js";
import { exploreColor, exploreMeta, fromCourseEnd, areaLabel } from "../lib/places.js";

const FILTERS = [["all", "filter_all"], ["history", "filter_history"], ["stream", "filter_stream"], ["park", "filter_park"]];
// 바텀시트가 멈추는 높이 (px). 가운데(처음) 높이는 420인데, 낮은 화면(아이폰 SE 등)에서는
// 지도에 핀 자리가 남도록 화면 높이에 맞춰 낮춰요 (최소 300)
// 이 단계 이하(가까이)면 "확대 상태": 묶음이 풀리고 카드 줄·전체 지도 버튼이 보여요.
// 묶음을 눌러 그보다 먼 단계로 맞췄으면(focus) 그 단계까지 확대 상태로 치고, 그 묶음의 점은 묶지 않아요
const ZOOMED_LEVEL = CLUSTER_MIN_LEVEL - 1;
const inBounds = (b, p) => p.lat >= b.s && p.lat <= b.n && p.lng >= b.w && p.lng <= b.e;
const snapsFor = (screenH) => [150, Math.max(300, Math.min(420, screenH - 330)), Math.min(640, screenH - 120)];

// 스팟 배지가 보여야 하는 지도 영역: 위쪽 검색·칩 아래부터 아래 시트 위까지 (지도 안쪽 px)
// 레이아웃 위치(offset)로 재요. 화면상 위치는 PC 아이폰 프레임 축소나 시트 애니메이션에 따라 달라져서요.
// 둘러볼 곳 카드 줄 높이(위아래 여백 포함). 묶음을 눌러 확대할 때 내려간 시트 위로 이만큼 더 비워 둬요
const CARD_ROW_H = 160;
// 위쪽: 검색·칩 아래에 뜨는 "← 전체 지도" 버튼 자리
const BACK_BTN_H = 52;
function homeSafeArea() {
  const map = document.querySelector(".home-map");
  const top = document.querySelector(".home-top");
  const sheet = document.querySelector(".home-screen .bsheet");
  return { top: top.offsetTop + top.offsetHeight + 8, bottom: sheet.offsetTop - 8, left: 8, right: map.offsetWidth - 8 };
}

// 오늘의 추천: 고른 거리의 완만한 길(low) 중 정식 추천(formal_recommendation) 경로를 먼저 골라요.
// 정식 추천이 없는 거리(5·10km)에서도 디자인처럼 카드를 보여주되, 카드에 "검토 필요" 배지를 붙여요.
// 경로 데이터(팀원 코스 번들)는 그대로 두고 화면에서만 고르는 방식이에요. 경로가 아예 없으면 null
export function todaysPick(data, km) {
  const lows = DESTINATIONS.map((dest) => getCourse(data, dest, km, "low")).filter(Boolean);
  return lows.find((c) => c.properties.formal) || lows[0] || null;
}

export default function Home() {
  const app = useApp();
  const { data, settings, setSettings, user } = app;
  // 떠날 때 남겨 둔 홈 지도 상태 (처음 열 때는 null)
  const [saved] = useState(() => app.homeMap.current);
  const [filter, setFilter] = useState(saved?.filter ?? "all");
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState(null); // { at: [lat, lng], level }
  const [refit, setRefit] = useState(0);
  const [me, setMe] = useState(null);
  const [locating, setLocating] = useState(false);
  const sheet = useBottomSheet({ snaps: snapsFor, initial: saved?.sheet ?? 1 });
  const shown = data.spots.filter((s) => filter === "all" || s.category === filter);
  // 둘러볼 곳: 칩으로 거르고, 고른 점 · 지도 상태(확대 단계·보이는 영역)
  const [selId, setSelId] = useState(saved?.selId ?? null);
  const [view, setView] = useState(saved?.view ?? null);
  const [focus, setFocus] = useState(saved?.focus ?? null); // 묶음을 눌러 맞춘 { level, ids } (그 단계까지 확대 상태)
  const [panTo, setPanTo] = useState(null);
  const exShown = useMemo(() => data.explore.filter((p) => filter === "all" || p.chip === filter), [data.explore, filter]);
  const zoomed = !!view && view.level <= Math.max(ZOOMED_LEVEL, focus?.level ?? 0);
  // 맞춘 단계보다 멀리 축소하면 원래대로 묶어요
  useEffect(() => { if (focus && view && view.level > focus.level) setFocus(null); }, [focus, view]);
  // 지금 상태를 AppContext에 남겨요 (다시 들어오면 이 값으로 시작)
  useEffect(() => { app.homeMap.current = { filter, selId, view, focus, sheet: sheet.index }; }, [app.homeMap, filter, selId, view, focus, sheet.index]);
  const inView = view ? exShown.filter((p) => inBounds(view.bounds, p)) : [];
  const sel = exShown.find((p) => p.id === selId) || null;
  const cards = sel ? [sel, ...inView.filter((p) => p.id !== sel.id).sort((a, b) => distance(sel, a) - distance(sel, b))]
    : zoomed ? [...inView].sort((a, b) => distance(view.center, a) - distance(view.center, b)) : [];
  const showCards = cards.length > 0 && !sheet.expanded;
  // 확대 상태의 동네: 보이는 둘러볼 곳 중 가장 많은 동네
  const area = useMemo(() => {
    const n = {};
    inView.forEach((p) => { n[p.area] = (n[p.area] || 0) + 1; });
    const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    return top ? areaLabel({ area: top[0] }) : "";
  }, [inView]);
  // 점을 고르거나 묶음을 눌러 확대하면 시트를 맨 아래로 내려 지도·카드 줄 자리를 넓혀요
  const selectPlace = (p) => {
    setSelId(p.id === selId ? null : p.id);
    if (p.id !== selId) { setPanTo([p.lat, p.lng]); sheet.setIndex(0); }
  };
  // 묶음 확대 때 비워 둘 가장자리 [위, 오른쪽, 아래, 왼쪽] (setBounds 여백):
  //   위 = 검색·칩 + 전체 지도 버튼, 아래 = 맨 아래로 내린 시트 + 카드 줄. 그래서 점이 카드 줄 뒤에 숨지 않아요
  const clusterPad = () => {
    sheet.setIndex(0);
    return [homeSafeArea().top + BACK_BTN_H, 24, sheet.snaps[0] + CARD_ROW_H, 24];
  };
  const onClusterZoom = (level, ids) => setFocus(level >= CLUSTER_MIN_LEVEL ? { level, ids } : null);
  // 전체 지도: 시트를 처음 높이로 올리고, 다 올라간 뒤 핀 전체에 다시 맞춰요
  const backToAll = () => { setSelId(null); setFocus(null); setFlyTo(null); sheet.setIndex(1); setTimeout(() => setRefit((n) => n + 1), 350); };
  const openExplore = (p) => { app.setExplore({ place: p, from: "home" }); app.go("explore"); };
  const pickFilter = (k) => { setFilter(k); setSelId(null); setFocus(null); };
  const pick = todaysPick(data, settings.km);
  const startFree = () => app.run.start(null, { demo: app.demo, speedup: speedParam() });

  // 코스 고르기로 (목적지를 미리 골라 둘 수 있어요)
  const openCourses = (dest) => { app.setPick({ ...app.pick, km: settings.km, ...(dest ? { dest } : {}) }); app.go("courses"); };
  const openSpot = (spot) => { app.setSpot(spot); app.setPlaceFrom("home"); app.go("place"); };
  const search = (e) => {
    if (e.key !== "Enter") return;
    const q = query.trim().toLowerCase();
    const hit = data.spots.find((s) => s.name.ko.includes(q) || s.name.en.toLowerCase().includes(q));
    if (hit) return setFlyTo({ at: [hit.lat, hit.lng], level: 2 });
    // 코스 목적지가 아니면 둘러볼 곳에서 찾아 골라요 (칩은 전체로)
    const ex = data.explore.find((p) => p.name.ko.includes(q) || p.name.en.toLowerCase().includes(q));
    if (ex) { setFilter("all"); setSelId(ex.id); setFlyTo({ at: [ex.lat, ex.lng], level: 3 }); }
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
      <MapView className="home-map" center={saved?.view ? [saved.view.center.lat, saved.view.center.lng] : HOME_CENTER} level={saved?.view?.level ?? HOME_LEVEL}>
        {/* 둘러볼 곳 점은 코스 목적지 핀 아래에. 칩을 바꾸면 묶음을 새로 만들어요 */}
        <ExploreLayer key={filter} places={exShown} selectedId={selId} cluster={filter !== "park"} named={filter === "park"} onSelect={selectPlace} pad={clusterPad} onZoom={onClusterZoom} loose={focus?.ids} />
        {shown.map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openSpot(s)} />)}
        <Me at={me} />
        {/* 위쪽 검색·칩과 아래 시트에 배지·이름표가 가리지 않게 맞춰요 */}
        {/* 남겨 둔 확대 범위로 돌아왔으면 처음 맞춤은 건너뛰고, 전체 지도·내 위치 실패 때만 다시 맞춰요 */}
        {(!saved?.view || refit > 0) && <FitSpots spots={data.spots} safe={homeSafeArea} refitKey={refit} />}
        <FlyTo to={flyTo?.at} level={flyTo?.level} />
        <PanTo to={panTo} />
        <MapWatch onChange={setView} />
      </MapView>
      {filter === "stream" && (
        <div className="stream-soon glass" role="status"><b>{t("stream_soon")}</b><small>{t("stream_soon_sub")}</small></div>
      )}
      {zoomed && !sheet.expanded && inView.length > 0 && (
        <button type="button" className="ex-back glass" onClick={backToAll}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          <span>{t("whole_map")}</span><small>{t("area_explore_n", { area, n: inView.length })}</small>
        </button>
      )}
      {showCards && <ExploreCards cards={cards} selId={selId} bottom={sheet.height + 10} onSelect={selectPlace} onOpen={openExplore} />}
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
            <button key={k} className={`chip ${filter === k ? "on" : "glass"}`} aria-pressed={filter === k} onClick={() => pickFilter(k)}>
              {k !== "all" && <CategoryIcon category={k} />}{t(key)}
            </button>
          ))}
        </div>
      </div>

      {!sheet.expanded && !showCards && (
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
            onStart={() => { app.setPick({ ...app.pick, km: settings.km, dest: pick.properties.dest, hill: "flat" }); app.go("courses"); }} /> : (
            // 이 거리에 경로가 하나도 없으면 추천 카드 대신 코스 고르기로 가는 버튼만 둬요
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

// 둘러볼 곳 카드 줄 (시트 바로 위, 가로로 넘김). 고른 곳이 맨 앞이에요
function ExploreCards({ cards, selId, bottom, onSelect, onOpen }) {
  const { data } = useApp();
  const row = useRef(null);
  useEffect(() => { row.current?.scrollTo({ left: 0, behavior: "smooth" }); }, [selId]);
  return (
    <div className="ex-cards" ref={row} style={{ bottom }} aria-label={t("explore_nearby")}>
      {cards.slice(0, 12).map((p) => (
        <article key={p.id} className={`ex-card glass ${p.id === selId ? "on" : ""}`}>
          <button type="button" className="ex-card-name" onClick={() => p.id !== selId && onSelect(p)} aria-pressed={p.id === selId}>
            <i style={{ background: exploreColor(p) }} aria-hidden="true" /><b>{loc(p.name)}</b>
          </button>
          <small>{exploreMeta(p)}</small>
          <div className="ex-card-foot">
            <span>{fromCourseEnd(data, p)}</span>
            <button type="button" className="btn btn-soft" onClick={() => onOpen(p)}>{t("details")}</button>
          </div>
        </article>
      ))}
    </div>
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
          <span className="tc-badges">
            <Badge>{t("today_pick")}</Badge>
            {!p.formal && <Badge tone="warn">{t("needs_review")}</Badge>}
          </span>
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
