// 장소 탭: 성북구 둘러볼 곳을 종류(전시·역사·종교·공원)와 코스로 나눠 보여줘요.
// - PlacesHub      : 장소 첫 화면. "성북구 둘러볼 곳 N / 장소" + 검색 버튼(누르면 이름·종류로 찾기) → 카테고리 칩(전체·전시·역사·종교·공원, 옆으로 밀기)
//                    → 성북구 작은 지도(물방울 핀, 심우장·정릉·의릉은 흰 점 + 이름) → 코스 따라 보기 세 줄(코스 모양 · 출발지 → 목적지 · 거리 · 근처 장소 미리보기)
//                    (예전 카테고리 화면 PlacesCategory는 없앴어요. 장소 안내는 지도 핀 → PlaceSheet)
// - PlacesCourse   : 코스 따라 보기. 그 목적지의 가장 짧은 코스 + 코스 근처 장소 (300m 안, 없으면 500m → 800m)
// 큰 지도는 Home.jsx ("지도 크게 보기"). 고른 카테고리·목적지는 app.placesView에 남겨서 상세에 갔다 와도 그대로예요.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CustomOverlayMap, Polygon } from "react-kakao-maps-sdk";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";
import { DESTINATIONS } from "../lib/routes.js";
import { MapView, FitBounds, ExploreLayer, Route, Dot, SpotMarker } from "../components/MapView.jsx";
import { GroupIcon } from "../components/SpotIcons.jsx";
import { PlaceThumb } from "../components/PlacePhoto.jsx";
import { Badge, Segment } from "../components/ui.jsx";
import { MODE_COLOR } from "./Courses.jsx";
import { GROUPS, groupOf, kindLabel, shortFee, destName, round10, byNearest, THEME_COLORS, kakaoDirections } from "../lib/places.js";

