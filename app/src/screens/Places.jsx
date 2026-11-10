// ⑦ 장소와 이야기 = 로그인 뒤 메인 화면 (디자인 원본 docs/design/Places.dc.html)
// 검색 · 목록/지도 전환 · 주제 칩 · 장소 카드("이야기 · 방문 정보" / "여기로 달리기")
// "여기로 달리기"를 누르면 코스 고르기에 그 목적지가 미리 골라져요.
// 추천 코스 3선(코스 목적지) 카드 아래에 "둘러볼 곳"(explore.json) 목록: 코스 도착지에서 가까운 순, 6곳 + 모두 보기. 누르면 둘러볼 곳 상세.
// 장소 상세의 "근처 N곳 모두 보기"로 오면(app.placesNear) 그 목적지가 가장 가까운 곳만 걸러서 "{장소} 근처 · 해제" 칩을 보여줘요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";
import { GROUPS, groupOf, PLACE_TOPICS, kindLabel, byNearest, destName, round10 } from "../lib/places.js";
import { MapView, FitBounds, SpotMarker, ExploreLayer } from "../components/MapView.jsx";
import { spotIconSvg, GroupIcon } from "../components/SpotIcons.jsx";
import { PlaceCover, PlaceThumb } from "../components/PlacePhoto.jsx";

function PhotoIcon() {
  return <svg width="38" height="38" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>;
}

// 둘러볼 곳 3열 타일: 네모 사진 + 분류 배지(왼쪽 위) · 무료(오른쪽 아래), 아래에 이름과 코스 도착지에서 거리 · 도보 시간
function ExploreTile({ place, data, onOpen }) {
  const name = loc(place.name);
  const badge = kindLabel(place).split(/[·,\s]+/).filter(Boolean)[0];
  const free = String(place.fee || "").startsWith("무료");
  const meters = place.nearest_course?.straight_m;
  const from = place.nearest_course?.dest && t("explore_distance_from", { name: destName(data, place.nearest_course.dest) });
  const hasDist = Number.isFinite(meters);
  const distanceText = hasDist ? (meters < 1000 ? `${round10(meters)}m` : `${(meters / 1000).toFixed(1)}km`) : "";
  const walkMin = hasDist ? Math.max(1, Math.round(meters / 67)) : 0; // 걷는 속도 약 4km/h
  return (
    <button type="button" className="gx-tile" data-places-theme={groupOf(place)} onClick={() => onOpen(place)}
      aria-label={from && hasDist ? `${name}, ${from} ${distanceText}` : name}>
      <span className="gx-photo">
        <PlaceThumb place={place} fallback={<GroupIcon group={groupOf(place)} size={34} />} />
        {badge && <span className="gx-badge">{badge}</span>}
        {free && <span className="gx-free">{t("fee_free")}</span>}
      </span>
      <b className="gx-name">{name}</b>
      {hasDist && <span className="gx-dist">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 22s8-9 8-14a8 8 0 00-16 0c0 5 8 14 8 14z"/><circle cx="12" cy="9" r="2.5"/></svg>
        <strong>{distanceText}</strong> · {loc({ ko: `도보 ${walkMin}분`, en: `${walkMin} min walk` })}
      </span>}
    </button>
  );
}

