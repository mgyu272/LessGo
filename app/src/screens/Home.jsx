// ① 홈: 지도 (디자인 원본 docs/design/Main.dc.html). 아래 바텀시트는 없앴어요
// 코스 목적지 핀을 누르면 장소 상세(이야기 탭)로 가요.
// 둘러볼 곳(explore.json): 장소마다 종류 아이콘. 멀리 볼 때도 묶지 않고 작은 아이콘 그대로 보여요.
//   아이콘을 누르면 그곳을 가운데에 두고 한 단계 확대하고, 하단 탭 바로 위 카드 줄에 그곳부터 가까운 순 8곳이 떠요.
//   왼쪽 위 "← 성북구 전체 · {장소} 주변"을 누르면 고르기 전 확대 단계로 돌아가요.
//   칩(전체 · 전시 · 역사 · 종교 · 공원, places.js의 groupOf)은 둘러볼 곳 아이콘만 걸러요.
// 칩·고른 곳·확대 범위는 AppContext(app.homeMap)에 남겨서, 둘러볼 곳 상세에 갔다 와도 그대로예요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, HOME_CENTER, HOME_LEVEL } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { MapView, FitSpots, FlyTo, FocusOn, SpotMarker, Me, ExploreLayer, MapWatch, Route, FitBounds } from "../components/MapView.jsx";
import { LangPill } from "../components/Bits.jsx";
import { getCourse } from "../lib/data.js";
import { GroupIcon } from "../components/SpotIcons.jsx";
import { MODE_COLOR } from "./Courses.jsx";
import { distance } from "../lib/geo.js";
import { exploreColor, exploreMeta, fromCourseEnd, GROUPS, groupOf } from "../lib/places.js";

// 아이콘을 누르면 아래 카드 줄에 보여줄 장소 수 (고른 곳 포함)
const CARD_COUNT = 8;
// 카드 줄 높이(위아래 여백 포함)와 "← 성북구 전체" 버튼 자리. 아이콘을 골라 확대할 때 이만큼 비워 둬요
const CARD_ROW_H = 160;
const BACK_BTN_H = 48;
// 하단 탭(.tabbar)이 차지하는 아래 높이 (px, 안전 영역 제외). 내 위치 버튼·카드 줄은 이 위에 띄워요
const TABBAR_H = 86;
const aboveTabbar = (gap) => `calc(${TABBAR_H + gap}px + var(--safe-bottom))`;

// 스팟 배지가 보여야 하는 지도 영역: 위쪽 검색·칩 아래부터 아래 하단 탭 위까지 (지도 안쪽 px)
// 레이아웃 위치(offset)로 재요. 화면상 위치는 PC 아이폰 프레임 축소에 따라 달라져서요.
function homeSafeArea() {
  const map = document.querySelector(".home-map");
  const top = document.querySelector(".home-top");
  return { top: top.offsetTop + top.offsetHeight + 8, bottom: map.offsetHeight - TABBAR_H - 8, left: 8, right: map.offsetWidth - 8 };
}