const CATS = GROUPS.filter((g) => g !== "all");
const CHIPS = GROUPS; // 칩 줄: 전체 + 카테고리 4개 (옆으로 밀어요)
// 연한 배경 위 작은 글씨용 진한 카테고리 색 (대비 4.5:1 이상)
const DEEP = { all: "#1F5A12", exhibit: "#17489A", heritage: "#9A350B", religion: "#82205F", park: "#2A6A0F" };
// 카테고리 연한 색 (칩 바탕 · 시트 아이콘 타일)
const SOFT = { all: "#CDE8B6", exhibit: "#CCDFFB", heritage: "#FDD5BF", religion: "#F7CBE7", park: "#D2EDB2" };
// 코스 따라 보기: 코스 선에서 300m 안. 한 곳도 없으면 500m, 그래도 없으면 800m까지 넓혀요
const COURSE_RADII = [300, 500, 800];
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
// 카테고리 칩 줄 → 바로 아래 성북구 지도(고른 카테고리 핀 + 코스 목적지 핀, 가까이 모이면 숫자 묶음) → 코스 따라 보기.
// 핀을 누르면 아래에서 장소 안내 시트(PlaceSheet)가 올라와요
export function PlacesHub() {
  const app = useApp();
  const { data } = app;
  const st = app.placesView.current;
  const items = usePlaceItems(data);
  const [cat, setCat] = useState(CHIPS.includes(st.cat) ? st.cat : "all");
  useEffect(() => { st.cat = cat; }, [st, cat]);
  const count = useMemo(() => ({ all: items.length, ...Object.fromEntries(CATS.map((c) => [c, items.filter((p) => groupOf(p) === c).length])) }), [items]);
  // 코스 목적지는 따로 큰 그림 핀으로 그려서, 카테고리 아이콘에서는 빼요
  const list = useMemo(() => items.filter((p) => !p.isDest && (cat === "all" || groupOf(p) === cat)).sort(byNearest), [items, cat]);
  // 심우장·정릉·의릉은 어떤 칩에서든 흰 원 + 초록 테두리 작은 점 + 이름으로 보여요
  const dests = useMemo(() => items.filter((p) => p.isDest), [items]);
  // 검색: 검색 버튼을 누르면 입력창이 열리고, 이름·분류로 장소를 걸러 아래에 결과를 보여줘요
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef(null);
  useEffect(() => { if (searching) searchInput.current?.focus(); }, [searching]);
  const q = query.trim().toLowerCase();
  const found = useMemo(() => (q ? items.filter((p) => [loc(p.name), p.name?.ko, p.name?.en, p.kind].some((x) => String(x || "").toLowerCase().includes(q))).slice(0, 8) : []), [items, q]);
  const [sel, setSel] = useState(null);
  const screenRef = useRef(null);
  useEffect(() => { setSel(null); }, [cat]);
  // 코스 따라 보기 화면과 같은 기준으로 센 개수
  // 코스 따라 보기 줄: 가장 짧은 코스 + 그 코스 근처 장소 (코스 따라 보기 화면과 같은 기준)
  const courseRows = useMemo(() => DESTINATIONS.map((d) => {
    const course = shortestCourse(data, d);
    const near = courseNear(data, course, d).list;
    const by = {};
    near.forEach(({ p }) => { const g = groupOf(p); by[g] = (by[g] || 0) + 1; });
    const groups = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
    const props = course?.properties;
    const start = props?.route?.start?.name;
    return {
      d, course, n: near.length, groups,
      names: near.slice(0, 3).map(({ p }) => loc(p.name).replace(/\s*\(.*\)/, "")).filter(Boolean),
      start: start && !start.startsWith("OSM ") ? start : "",
      km: props?.distance_km ?? null,
    };
  }), [data]);
  const openCourse = (d) => { st.dest = d; app.go("placesCourse"); };
  // 큰 지도: 같은 카테고리 칩이 켜진 상태로 성북구 전체부터
  const bigMap = () => { app.homeMap.current = { filter: cat, selId: null, view: null, origin: null }; app.go("home"); };
  const fitPts = useMemo(() => [...list, ...dests].map((p) => [p.lat, p.lng]), [list, dests]);
  const here = useHere();

  return (
    <section ref={screenRef} className="screen places-screen ph-screen ph2">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll ph2-scroll">
        <header className="ph2-head">
          <div>
            <small>{t("ph2_kicker", { n: items.length })}</small>
            <h1>{t("ph_title")}</h1>
          </div>
          <button type="button" className="ph2-search-btn" onClick={() => { setSearching((v) => !v); if (searching) setQuery(""); }}
            aria-label={t("places_search")} aria-expanded={searching}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
          </button>
        </header>
        {searching && (
          <div className="ph2-search">
            <input ref={searchInput} type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ph2_search_ph")} aria-label={t("places_search")} />
            {q && (
              <ul className="ph2-found" aria-live="polite">
                {!found.length && <li className="ph2-none">{t("ph2_search_none")}</li>}
                {found.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setSel(p)} style={{ "--c": THEME_COLORS[groupOf(p)] }}>
                      <span className="ph2-dot" aria-hidden="true"><GroupIcon group={groupOf(p)} size={13} /></span>
                      <b>{loc(p.name)}</b><small>{t("grp_" + groupOf(p))}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="ph-hub-chips ph2-chips" role="radiogroup" aria-label={t("ph_kind")}>
          {CHIPS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cat === c} className={`ph2-chip ${cat === c ? "on" : ""}`}
              style={{ "--c": THEME_COLORS[c] }} onClick={() => setCat(c)}>
              {c !== "all" && <GroupIcon group={c} size={16} />}{t("grp_" + c)}<span className="chip-n">{count[c]}</span>
            </button>
          ))}
        </div>

        <div className="ph-map ph-hub-map ph2-map" style={{ "--c": THEME_COLORS[cat] }}>
          <MapView>
            <DistrictShape />
            <ExploreLayer key={cat} cluster={false} places={list} selectedId={sel?.id} level={6} onSelect={setSel} />
            {dests.map((p) => <DestPin key={p.id} p={p} on={sel?.id === p.id} onClick={() => setSel(p)} />)}
            <FitBounds points={fitPts} padTL={[52, 30]} padBR={[44, 30]} fitKey={cat} />
            {here && <HerePin at={here} />}
          </MapView>
          <span className="ph-map-tag"><i aria-hidden="true" />{t("ph2_cat_n", { name: t("grp_" + cat), n: count[cat] })}</span>
          <button type="button" className="ph-map-big" onClick={bigMap} aria-label={t("ph_big_map")}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </button>
          <span className="ph2-hint" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V5a1.6 1.6 0 013.2 0v5 M12.2 9.5a1.6 1.6 0 013.2 0V11 M15.4 10.5a1.6 1.6 0 013.2 0v3.5a6 6 0 01-6 6h-1a6 6 0 01-4.7-2.3l-2.3-3a1.6 1.6 0 012.5-2L9 15" /></svg>
            {t("ph2_pin_hint")}
          </span>
        </div>

        <div className="ph2-course-head">
          <h2>{t("ph_by_course")}</h2>
          <p>{t("ph_by_course_sub")}</p>
        </div>
        <ul className="ph2-courses">
          {courseRows.map((r) => (
            <li key={r.d}>
              <button type="button" className="ph2-course" onClick={() => openCourse(r.d)}
                aria-label={t("ph2_course_label", { name: destName(data, r.d), n: r.n })}>
                <span className="ph2-course-tile" aria-hidden="true"><CourseShape course={r.course} /></span>
                <span className="ph2-course-text">
                  <span className="ph2-course-l1"><b>{destName(data, r.d)}</b><small>{t("ph_near_n", { n: r.n })}</small></span>
                  {(r.start || r.km != null) && (
                    <span className="ph2-course-l2">
                      {[r.start ? `${r.start} → ${destName(data, r.d)}` : "", r.km != null ? `${r.km}km` : ""].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {(r.groups.length > 0 || r.names.length > 0) && (
                    <span className="ph2-course-l3">
                      <span className="ph2-dots">
                        {r.groups.map((g) => (
                          <span key={g} className="ph2-dot" style={{ "--c": THEME_COLORS[g] }}><GroupIcon group={g} size={12} /></span>
                        ))}
                      </span>
                      <span className="ph2-names">{r.names.join(" · ")}</span>
                    </span>
                  )}
                </span>
                <svg className="ph2-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {sel && <PlaceSheet p={sel} onClose={() => setSel(null)} host={screenRef.current?.parentElement} />}
    </section>
  );
}

// 코스 목적지 핀: 흰 원 + 초록(#2F6512) 테두리 작은 점 + 이름 라벨 (styles.css .ph-dest-pin)
function DestPin({ p, on, onClick }) {
  const name = loc(p.name).replace(/\s*\(.*\)/, "");
  return (
    <CustomOverlayMap position={{ lat: p.lat, lng: p.lng }} xAnchor={0.5} yAnchor={0.5} zIndex={on ? 4 : 3} clickable>
      <div className={`ph-dest-pin ${on ? "on" : ""}`}>
        <button type="button" onClick={onClick} aria-label={name} aria-pressed={on} />
        <span aria-hidden="true">{name}</span>
      </div>
    </CustomOverlayMap>
  );
}

// 코스 따라 보기 줄의 52px 타일: 실제 코스 경로를 작게 (연두 굵은 선 위 초록 선)
function CourseShape({ course }) {
  const d = useMemo(() => {
    const path = course?.path || [];
    if (path.length < 2) return null;
    const lat0 = path[0].lat, kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = path.map((q) => q.lng * kx), ys = path.map((q) => -q.lat);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const S = 52, P = 9, s = (S - P * 2) / Math.max(x1 - x0, y1 - y0, 1e-6);
    const ox = (S - (x1 - x0) * s) / 2, oy = (S - (y1 - y0) * s) / 2;
    const step = Math.max(1, Math.floor(path.length / 60));
    return path.filter((_, i) => i % step === 0 || i === path.length - 1)
      .map((q, i) => `${i ? "L" : "M"}${(ox + (q.lng * kx - x0) * s).toFixed(1)} ${(oy + (-q.lat - y0) * s).toFixed(1)}`).join(" ");
  }, [course]);
  if (!d) return null;
  return (
    <svg viewBox="0 0 52 52" width="52" height="52">
      <path d={d} fill="none" stroke="#CFE3B8" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#2F6512" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 내 위치: 위치 권한이 있으면 빨간 핀으로 (지도 범위 맞추기에는 넣지 않아요)
export function useHere() {
  const [here, setHere] = useState(null);
  useEffect(() => {
    if (!navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition(
      (pos) => setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return here;
}
export function HerePin({ at }) {
  return (
    <CustomOverlayMap position={at} xAnchor={0.5} yAnchor={1} zIndex={8}>
      <span className="here-wrap" role="img" aria-label={loc({ ko: "현위치", en: "You are here" })}>
        <span className="here-pin"><i /></span>
        <span className="here-label" aria-hidden="true">{loc({ ko: "현위치", en: "You're here" })}</span>
      </span>
    </CustomOverlayMap>
  );
}

// 작은 지도의 성북구 경계: 연두 채움 + 점선 테두리 (경계 파일을 못 불러오면 그냥 없이)
let boundaryReq = null;
function DistrictShape() {
  const [rings, setRings] = useState(null);
  useEffect(() => {
    let alive = true;
    boundaryReq ??= fetch("/data/seongbuk-boundary.geojson").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    boundaryReq.then((geo) => {
      const f = geo?.features?.find((x) => x.properties?.kind === "district");
      if (!alive || !f) return;
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      setRings(polys.map((poly) => poly[0].map(([lng, lat]) => ({ lat, lng }))));
    });
    return () => { alive = false; };
  }, []);
  if (!rings) return null;
  return rings.map((path, i) => (
    <Polygon key={i} path={path} fillColor="#E4F0D5" fillOpacity={0.35} strokeColor="#7FB25A" strokeWeight={2} strokeStyle="shortdash" strokeOpacity={1} zIndex={0} />
  ));
}

// ---------- 장소 안내 시트 ----------
// 지도 핀을 누르면 어두운 막 위로 아래에서 올라와요 (하단 탭바도 덮어요).
// 막 누르기 · 아래로 끌기 · X · Esc로 닫혀요. 열리면 X에 포커스, 닫히면 지도 핀으로 돌아가요
// .screen은 isolation: isolate라 그 안에서는 하단 탭바를 덮을 수 없어요. 그래서 화면 바깥(휴대폰 틀, host)에 portal로 띄워요
function PlaceSheet({ p, onClose, host }) {
  const app = useApp();
  const { data } = app;
  const g = groupOf(p);
  const closeBtn = useRef(null);
  const opener = useRef(document.activeElement);
  const [dy, setDy] = useState(0);
  const drag = useRef(null);
  // onClose는 부모가 그릴 때마다 새로 만들어져서, 최신 것을 ref로 들고 있어요 (포커스가 매번 X로 튀지 않게)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    const el = opener.current;
    return () => { window.removeEventListener("keydown", onKey); if (el?.isConnected) el.focus?.(); };
  }, []);
  useEffect(() => { setDy(0); }, [p.id]);

  const down = (e) => { if (e.target.closest("button, a")) return; drag.current = { y: e.clientY, id: e.pointerId }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y)); };
  const up = () => { if (!drag.current) return; drag.current = null; if (dy > 80) onClose(); else setDy(0); };

  const name = loc(p.name).replace(/\s*\(.*\)/, "");
  const kinds = String(p.kind || "").split(/\s*·\s*/).filter(Boolean);
  const dist = p.isDest ? t("ph_dest_self") : fromDest(data, p);
  const dest = p.nearest_course?.dest || (p.isDest ? p.id : null);
  const info = [["visit_fee", p.fee], ["visit_hours", p.hours], ["visit_address", p.address]];
  const run = () => { if (dest) app.setPick({ ...app.pick, dest }); app.go("courses"); };

  const sheet = (
    <div className="ui-layer ph-sheet-layer">
      <div className="ph-sheet-scrim" onClick={onClose} />
      <section className="ph-sheet" role="dialog" aria-modal="true" aria-label={t("ph_sheet_label", { name })}
        style={{ "--c": THEME_COLORS[g], "--soft": SOFT[g], "--deep": DEEP[g], transform: dy ? `translateY(${dy}px)` : undefined, transition: drag.current ? "none" : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span className="ph-sheet-grip" aria-hidden="true" />
        <div className="ph-sheet-head">
          <span className="ph-sheet-ic" aria-hidden="true"><GroupIcon group={g} size={30} /></span>
          <div className="ph-sheet-title">
            <small><b>{t("grp_" + g)}</b>{kinds.map((k) => ` · ${k}`).join("")}</small>
            <h2>{name}</h2>
            {dist && <p>{dist}</p>}
          </div>
          <button type="button" ref={closeBtn} className="ph-sheet-x" onClick={onClose} aria-label={t("close")}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <dl className="ph-sheet-info">
          {info.map(([k, v]) => (
            <div key={k}><dt>{t(k)}</dt><dd className={!v ? "pd-pending" : k === "visit_fee" && isFree(p) ? "free" : ""}>{v || t("info_pending")}</dd></div>
          ))}
        </dl>
        <div className="ph-sheet-actions">
          <a className="ph-sheet-way" href={kakaoDirections(p.name.ko, p.lat, p.lng)} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
            {t("directions")}
          </a>
          <button type="button" className="ph-sheet-run" onClick={run}>{t("ph_sheet_run")} →</button>
        </div>
      </section>
    </div>
  );
  return host ? createPortal(sheet, host) : sheet;
}

// ---------- 코스 따라 보기 ----------
export function PlacesCourse() {
  const app = useApp();
  const { data } = app;
  const st = app.placesView.current;
  const [dest, setDest] = useState(DESTINATIONS.includes(st.dest) ? st.dest : DESTINATIONS[0]);
  const [kind, setKind] = useState(st.kind || "all");
  const course = useMemo(() => shortestCourse(data, dest), [data, dest]);
  const { radius, list: near } = useMemo(() => courseNear(data, course, dest), [data, course, dest]);
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
          <span className="ph-map-tag">{t("ph_course_within", { r: radius, n: near.length })}</span>
        </div>

        <div className="pl-topics scroll ph-chips" role="radiogroup" aria-label={t("ph_kind")}>
          {GROUPS.filter((g) => g === "all" || count[g]).map((g) => (
            <button key={g} type="button" role="radio" data-theme-chip={g} aria-checked={curKind === g} className={`pl-topic ${curKind === g ? "on" : ""}`} onClick={() => setKind(g)}>
              {t(g === "all" ? "ph_all_n" : "grp_" + g)}<span className="chip-n">{count[g] || 0}</span>
            </button>
          ))}
        </div>

        <h2 className="ph-h2">{t("ph_course_near")}</h2>
        {!shown.length && <p className="pl-count">{t("ph_course_none", { r: radius })}</p>}
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

// 코스 근처 둘러볼 곳: 코스 선 위 점들까지 가장 가까운 거리로 재고(목적지 자신은 빼요), 가까운 순.
// 300m 안에 한 곳도 없으면 500m → 800m로 넓혀요. { radius, list: [{ p, d }] }
function courseNear(data, course, dest) {
  if (!course) return { radius: COURSE_RADII[0], list: [] };
  const all = data.explore.filter((p) => p.spot_id !== dest && p.id !== dest)
    .map((p) => ({ p, d: Math.min(...course.path.map((q) => distance(q, p))) }))
    .sort((a, b) => a.d - b.d);
  const radius = COURSE_RADII.find((r) => all.some((x) => x.d <= r)) ?? COURSE_RADII[COURSE_RADII.length - 1];
  return { radius, list: all.filter((x) => x.d <= radius) };
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
