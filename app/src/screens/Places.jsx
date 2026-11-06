// ⑦ 장소와 이야기 (디자인 원본 docs/design/Places.dc.html)
// 검색 · 목록/지도 전환 · 주제 칩 · 장소 카드("이야기 · 방문 정보" / "여기로 달리기")
// "여기로 달리기"를 누르면 코스 고르기에 그 목적지가 미리 골라져요.
// 코스 목적지 카드 아래에 "둘러볼 곳"(explore.json) 목록: 코스 도착지에서 가까운 순, 6곳 + 모두 보기. 누르면 둘러볼 곳 상세.
// 장소 상세의 "근처 N곳 모두 보기"로 오면(app.placesNear) 그 목적지가 가장 가까운 곳만 걸러서 "{장소} 근처 · 해제" 칩을 보여줘요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";
import { GROUPS, groupOf, PLACE_TOPICS, kindLabel, exploreMeta, fromCourseEnd, byNearest, destName, round10 } from "../lib/places.js";
import { MapView, FitBounds, SpotMarker, ExploreLayer } from "../components/MapView.jsx";
import { spotIconSvg, GroupIcon } from "../components/SpotIcons.jsx";
import PlacePhoto from "../components/PlacePhoto.jsx";

const chipIcons = {
  all: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  exhibit: "M3 4h18v14H3z M6 15l4-5 3 3 3-4 3 6 M9 21l1-3m5 3-1-3",
  heritage: "M2 9l10-6 10 6H2z M5 10v9m5-9v9m4-9v9m5-9v9 M3 20h18",
  religion: "M5 16h14l-2-3V9a5 5 0 00-10 0v4z M10 19a2 2 0 004 0",
  park: "M12 2l6 8h-3l5 7H4l5-7H6z M12 17v5",
};

function PhotoIcon() {
  return <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>;
}

// 공공누리 3유형은 변경 금지라 자르지 않고 보여줘요. 사진을 못 불러오면 회색 아이콘으로 바뀌어요.
function ExplorePhoto({ place }) {
  const [failed, setFailed] = useState(false);
  if (!place.photo_url || failed) return <PhotoIcon />;
  return (
    <>
      <img className={place.photo_license === "KOGL-3" ? "contain" : undefined} src={place.photo_url} alt={t("photo_alt", { name: loc(place.name) })} loading="lazy" onError={() => setFailed(true)} />
      <span className="explore-credit">{t("photo_credit", { credit: place.photo_credit })}</span>
    </>
  );
}

function ExploreCard({ place, data, onOpen }) {
  const name = loc(place.name);
  const [badge, ...tags] = kindLabel(place).split(/[·,\s]+/).filter(Boolean);
  const meters = place.nearest_course?.straight_m;
  const from = place.nearest_course?.dest && t("explore_distance_from", { name: destName(data, place.nearest_course.dest) });
  const distanceText = Number.isFinite(meters) ? (meters < 1000 ? `${round10(meters)}m` : `${(meters / 1000).toFixed(1)}km`) : "";
  return (
    <button type="button" className="explore-tile" data-places-theme={groupOf(place)} onClick={() => onOpen(place)}
      aria-label={from && distanceText ? `${name}, ${from} ${distanceText}` : name}>
      <span className="explore-photo">
        <ExplorePhoto place={place} />
        <span className="explore-badge">{badge}</span>
      </span>
      <span className="explore-caption">
        <b>{name}</b><small>{tags.filter((tag) => tag !== badge).join(" · ")}</small>
        {from && distanceText && <span className="explore-distance">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 22s8-9 8-14a8 8 0 00-16 0c0 5 8 14 8 14z"/><circle cx="12" cy="9" r="2"/></svg>
          {from} <strong>{distanceText}</strong>
        </span>}
      </span>
    </button>
  );
}

