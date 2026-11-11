// 장소 탭: 성북구 둘러볼 곳을 종류(전시·역사·종교·공원)와 코스로 나눠 보여줘요.
// - PlacesHub      : 장소 첫 화면. 카테고리 큰 카드 4장 + 코스 따라 보기(심우장·정릉·의릉)
// - PlacesCategory : 카테고리 하나. 작은 지도 + 코스 목적지에서 가까운 순 목록 (핀 ↔ 카드 연결)
// - PlacesCourse   : 코스 따라 보기. 그 목적지의 가장 짧은 코스 + 코스 300m 안 장소
// 큰 지도는 Home.jsx ("지도 크게 보기"). 고른 카테고리·목적지는 app.placesView에 남겨서 상세에 갔다 와도 그대로예요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";
import { DESTINATIONS } from "../lib/routes.js";
import { MapView, FitBounds, ExploreLayer, Route, Dot, SpotMarker } from "../components/MapView.jsx";
import { GroupIcon } from "../components/SpotIcons.jsx";
import { PlaceThumb } from "../components/PlacePhoto.jsx";
import { Badge, Segment } from "../components/ui.jsx";
import { MODE_COLOR } from "./Courses.jsx";
import { GROUPS, groupOf, kindLabel, shortFee, destName, round10, byNearest } from "../lib/places.js";

const CATS = GROUPS.filter((g) => g !== "all");
// 연한 배경 위 작은 글씨용 진한 카테고리 색 (대비 4.5:1 이상)
const DEEP = { exhibit: "#17489A", heritage: "#9A350B", religion: "#82205F", park: "#2A6A0F" };
const NEAR_COURSE_M = 300; // 코스 따라 보기: 코스 선에서 이 거리 안
const BESIDE_M = 50;       // 이보다 가까우면 "코스 바로 옆"
// 걸어서 몇 분 (1분 = 67m, 최소 1분)
const walkMin = (m) => Math.max(1, Math.round(m / 67));

// 장소 탭의 장소 전체: 지도에 보이는 코스 목적지 + 둘러볼 곳 (큰 지도 칩 개수와 같은 기준)
// 코스 목적지는 둘러볼 곳 자료(분류·입장료·주소)를 합쳐 두고, 거리는 0으로 맨 앞에 와요
function usePlaceItems(data) {
  return useMemo(() => {
    const spotIds = new Set(data.spots.map((s) => s.id));
    const dests = data.spots.map((s) => ({ ...(data.exploreBySpot?.[s.id] || {}), ...s, isDest: true, nearest_course: { dest: s.id, straight_m: 0 } }));
    return [...dests, ...data.explore.filter((p) => !spotIds.has(p.spot_id))];
  }, [data]);
}

// 장소 열기: 코스 목적지는 장소 상세, 둘러볼 곳은 둘러볼 곳 상세 (뒤로 가면 from 화면)
function openItem(app, p, from) {
  if (p.isDest) { app.setSpot(app.data.spotById[p.id]); app.setPlaceFrom(from); app.go("place"); return; }
  app.setExplore({ place: p, from }); app.go("explore");
}

const isFree = (p) => !!p.fee && shortFee(p.fee) === t("fee_free");
const kindOf = (p) => (p.isDest ? t("ph_dest_self") : kindLabel(p));
// "심우장에서 270m · 도보 4분"
function fromDest(data, p) {
  const nc = p.nearest_course;
  if (p.isDest || !nc?.dest) return null;
  return t("ph_from_dest", { name: destName(data, nc.dest), m: round10(nc.straight_m), min: walkMin(nc.straight_m) });
}

