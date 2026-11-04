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

// 하단 메뉴: 지도 · 장소·이야기 · 문화 활동 · 내 기록
export const TABS = [
  ["home", "tab_map", <path key="p" d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />],
  ["places", "tab_places", <path key="p" d="M4 19.5V6a2 2 0 012-2h11v14H6a2 2 0 00-2 1.5zM4 19.5A2 2 0 006 21h12 M9 8h5" />],
  ["events", "tab_events", <path key="p" d="M5 5h14v15H5z M5 10h14 M9 3v4 M15 3v4" />],
  ["stats", "tab_stats", <path key="p" d="M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2" />],
];

export function TabBar() {
  const { screen, go } = useApp();
  return (
    <nav className="tabbar" aria-label={t("main_menu")}>
      {TABS.map(([id, key, icon]) => (
        <button key={id} className={screen === id ? "on" : ""} aria-current={screen === id ? "page" : undefined} onClick={() => go(id)}>
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

export function LangPill({ soft = false, glass = false }) {
  const { lang, changeLang } = useApp();
  return (
    <button className={`lang-pill ${soft ? "soft" : ""} ${glass ? "glass" : ""}`} onClick={() => changeLang(lang === "en" ? "ko" : "en")}
      aria-label={lang === "en" ? "Switch language to Korean" : "언어를 영어로 바꾸기"}>{lang.toUpperCase()}</button>
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

