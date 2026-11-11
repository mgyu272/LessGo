// ⑧ 상권: 코스 근처 동네 가게(식당 · 카페 · 술집 등) 목록 (shops.json의 카카오맵 조사 자료)
// 장소와 이야기 화면과 같은 카드 모양. 왼쪽에 카카오맵 대표 사진, 아래로 쭉 스크롤해서 봐요.
// 목적지(심우장·정릉·의릉)와 둘러볼 곳 근처로 묶어서 보여줘요.
// 사진·이름을 누르면 홈 지도에서 그 가게를 핀으로 보여주고, 오른쪽 노란 카카오맵 버튼은 카카오맵 가게 페이지를 열어요.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, MAIN } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";
import { destName } from "../lib/places.js";
import { Badge } from "../components/ui.jsx";
import { useKnownPosition } from "./Places.jsx";

// 상권 칩: 카카오 분류(예: "음식점 > 카페 > 커피전문점")로 나눠요
const KINDS = [
  ["all", { ko: "전체", en: "All" }],
  ["food", { ko: "식당", en: "Food" }],
  ["cafe", { ko: "카페", en: "Cafés" }],
  ["bar", { ko: "술집", en: "Bars" }],
  ["etc", { ko: "기타", en: "Other" }],
];
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

// 코스 목적지 (이 순서로 묶어요)
const DESTS = ["simujang", "jeongneung", "uiryeong"];
const placeName = (p) => loc(p.name).replace(/\s*\(.*\)/, "");
// "{이름}에서 도보 N분" (걸음 67m/분, 최소 1분). 좌표가 없으면 "{이름} 근처"
function walkFrom(name, place, shop) {
  if (!name) return null;
  if (!place || place.lat == null || shop.lat == null) return loc({ ko: `${name} 근처`, en: `Near ${name}` });
  const min = Math.max(1, Math.round(distance(place, shop) / 67));
  return loc({ ko: `${name}에서 도보 ${min}분`, en: `${min} min walk from ${name}` });
}

