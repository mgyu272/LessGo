// ⑧ 상권: 코스 근처 동네 가게(식당 · 카페 등) 목록 (shops.json의 카카오맵 조사 자료)
// 위에서부터: "달리고, 들르고 / 동네 상권" + 검색 버튼 → 목적지 고르기(심우장·정릉·의릉·그 외)
// → 미니 지도(코스 선 + 번호 핀) → 종류 칩 + 정렬 → 가게 목록(흰 패널 없이 줄마다 구분선).
// 줄을 누르면 홈 지도에서 그 가게를 핀으로 보여주고, 오른쪽 노란 원 버튼은 카카오맵 가게 페이지를 새 창으로 열어요.
// 지도 핀 번호 = 목록 번호예요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
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
const KIND_COLOR = { food: "#C2410C", cafe: "#7A4A22", bar: "#4F6B3B", etc: "#4F6B3B" };
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
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [bigMap, setBigMap] = useState(false);
  const searchInput = useRef(null);
  const bigBtn = useRef(null);
  useEffect(() => { if (search) searchInput.current?.focus(); }, [search]);

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

  return (
    <section className="screen places-screen market-screen mk2">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll mk2-scroll">
        <header className="mk2-head">
          <div>
            <small>{loc({ ko: "달리고, 들르고", en: "Run, then stop by" })}</small>
            <h1>{loc({ ko: "동네 상권", en: "Local shops" })}</h1>
          </div>
          <button type="button" className="mk2-search-btn" onClick={() => { setSearch((v) => !v); if (search) setQuery(""); }}
            aria-label={loc({ ko: "가게 검색", en: "Search shops" })} aria-expanded={search}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
          </button>
        </header>
        {search && (
          <input ref={searchInput} className="mk2-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={loc({ ko: "가게 이름 · 종류 · 주소", en: "Name, type or address" })} aria-label={loc({ ko: "가게 검색", en: "Search shops" })} />
        )}

        <div className="mk2-seg" role="radiogroup" aria-label={loc({ ko: "어디 근처", en: "Near" })}>
          {[...DESTS, "explore"].map((d) => (
            <button key={d} type="button" role="radio" aria-checked={dest === d} className={dest === d ? "on" : ""} onClick={() => setDest(d)}>
              {tabName(d)} <b>{destCount[d] || 0}</b>
            </button>
          ))}
        </div>

        <div className="mk2-map">
          <ShopMap shops={list} course={course} height={132} />
          <span className="mk2-legend">
            {legend.map(([k, label]) => (
              <span key={k}><i style={{ background: KIND_COLOR[k] }} aria-hidden="true" />{loc(label)} {count[k]}</span>
            ))}
          </span>
          <button type="button" ref={bigBtn} className="mk2-big" onClick={() => setBigMap(true)} aria-haspopup="dialog">
            {loc({ ko: "지도 크게", en: "Bigger map" })} <span aria-hidden="true">›</span>
          </button>
        </div>

        <div className="mk2-tools">
          <div className="mk2-kinds" role="radiogroup" aria-label={loc({ ko: "가게 종류", en: "Shop type" })}>
            {KINDS.filter(([k]) => k === "all" || count[k]).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={curKind === k} className={curKind === k ? "on" : ""} onClick={() => setKind(k)}>
                {loc(label)} {count[k]}
              </button>
            ))}
          </div>
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
                    <b>{loc(s.name)}</b>
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
      {bigMap && <BigMap shops={list} course={course} title={tabName(dest)} legend={legend} count={count} onClose={closeBig} />}
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

