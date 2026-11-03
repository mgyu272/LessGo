// ① 홈: 지도 + 끌어 올리는 바텀시트 "오늘은 얼마나 달려볼까요?"

import { useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";
import { MapView, FitSpots, FlyTo, HexLayer, SpotMarker, Me } from "../components/MapView.jsx";
import { CategoryIcon } from "../components/SpotIcons.jsx";
import { LangPill } from "../components/Bits.jsx";
import { Icon } from "./Auth.jsx";

const FILTERS = [["all", "filter_all"], ["history", "filter_history"], ["stream", "filter_stream"], ["park", "filter_park"]];
const DISTANCES = [3, 5, 10];
const MIN_PER_KM = 6.5;             // 예상 시간 기준: 1km 6분 30초
const SNAPS = [150, 420, 640];      // 바텀시트가 멈추는 높이 (px)
const DEFAULT_SNAP = 420;

// 스팟 배지가 보여야 하는 지도 영역: 위쪽 검색·칩 아래부터 아래 시트 위까지 (지도 안쪽 px)
// 레이아웃 위치(offset)로 재요. 화면상 위치는 PC 아이폰 프레임 축소나 시트 애니메이션에 따라 달라져서요.
// (지도는 화면 전체를 덮어서 지도 안쪽 좌표 = 화면 안쪽 좌표예요)
function homeSafeArea() {
  const map = document.querySelector(".home-map");
  const top = document.querySelector(".home-top");
  const sheet = document.querySelector(".home-sheet");
  return { top: top.offsetTop + top.offsetHeight + 8, bottom: sheet.offsetTop - 8, left: 8, right: map.offsetWidth - 8 };
}

// 끌어서 높이를 바꾸는 바텀시트. 손을 떼면 가장 가까운 멈춤 높이로 붙어요.
function useSheet() {
  const [height, setHeight] = useState(DEFAULT_SNAP);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const justDragged = useRef(false); // 끌기를 마친 직후의 click은 무시해요
  const maxH = () => Math.min(SNAPS[SNAPS.length - 1], (document.querySelector(".home-screen")?.offsetHeight || 852) - 120);
  const snapTo = (h) => SNAPS.reduce((best, s) => (Math.abs(s - h) < Math.abs(best - h) ? s : best), SNAPS[0]);
  const handlers = {
    onPointerDown: (e) => {
      drag.current = { y: e.clientY, h: height, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    onPointerMove: (e) => {
      const d = drag.current; if (!d) return;
      // PC 아이폰 프레임은 축소돼 보여서, 화면상 이동량을 원래 크기로 되돌려요
      const el = document.querySelector(".home-screen");
      const scale = el ? el.getBoundingClientRect().height / el.offsetHeight || 1 : 1;
      const dy = (d.y - e.clientY) / scale;
      if (Math.abs(dy) > 4) d.moved = true;
      setHeight(Math.max(SNAPS[0], Math.min(maxH(), d.h + dy)));
    },
    onPointerUp: () => {
      const d = drag.current; drag.current = null; setDragging(false);
      if (!d) return;
      justDragged.current = d.moved;
      setHeight((h) => (d.moved ? snapTo(h) : h));
    },
  };
  // 손잡이를 탭하거나 키보드 Enter를 누르면 다음 높이로
  const cycle = () => {
    if (justDragged.current) { justDragged.current = false; return; }
    setHeight((h) => SNAPS[(SNAPS.indexOf(snapTo(h)) + 1) % SNAPS.length]);
  };
  return { height, dragging, handlers, cycle, full: height >= SNAPS[SNAPS.length - 1] - 20 };
}

export default function Home() {
  const app = useApp();
  const { data, settings, setSettings, user } = app;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState(null);
  const [me, setMe] = useState(null);
  const [locating, setLocating] = useState(false);
  const sheet = useSheet();
  const shown = data.spots.filter((s) => filter === "all" || s.category === filter);
  const minutes = Math.round(settings.km * MIN_PER_KM);

  const openSpot = (spot) => {
    const c = data.courses.find((c) => c.properties.spots.includes(spot.id));
    if (c) { app.setCourse(c); app.go("detail"); }
  };
  const search = (e) => {
    if (e.key !== "Enter") return;
    const q = query.trim().toLowerCase();
    const hit = data.spots.find((s) => s.name.ko.includes(q) || s.name.en.toLowerCase().includes(q));
    if (hit) setFlyTo([hit.lat, hit.lng]);
  };
  const locate = () => {
    if (!navigator.geolocation) return app.toast(t("gps_denied"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); const at = [p.coords.latitude, p.coords.longitude]; setMe(at); setFlyTo(at); },
      () => { setLocating(false); app.toast(t("gps_denied")); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  return (
    <section className="screen home-screen">
      <MapView className="home-map">
        <HexLayer cells={user.cells} landmarkCells={data.landmarkCells} goals />
        {shown.map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openSpot(s)} />)}
        <Me at={me} />
        {/* 위쪽 검색·칩과 아래 시트에 배지·이름표가 가리지 않게 맞춰요 */}
        <FitSpots spots={data.spots} safe={homeSafeArea} />
        <FlyTo to={flyTo} />
      </MapView>

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

      {!sheet.full && (
        <button className={`locate-btn glass ${locating ? "busy" : ""}`} style={{ bottom: sheet.height + 12 }} onClick={locate} aria-label={t("my_location")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /><path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3" />
          </svg>
        </button>
      )}

      <div className={`home-sheet ${sheet.dragging ? "dragging" : ""}`} style={{ height: sheet.height }}>
        <button className="sheet-handle" {...sheet.handlers} onClick={sheet.cycle} aria-label={t("sheet_resize")}>
          <span className="grip" />
        </button>
        <div className="sheet-body">
          <h2>{t("home_title")}</h2>
          <div className="segment" role="radiogroup" aria-label={t("distance")}>
            {DISTANCES.map((km) => (
              <button key={km} role="radio" aria-checked={settings.km === km} className={settings.km === km ? "on" : ""} onClick={() => setSettings({ ...settings, km })}>
                <b>{km}</b>km
              </button>
            ))}
          </div>
          <p className="estimate">{t("estimate_line", { n: minutes })}</p>
          <button className="btn btn-cta" onClick={() => app.go("settings")}>
            {t("make_course_km", { km: settings.km })}<Icon name="arrow" className="arrow" />
          </button>
          <button className="free-card glass" onClick={() => app.run.start(null, { demo: app.demo, speedup: speedParam() })}>
            <span className="free-ic" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="14" cy="4.5" r="2" /><path d="M7 21l3-6 3 2 1 4 M6 12l3-4 5 1 3 3 M10 15l1.5-5" /></svg>
            </span>
            <span className="free-text"><b>{t("free_title")}</b><small>{t("free_sub")}</small></span>
            <Icon name="arrow" className="arrow" />
          </button>
        </div>
      </div>
    </section>
  );
}

// 주소 끝에 ?speed=30 을 붙이면 시연 모드가 30배 빠르게 움직여요 (기본 10배)
export function speedParam() {
  return Number(new URLSearchParams(location.search).get("speed")) || 10;
}
