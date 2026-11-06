// ① 홈: 지도 + 끌어 올리는 바텀시트 (디자인 원본 docs/design/Main.dc.html)
// "오늘은 얼마나 달려볼까요?" 3/5/10km → "{km}km 코스 고르기" 버튼 → 자유 달리기
// 코스 목적지 핀을 누르면 장소 상세(이야기 탭)로 가요.
// 둘러볼 곳(explore.json): 장소마다 종류 아이콘. 서울 전체처럼 아주 멀리 볼 때만 "성북동 18"처럼 묶어요.
//   아이콘을 누르면 그곳을 가운데에 두고 한 단계 확대하고, 시트 바로 위 카드 줄에 그곳부터 가까운 순 8곳이 떠요.
//   왼쪽 위 "← 성북구 전체 · {장소} 주변"을 누르면 고르기 전 확대 단계로 돌아가요.
//   칩(전체 · 전시 · 역사·한옥 · 사찰·성당 · 공원·전망, places.js의 groupOf)은 둘러볼 곳 아이콘만 걸러요.
// 칩·고른 곳·확대 범위·시트 높이는 AppContext(app.homeMap)에 남겨서, 둘러볼 곳 상세에 갔다 와도 그대로예요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, HOME_CENTER, HOME_LEVEL } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { MapView, FitSpots, FlyTo, FocusOn, SpotMarker, Me, ExploreLayer, MapWatch } from "../components/MapView.jsx";
import { LangPill } from "../components/Bits.jsx";
import { useBottomSheet, BottomSheet, Segment } from "../components/ui.jsx";
import { DISTANCES } from "../lib/routes.js";
import { distance } from "../lib/geo.js";
import { exploreColor, exploreMeta, fromCourseEnd, GROUPS, groupOf } from "../lib/places.js";

// 장소 종류 칩 아이콘 (선 아이콘, 글자색을 따라가요): 전시=액자, 역사·한옥=한옥 지붕, 사찰·성당=탑, 공원·전망=나무
const GROUP_ICONS = {
  exhibit: "M4 5h16v14H4zM7 16l4-5 3 3 2-2 2 4M15 8.5h.01",
  heritage: "M2 11c3 .5 5-1 6.5-3.5h7C17 10 19 11.5 22 11M5 11v8h14v-8M10 19v-5h4v5",
  religion: "M12 2v3M8 5h8l1.5 3h-11zM9 8v3h6V8M6.5 11h11l1.5 3H5zM9 14v6h6v-6M5 20h14",
  park: "M12 3L6 11h4l-4 6h12l-4-6h4zM12 17v4",
};
// 바텀시트가 멈추는 높이 (px). 가운데(처음) 높이는 380(제목·거리 탭·코스 고르기·자유 달리기가 하단 탭 위에 다 보이는 높이)인데, 낮은 화면(아이폰 SE 등)에서는
// 지도에 핀 자리가 남도록 화면 높이에 맞춰 낮춰요 (최소 300)
// 아이콘을 누르면 아래 카드 줄에 보여줄 장소 수 (고른 곳 포함)
const CARD_COUNT = 8;
// 카드 줄 높이(위아래 여백 포함)와 "← 성북구 전체" 버튼 자리. 아이콘을 골라 확대할 때 이만큼 비워 둬요
const CARD_ROW_H = 160;
const BACK_BTN_H = 48;
const snapsFor = (screenH) => [150, Math.max(300, Math.min(380, screenH - 330)), Math.min(640, screenH - 120)];

// 스팟 배지가 보여야 하는 지도 영역: 위쪽 검색·칩 아래부터 아래 시트 위까지 (지도 안쪽 px)
// 레이아웃 위치(offset)로 재요. 화면상 위치는 PC 아이폰 프레임 축소나 시트 애니메이션에 따라 달라져서요.
function homeSafeArea() {
  const map = document.querySelector(".home-map");
  const top = document.querySelector(".home-top");
  const sheet = document.querySelector(".home-screen .bsheet");
  return { top: top.offsetTop + top.offsetHeight + 8, bottom: sheet.offsetTop - 8, left: 8, right: map.offsetWidth - 8 };
}

