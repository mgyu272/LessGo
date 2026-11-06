// ⑦ 장소와 이야기 (디자인 원본 docs/design/Places.dc.html)
// 검색 · 목록/지도 전환 · 주제 칩 · 장소 카드("이야기 · 방문 정보" / "여기로 달리기")
// "여기로 달리기"를 누르면 코스 고르기에 그 목적지가 미리 골라져요.
// 코스 목적지 카드 아래에 "둘러볼 곳"(explore.json) 목록: 코스 도착지에서 가까운 순, 6곳 + 모두 보기. 누르면 둘러볼 곳 상세.
// 장소 상세의 "근처 N곳 모두 보기"로 오면(app.placesNear) 그 목적지가 가장 가까운 곳만 걸러서 "{장소} 근처 · 해제" 칩을 보여줘요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";
import { TOPICS, PLACE_TOPICS, exploreTopics, exploreColor, exploreMeta, fromCourseEnd, byNearest, destName } from "../lib/places.js";
import { MapView, FitBounds, SpotMarker, ExploreLayer } from "../components/MapView.jsx";
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
  // 둘러볼 곳: 같은 주제·검색(· 근처 목적지)으로 거르고 코스 도착지에서 가까운 순
  const near = app.placesNear;
  const explore = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.explore.filter((p) => !near || p.nearest_course?.dest === near)
      .filter((p) => topic === "all" || exploreTopics(p).includes(topic))
      .filter((p) => !qq || [p.name.ko, p.name.en, p.kind, p.curation, p.area_ko].some((x) => (x || "").toLowerCase().includes(qq)))
      .sort(byNearest);
  }, [data.explore, topic, q, near]);
  const [allExplore, setAllExplore] = useState(false);
  useEffect(() => { setAllExplore(false); }, [topic, q, near]);
  // 근처로 걸러 왔으면 둘러볼 곳 목록으로 내려가요
  const exploreRef = useRef(null);
  useEffect(() => { if (near) exploreRef.current?.scrollIntoView({ block: "start" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openExplore = (p) => { app.setExplore({ place: p, from: "places" }); app.go("explore"); };

  const courseCount = (id) => data.courses.filter((c) => c.properties.dest === id).length;
  const openPlace = (s) => { app.setSpot(s); app.setPlaceFrom("places"); app.go("place"); };
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
              <ExploreLayer key={topic} places={explore} onSelect={openExplore} />
              {list.map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openPlace(s)} />)}
              <FitBounds points={(list.length || explore.length ? [...list, ...explore] : data.spots).map((s) => [s.lat, s.lng])} padTL={[60, 90]} padBR={[60, 40]} fitKey={view + topic + list.length + "-" + explore.length} />
            </MapView>
          </div>
        )}

        <p className="pl-count">{list.length ? t("dest_places_n", { n: list.length }) : t("dest_places_none")}</p>

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

        {(explore.length > 0 || near) && (
          <section className="pl-explore" ref={exploreRef} aria-label={t("explore_n", { n: explore.length })}>
            <h2>{t("explore_n", { n: explore.length })}</h2>
            <p>{t("explore_sub")}</p>
            {near && (
              <button type="button" className="pl-near" onClick={() => app.setPlacesNear(null)} aria-label={t("near_clear_label", { name: destName(data, near) })}>
                {t("near_chip", { name: destName(data, near) })}<span aria-hidden="true">· {t("near_clear")}</span>
              </button>
            )}
            {explore.length > 0 && <ul className="card">
              {(allExplore ? explore : explore.slice(0, 6)).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => openExplore(p)}>
                    <i style={{ background: exploreColor(p) }} aria-hidden="true" />
                    <span className="ple-text"><b>{loc(p.name)}</b><small>{exploreMeta(p)}</small></span>
                    <span className="ple-near">{fromCourseEnd(data, p)}</span>
                    <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </li>
              ))}
            </ul>}
            {explore.length > 6 && (
              <button type="button" className="btn btn-soft ple-more" aria-expanded={allExplore} onClick={() => setAllExplore(!allExplore)}>
                {allExplore ? t("show_less") : t("see_all_n", { n: explore.length })}
              </button>
            )}
          </section>
        )}

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