export default function Market() {
  const app = useApp();
  const { data } = app;
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const here = useKnownPosition();

  const stores = useMemo(() => (data.shops || []).filter(isStore), [data.shops]);
  const count = useMemo(() => {
    const n = { all: stores.length };
    stores.forEach((s) => { const k = kindOf(s); n[k] = (n[k] || 0) + 1; });
    return n;
  }, [stores]);
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return stores.filter((s) => kind === "all" || kindOf(s) === kind)
      .filter((s) => !qq || [s.name.ko, s.name.en, s.category, s.address].some((x) => (x || "").toLowerCase().includes(qq)));
  }, [stores, kind, q]);

  // 목적지별로 묶어요: 심우장 → 정릉 → 의릉 → 둘러볼 곳 (빈 묶음은 숨겨요)
  const groups = useMemo(() => {
    const keyOf = (s) => (DESTS.includes(s.near) ? s.near : "explore");
    return [...DESTS, "explore"].map((key) => {
      const shops = list.filter((s) => keyOf(s) === key);
      const name = key === "explore" ? null : destName(data, key);
      const title = key === "explore"
        ? loc({ ko: `둘러볼 곳 근처 · ${shops.length}곳`, en: `Near places to explore · ${shops.length}` })
        : loc({ ko: `${name} 근처 · ${shops.length}곳`, en: `Near ${name} · ${shops.length}` });
      return { key, title, shops };
    }).filter((g) => g.shops.length);
  }, [list, data]);

  // 카드의 거리: 목적지 묶음은 목적지에서, 둘러볼 곳 묶음은 가장 가까운 둘러볼 곳에서 걸어서 몇 분
  const walkLabel = (s, key) => {
    if (key !== "explore") return walkFrom(destName(data, key), data.spotById[key], s);
    const places = (s.near_places || []).map((id) => data.placeById?.[id] || data.spotById[id]).filter(Boolean);
    const withPos = places.filter((p) => p.lat != null && p.lng != null && s.lat != null);
    if (withPos.length) {
      const p = withPos.reduce((a, b) => (distance(a, s) <= distance(b, s) ? a : b));
      return walkFrom(placeName(p), p, s);
    }
    return places.length ? loc({ ko: `${placeName(places[0])} 근처`, en: `Near ${placeName(places[0])}` }) : null;
  };

  const [info, setInfo] = useState(false);
  const infoBtn = useRef(null);
  const closeInfo = useCallback(() => { setInfo(false); infoBtn.current?.focus(); }, []);

  // 사진·이름을 누르면 홈 지도로 가서 그 가게를 핀으로 보여줘요
  const showOnMap = (s) => { app.setMapShop(s); app.go("home"); };

  return (
    <section className="screen places-screen market-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="pl-top">
          <button className="round-btn glass" onClick={() => app.go(MAIN)} aria-label={t("back_home")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{loc({ ko: "동네 상권", en: "Local shops" })}</h1>
        </div>

        <label className="search glass pl-search">
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={loc({ ko: "가게 이름, 메뉴, 주소 검색", en: "Search shops, food, address" })} aria-label={loc({ ko: "가게 검색", en: "Search shops" })} />
        </label>

        <div className="pl-topics scroll" role="radiogroup" aria-label={loc({ ko: "가게 종류", en: "Shop type" })}>
          {KINDS.filter(([k]) => k === "all" || count[k]).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={kind === k} className={`pl-topic ${kind === k ? "on" : "soft"}`} onClick={() => setKind(k)}>{loc(label)}</button>
          ))}
        </div>

        <div className="mk-count-row">
          <p className="pl-count">{list.length
            ? loc({ ko: `코스 근처 가게 ${list.length}곳`, en: `${list.length} shops near the courses` })
            : loc({ ko: "조건에 맞는 가게가 없어요", en: "No shops match" })}</p>
          <button type="button" ref={infoBtn} className="mk-info-btn" onClick={() => setInfo(true)} aria-label={loc({ ko: "이 가게들은 어떻게 골랐나요", en: "How these shops were chosen" })}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5 M12 7.6v.1" /></svg>
          </button>
        </div>

        {groups.map((g) => (
          <div key={g.key} className="mk-group">
            <h2 className="mk-group-title">{g.title}</h2>
            {g.shops.map((s) => {
              const meta = [catLabel(s), walkLabel(s, g.key), here ? t("from_me", { km: (distance(here, s) / 1000).toFixed(1) }) : null].filter(Boolean).join(" · ");
              return (
                <article key={s.id} className="card mk-card">
                  <button type="button" className="mk-main" onClick={() => showOnMap(s)} aria-label={loc({ ko: `${loc(s.name)} 지도에서 보기`, en: `Show ${loc(s.name)} on the map` })}>
                    <ShopPhoto shop={s} />
                    <span className="mk-text">
                      <b><span className="mk-name">{loc(s.name)}</span><svg className="mk-map-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s7-6 7-11.5a7 7 0 10-14 0C5 15 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.4" /></svg>{s.partner && <Badge>{loc({ ko: "제휴", en: "Partner" })}</Badge>}</b>
                      <small>{meta}</small>
                      {s.address && <span className="mk-addr">{s.address}</span>}
                      <span className="mk-onmap">{loc({ ko: "지도에서 보기 ›", en: "View on map ›" })}</span>
                    </span>
                  </button>
                  {s.kakao_url && (
                    <a className="mk-kakao" href={s.kakao_url.replace(/^http:/, "https:")} target="_blank" rel="noreferrer"
                      aria-label={loc({ ko: "카카오맵에서 열기 (새 창)", en: "Open in Kakao Map (new tab)" })}>
                      <span>{loc({ ko: "카카오맵", en: "Kakao Map" })}</span>
                      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 2.5h5.5V8 M9.5 2.5L2.5 9.5" /></svg>
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        ))}
      </div>
      {info && <ChosenInfo onClose={closeInfo} />}
    </section>
  );
}

// 가게를 어떻게 골랐는지 알려 주는 안내 창 (아래에서 올라와요)
function ChosenInfo({ onClose }) {
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
      <section className="ui-optsheet hanji-sheet rise mk-info" role="dialog" aria-modal="true" aria-labelledby="mk-info-title">
        <span className="grip" aria-hidden="true" />
        <h2 id="mk-info-title">{loc({ ko: "이 가게들은 어떻게 골랐나요?", en: "How were these shops chosen?" })}</h2>
        <p>{loc({
          ko: "성북런 팀이 러닝 코스 도착지(심우장·정릉·의릉)와 둘러볼 곳 근처를 직접 조사해 고른 동네 가게예요. 사진·분류·주소는 카카오맵 정보를 가져왔어요. 아직 제휴 가게가 아니라 쿠폰은 없어요. (2026년 11월 조사)",
          en: "The Seongbuk Run team picked these local shops by surveying the area around the course finish points (Simujang, Jeongneung, Uireung) and the places to explore. Photos, categories and addresses come from Kakao Map. They are not partner shops yet, so there are no coupons. (Surveyed November 2026)",
        })}</p>
        <h3>{loc({ ko: "이렇게 써요", en: "How to use" })}</h3>
        <ul>
          <li>{loc({ ko: "가게를 누르면 앱 지도에서 위치를 보여줘요", en: "Tap a shop to see where it is on the app map" })}</li>
          <li>{loc({ ko: "노란 카카오맵 버튼은 카카오맵에서 가게 정보를 열어요", en: "The yellow Kakao Map button opens the shop in Kakao Map" })}</li>
        </ul>
        <button type="button" ref={closeBtn} className="btn btn-cta" onClick={onClose}>{loc({ ko: "닫기", en: "Close" })}</button>
      </section>
    </div>
  );
}

// 카카오맵 대표 사진. 못 불러오면 가게 종류 그림으로 바꿔요
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
