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

// 시작 화면 그림: 달밤의 북악산 능선, 한양도성 성곽, 나뭇잎, 그 위로 그려지는 옥빛 달리기 길
const LEAVES = [
  [52, 236, 18, "#7CC4A4", 0], [96, 262, -30, "#B5C7BF", 0.25], [150, 250, 40, "#7CC4A4", 0.5],
  [214, 268, -12, "#7CC4A4", 0.15], [268, 254, 64, "#B5C7BF", 0.4], [330, 270, -48, "#7CC4A4", 0.3], [372, 248, 22, "#7CC4A4", 0.6],
];
export function OnboardingArt() {
  const wallY = (x) => 196 - 14 * Math.sin(x / 75) - x * 0.035;
  const top = [], merlons = [];
  for (let x = -10; x <= 410; x += 10) top.push(`${x},${wallY(x).toFixed(1)}`);
  for (let x = 0; x <= 400; x += 15) merlons.push(<rect key={x} x={x} y={wallY(x + 4) - 8} width="9" height="9" rx="1" />);
  const stones = [];
  for (let row = 1; row <= 3; row++) {
    const pts = [];
    for (let x = -10; x <= 410; x += 10) pts.push(`${x},${(wallY(x) + row * 9).toFixed(1)}`);
    stones.push(<polyline key={row} points={pts.join(" ")} fill="none" stroke="#1C2B26" strokeOpacity=".22" strokeWidth="1" strokeDasharray={row % 2 ? "14 3" : "9 3"} />);
  }
  return (
    <svg viewBox="0 0 400 320" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#17332A" /><stop offset=".55" stopColor="#1F4D3F" /><stop offset="1" stopColor="#2F5A4C" />
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#23453A" /><stop offset="1" stopColor="#17332A" />
        </linearGradient>
      </defs>
      <rect width="400" height="320" fill="url(#sky)" />
      <circle cx="292" cy="118" r="38" fill="#DDE5E1" opacity=".9" />
      <path d="M0,150 C50,112 96,104 150,128 S240,86 300,112 S372,132 400,118 L400,320 L0,320 Z" fill="#23453A" />
      <path d="M0,178 C70,150 120,160 180,150 S300,132 400,150 L400,320 L0,320 Z" fill="#2B5244" />
      <polygon points={`${top.join(" ")} 410,320 -10,320`} fill="#D9DEDA" />
      <g fill="#D9DEDA">{merlons}</g>
      {stones}
      <rect x="0" y="232" width="400" height="88" fill="url(#ground)" />
      <path className="ob-route" d="M18,300 C80,276 118,286 168,262 S250,236 292,226 S352,206 384,186" fill="none" stroke="#7CC4A4" strokeWidth="4.5" strokeLinecap="round" />
      <g className="ob-runner">
        <circle cx="384" cy="186" r="7" fill="#7CC4A4" stroke="#fff" strokeWidth="3" />
        <circle cx="384" cy="186" r="7" fill="none" stroke="#7CC4A4" strokeWidth="2" />
      </g>
      {LEAVES.map(([x, y, rot, c, delay], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`}>
          <path className="ob-leaf" style={{ animationDelay: `${delay}s` }} fill={c}
            d="M0,0 C-3,-6 -13,-10 -12,-19 C-6,-21 -2,-18 0,-15 C2,-18 6,-21 12,-19 C13,-10 3,-6 0,0 Z M0,0 L0,7" stroke={c} strokeWidth="1.2" />
        </g>
      ))}
    </svg>
  );
}