export default function Home() {
  const app = useApp();
  const { data, settings } = app;
  // 떠날 때 남겨 둔 홈 지도 상태 (처음 열 때는 null)
  const [saved] = useState(() => app.homeMap.current);
  const [filter, setFilter] = useState(saved?.filter ?? "all");
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState(null); // { at: [lat, lng], level }
  const [focusTo, setFocusTo] = useState(null); // 고른 아이콘으로: { at, level }
  const [refit, setRefit] = useState(0);
  const [me, setMe] = useState(null);
  const [locating, setLocating] = useState(false);
  // 코스 목적지(심우장·정릉·의릉·길상사)도 다른 장소처럼 테마 칩으로 걸러요
  const shown = useMemo(() => data.spots.filter((s) => filter === "all" || groupOf(s) === filter), [data.spots, filter]);
  // 둘러볼 곳: 칩으로 거르고, 고른 곳 · 지도 상태(확대 단계·가운데) · 고르기 전 지도(origin: 돌아갈 곳)
  const [selId, setSelId] = useState(saved?.selId ?? null);
  const [view, setView] = useState(saved?.view ?? null);
  const [origin, setOrigin] = useState(saved?.origin ?? null); // { level, center: [lat, lng] }
  const exShown = useMemo(() => data.explore.filter((p) => filter === "all" || groupOf(p) === filter), [data.explore, filter]);
  // 칩마다 둘러볼 곳 개수
  const groupCount = useMemo(() => {
    const spotIds = new Set(data.spots.map((s) => s.id));
    const all = [...data.spots, ...data.explore.filter((p) => !spotIds.has(p.spot_id))];
    const n = { all: all.length };
    all.forEach((p) => { const g = groupOf(p); n[g] = (n[g] || 0) + 1; });
    return n;
  }, [data.explore]);
  // 지금 상태를 AppContext에 남겨요 (다시 들어오면 이 값으로 시작)
  useEffect(() => { app.homeMap.current = { filter, selId, view, origin }; }, [app.homeMap, filter, selId, view, origin]);
  const sel = exShown.find((p) => p.id === selId) || null;
  // 카드 줄: 고른 곳부터 가까운 순 8곳
  const cards = sel ? [sel, ...exShown.filter((p) => p.id !== sel.id).sort((a, b) => distance(sel, a) - distance(sel, b))].slice(0, CARD_COUNT) : [];
  const showCards = cards.length > 0;
  // 아이콘을 누르면 그곳을 가운데에 두고 한 단계 확대해요. 처음 고를 때만 확대하고, 그 전 지도는 origin에 남겨 둬요.
  // 가운데는 위 검색·칩·버튼과 아래 카드 줄·하단 탭을 뺀 칸의 가운데예요
  const selectPlace = (p) => {
    if (p.id === selId) return;
    const level = view?.level ?? HOME_LEVEL;
    if (!sel) setOrigin({ level, center: view ? [view.center.lat, view.center.lng] : HOME_CENTER });
    setSelId(p.id);
    setFocusTo({ at: [p.lat, p.lng], level: sel ? level : Math.max(1, level - 1) });
  };
  // 고른 곳 확대 때 비워 둘 가장자리 [위, 오른쪽, 아래, 왼쪽]: 위 = 검색·칩 + 전체 버튼, 아래 = 하단 탭 + 카드 줄
  const focusPad = () => [homeSafeArea().top + BACK_BTN_H, 0, TABBAR_H + CARD_ROW_H, 0];
  // 아주 멀리 볼 때의 묶음을 누르면 위 검색·칩과 아래 하단 탭을 비우고 그 범위로 맞춰요 [위, 오른쪽, 아래, 왼쪽]
  const clusterPad = () => {
    const map = document.querySelector(".home-map"), area = homeSafeArea();
    return [area.top, 24, map.offsetHeight - area.bottom, 24];
  };
  // "← 성북구 전체": 고르기 전 확대 단계·위치로 돌아가요
  const backToAll = () => {
    setSelId(null);
    if (origin) setFlyTo({ at: origin.center, level: origin.level });
    setOrigin(null);
  };
  const openExplore = (p) => { app.setExplore({ place: p, from: "home" }); app.go("explore"); };
  // 칩을 바꾸면 고른 곳과 확대 상태를 처음으로 (고르기 전 확대 단계로 돌아가요)
  const pickFilter = (k) => { if (k === filter) return; backToAll(); setFilter(k); };
  // 장소 팝업(홈 위 절반 시트)이 열려 있으면: 코스가 있는 곳은 코스를, 준비 중인 곳은 그 자리를 지도 위쪽 절반에 보여줘요
  const popupSpot = app.screen === "place" && app.placeFrom === "home" ? app.spot : null;
  const popupCourse = popupSpot ? courseFor(data, popupSpot.id, settings.km) : null;
  const halfPad = () => (document.querySelector(".home-map")?.offsetHeight || 700) * 0.5 + 24;
  // 새로 추가된 장소(둘러볼 곳): 코스 목적지와 같은 팝업 형식으로, 내용은 "준비 중"
  const openPreparing = (p) => { app.setSpot(data.spotById[p.id] || preparingSpot(p)); app.setPlaceFrom("home"); app.go("place"); };

  const openSpot = (spot) => { app.setSpot(spot); app.setPlaceFrom("home"); app.go("place"); };
  const search = (e) => {
    if (e.key !== "Enter") return;
    const q = query.trim().toLowerCase();
    const hit = data.spots.find((s) => s.name.ko.includes(q) || s.name.en.toLowerCase().includes(q));
    if (hit) return setFlyTo({ at: [hit.lat, hit.lng], level: 2 });
    // 코스 목적지가 아니면 둘러볼 곳에서 찾아 준비 중 팝업으로 열어요
    const ex = data.explore.find((p) => p.name.ko.includes(q) || (p.name.en || "").toLowerCase().includes(q));
    if (ex) openPreparing(ex);
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
        {/* 둘러볼 곳 아이콘은 코스 목적지 핀 아래에. 칩을 바꾸면 묶음을 새로 만들어요 */}
        <ExploreLayer key={filter} cluster={false}
          // 장소 하나를 열면 그 장소(와 코스)만 보이게 다른 아이콘은 숨겨요
          places={popupSpot ? exShown.filter((p) => popupSpot.preparing && p.id === popupSpot.id) : exShown}
          selectedId={popupSpot?.preparing ? popupSpot.id : null} level={view?.level ?? HOME_LEVEL} onSelect={openPreparing} pad={clusterPad} />
        {/* 코스 목적지(심우장·정릉·의릉)는 예전처럼 큰 그림 핀 + 이름표 */}
        {(popupSpot ? shown.filter((s) => s.id === popupSpot.id) : shown).map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openSpot(s)} />)}
        {popupCourse && [
          <Route key="pc-case" path={popupCourse.path} color="#FFFFFF" weight={11} opacity={1} zIndex={5} />,
          <Route key="pc" path={popupCourse.path} color={MODE_COLOR[popupCourse.properties.mode]} weight={6} opacity={1} zIndex={6} />,
          <FitBounds key="pc-fit" points={popupCourse.path.map((q) => [q.lat, q.lng])} padTL={[30, 70]} padBR={[30, halfPad()]} fitKey={popupCourse.id} />,
        ]}
        {popupSpot?.preparing && !popupCourse && <FitBounds points={[[popupSpot.lat + 0.0025, popupSpot.lng], [popupSpot.lat - 0.0025, popupSpot.lng]]} padTL={[30, 70]} padBR={[30, halfPad()]} fitKey={popupSpot.id} />}
        <Me at={me} />
        {/* 위쪽 검색·칩과 아래 하단 탭에 배지·이름표가 가리지 않게 맞춰요 */}
        {/* 남겨 둔 확대 범위로 돌아왔으면 처음 맞춤은 건너뛰고, 전체 지도·내 위치 실패 때만 다시 맞춰요 */}
        {(!saved?.view || refit > 0) && <FitSpots spots={data.spots} safe={homeSafeArea} refitKey={refit} />}
        <FlyTo to={flyTo?.at} level={flyTo?.level} />
        <FocusOn to={focusTo?.at} level={focusTo?.level} pad={focusPad} />
        <MapWatch onChange={setView} />
      </MapView>
      {sel && (
        <button type="button" className="ex-back glass" onClick={backToAll}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          <span>{t("whole_district")}</span><small>{t("around_place", { name: loc(sel.name) })}</small>
        </button>
      )}
      {showCards && <ExploreCards cards={cards} selId={selId} bottom={aboveTabbar(10)} onSelect={selectPlace} onOpen={openExplore} />}
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
          {GROUPS.map((k) => (
            <button key={k} className={`chip ${filter === k ? "on" : "glass"}`} aria-pressed={filter === k} onClick={() => pickFilter(k)}>
              {k !== "all" && <GroupIcon group={k} size={18} />}
              {t("grp_" + k)}<span className="chip-n">{groupCount[k] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {!showCards && <div className={`home-course-shecate-btn glass ${locating ? "busy" : ""}`} style={{ bottom: aboveTabbar(14) }} onClick={locate} aria-label={t("my_location")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3" />
          </svg>
        </button>
      )}
    </section>
  );
}

// 장소의 코스: 고른 거리의 완만한 길, 없으면 언덕 허용
function courseFor(data, dest, km) {
  return getCourse(data, dest, km, "low") || getCourse(data, dest, km, "high") || null;
}

// 새로 추가된 장소 → 장소 팝업에 넣을 "준비 중" 장소 (해설·방문 정보·코스는 비워 둬요)
function preparingSpot(p) {
  return {
    id: p.id, preparing: true, name: { ko: p.name.ko, en: p.name.en || p.name.ko },
    lat: p.lat, lng: p.lng, category: ["history", "stream", "park"].includes(p.chip) ? p.chip : "history", group: groupOf(p),
    kindLabel: [p.kind, p.area_ko].filter(Boolean).join(" · "),
    cards: [], narration: { ko: "", en: "" }, sources: [],
  };
}

// 둘러볼 곳 카드 줄 (하단 탭 바로 위, 가로로 넘김). 고른 곳이 맨 앞이에요
function ExploreCards({ cards, selId, bottom, onSelect, onOpen }) {
  const { data } = useApp();
  const row = useRef(null);
  useEffect(() => { row.current?.scrollTo({ left: 0, behavior: "smooth" }); }, [selId]);
  return (
    <div className="ex-cards" ref={row} style={{ bottom }} aria-label={t("explore_nearby")}>
      {cards.slice(0, 12).map((p) => (
        <article key={p.id} className={`ex-card glass ${p.id === selId ? "on" : ""}`}>
          <button type="button" className="ex-card-name" onClick={() => p.id !== selId && onSelect(p)} aria-pressed={p.id === selId}>
            <GroupIcon group={groupOf(p)} size={20} /><b>{loc(p.name)}</b>
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

// 주소 끝에 ?speed=30 을 붙이면 시연 모드가 30배 빠르게 움직여요 (기본 10배)
export function speedParam() {
  return Number(new URLSearchParams(location.search).get("speed")) || 10;
}