// 미니 지도 (실제 좌표 → SVG): 점무늬 바탕 + 코스 선(연두 띠 위 초록 선, 출발 흰 원 · 도착 초록 원) + 번호 핀.
// 핀이 겹치면 서로 살짝 밀어서 띄워요. 지도 타일 없이 그려서 가볍고 바로 떠요
function ShopMap({ shops, course, height }) {
  const box = useRef(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 아래쪽은 범례 칩·"지도 크게" 버튼 자리(약 40px)라 핀이 거기 가리지 않게 비워요
  const R = 9, PAD = 16, PAD_B = height > 200 ? 52 : 50;
  const geo = useMemo(() => {
    const path = course ? course.path.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0 || i === a.length - 1) : [];
    const pts = [...path, ...shops.filter((s) => s.lat != null)];
    if (!pts.length) return null;
    const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = pts.map((p) => p.lng * kx), ys = pts.map((p) => -p.lat);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((w - PAD * 2) / Math.max(x1 - x0, 1e-6), (height - PAD - PAD_B) / Math.max(y1 - y0, 1e-6));
    const ox = (w - (x1 - x0) * s) / 2, oy = PAD + (height - PAD - PAD_B - (y1 - y0) * s) / 2;
    const at = (p) => [ox + (p.lng * kx - x0) * s, oy + (-p.lat - y0) * s];
    // 핀 위치: 겹치면 서로 밀어내요 (지도 칸 안에서)
    const pins = shops.filter((x) => x.lat != null).map((x) => ({ shop: x, no: shops.indexOf(x) + 1, p: at(x) }));
    for (let it = 0; it < 40; it++) {
      for (let a = 0; a < pins.length; a++) for (let b = a + 1; b < pins.length; b++) {
        const [ax, ay] = pins[a].p, [bx, by] = pins[b].p;
        const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 0.01, min = R * 2 + 2;
        if (d < min) {
          const push = (min - d) / 2, ux = d > 0.02 ? dx / d : 1, uy = d > 0.02 ? dy / d : 0;
          pins[a].p = [ax - ux * push, ay - uy * push];
          pins[b].p = [bx + ux * push, by + uy * push];
        }
      }
      pins.forEach((q) => { q.p = [Math.min(w - R - 2, Math.max(R + 2, q.p[0])), Math.min(height - PAD_B + R, Math.max(R + 2, q.p[1]))]; });
    }
    return { line: path.map((p) => at(p).map((v) => v.toFixed(1)).join(",")).join(" "), start: path[0] && at(path[0]), end: path.length > 1 && at(path[path.length - 1]), pins };
  }, [shops, course, w, height]);

  return (
    <div ref={box} className="mk2-mapbox" style={{ height }}>
      {geo && (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true">
          {geo.line && <polyline points={geo.line} fill="none" stroke="#9FD25E" strokeOpacity=".35" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />}
          {geo.line && <polyline points={geo.line} fill="none" stroke="#2F6512" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
          {geo.start && <circle cx={geo.start[0]} cy={geo.start[1]} r="5.5" fill="#FFFFFF" stroke="#2F6512" strokeWidth="2.5" />}
          {geo.end && <circle cx={geo.end[0]} cy={geo.end[1]} r="6.5" fill="#2F6512" stroke="#FFFFFF" strokeWidth="2.5" />}
          {geo.pins.map(({ shop, no, p }) => (
            <g key={shop.id} transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`}>
              <circle r={R} fill={KIND_COLOR[kindOf(shop)]} stroke="#FFFFFF" strokeWidth="2" />
              <text y="3.6" textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#FFFFFF">{no}</text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

// "지도 크게": 같은 지도를 크게 보여주는 창 (막 · 닫기 · Esc로 닫혀요)
function BigMap({ shops, course, title, legend, count, onClose }) {
  const closeBtn = useRef(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
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
          <ShopMap shops={shops} course={course} height={360} />
          <span className="mk2-legend">
            {legend.map(([k, label]) => (
              <span key={k}><i style={{ background: KIND_COLOR[k] }} aria-hidden="true" />{loc(label)} {count[k]}</span>
            ))}
          </span>
        </div>
        <ol className="mk2-biglist">
          {shops.map((s, i) => <li key={s.id}><span className="mk2-no" style={{ background: KIND_COLOR[kindOf(s)] }}>{i + 1}</span>{loc(s.name)}</li>)}
        </ol>
      </section>
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
