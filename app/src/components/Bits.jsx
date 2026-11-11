// 작은 공용 부품들: 고도 그래프, 가게 줄, QR 자리표시, 탭바, 토스트

import { t, loc } from "../lib/i18n.js";
import { fmtDist } from "../lib/geo.js";
import { useApp } from "../state/AppContext.jsx";

// 고도 그래프 (시안 3·4번의 언덕 모양). 라이브러리 없이 SVG로.
export function ElevationChart({ values, color = "#5FA52A", fill = "rgba(174,218,128,.3)", height = 64 }) {
  if (!values?.length) return null;
  const w = 300, h = height, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(max - min, 25); // 평지도 너무 출렁이지 않게
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2) * 0.85;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="elev" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={fill} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// 가게 한 줄 (시안 7번)
export function ShopRow({ shop, dist, onCoupon }) {
  const sub = [shop.visit_coupon ? t("visit_coupon") : "", shop.buy_stars ? t("buy_stars", { n: shop.buy_stars }) : ""].filter(Boolean).join(" · ");
  return (
    <div className={`shop ${shop.partner && shop.visit_coupon ? "partner" : ""}`}>
      <span className="d">{fmtDist(dist)}</span>
      <span className="t"><b>{loc(shop.name)}</b><small>{sub}</small></span>
      {shop.visit_coupon && <button className="btn btn-ink sm" onClick={() => onCoupon(shop)}>{t("get_coupon")}</button>}
    </div>
  );
}

// 진짜 QR 대신 쓰는 자리표시 무늬 (실제 쿠폰 QR은 2단계에서 qrcode 라이브러리로)
export function FakeQr({ seed = "x" }) {
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = 21, rects = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    let on;
    if (finder) { const fx = x % 14, fy = y % 14; on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx > 1 && fx < 5 && fy > 1 && fy < 5); }
    else { h = (h * 1103515245 + 12345) >>> 0; on = (h >> 16) & 1; }
    if (on) rects.push(<rect key={x + "-" + y} x={x} y={y} width="1" height="1" />);
  }
  return <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} shapeRendering="crispEdges"><g fill="#1C2321">{rects}</g></svg>;
}

// 하단 메뉴: 장소·이야기(메인) · 지도 · 상권 · 내 기록 (문화 활동은 장소와 이야기 화면의 "이어진 문화 활동"으로 들어가요)
export const TABS = [
  ["places", "tab_places", <path key="p" d="M4 19.5V6a2 2 0 012-2h11v14H6a2 2 0 00-2 1.5zM4 19.5A2 2 0 006 21h12 M9 8h5" />],
  ["placesHub", "tab_map", <path key="p" d="M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z" />],
  ["market", "tab_market", <path key="p" d="M4 9l1.5-5h13L20 9 M4 9h16v11H4z M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0 2.7 2.7 0 005.3 0 M10 20v-5h4v5" />],
  ["stats", "tab_stats", <path key="p" d="M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2" />],
];

const TAB_OF = { home: "placesHub", placesCourse: "placesHub" };

export function TabBar() {
  const { screen, go } = useApp();
  // 장소 탭 안의 화면(카테고리 · 코스 따라 보기 · 큰 지도)에서도 장소 탭이 켜져 보여요
  const active = TAB_OF[screen] || screen;
  return (
    <nav className="tabbar" aria-label={t("main_menu")}>
      {TABS.map(([id, key, icon]) => (
        <button key={id} className={active === id ? "on" : ""} aria-current={active === id ? "page" : undefined} onClick={() => go(id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">{icon}</svg>
          <span>{t(key)}</span>
        </button>
      ))}
    </nav>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  return <div className={`toast ${toastMsg ? "show" : ""}`}>{toastMsg}</div>;
}

// 접힌 알약에는 누르면 바뀔 언어를 보여줘요 (한국어 화면 → EN, 영어 화면 → KO)
export function LangPill({ soft = false, glass = false, expanded = false }) {
  const { lang, changeLang } = useApp();
  return (
    <button className={`lang-pill ${soft ? "soft" : ""} ${glass ? "glass" : ""} ${expanded ? "expanded" : ""}`} onClick={() => changeLang(lang === "en" ? "ko" : "en")}
      aria-label={lang === "en" ? "Switch language to Korean" : "언어를 영어로 바꾸기"}>
      {expanded ? <><svg className="lang-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></svg><span>{lang === "ko" ? t("language_korean") : t("language_english")}</span></> : (lang === "en" ? "KO" : "EN")}
    </button>
  );
}

// 로그인 화면 언어 선택: 한국어 | English 두 칸 스위치. 지금 언어 칸이 켜져 있어요
export function LangSwitch() {
  const { lang, changeLang } = useApp();
  const opts = [["ko", "한국어"], ["en", "English"]];
  return (
    <div className="lang-switch" role="radiogroup" aria-label="Language · 언어">
      <span className={`lang-switch-knob ${lang === "en" ? "right" : ""}`} aria-hidden="true" />
      {opts.map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={lang === k} lang={k}
          className={lang === k ? "on" : ""} onClick={() => lang !== k && changeLang(k)}>{label}</button>
      ))}
    </div>
  );
}

// 낙관(도장): 스팟 도착·완주 때 찍히는 주홍 도장. text는 1~2글자 (예: 길상)
export function Seal({ text, size = 56, off = false, stamp = false }) {
  return (
    <span className={`seal ${off ? "off" : ""} ${stamp ? "stamp" : ""}`} style={{ width: size, height: size, fontSize: size * (text.length >= 3 ? 0.24 : text.length === 2 ? 0.32 : 0.5) }}>
      <span>{text}</span>
    </span>
  );
}
export const sealText = (spot) => spot.seal || spot.name.ko.replace(/\s*\(.*\)/, "").slice(0, 2);