export default function Home() {
  const app = useApp();
  const { data, settings, setSettings, user } = app;
  // 떠날 때 남겨 둔 홈 지도 상태 (처음 열 때는 null)
  const [saved] = useState(() => app.homeMap.current);
  const [filter, setFilter] = useState(saved?.filter ?? "all");
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState(null); // { at: [lat, lng], level }
  const [focusTo, setFocusTo] = useState(null); // 고른 아이콘으로: { at, level }
  const [refit, setRefit] = useState(0);
  const [me, setMe] = useState(null);
  const [locating, setLocating] = useState(false);
  const sheet = useBottomSheet({ snaps: snapsFor, initial: saved?.sheet ?? 1 });
  const shown = data.spots; // 코스 목적지 핀은 칩과 상관없이 늘 보여요
  // 둘러볼 곳: 칩으로 거르고, 고른 곳 · 지도 상태(확대 단계·가운데) · 고르기 전 지도(origin: 돌아갈 곳)
  const [selId, setSelId] = useState(saved?.selId ?? null);
  const [view, setView] = useState(saved?.view ?? null);
  const [origin, setOrigin] = useState(saved?.origin ?? null); // { level, center: [lat, lng], sheet }
  const exShown = useMemo(() => data.explore.filter((p) => filter === "all" || groupOf(p) === filter), [data.explore, filter]);
  // 칩마다 둘러볼 곳 개수
  const groupCount = useMemo(() => {
    const n = { all: data.explore.length };
    data.explore.forEach((p) => { const g = groupOf(p); n[g] = (n[g] || 0) + 1; });
    return n;
  }, [data.explore]);
  // 지금 상태를 AppContext에 남겨요 (다시 들어오면 이 값으로 시작)
  useEffect(() => { app.homeMap.current = { filter, selId, view, origin, sheet: sheet.index }; }, [app.homeMap, filter, selId, view, origin, sheet.index]);
  const sel = exShown.find((p) => p.id === selId) || null;
  // 카드 줄: 고른 곳부터 가까운 순 8곳
  const cards = sel ? [sel, ...exShown.filter((p) => p.id !== sel.id).sort((a, b) => distance(sel, a) - distance(sel, b))].slice(0, CARD_COUNT) : [];
  const showCards = cards.length > 0 && !sheet.expanded;
  // 아이콘을 누르면 그곳을 가운데에 두고 한 단계 확대해요. 처음 고를 때만 확대하고, 그 전 지도는 origin에 남겨 둬요.
  // 카드 줄 자리를 넓히려고 시트는 맨 아래로 내리고, 가운데는 위 검색·칩·버튼과 아래 카드 줄·시트를 뺀 칸의 가운데예요
  const selectPlace = (p) => {
    if (p.id === selId) return;
    const level = view?.level ?? HOME_LEVEL;
    if (!sel) setOrigin({ level, center: view ? [view.center.lat, view.center.lng] : HOME_CENTER, sheet: sheet.index });
    setSelId(p.id);
    setFocusTo({ at: [p.lat, p.lng], level: sel ? level : Math.max(1, level - 1) });
    sheet.setIndex(0);
  };
  // 고른 곳 확대 때 비워 둘 가장자리 [위, 오른쪽, 아래, 왼쪽]: 위 = 검색·칩 + 전체 버튼, 아래 = 내려간 시트 + 카드 줄
  const focusPad = () => [homeSafeArea().top + BACK_BTN_H, 0, sheet.snaps[0] + CARD_ROW_H, 0];
  // 아주 멀리 볼 때의 묶음을 누르면 위 검색·칩과 아래 시트를 비우고 그 범위로 맞춰요 [위, 오른쪽, 아래, 왼쪽]
  const clusterPad = () => {
    const map = document.querySelector(".home-map"), area = homeSafeArea();
    return [area.top, 24, map.offsetHeight - area.bottom, 24];
  };
  // "← 성북구 전체": 고르기 전 확대 단계·위치·시트 높이로 돌아가요
  const backToAll = () => {
    setSelId(null);
    if (origin) { setFlyTo({ at: origin.center, level: origin.level }); sheet.setIndex(origin.sheet ?? 1); }
    setOrigin(null);
  };
  const openExplore = (p) => { app.setExplore({ place: p, from: "home" }); app.go("explore"); };
  // 칩을 바꾸면 고른 곳과 확대 상태를 처음으로 (고르기 전 확대 단계로 돌아가요)
  const pickFilter = (k) => { if (k === filter) return; backToAll(); setFilter(k); };
  const startFree = () => app.run.start(null, { demo: app.demo, speedup: speedParam() });

  // 코스 고르기로 (지금 고른 거리로)
  const openCourses = () => { app.setPick({ ...app.pick, km: settings.km }); app.go("courses"); };
  const openSpot = (spot) => { app.setSpot(spot); app.setPlaceFrom("home"); app.go("place"); };
  const search = (e) => {
    if (e.key !== "Enter") return;
    const q = query.trim().toLowerCase();
    const hit = data.spots.find((s) => s.name.ko.includes(q) || s.name.en.toLowerCase().includes(q));
    if (hit) return setFlyTo({ at: [hit.lat, hit.lng], level: 2 });
    // 코스 목적지가 아니면 둘러볼 곳에서 찾아 골라요 (칩은 전체로)
    const ex = data.explore.find((p) => p.name.ko.includes(q) || p.name.en.toLowerCase().includes(q));
    if (ex) { setFilter("all"); selectPlace(ex); }
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
        <ExploreLayer key={filter} places={exShown} selectedId={selId} level={view?.level ?? HOME_LEVEL} onSelect={selectPlace} pad={clusterPad} />
        {shown.map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openSpot(s)} />)}
        <Me at={me} />
        {/* 위쪽 검색·칩과 아래 시트에 배지·이름표가 가리지 않게 맞춰요 */}
        {/* 남겨 둔 확대 범위로 돌아왔으면 처음 맞춤은 건너뛰고, 전체 지도·내 위치 실패 때만 다시 맞춰요 */}
        {(!saved?.view || refit > 0) && <FitSpots spots={data.spots} safe={homeSafeArea} refitKey={refit} />}
        <FlyTo to={flyTo?.at} level={flyTo?.level} />
        <FocusOn to={focusTo?.at} level={focusTo?.level} pad={focusPad} />
        <MapWatch onChange={setView} />
      </MapView>
      {sel && !sheet.expanded && (
        <button type="button" className="ex-back glass" onClick={backToAll}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          <span>{t("whole_district")}</span><small>{t("around_place", { name: loc(sel.name) })}</small>
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
          {GROUPS.map((k) => (
            <button key={k} className={`chip ${filter === k ? "on" : "glass"}`} aria-pressed={filter === k} onClick={() => pickFilter(k)}>
              {k !== "all" && <svg className="grp-ic" viewBox="0 0 24 24" aria-hidden="true"><path d={GROUP_ICONS[k]} /></svg>}
              {t("grp_" + k)}<span className="chip-n">{groupCount[k] || 0}</span>
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

          <button className="btn btn-cta home-pick" onClick={openCourses}>{t("pick_course_km", { km: settings.km })} →</button>

          <button className="free-card glass" onClick={startFree}>
            <span className="free-ic" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18c4 0 4-7 8-7s4-6 8-6" /><circle cx="20" cy="5" r="1.6" fill="currentColor" /></svg>
            </span>
            <span className="free-text"><b>{t("free_title")}</b><small>{t("free_sub")}</small></span>
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
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

// 주소 끝에 ?speed=30 을 붙이면 시연 모드가 30배 빠르게 움직여요 (기본 10배)
export function speedParam() {
  return Number(new URLSearchParams(location.search).get("speed")) || 10;
}