export default function Places() {
  const app = useApp();
  const { data } = app;
  const [view, setView] = useState("list");
  const [topic, setTopic] = useState("all");
  const [q, setQ] = useState("");
  const here = useKnownPosition();

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.spots.filter((s) => topic === "all" || groupOf(s) === topic)
      .filter((s) => !qq || [s.name.ko, s.name.en, ...s.cards.flatMap((c) => [c.title?.ko, c.title?.en, c.body?.ko, c.body?.en])]
        .some((x) => (x || "").toLowerCase().includes(qq)));
  }, [data.spots, topic, q]);
  // 둘러볼 곳: 같은 주제·검색(· 근처 목적지)으로 거르고 코스 도착지에서 가까운 순
  const near = app.placesNear;
  const explore = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.explore.filter((p) => !near || p.nearest_course?.dest === near)
      .filter((p) => topic === "all" || groupOf(p) === topic)
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
          {GROUPS.map((k) => (
            <button key={k} role="radio" data-places-theme={k} aria-checked={topic === k} className={`pl-topic ${topic === k ? "on" : ""}`} onClick={() => setTopic(k)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={chipIcons[k]} /></svg>{t("grp_" + k)}
            </button>
          ))}
        </div>

        {view === "map" && (
          <div className="card pl-map rise">
            <MapView>
              <ExploreLayer key={topic} cluster={false} places={explore} onSelect={openExplore} />
              {list.map((s) => <SpotMarker key={s.id} spot={s} label onClick={() => openPlace(s)} />)}
              <FitBounds points={(list.length || explore.length ? [...list, ...explore] : data.spots).map((s) => [s.lat, s.lng])} padTL={[60, 90]} padBR={[60, 40]} fitKey={view + topic + list.length + "-" + explore.length} />
            </MapView>
          </div>
        )}

        {list.length ? <section className="pl-destinations" data-places-theme={topic}>
          <h2>{t("dest_title")} <span>{list.length}</span></h2>
          <p>{t("dest_description")}</p>
          <div className="explore-rail" role="list" aria-label={t("dest_title")} key={topic}>
            {list.map((s) => (
              <article key={s.id} className="pl-card" role="listitem">
                <div className="pl-card-photo">
                  <PlacePhoto spot={s} fallback={<PhotoIcon />} />
                  <span className="pl-course-count">{t("courses_n", { n: courseCount(s.id) })}</span>
                  <span className="pl-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(s) }} />
                </div>
                <div className="pl-text" data-places-theme={groupOf(s)}>
                  <h3>{loc(s.name)}</h3>
                  <small>{[...(PLACE_TOPICS[s.id] || []).map((k) => t("topic_" + k)), here ? t("from_me", { km: (distance(here, s) / 1000).toFixed(1) }) : null].filter(Boolean).join(" · ")}</small>
                  <p>{loc(s.summary)}</p>
                </div>
                <div className="pl-actions">
                  <button type="button" aria-label={t("dest_visit_label", { name: loc(s.name) })} onClick={() => openPlace(s)}>{t("story_visit")}</button>
                  <button type="button" aria-label={t("dest_run_label", { name: loc(s.name) })} onClick={() => runHere(s)}>{t("run_here")} →</button>
                </div>
              </article>
            ))}
          </div>
        </section> : <p className="pl-count">{t("dest_places_none")}</p>}

          <section className="pl-explore" data-places-theme={topic} ref={exploreRef} aria-label={t("explore_n", { n: explore.length })}>
            <h2>{t("explore_n", { n: "" }).trim()} <span>{explore.length}</span></h2>
            <p>{t("explore_sub")}</p>
            {near && (
              <button type="button" className="pl-near" onClick={() => app.setPlacesNear(null)} aria-label={t("near_clear_label", { name: destName(data, near) })}>
                {t("near_chip", { name: destName(data, near) })}<span aria-hidden="true">· {t("near_clear")}</span>
              </button>
            )}
            {!explore.length ? <p>{t("explore_empty")}</p> : !allExplore ? (
              <div className="explore-rail" key={topic + q}>
                {explore.map((p) => <ExploreCard key={p.id} place={p} data={data} onOpen={openExplore} />)}
              </div>
            ) : <ul className="card">
              {explore.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => openExplore(p)}>
                    <GroupIcon group={groupOf(p)} size={30} className="grp-icon list" />
                    <span className="ple-text"><b>{loc(p.name)}</b><small>{exploreMeta(p)}</small></span>
                    <span className="ple-near">{fromCourseEnd(data, p)}</span>
                    <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </li>
              ))}
            </ul>}
            {explore.length > 0 && (
              <button type="button" className="btn btn-soft ple-more" aria-expanded={allExplore} onClick={() => setAllExplore(!allExplore)}>
                {allExplore ? t("show_less") : t("see_all_n", { n: explore.length })}
              </button>
            )}
          </section>

      </div>
    </section>
  );
}

// 위치 권한이 이미 허용돼 있을 때만 내 위치를 써요 (이 화면에서 권한 창을 새로 띄우지 않아요). 모르면 거리 표시를 숨겨요
export function useKnownPosition() {
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
