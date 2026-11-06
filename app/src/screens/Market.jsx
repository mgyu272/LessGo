// ⑧ 상권: 코스 근처 동네 가게(식당 · 카페 · 술집 등) 목록 (shops.json의 카카오맵 조사 자료)
// 장소와 이야기 화면과 같은 카드 모양. 왼쪽에 카카오맵 대표 사진, 아래로 쭉 스크롤해서 봐요.
// "카카오맵 보기"는 가게 페이지를 열고, "여기로 달리기"는 그 가게와 가까운 코스 목적지로 코스 고르기를 열어요.

import { useMemo, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
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
// 분류의 마지막 두 칸만 보여줘요 ("한식 · 국수")
const catLabel = (s) => (s.category || "").split(">").map((x) => x.trim()).slice(1).slice(-2).join(" · ");

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

  const runHere = (s) => { app.setPick({ ...app.pick, dest: s.near }); app.go("courses"); };

  return (
    <section className="screen places-screen market-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="pl-top">
          <button className="round-btn glass" onClick={() => app.go("home")} aria-label={t("back_home")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{loc({ ko: "동네 상권", en: "Local shops" })}</h1>
        </div>

        <label className="search glass pl-search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={loc({ ko: "가게 이름, 메뉴, 주소 검색", en: "Search shops, food, address" })} aria-label={loc({ ko: "가게 검색", en: "Search shops" })} />
        </label>

        <div className="pl-topics scroll" role="radiogroup" aria-label={loc({ ko: "가게 종류", en: "Shop type" })}>
          {KINDS.filter(([k]) => k === "all" || count[k]).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={kind === k} className={`pl-topic ${kind === k ? "on" : "soft"}`} onClick={() => setKind(k)}>{loc(label)}</button>
          ))}
        </div>

        <p className="pl-count">{list.length
          ? loc({ ko: `코스 근처 가게 ${list.length}곳 · 달린 뒤 들러 보세요`, en: `${list.length} shops near the courses` })
          : loc({ ko: "조건에 맞는 가게가 없어요", en: "No shops match" })}</p>

        {list.map((s) => {
          const near = s.near && data.spotById[s.near] ? destName(data, s.near) : null;
          const meta = [catLabel(s), near && loc({ ko: `${near} 근처`, en: `Near ${near}` }), here ? t("from_me", { km: (distance(here, s) / 1000).toFixed(1) }) : null].filter(Boolean).join(" · ");
          return (
            <article key={s.id} className="card pl-card mk-card">
              <div className="pl-card-top">
                <ShopPhoto shop={s} />
                <div className="pl-text">
                  <div className="pl-name"><h2>{loc(s.name)}</h2>{s.partner && <Badge>{loc({ ko: "제휴", en: "Partner" })}</Badge>}</div>
                  <small>{meta}</small>
                  {s.address && <p>{s.address}</p>}
                </div>
              </div>
              <div className="pl-actions">
                {s.kakao_url
                  ? <a className="btn btn-soft" href={s.kakao_url.replace(/^http:/, "https:")} target="_blank" rel="noreferrer">{loc({ ko: "카카오맵 보기", en: "Kakao Map" })}</a>
                  : <span />}
                {s.near && data.spotById[s.near]
                  ? <button className="btn btn-cta" onClick={() => runHere(s)}>{t("run_here")} →</button>
                  : <span />}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// 카카오맵 대표 사진. 못 불러오면 가게 종류 그림으로 바꿔요
function ShopPhoto({ shop }) {
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
