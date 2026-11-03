// ① 홈 (시안 1번): 지도 + "오늘은 얼마나 달려볼까요?"

import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";
import { MapView, FitSpots, FlyTo, HexLayer, SpotMarker } from "../components/MapView.jsx";
import { CategoryIcon } from "../components/SpotIcons.jsx";
import { LangPill } from "../components/Bits.jsx";

const FILTERS = [["all", "filter_all"], ["history", "filter_history"], ["stream", "filter_stream"], ["park", "filter_park"]];

// 스팟 배지가 보여야 하는 지도 영역: 위쪽 검색·칩 아래부터 아래 시트 위까지 (지도 안쪽 px)
// 레이아웃 위치(offset)로 재요. 화면상 위치는 PC 아이폰 프레임 축소나 시트가 올라오는 애니메이션에 따라 달라져서요.
// (지도는 화면 전체를 덮어서 지도 안쪽 좌표 = 화면 안쪽 좌표예요)
function homeSafeArea() {
  const map = document.querySelector(".home-map");
  const top = document.querySelector(".home-top");
  const sheet = document.querySelector(".home-sheet");
  return { top: top.offsetTop + top.offsetHeight + 8, bottom: sheet.offsetTop - 8, left: 8, right: map.offsetWidth - 8 };
}

export default function Home() {
  const app = useApp();
  const { data, settings, setSettings, user } = app;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState(null);
  const shown = data.spots.filter((s) => filter === "all" || s.category === filter);

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

  return (
    <section className="screen">
      <MapView className="home-map">
        <HexLayer cells={user.cells} landmarkCells={data.landmarkCells} goals />
        {shown.map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openSpot(s)} />)}
        {/* 위쪽 검색·칩과 아래 시트에 배지·이름표가 가리지 않게 맞춰요 */}
        <FitSpots spots={data.spots} safe={homeSafeArea} />
        <FlyTo to={flyTo} />
      </MapView>

      <div className="home-top">
        <div className="search">
          <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={search} placeholder={t("search_ph")} />
          <LangPill />
        </div>
        <div className="chips scroll">
          {FILTERS.map(([k, key]) => (
            <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>
              {k !== "all" && <CategoryIcon category={k} />}{t(key)}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet home-sheet">
        <div className="grip" />
        <p className="eyebrow">{t("home_mode", { mode: t("mode_" + settings.time) })}</p>
        <h2>{t("home_title")}</h2>
        <div className="dist-row">
          {[[3, "d_light"], [5, "d_normal"], [10, "d_long"]].map(([km, key]) => (
            <button key={km} className={settings.km === km ? "on" : ""} onClick={() => setSettings({ ...settings, km })}>
              <span className="n">{km}</span><span className="u">km</span><small>{t(key)}</small>
            </button>
          ))}
        </div>
        <button className="btn btn-ink" onClick={() => app.go("settings")}>{t("make_course")}</button>
        <button className="btn btn-outline-teal" onClick={() => app.run.start(null, { demo: app.demo, speedup: speedParam() })}>{t("free_run")}</button>
      </div>
    </section>
  );
}

// 주소 끝에 ?speed=30 을 붙이면 시연 모드가 30배 빠르게 움직여요 (기본 10배)
export function speedParam() {
  return Number(new URLSearchParams(location.search).get("speed")) || 10;
}