// 코스 목적지 카드: 손으로 쓸어 한 장씩 넘기는 캐러셀 (터치·트랙패드는 브라우저 스크롤, 마우스는 끌기).
// 옆 카드가 살짝 보이고, 아래 점으로 지금 몇 번째인지 보여줘요
function DestCarousel({ items, render, label }) {
  const n = items.length;
  const [idx, setIdx] = useState(0);
  const track = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const step = () => { const el = track.current; if (!el) return 1; const slide = el.querySelector(".dc-slide"); return slide ? slide.offsetWidth + 10 : el.clientWidth; };
  const go = (k) => { const el = track.current; if (!el) return; const t = Math.max(0, Math.min(n - 1, k)); el.scrollTo({ left: t * step(), behavior: "smooth" }); setIdx(t); };
  const onScroll = () => { const el = track.current; if (!el || drag.current) return; setIdx(Math.max(0, Math.min(n - 1, Math.round(el.scrollLeft / step())))); };
  // 마우스로 끌기 (데스크톱 화면에서 쓸어넘기기처럼)
  const down = (e) => { if (e.pointerType !== "mouse" || n < 2) return; drag.current = { x: e.clientX, left: track.current.scrollLeft, id: e.pointerId }; moved.current = false; };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x;
    if (!moved.current && Math.abs(dx) > 6) { moved.current = true; track.current.classList.add("dragging"); track.current.setPointerCapture?.(d.id); }
    if (moved.current) track.current.scrollLeft = d.left - dx;
  };
  const up = (e) => {
    const d = drag.current; drag.current = null; if (!d) return;
    track.current.classList.remove("dragging");
    if (!moved.current) return;
    const dx = e.clientX - d.x, base = Math.round(d.left / step());
    go(dx < -40 ? base + 1 : dx > 40 ? base - 1 : base);
  };
  const stopClick = (e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } };
  const key = (e) => { if (e.key === "ArrowRight") go(idx + 1); if (e.key === "ArrowLeft") go(idx - 1); };

  return (
    <div className="dc" role="region" aria-roledescription="carousel" aria-label={label} tabIndex={0} onKeyDown={key}>
      <div className="dc-track" ref={track} onScroll={onScroll}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={stopClick}>
        {items.map((it, k) => (
          <div key={k} className={`dc-slide ${k === idx ? "on" : ""}`} aria-hidden={k !== idx}
            onClickCapture={k !== idx ? (e) => { e.stopPropagation(); e.preventDefault(); go(k); } : undefined}>
            {render(it)}
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="dc-dots" aria-hidden="true">
          {items.map((_, k) => <span key={k} className={k === idx ? "on" : ""} />)}
        </div>
      )}
    </div>
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
  // 근처로 걸러 왔으면 둘러볼 곳 목록으로 내려가요
  const exploreRef = useRef(null);
  useEffect(() => { if (near) exploreRef.current?.scrollIntoView({ block: "start" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 둘러볼 곳은 처음에 9곳(3×3)만, "더 알아보기"로 나머지
  const [moreExplore, setMoreExplore] = useState(false);
  useEffect(() => { setMoreExplore(false); }, [topic, q, near]);
  const openExplore = (p) => { app.setExplore({ place: p, from: "places" }); app.go("explore"); };

  const courseCount = (id) => data.courses.filter((c) => c.properties.dest === id).length;
  const openPlace = (s) => { app.setSpot(s); app.setPlaceFrom("places"); app.go("place"); };
  const runHere = (s) => { app.setPick({ ...app.pick, dest: s.id }); app.go("courses"); };

  return (
    <section className="screen places-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="pl-top">
          <h1>{t("places_title")}</h1>
          <div className="pl-view" role="tablist" aria-label={t("view_mode")}>
            <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>{t("view_list")}</button>
            <button role="tab" aria-selected={view === "map"} className={view === "map" ? "on" : ""} onClick={() => setView("map")}>{t("view_map")}</button>
          </div>
        </div>

        <label className="search glass pl-search">
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("places_search_ph")} aria-label={t("places_search")} />
        </label>

        <div className="pl-topics scroll" role="radiogroup" aria-label={t("topic")}>
          {GROUPS.map((k) => (
            <button key={k} role="radio" data-places-theme={k} data-theme-chip={k} aria-checked={topic === k} className={`pl-topic ${topic === k ? "on" : ""}`} onClick={() => setTopic(k)}>
              <GroupIcon group={k} size={18} />{t("grp_" + k)}
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
          <h2>{t("dest_title")}</h2>
          <p>{t("dest_description")}</p>
          <DestCarousel key={topic + q} items={list} label={t("dest_title")} render={(s) => (
              <article className="pl-card">
                <div className="pl-card-photo">
                  <PlaceCover place={s} fallback={<PhotoIcon />} />
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
            )} />
        </section> : <p className="pl-count">{t("dest_places_none")}</p>}

          <section className="pl-explore" data-places-theme={topic} ref={exploreRef} aria-label={t("explore_n", { n: explore.length })}>
            <h2>{t("explore_n", { n: "" }).trim()} <span>{explore.length}</span></h2>
            <p>{t("explore_sub")}</p>
            {near && (
              <button type="button" className="pl-near" onClick={() => app.setPlacesNear(null)} aria-label={t("near_clear_label", { name: destName(data, near) })}>
                {t("near_chip", { name: destName(data, near) })}<span aria-hidden="true">· {t("near_clear")}</span>
              </button>
            )}
            {!explore.length ? <p>{t("explore_empty")}</p> : (
              <>
                <div className="gx-grid" key={topic + q}>
                  {(moreExplore ? explore : explore.slice(0, 9)).map((p) => <ExploreTile key={p.id} place={p} data={data} onOpen={openExplore} />)}
                </div>
                {explore.length > 9 && (
                  <button type="button" className="btn btn-soft ple-more" aria-expanded={moreExplore} onClick={() => setMoreExplore(!moreExplore)}>
                    {moreExplore ? t("show_less") : loc({ ko: "더 알아보기", en: "See more" })}
                  </button>
                )}
              </>
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
