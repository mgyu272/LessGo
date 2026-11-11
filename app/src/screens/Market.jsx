// ⑧ 상권: 코스 근처 동네 가게(식당 · 카페 등) 목록 (shops.json의 카카오맵 조사 자료)
// 위에서부터: "달리고, 들르고 / 동네 상권" + 검색 버튼 → 목적지 고르기(심우장·정릉·의릉·그 외)
// 종류 칩(장소 탭 칩처럼 색·아이콘) → 미니 지도(장소 탭 지도와 같은 모양 · 끌기·확대 · 핀 누르면 가게 카드) → 목적지 고르기(심우장·정릉·의릉·그 외) + 정렬 → 가게 목록.
// 줄을 누르면 홈 지도에서 그 가게를 핀으로 보여주고, 오른쪽 노란 원 버튼은 카카오맵 가게 페이지를 새 창으로 열어요.
// 지도 핀 번호 = 목록 번호예요.

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomOverlayMap, useMap } from "react-kakao-maps-sdk";
import { useApp } from "../state/AppContext.jsx";
import { MapView, Route } from "../components/MapView.jsx";
import { useHere, HerePin } from "./PlacesHub.jsx";
import { loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";
import { destName } from "../lib/places.js";

// 가게 종류: 카카오 분류(예: "음식점 > 카페 > 커피전문점")로 나눠요
const KINDS = [
  ["all", { ko: "전체", en: "All" }],
  ["food", { ko: "식당", en: "Food" }],
  ["cafe", { ko: "카페", en: "Cafés" }],
  ["bar", { ko: "술집", en: "Bars" }],
  ["etc", { ko: "기타", en: "Other" }],
];
const KIND_COLOR = { all: "#2F6512", food: "#E0591F", cafe: "#8A5A2B", bar: "#7A3FB0", etc: "#4F7A3B" };
// 종류 아이콘 (장소 탭 카테고리 아이콘처럼 한 줄 그림): 식당 = 포크·나이프, 카페 = 커피잔, 술집 = 잔, 기타 = 가게
const KIND_ICON = {
  food: <path d="M7 3v7a2 2 0 002 2v9 M5 3v5 M9 3v5 M5 8a2 2 0 002 2 M17 21V3c-2 1.5-3 4-3 7v3h3" />,
  cafe: <path d="M4 9h12v5a5 5 0 01-5 5H9a5 5 0 01-5-5z M16 10h1.5a2.5 2.5 0 010 5H16 M8 3.5v2.5 M12 3.5v2.5" />,
  bar: <path d="M7 4h10l-1 6a4 4 0 01-8 0z M12 14v6 M8.5 20h7" />,
  etc: <path d="M4 9l1.5-5h13L20 9 M4 9h16v11H4z M10 20v-5h4v5" />,
};
export function KindIcon({ kind, size = 16, className = "grp-icon" }) {
  return <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{KIND_ICON[kind] || KIND_ICON.etc}</svg>;
}
function kindOf(s) {
  const c = s.category || "";
  if (c.includes("카페") || c.includes("제과") || c.includes("간식")) return "cafe";
  if (c.includes("술집")) return "bar";
  if (c.startsWith("음식점")) return "food";
  return "etc";
}
// 상권에 넣지 않는 것: 주차장, 상인회 같은 단체
const isStore = (s) => s.id.startsWith("kakao-") && !/주차장|단체,협회/.test(s.category || "");
// 분류는 큰 갈래 하나만 보여줘요 ("음식점 > 한식 > 국수" → "한식")
export const catLabel = (s) => ((s.category || "").split(">")[1] || "").trim().replace(/,/g, "·");
// 주소는 "서울 성북구"를 빼고 짧게 ("서울 성북구 성북로31길 9" → "성북로31길 9")
const shortAddr = (a) => (a || "").replace(/^서울(특별시)?\s*성북구\s*/, "").trim();

// 코스 목적지 (탭 순서)
const DESTS = ["simujang", "jeongneung", "uiryeong"];
// 가게가 속한 탭: 코스 목적지 근처가 아니면 "그 외"
const destOf = (s) => (DESTS.includes(s.near) ? s.near : "explore");
const placeName = (p) => loc(p.name).replace(/\s*\(.*\)/, "");
const WALK_M = 67; // 걸음 67m/분
// "{이름}에서 도보 N분" (최소 1분). 좌표가 없으면 "{이름} 근처"
function walkFrom(name, place, shop) {
  if (!name) return null;
  if (!place || place.lat == null || shop.lat == null) return loc({ ko: `${name} 근처`, en: `Near ${name}` });
  const min = Math.max(1, Math.round(distance(place, shop) / WALK_M));
  return loc({ ko: `${name}에서 도보 ${min}분`, en: `${min} min walk from ${name}` });
}

export default function Market() {
  const app = useApp();
  const { data } = app;
  const [dest, setDest] = useState(DESTS[0]);
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("near");
  const [query] = useState(""); // (가게 검색은 없앴어요. 머리의 ? 버튼은 가게 고른 기준 안내)
  const [bigMap, setBigMap] = useState(false);
  const [info, setInfo] = useState(false);
  const infoBtn = useRef(null);
  const bigBtn = useRef(null);

  const stores = useMemo(() => (data.shops || []).filter(isStore), [data.shops]);
  // 목적지 칸 숫자
  const destCount = useMemo(() => {
    const n = {};
    stores.forEach((s) => { const d = destOf(s); n[d] = (n[d] || 0) + 1; });
    return n;
  }, [stores]);
  const inDest = useMemo(() => stores.filter((s) => destOf(s) === dest), [stores, dest]);
  // 고른 목적지 안의 종류별 숫자 (칩 · 지도 범례)
  const count = useMemo(() => {
    const n = { all: inDest.length };
    inDest.forEach((s) => { const k = kindOf(s); n[k] = (n[k] || 0) + 1; });
    return n;
  }, [inDest]);
  // 고른 종류가 이 목적지에 없으면 전체로 보여줘요
  const curKind = kind === "all" || count[kind] ? kind : "all";

  // 그 외 묶음: 가게마다 가장 가까운 둘러볼 곳 (거리·도보 배지에 써요)
  const nearestPlace = (s) => {
    const places = (s.near_places || []).map((id) => data.placeById?.[id] || data.spotById[id]).filter(Boolean);
    const withPos = places.filter((p) => p.lat != null && p.lng != null && s.lat != null);
    if (withPos.length) return withPos.reduce((a, b) => (distance(a, s) <= distance(b, s) ? a : b));
    return places[0] || null;
  };
  const distKey = (s) => {
    const from = dest === "explore" ? nearestPlace(s) : data.spotById[dest];
    return from && from.lat != null && s.lat != null ? distance(from, s) : Infinity;
  };
  const walkLabel = (s) => {
    if (dest !== "explore") return walkFrom(destName(data, dest), data.spotById[dest], s);
    const p = nearestPlace(s);
    return p ? walkFrom(placeName(p), p, s) : null;
  };

  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    const out = inDest
      .filter((s) => curKind === "all" || kindOf(s) === curKind)
      .filter((s) => !q || [loc(s.name), s.category, s.address].some((x) => String(x || "").toLowerCase().includes(q)));
    return sort === "name"
      ? [...out].sort((a, b) => loc(a.name).localeCompare(loc(b.name), "ko"))
      : [...out].sort((a, b) => distKey(a) - distKey(b));
  }, [inDest, curKind, q, sort, dest, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 미니 지도 코스 선: 그 목적지의 가장 짧은 코스 (그 외는 코스 없이 가게만)
  const course = useMemo(() => (dest === "explore" ? null
    : data.courses.filter((c) => c.properties.dest === dest).sort((a, b) => a.properties.distance_km - b.properties.distance_km)[0] || null), [data, dest]);

  const tabName = (d) => (d === "explore" ? loc({ ko: "그 외", en: "Others" }) : destName(data, d));
  // 줄을 누르면 홈 지도로 가서 그 가게를 핀으로 보여줘요
  const showOnMap = (s) => { app.setMapShop(s); app.go("home"); };
  const closeBig = () => { setBigMap(false); bigBtn.current?.focus(); };
  const legend = KINDS.filter(([k]) => k !== "all" && count[k]);
  // 지도 핀: 목록 번호 그대로. 좌표가 없는 가게는 지도에서 빼요 (좌표를 지어내지 않아요)
  const pins = useMemo(() => list.map((shop, i) => ({ shop, no: i + 1 })).filter(({ shop }) => shop.lat != null && shop.lng != null), [list]);
  const missing = useMemo(() => list.filter((s) => s.lat == null || s.lng == null), [list]);
  const describe = (s) => ({ cat: catLabel(s), walk: walkLabel(s) });
  // 미니 지도에서 누른 핀 (목적지 · 종류를 바꾸면 지워요)
  const [picked, setPicked] = useState(null);
  useEffect(() => { setPicked(null); }, [dest, curKind]);
  const miniSel = pins.find((x) => x.shop.id === picked) || null;

  return (
    <section className="screen places-screen market-screen mk2">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll mk2-scroll">
        <header className="mk2-head">
          <div>
            <small>{loc({ ko: "달리고, 들르고", en: "Run, then stop by" })}</small>
            <h1>{loc({ ko: "동네 상권", en: "Local shops" })}</h1>
          </div>
          <button type="button" ref={infoBtn} className="mk2-search-btn mk2-info-btn" onClick={() => setInfo((v) => !v)}
            aria-label={loc({ ko: "가게를 고른 기준", en: "How we picked these shops" })} aria-expanded={info} aria-controls="mk2-criteria">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.2 9.2a2.9 2.9 0 015.6 1c0 1.9-2.8 2.5-2.8 4.3 M12 18.3v.1" /></svg>
          </button>
          {info && <CriteriaPopover anchor={infoBtn} onClose={() => { setInfo(false); infoBtn.current?.focus(); }} />}
        </header>

        <div className="ph-hub-chips ph2-chips mk2-kchips" role="radiogroup" aria-label={loc({ ko: "가게 종류", en: "Shop type" })}>
          {KINDS.filter(([k]) => k === "all" || count[k]).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={curKind === k} className={`ph2-chip ${curKind === k ? "on" : ""}`}
              style={{ "--c": KIND_COLOR[k] }} onClick={() => setKind(k)}>
              {k !== "all" && <KindIcon kind={k} />}{loc(label)}<span className="chip-n">{count[k] || 0}</span>
            </button>
          ))}
        </div>

        {/* 미니 지도: 장소 탭 지도와 같은 모양 (왼쪽 위 "전체 N곳" · 오른쪽 위 크게 보기 · 왼쪽 아래 핀 안내). 끌기·확대 · 핀 누르기 돼요 */}
        <div className="mk2-map mk2-map-mini" style={{ "--c": KIND_COLOR[curKind] }}>
          <ShopMap pins={pins} course={course} interactive pad={[52, 30, 44, 30]} picked={picked} onPick={(s) => setPicked((v) => (v === s.id ? null : s.id))} />
          <span className="ph-map-tag mk2-map-tag"><i aria-hidden="true" />{loc({ ko: `${loc(KINDS.find(([k]) => k === curKind)[1])} ${list.length}곳`, en: `${loc(KINDS.find(([k]) => k === curKind)[1])} ${list.length}` })}</span>
          <button type="button" ref={bigBtn} className="mk2-big-ic" onClick={() => setBigMap(true)} aria-haspopup="dialog" aria-label={loc({ ko: "지도 크게 보기", en: "Bigger map" })}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </button>
          {miniSel ? (
            <div className="mk2-pick mk2-pick-mini" aria-live="polite">
              <button type="button" className="mk2-pick-main" onClick={() => showOnMap(miniSel.shop)}
                aria-label={loc({ ko: `${miniSel.no}. ${loc(miniSel.shop.name)} 지도에서 보기`, en: `${miniSel.no}. Show ${loc(miniSel.shop.name)} on the map` })}>
                <span className="mk2-no" style={{ background: KIND_COLOR[kindOf(miniSel.shop)] }}>{miniSel.no}</span>
                <span className="mk2-text">
                  <b>{loc(miniSel.shop.name)}</b>
                  {walkLabel(miniSel.shop) && <span className="mk2-walk">{walkLabel(miniSel.shop)}</span>}
                </span>
              </button>
              {miniSel.shop.kakao_url && (
                <a className="mk2-kakao" href={miniSel.shop.kakao_url.replace(/^http:/, "https:")} target="_blank" rel="noopener noreferrer"
                  aria-label={loc({ ko: `${loc(miniSel.shop.name)} 카카오맵에서 열기`, en: `Open ${loc(miniSel.shop.name)} in Kakao Map` })}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 6h10v10 M18 6L6 18" /></svg>
                </a>
              )}
              <button type="button" className="mk2-pick-x" onClick={() => setPicked(null)} aria-label={loc({ ko: "닫기", en: "Close" })}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          ) : (
            <span className="ph2-hint" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V5a1.6 1.6 0 013.2 0v5 M12.2 9.5a1.6 1.6 0 013.2 0V11 M15.4 10.5a1.6 1.6 0 013.2 0v3.5a6 6 0 01-6 6h-1a6 6 0 01-4.7-2.3l-2.3-3a1.6 1.6 0 012.5-2L9 15" /></svg>
              {loc({ ko: "핀을 누르면 안내가 떠요", en: "Tap a pin for details" })}
            </span>
          )}
        </div>

        <div className="mk2-seg" role="radiogroup" aria-label={loc({ ko: "어디 근처", en: "Near" })}>
          {[...DESTS, "explore"].map((d) => (
            <button key={d} type="button" role="radio" aria-checked={dest === d} className={dest === d ? "on" : ""} onClick={() => setDest(d)}>
              {tabName(d)} <b>{destCount[d] || 0}</b>
            </button>
          ))}
        </div>
        <div className="mk2-tools">
          <label className="mk2-sort">
            <span className="sr-only">{loc({ ko: "정렬", en: "Sort" })}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="near">{loc({ ko: "가까운 순", en: "Nearest" })}</option>
              <option value="name">{loc({ ko: "이름순", en: "By name" })}</option>
            </select>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </label>
        </div>

        <ol className="mk2-list">
          {!list.length && <li className="mk2-empty">{loc({ ko: "조건에 맞는 가게가 없어요", en: "No shops match" })}</li>}
          {list.map((s, i) => {
            const k = kindOf(s);
            const cat = catLabel(s);
            const addr = shortAddr(s.address);
            const walk = walkLabel(s);
            return (
              <li key={s.id} className="mk2-row">
                <button type="button" className="mk2-main" onClick={() => showOnMap(s)}
                  aria-label={loc({ ko: `${i + 1}. ${loc(s.name)} 지도에서 보기`, en: `${i + 1}. Show ${loc(s.name)} on the map` })}>
                  <span className={`mk2-tile ${k}`} aria-hidden="true">
                    <ShopTile shop={s} kind={k} />
                    <span className="mk2-no">{i + 1}</span>
                  </span>
                  <span className="mk2-text">
                    <b className="mk2-name-link">{loc(s.name)}</b>
                    {(cat || addr) && (
                      <span className="mk2-meta">
                        {cat && <span style={{ color: KIND_COLOR[k] }}>{cat}</span>}
                        {cat && addr && <i aria-hidden="true" />}
                        {addr && <span className="mk2-addr">{addr}</span>}
                      </span>
                    )}
                    {walk && (
                      <span className="mk2-walk">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8" /><path d="M10 21l2-6 3 3v3 M7.5 12.5l2-4.5h4l2.5 4h2.5 M12 8l-1.5 7" /></svg>
                        {walk}
                      </span>
                    )}
                  </span>
                </button>
                {s.kakao_url && (
                  <a className="mk2-kakao" href={s.kakao_url.replace(/^http:/, "https:")} target="_blank" rel="noopener noreferrer"
                    aria-label={loc({ ko: `${loc(s.name)} 카카오맵에서 열기`, en: `Open ${loc(s.name)} in Kakao Map` })}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 6h10v10 M18 6L6 18" /></svg>
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {bigMap && <BigMap pins={pins} missing={missing} course={course} title={tabName(dest)} legend={legend} count={count} describe={describe} onClose={closeBig} />}
    </section>
  );
}

// 가게 타일: 카카오맵 사진이 있으면 사진, 없거나 못 불러오면 종류 아이콘 (식당 = 수저, 카페 = 커피잔)
function ShopTile({ shop, kind }) {
  const [broken, setBroken] = useState(false);
  if (shop.image && !broken) return <img src={shop.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  return kind === "cafe"
    ? <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h12v5a5 5 0 01-5 5H9a5 5 0 01-5-5z M16 10h1.5a2.5 2.5 0 010 5H16 M8 3.5v2.5 M12 3.5v2.5" /></svg>
    : <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v7a2 2 0 002 2v9 M5 3v5 M9 3v5 M5 8a2 2 0 002 2 M17 21V3c-2 1.5-3 4-3 7v3h3" /></svg>;
}

// 가게 지도 (카카오 지도 · 장소 탭과 같은 MapView 부품): 코스 경로(연두 띠 위 초록 선) + 출발 흰 원 · 도착 초록 원 + 번호 핀.
// 핀 번호 = 아래 목록 번호. 화면에서 핀이 붙으면 2개는 옆으로 살짝 띄우고, 3개 이상은 숫자 묶음 핀으로 보여줘요.
// interactive={false}면 미리보기(끌기·확대 막음, 화면 스크롤을 가로채지 않게 손가락 이벤트도 지도에 안 줘요)
const GROUP_PX = 20; // 핀 중심이 이보다 가까우면 겹친다고 봐요
function ShopMap({ pins, course, interactive = false, pad = [16, 16, 16, 16], picked, onPick }) {
  // 지도 범위: 코스 경로 + 가게 좌표가 모두 보이게
  const fit = useMemo(() => {
    const path = course ? course.path.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 80)) === 0 || i === a.length - 1) : [];
    return [...path.map((p) => [p.lat, p.lng]), ...pins.map(({ shop }) => [shop.lat, shop.lng])];
  }, [course, pins]);
  const fitKey = `${course?.id || "none"}:${pins.map((x) => x.shop.id).join(",")}`;
  const start = course?.path[0], end = course?.path[course.path.length - 1];
  const [top, right, bottom, left] = pad;
  const here = useHere(); // 내 위치 빨간 핀 (지도 범위에는 넣지 않아요)
  return (
    <MapView className={`mk2-kmap ${interactive ? "" : "locked"}`} interactive={interactive}>
      {course && <Route path={course.path} color="#9FD25E" weight={14} opacity={0.35} zIndex={1} />}
      {course && <Route path={course.path} color="#2F6512" weight={4} opacity={1} zIndex={2} />}
      {start && <CustomOverlayMap position={{ lat: start.lat, lng: start.lng }} xAnchor={0.5} yAnchor={0.5} zIndex={3}><span className="mk2-pt start" aria-hidden="true" /></CustomOverlayMap>}
      {end && <CustomOverlayMap position={{ lat: end.lat, lng: end.lng }} xAnchor={0.5} yAnchor={0.5} zIndex={3}><span className="mk2-pt end" aria-hidden="true" /></CustomOverlayMap>}
      <ShopPins pins={pins} interactive={interactive} picked={picked} onPick={onPick} />
      {here && <HerePin at={here} />}
      <FitAll points={fit} pad={[top, right, bottom, left]} fitKey={fitKey} />
    </MapView>
  );
}

// 지도 범위를 코스 + 가게에 맞춰요 (LatLngBounds → setBounds). 시트가 올라오는 동안 지도 칸 크기가 바뀌어서
// 열리고 조금 뒤에 한 번 더 맞춰요
function FitAll({ points, pad, fitKey }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return undefined;
    const { kakao } = window;
    const run = () => {
      if (points.length === 1) { map.setCenter(new kakao.maps.LatLng(points[0][0], points[0][1])); return; }
      const b = new kakao.maps.LatLngBounds();
      points.forEach(([lat, lng]) => b.extend(new kakao.maps.LatLng(lat, lng)));
      map.relayout();
      map.setBounds(b, pad[0], pad[1], pad[2], pad[3]);
    };
    run();
    const timer = setTimeout(run, 380);
    return () => clearTimeout(timer);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// 번호 핀 묶기: 지금 화면 좌표로 가까운 핀끼리 모아요 (지도를 움직이거나 확대하면 다시 계산)
function ShopPins({ pins, interactive, picked, onPick }) {
  const map = useMap();
  const [view, setView] = useState(0);
  useEffect(() => {
    const { kakao } = window;
    const bump = () => setView((v) => v + 1);
    kakao.maps.event.addListener(map, "idle", bump);
    return () => kakao.maps.event.removeListener(map, "idle", bump);
  }, [map]);
  const groups = useMemo(() => {
    const { kakao } = window;
    const proj = map.getProjection();
    const out = [];
    pins.forEach((pin) => {
      const pt = proj.containerPointFromCoords(new kakao.maps.LatLng(pin.shop.lat, pin.shop.lng));
      const g = out.find((x) => Math.hypot(x.x - pt.x, x.y - pt.y) < GROUP_PX);
      if (g) { g.items.push(pin); g.x = (g.x * (g.items.length - 1) + pt.x) / g.items.length; g.y = (g.y * (g.items.length - 1) + pt.y) / g.items.length; }
      else out.push({ x: pt.x, y: pt.y, items: [pin] });
    });
    return out;
  }, [pins, map, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomTo = (g) => {
    const { kakao } = window;
    const b = new kakao.maps.LatLngBounds();
    g.items.forEach(({ shop }) => b.extend(new kakao.maps.LatLng(shop.lat, shop.lng)));
    map.setBounds(b, 60, 60, 60, 60);
    if (map.getLevel() > 1 && g.items.every(({ shop }) => shop.lat === g.items[0].shop.lat && shop.lng === g.items[0].shop.lng)) map.setLevel(1);
  };

  return groups.flatMap((g) => {
    if (g.items.length >= 3) {
      const lat = g.items.reduce((a, { shop }) => a + shop.lat, 0) / g.items.length;
      const lng = g.items.reduce((a, { shop }) => a + shop.lng, 0) / g.items.length;
      const label = loc({ ko: `가게 ${g.items.length}곳 (${g.items.map((x) => x.no).join(", ")}번)`, en: `${g.items.length} shops (#${g.items.map((x) => x.no).join(", ")})` });
      const Tag = interactive ? "button" : "span";
      return [(
        <CustomOverlayMap key={`g-${g.items[0].shop.id}`} position={{ lat, lng }} xAnchor={0.5} yAnchor={0.5} zIndex={5} clickable={interactive}>
          <Tag {...(interactive ? { type: "button", onClick: () => zoomTo(g), "aria-label": label } : { "aria-hidden": true })} className="mk2-pin mk2-pin-group">{g.items.length}</Tag>
        </CustomOverlayMap>
      )];
    }
    // 2개가 붙으면 옆으로 10px씩 띄워서 번호가 읽히게
    return g.items.map((pin, i) => {
      const dx = g.items.length === 2 ? (i === 0 ? -10 : 10) : 0;
      const on = picked === pin.shop.id;
      const Tag = interactive ? "button" : "span";
      return (
        <CustomOverlayMap key={pin.shop.id} position={{ lat: pin.shop.lat, lng: pin.shop.lng }} xAnchor={0.5} yAnchor={1} zIndex={on ? 7 : 6} clickable={interactive}>
          <Tag {...(interactive ? { type: "button", onClick: () => onPick?.(pin.shop), "aria-label": `${pin.no}. ${loc(pin.shop.name)}`, "aria-pressed": on } : { "aria-hidden": true })}
            className={`mk2-pin mk2-ipin ${on ? "on" : ""}`} style={{ "--c": KIND_COLOR[kindOf(pin.shop)], transform: `translateX(${dx}px)` }}>
            <span className="mk2-ipin-body"><KindIcon kind={kindOf(pin.shop)} size={12} className="mk2-ipin-ic" /></span>
            <span className="mk2-ipin-no">{pin.no}</span>
          </Tag>
        </CustomOverlayMap>
      );
    });
  });
}

// "지도 크게": 전체 높이 시트 안 지도 (끌기·확대 돼요). 핀을 누르면 가게 카드(이름 · 종류 · 도보 · 카카오맵)가 떠요.
// 막 · 닫기 · Esc로 닫혀요
function BigMap({ pins, missing, course, title, legend, count, describe, onClose }) {
  const closeBtn = useRef(null);
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sel = pins.find((x) => x.shop.id === picked);
  const info = sel ? describe(sel.shop) : null;
  return (
    <div className="ui-layer">
      <div className="ui-scrim" onClick={onClose} />
      <section className="ui-optsheet mk2-bigsheet rise" role="dialog" aria-modal="true" aria-label={loc({ ko: `${title} 근처 가게 지도`, en: `Map of shops near ${title}` })}>
        <div className="mk2-bighead">
          <h2>{loc({ ko: `${title} 근처 가게`, en: `Shops near ${title}` })}</h2>
          <button type="button" ref={closeBtn} className="mk2-x" onClick={onClose} aria-label={loc({ ko: "닫기", en: "Close" })}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="mk2-map mk2-map-big">
          <ShopMap pins={pins} course={course} interactive pad={[40, 24, 48, 24]} picked={picked} onPick={(s) => setPicked(s.id)} />
          <span className="mk2-legend">
            {legend.map(([k, label]) => (
              <span key={k}><i style={{ background: KIND_COLOR[k] }} aria-hidden="true" />{loc(label)} {count[k]}</span>
            ))}
          </span>
        </div>
        {sel ? (
          <div className="mk2-pick" aria-live="polite">
            <span className="mk2-no" style={{ background: KIND_COLOR[kindOf(sel.shop)] }}>{sel.no}</span>
            <span className="mk2-text">
              <b>{loc(sel.shop.name)}</b>
              {info.cat && <span className="mk2-meta"><span style={{ color: KIND_COLOR[kindOf(sel.shop)] }}>{info.cat}</span></span>}
              {info.walk && <span className="mk2-walk">{info.walk}</span>}
            </span>
            {sel.shop.kakao_url && (
              <a className="mk2-kakao" href={sel.shop.kakao_url.replace(/^http:/, "https:")} target="_blank" rel="noopener noreferrer"
                aria-label={loc({ ko: `${loc(sel.shop.name)} 카카오맵에서 열기`, en: `Open ${loc(sel.shop.name)} in Kakao Map` })}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 6h10v10 M18 6L6 18" /></svg>
              </a>
            )}
          </div>
        ) : (
          <p className="mk2-pick-hint">{loc({ ko: "핀을 누르면 가게 정보가 떠요", en: "Tap a pin to see the shop" })}</p>
        )}
        {missing.length > 0 && (
          <p className="mk2-missing">{loc({ ko: `위치 정보가 없어 지도에 없는 가게: ${missing.map((s) => loc(s.name)).join(", ")}`, en: `Not on the map (no location): ${missing.map((s) => loc(s.name)).join(", ")}` })}</p>
        )}
      </section>
    </div>
  );
}

// 머리의 ? 버튼 아래에 뜨는 작은 안내 창: 가게를 어떻게 골랐는지 (shops.json 조사 자료 기준)
// X · Esc · 바깥 누르기로 닫혀요
function CriteriaPopover({ anchor, onClose }) {
  const box = useRef(null);
  useEffect(() => {
    box.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onDown = (e) => { if (!box.current?.contains(e.target) && !anchor.current?.contains(e.target)) onClose(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [anchor, onClose]);
  return (
    <div ref={box} id="mk2-criteria" className="mk2-pop" role="dialog" aria-labelledby="mk2-pop-title" tabIndex={-1}>
      <div className="mk2-pop-head">
        <h2 id="mk2-pop-title">{loc({ ko: "가게는 이렇게 골랐어요", en: "How we picked these shops" })}</h2>
        <button type="button" className="mk2-pop-x" onClick={onClose} aria-label={loc({ ko: "닫기", en: "Close" })}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <ul>
        <li>{loc({ ko: "코스 도착지(심우장·정릉·의릉)와 둘러볼 곳 근처 가게를 팀이 직접 조사해서 골랐어요 (2026년 10~11월 상권 조사)", en: "Our team surveyed and picked shops near the course finishes (Simujang, Jeongneung, Uireung) and places to explore (Oct–Nov 2026)" })}</li>
        <li>{loc({ ko: "주차장이나 상인회 같은 곳은 빼고, 들러서 먹고 마실 수 있는 가게만 넣었어요", en: "Parking lots and associations are left out — only places to eat and drink" })}</li>
        <li>{loc({ ko: "이름·종류·주소·사진은 카카오맵 자료예요", en: "Names, types, addresses and photos come from Kakao Map" })}</li>
        <li>{loc({ ko: "도보 시간은 목적지에서 가게까지 직선거리로 잰 대략적인 시간이에요", en: "Walking times are rough, based on straight-line distance from the destination" })}</li>
        <li>{loc({ ko: "아직 제휴 가게가 아니라 쿠폰은 없어요", en: "These aren't partner shops yet, so there are no coupons" })}</li>
      </ul>
    </div>
  );
}

// 카카오맵 대표 사진. 못 불러오면 가게 종류 그림으로 바꿔요 (보상 가게 · 근처 가게에서 써요)
export function ShopPhoto({ shop }) {
  const [broken, setBroken] = useState(false);
  if (!shop.image || broken) {
    return (
      <span className="mk-photo mk-photo-empty" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9l1.5-5h13L20 9 M4 9h16v11H4z M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0 2.7 2.7 0 005.3 0 M10 20v-5h4v5" /></svg>
      </span>
    );
  }
  return <img className="mk-photo" src={shop.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

// 카카오맵으로 가는 작은 아이콘 (노란 바탕 + 지도 핀)
export function KakaoMapIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#FEE500" />
      <path d="M16 25s7-6.7 7-11.6A7 7 0 009 13.4C9 18.3 16 25 16 25z" fill="#3C1E1E" />
      <circle cx="16" cy="13.4" r="2.6" fill="#FEE500" />
    </svg>
  );
}
