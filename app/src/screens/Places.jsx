// ⑦ 장소와 이야기 (디자인 원본 docs/design/Places.dc.html)
// 검색 · 목록/지도 전환 · 주제 칩 · 장소 카드("이야기 · 방문 정보" / "여기로 달리기")
// "여기로 달리기"를 누르면 코스 고르기에 그 목적지가 미리 골라져요.

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";
import { TOPICS, PLACE_TOPICS } from "../lib/places.js";
import { MapView, FitBounds, SpotMarker } from "../components/MapView.jsx";
import { spotIconSvg } from "../components/SpotIcons.jsx";
import { Badge } from "../components/ui.jsx";

export default function Places() {
  const app = useApp();
  const { data } = app;
  const [view, setView] = useState("list");
  const [topic, setTopic] = useState("all");
  const [q, setQ] = useState("");
  const here = useKnownPosition();

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.spots.filter((s) => (topic === "all" || (PLACE_TOPICS[s.id] || []).includes(topic)))
      .filter((s) => !qq || [s.name.ko, s.name.en, ...s.cards.flatMap((c) => [c.title?.ko, c.title?.en, c.body?.ko, c.body?.en])]
        .some((x) => (x || "").toLowerCase().includes(qq)));
  }, [data.spots, topic, q]);

  const courseCount = (id) => data.courses.filter((c) => c.properties.dest === id).length;
  const openPlace = (s) => { app.setSpot(s); app.go("place"); };
  const runHere = (s) => { app.setPick({ ...app.pick, dest: s.id }); app.go("courses"); };

  return (
    <section className="screen places-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="pl-top">
          <button className="round-btn glass" onClick={() => app.go("home")} aria-label={t("back_home")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{t("places_title")}</h1>
          <div className="pl-view" role="tablist" aria-label={t("view_mode")}>
            <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>{t("view_list")}</button>
            <button role="tab" aria-selected={view === "map"} className={view === "map" ? "on" : ""} onClick={() => setView("map")}>{t("view_map")}</button>
          </div>
        </div>

        <label className="search glass pl-search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("places_search_ph")} aria-label={t("places_search")} />
        </label>

        <div className="pl-topics scroll" role="radiogroup" aria-label={t("topic")}>
          {TOPICS.map((k) => (
            <button key={k} role="radio" aria-checked={topic === k} className={`pl-topic ${topic === k ? "on" : "soft"}`} onClick={() => setTopic(k)}>{t("topic_" + k)}</button>
          ))}
        </div>

        {view === "map" && (
          <div className="card pl-map rise">
            <MapView>
              {list.map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openPlace(s)} />)}
              <FitBounds points={(list.length ? list : data.spots).map((s) => [s.lat, s.lng])} padTL={[60, 90]} padBR={[60, 40]} fitKey={view + topic + list.length} />
            </MapView>
          </div>
        )}

        <p className="pl-count">{list.length ? t("places_n", { n: list.length }) : t("places_none")}</p>

        {list.map((s) => (
          <article key={s.id} className="card pl-card">
            <div className="pl-card-top">
              <span className="pl-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(s) }} />
              <div className="pl-text">
                <div className="pl-name"><h2>{loc(s.name)}</h2><Badge>{t("courses_n", { n: courseCount(s.id) })}</Badge></div>
                <small>{[...(PLACE_TOPICS[s.id] || []).map((k) => t("topic_" + k)), here ? t("from_me", { km: (distance(here, s) / 1000).toFixed(1) }) : null].filter(Boolean).join(" · ")}</small>
                <p>{loc(s.cards[0]?.body)}</p>
              </div>
            </div>
            <div className="pl-actions">
              <button className="btn btn-soft" onClick={() => openPlace(s)}>{t("story_visit")}</button>
              <button className="btn btn-cta" onClick={() => runHere(s)}>{t("run_here")} →</button>
            </div>
          </article>
        ))}

        <button className="soft pl-events" onClick={() => app.go("events")}>
          <span className="pl-ev-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5h14v15H5z M5 10h14 M9 3v4 M15 3v4" /></svg></span>
          <span className="pl-ev-text"><b>{t("linked_events")}</b><small>{t("linked_events_sub")}</small></span>
          <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
    </section>
  );
}

// 위치 권한이 이미 허용돼 있을 때만 내 위치를 써요 (이 화면에서 권한 창을 새로 띄우지 않아요). 모르면 거리 표시를 숨겨요
function useKnownPosition() {
  const [here, setHere] = useState(null);
  useEffect(() => {
    let alive = true;
    navigator.permissions?.query({ name: "geolocation" }).then((p) => {
      if (p.state !== "granted" || !alive) return;
      navigator.geolocation.getCurrentPosition((pos) => alive && setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => {}, { maximumAge: 60000, timeout: 8000 });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return here;
}