// ---------- 장소 첫 화면 ----------
export function PlacesHub() {
  const app = useApp();
  const { data } = app;
  const st = app.placesView.current;
  const [q, setQ] = useState(st.q || "");
  useEffect(() => { st.q = q; }, [st, q]);
  const items = usePlaceItems(data);
  const byCat = useMemo(() => Object.fromEntries(CATS.map((c) => [c, items.filter((p) => groupOf(p) === c).sort(byNearest)])), [items]);
  const results = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return null;
    return items.filter((p) => [p.name?.ko, p.name?.en, p.kind, p.address, p.area_ko, t("grp_" + groupOf(p))].some((x) => (x || "").toLowerCase().includes(qq))).sort(byNearest);
  }, [items, q]);
  const nearCount = (d) => data.explore.filter((p) => p.nearest_course?.dest === d).length;
  const openCat = (c) => { st.cat = c; app.go("placesCat"); };
  const openCourse = (d) => { st.dest = d; app.go("placesCourse"); };

  return (
    <section className="screen places-screen ph-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="ph-head">
          <h1>{t("ph_title")}</h1>
          <p>{t("ph_sub", { n: items.length })}</p>
        </div>
        <label className="search glass pl-search">
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ph_search_ph")} aria-label={t("ph_search")} />
        </label>

        {results ? (
          <>
            <p className="pl-count">{results.length ? t("ph_results", { n: results.length }) : t("ph_none")}</p>
            {results.map((p) => (
              <PlaceRow key={p.id} p={p} meta={fromDest(data, p)} onOpen={() => openItem(app, p, "placesHub")} />
            ))}
          </>
        ) : (
          <>
            <h2 className="ph-h2">{t("ph_by_cat")}</h2>
            <div className="ph-cats">
              {CATS.map((c) => {
                const list = byCat[c];
                const names = list.slice(0, 3).map((p) => loc(p.name).replace(/\s*\(.*\)/, "")).join(", ");
                return (
                  <button key={c} type="button" className="ph-cat" data-theme-chip={c} style={{ "--deep": DEEP[c] }} onClick={() => openCat(c)}
                    aria-label={`${t("grp_" + c)} ${t("ph_n", { n: list.length })}`}>
                    <span className="ph-cat-top">
                      <span className="ph-cat-ic" aria-hidden="true"><GroupIcon group={c} size={24} /></span>
                      <b className="ph-cat-n">{t("ph_n", { n: list.length })}</b>
                    </span>
                    <span className="ph-cat-name">{t("grp_" + c)}</span>
                    <span className="ph-cat-desc">{t("ph_desc_" + c)}</span>
                    <span className="ph-cat-more"><span>{names}</span>{list.length > 3 && <span className="ph-cat-suffix">{t("ph_more_suffix")}</span>}</span>
                  </button>
                );
              })}
            </div>

            <h2 className="ph-h2">{t("ph_by_course")}</h2>
            <p className="ph-h2-sub">{t("ph_by_course_sub")}</p>
            <div className="ph-dests">
              {DESTINATIONS.map((d) => (
                <button key={d} type="button" className="card ph-dest" onClick={() => openCourse(d)}>
                  <b>{destName(data, d)}</b>
                  <small>{t("ph_near_n", { n: nearCount(d) })}</small>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ---------- 카테고리 화면 ----------
export function PlacesCategory() {
  const app = useApp();
  const { data } = app;
  const st = app.placesView.current;
  const [cat, setCat] = useState(CATS.includes(st.cat) ? st.cat : CATS[0]);
  useEffect(() => { st.cat = cat; }, [st, cat]);
  const items = usePlaceItems(data);
  const count = useMemo(() => Object.fromEntries(CATS.map((c) => [c, items.filter((p) => groupOf(p) === c).length])), [items]);
  const list = useMemo(() => items.filter((p) => groupOf(p) === cat).sort(byNearest), [items, cat]);
  const link = usePinLink([cat]);
  // 큰 지도: 같은 카테고리 칩이 켜진 상태로 성북구 전체부터
  const bigMap = () => { app.homeMap.current = { filter: cat, selId: null, view: null, origin: null }; app.go("home"); };

  return (
    <section className="screen places-screen ph-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="pl-top">
          <button className="round-btn glass" onClick={() => app.go("placesHub")} aria-label={t("ph_back_places_label")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{t("ph_cat_title", { name: t("grp_" + cat), n: list.length })}</h1>
        </div>

        <div className="pl-topics scroll ph-chips" role="radiogroup" aria-label={t("ph_kind")}>
          {CATS.map((c) => (
            <button key={c} type="button" role="radio" data-theme-chip={c} aria-checked={cat === c} className={`pl-topic ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
              <GroupIcon group={c} size={18} />{t("grp_" + c)}<span className="chip-n">{count[c]}</span>
            </button>
          ))}
        </div>

        <div className="card ph-map">
          <MapView>
            <ExploreLayer key={cat} cluster={false} places={list} selectedId={link.pinId} level={6} onSelect={link.pickPin} />
            <FitBounds points={list.map((p) => [p.lat, p.lng])} padTL={[28, 60]} padBR={[28, 28]} fitKey={cat} />
          </MapView>
          <span className="ph-map-tag">{t("ph_cat_only", { name: t("grp_" + cat) })}</span>
          <button type="button" className="ph-map-big" onClick={bigMap}>{t("ph_big_map")}</button>
        </div>

        <h2 className="ph-h2">{t("ph_by_dest")}</h2>
        {list.map((p) => (
          <PlaceRow key={p.id} p={p} meta={fromDest(data, p)} on={link.selId === p.id} rowRef={link.rowRef(p.id)} {...link.hover(p.id)}
            onOpen={() => openItem(app, p, "placesCat")} />
        ))}
      </div>
    </section>
  );
}

// ---------- 코스 따라 보기 ----------
export function PlacesCourse() {
  const app = useApp();
  const { data } = app;
  const st = app.placesView.current;
  const [dest, setDest] = useState(DESTINATIONS.includes(st.dest) ? st.dest : DESTINATIONS[0]);
  const [kind, setKind] = useState(st.kind || "all");
  const course = useMemo(() => shortestCourse(data, dest), [data, dest]);
  // 코스 선 위 점들까지 가장 가까운 거리가 300m 안인 둘러볼 곳 (목적지 자신은 빼요)
  const near = useMemo(() => {
    if (!course) return [];
    return data.explore.filter((p) => p.spot_id !== dest && p.id !== dest)
      .map((p) => ({ p, d: Math.min(...course.path.map((q) => distance(q, p))) }))
      .filter((x) => x.d <= NEAR_COURSE_M)
      .sort((a, b) => a.d - b.d);
  }, [data, course, dest]);
  const count = useMemo(() => {
    const n = { all: near.length };
    near.forEach(({ p }) => { const g = groupOf(p); n[g] = (n[g] || 0) + 1; });
    return n;
  }, [near]);
  // 고른 종류가 이 코스에 없으면 전체로
  const curKind = kind === "all" || count[kind] ? kind : "all";
  useEffect(() => { st.dest = dest; st.kind = curKind; }, [st, dest, curKind]);
  const shown = near.filter(({ p }) => curKind === "all" || groupOf(p) === curKind);
  const link = usePinLink([dest, curKind]);
  const props = course?.properties;
  const startName = props?.route?.start?.name && !props.route.start.name.startsWith("OSM ") ? props.route.start.name : t("start_point");
  // 지금 앱의 "여기로 달리기"와 같아요: 코스 고르기로 가서 이 목적지·거리·길 종류로
  const runCourse = () => {
    app.setPick({ ...app.pick, dest, ...(props ? { km: props.km, hill: props.mode === "low" ? "flat" : "hard" } : {}) });
    app.go("courses");
  };
  // 지도 맞춤: 코스 선(띄엄띄엄) + 보이는 장소
  const fitPts = useMemo(() => {
    if (!course) return [];
    const step = Math.max(1, Math.floor(course.path.length / 40));
    return [...course.path.filter((_, i) => i % step === 0).map((q) => [q.lat, q.lng]), ...shown.map(({ p }) => [p.lat, p.lng])];
  }, [course, shown]);

  return (
    <section className="screen places-screen ph-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll ph-scroll-run">
        <div className="pl-top">
          <button className="round-btn glass" onClick={() => app.go("placesHub")} aria-label={t("ph_back_places_label")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{t("ph_course_title")}</h1>
        </div>

        <Segment className="ph-seg" label={t("ph_dest_pick")} value={dest} onChange={setDest}
          options={DESTINATIONS.map((d) => ({ value: d, label: destName(data, d) }))} />
        {props && <p className="ph-course-line">{t("ph_course_line", { from: startName, to: destName(data, dest), km: props.distance_km })}</p>}

        <div className="card ph-map ph-map-sm">
          <MapView>
            {course && [
              <Route key={course.id + "-case"} path={course.path} color="#FFFFFF" weight={10} opacity={1} zIndex={5} />,
              <Route key={course.id} path={course.path} color={MODE_COLOR[props.mode]} weight={6} opacity={1} zIndex={6} />,
              <Dot key="start" at={[course.path[0].lat, course.path[0].lng]} color={MODE_COLOR[props.mode]} />,
            ]}
            {data.spotById[dest] && <SpotMarker spot={data.spotById[dest]} />}
            <ExploreLayer key={dest + curKind} cluster={false} places={shown.map((x) => x.p)} selectedId={link.pinId} level={6} onSelect={link.pickPin} />
            <FitBounds points={fitPts} padTL={[24, 52]} padBR={[24, 24]} fitKey={dest + curKind} />
          </MapView>
          <span className="ph-map-tag">{t("ph_course_within", { n: near.length })}</span>
        </div>

        <div className="pl-topics scroll ph-chips" role="radiogroup" aria-label={t("ph_kind")}>
          {GROUPS.filter((g) => g === "all" || count[g]).map((g) => (
            <button key={g} type="button" role="radio" data-theme-chip={g} aria-checked={curKind === g} className={`pl-topic ${curKind === g ? "on" : ""}`} onClick={() => setKind(g)}>
              {t(g === "all" ? "ph_all_n" : "grp_" + g)}<span className="chip-n">{count[g] || 0}</span>
            </button>
          ))}
        </div>

        <h2 className="ph-h2">{t("ph_course_near")}</h2>
        {!shown.length && <p className="pl-count">{t("ph_course_none")}</p>}
        {shown.map(({ p, d }) => (
          <PlaceRow key={p.id} p={p} kindColor on={link.selId === p.id} rowRef={link.rowRef(p.id)} {...link.hover(p.id)}
            right={d < BESIDE_M ? t("ph_course_beside") : t("ph_course_walk", { min: walkMin(d) })}
            onOpen={() => openItem(app, p, "placesCourse")} />
        ))}
      </div>
      {course && (
        <button type="button" className="btn btn-cta ph-run" onClick={runCourse}>{t("ph_run_course")} →</button>
      )}
    </section>
  );
}

// 그 목적지의 가장 짧은 코스 하나
function shortestCourse(data, dest) {
  return data.courses.filter((c) => c.properties.dest === dest)
    .sort((a, b) => a.properties.distance_km - b.properties.distance_km)[0] || null;
}

// 지도 핀 ↔ 목록 카드 연결
// 핀을 누르면 그 카드로 스크롤하고 테두리 강조(selId), 카드에 손가락·마우스·포커스가 있는 동안 그 핀이 커져요(hotId)
function usePinLink(resetKeys) {
  const [selId, setSelId] = useState(null);
  const [hotId, setHotId] = useState(null);
  const rows = useRef({});
  useEffect(() => { setSelId(null); setHotId(null); }, resetKeys); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    selId,
    pinId: hotId || selId,
    pickPin: (p) => { setSelId(p.id); rows.current[p.id]?.scrollIntoView({ block: "center", behavior: "smooth" }); },
    rowRef: (id) => (el) => { rows.current[id] = el; },
    hover: (id) => ({
      onHot: () => setHotId(id),
      onCold: () => setHotId((h) => (h === id ? null : h)),
    }),
  };
}

// 장소 카드: 사진(없으면 종류 아이콘) · 이름 · 종류 · 거리 · 무료 배지. 카드 전체가 버튼이에요
function PlaceRow({ p, meta, right, kindColor = false, on = false, rowRef, onHot, onCold, onOpen }) {
  const g = groupOf(p);
  return (
    <article ref={rowRef} className={`card ph-row ${on ? "on" : ""}`}>
      <button type="button" className="ph-row-main" onClick={onOpen}
        onPointerEnter={onHot} onPointerLeave={onCold} onFocus={onHot} onBlur={onCold}>
        <PlaceThumb place={p} fallback={<GroupIcon group={g} size={30} />} />
        <span className="ph-row-text">
          <b>{loc(p.name)}</b>
          <small style={kindColor ? { color: DEEP[g] } : undefined}>{kindOf(p)}</small>
          {meta && <span className="ph-row-meta">{meta}</span>}
          {isFree(p) && <Badge>{t("fee_free")}</Badge>}
        </span>
        {right && <span className="ph-row-right">{right}</span>}
      </button>
    </article>
  );
}
