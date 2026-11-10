import { groupOf } from "../lib/places.js";
// 스팟·카테고리 아이콘 (지도 마커와 필터 칩에서 같이 써요)
// SVG는 문자열로 두고 지도 오버레이에 그대로 넣어요(dangerouslySetInnerHTML). 모두 고정된 그림이라 안전해요.

// 스팟별 그림 (없는 스팟은 카테고리 아이콘을 써요)
const SPOT_SVG = {
  // 길상사: 단청 지붕과 연등
  gilsangsa: `<rect x="6" y="27" width="20" height="2" rx="1" fill="#B8AE9C"/><rect x="11" y="17" width="10" height="10" fill="#FBF0DC"/><path d="M13.5 18.5v8M16 18.5v8M18.5 18.5v8M12 21.5h8M12 24.5h8" stroke="#C9A77C" stroke-width=".7"/><path d="M9.5 16.5v10.5M22.5 16.5v10.5" stroke="#A8331A" stroke-width="1.8"/><rect x="8" y="15" width="16" height="2.2" fill="#2F6E5E"/><path d="M9.5 16.1h1.6M12.6 16.1h1.6M15.7 16.1h1.6M18.8 16.1h1.6M21.9 16.1h.8" stroke="#ECB22E" stroke-width="1.1"/><path d="M2 13C6 14.2 9 12.2 11 9H21C23 12.2 26 14.2 30 13C28 15.4 24.5 15.6 21 15H11C7.5 15.6 4 15.4 2 13Z" fill="#1F1C2C"/><path d="M10.5 9.2Q16 7 21.5 9.2" fill="none" stroke="#1F1C2C" stroke-width="1.8" stroke-linecap="round"/><path d="M13 10.5v3.6M16 10v4M19 10.5v3.6" stroke="#4A4560" stroke-width=".8"/><path d="M4.5 14.6v3M27.5 14.6v3" stroke="#6E6960" stroke-width=".6"/><ellipse cx="4.5" cy="20" rx="2.5" ry="2.3" fill="#F29BB0"/><path d="M2.4 19.6Q4.5 17.4 6.6 19.6M3 21.4Q4.5 22.6 6 21.4" fill="none" stroke="#D96A88" stroke-width=".7"/><path d="M4.5 22.3v1.6" stroke="#ECB22E" stroke-width=".8"/><ellipse cx="27.5" cy="20" rx="2.5" ry="2.3" fill="#ECB22E"/><path d="M25.4 19.6Q27.5 17.4 29.6 19.6M26 21.4Q27.5 22.6 29 21.4" fill="none" stroke="#C48A12" stroke-width=".7"/><path d="M27.5 22.3v1.6" stroke="#D2461F" stroke-width=".8"/>`,
  // 정릉: 곡장 두른 봉분과 홍살문
  jeongneung: `<path d="M2 30H30" stroke="#7FA66B" stroke-width="2.4" stroke-linecap="round"/><path d="M4.5 16.5C4.5 6.5 27.5 6.5 27.5 16.5" fill="none" stroke="#9C9384" stroke-width="2.2" stroke-linecap="round"/><path d="M7 18C8 10.5 24 10.5 25 18Z" fill="#7FA66B"/><path d="M10.5 14.2C13.5 12.4 18.5 12.4 21.5 14.2" fill="none" stroke="#A9C995" stroke-width="1.1" stroke-linecap="round"/><rect x="6.5" y="17.4" width="19" height="2.6" rx=".6" fill="#DDD6C8" stroke="#9C9384" stroke-width=".5"/><path d="M9.5 17.4v2.6M12.5 17.4v2.6M15.5 17.4v2.6M18.5 17.4v2.6M21.5 17.4v2.6" stroke="#B8AE9C" stroke-width=".5"/><path d="M11.5 22.5V20.2M13.4 22.5V20.2M15.3 22.5V20.2M16.7 22.5V20.2M18.6 22.5V20.2M20.5 22.5V20.2" stroke="#C2361A" stroke-width=".7"/><path d="M10 30V21.5M22 30V21.5" stroke="#C2361A" stroke-width="1.8" stroke-linecap="round"/><path d="M8.6 22.5H23.4M9.2 24.6H22.8" stroke="#C2361A" stroke-width="1.3" stroke-linecap="round"/><circle cx="16" cy="20.6" r="1.1" fill="#ECB22E" stroke="#C2361A" stroke-width=".4"/>`,
  // 심우장: 북향 한옥과 초승달
  simujang: `<path d="M25.6 3.2a3.4 3.4 0 1 0 3.6 4.6a2.8 2.8 0 1 1-3.6-4.6z" fill="#ECB22E"/><rect x="4" y="27" width="24" height="2.2" rx="1" fill="#B8AE9C"/><rect x="8" y="17" width="16" height="10" fill="#FBF0DC"/><path d="M8 17v10M13.6 17v10M18.4 17v10M24 17v10" stroke="#7A5134" stroke-width="1.3"/><rect x="14.4" y="18.6" width="3.2" height="8.4" fill="#D8B88A"/><path d="M16 18.6v8.4M14.4 21.4h3.2M14.4 24.2h3.2" stroke="#7A5134" stroke-width=".55"/><rect x="9.4" y="19.4" width="2.9" height="3" fill="#FBF0DC" stroke="#7A5134" stroke-width=".6"/><path d="M10.85 19.4v3M9.4 20.9h2.9" stroke="#7A5134" stroke-width=".4"/><rect x="19.7" y="19.4" width="2.9" height="3" fill="#FBF0DC" stroke="#7A5134" stroke-width=".6"/><path d="M21.15 19.4v3M19.7 20.9h2.9" stroke="#7A5134" stroke-width=".4"/><path d="M1.5 15.8C5 16.8 8 14.6 10 11.5H22C24 14.6 27 16.8 30.5 15.8C28.4 18 25 18.2 22 17.4H10C7 18.2 3.6 18 1.5 15.8Z" fill="#1F1C2C"/><path d="M9.4 11.7Q16 9.2 22.6 11.7" fill="none" stroke="#1F1C2C" stroke-width="2" stroke-linecap="round"/><path d="M12 13v3.6M14.5 12.6v4M17.5 12.6v4M20 13v3.6" stroke="#4A4560" stroke-width=".8"/><circle cx="9.4" cy="11.7" r=".9" fill="#FBF9F5"/><circle cx="22.6" cy="11.7" r=".9" fill="#FBF9F5"/>`,
  // 의릉: 언덕 위아래로 놓인 두 봉분과 장명등
  uiryeong: `<path d="M1.5 29C9 24.5 19 17.5 30.5 15V30H1.5Z" fill="#C5DCB1"/><path d="M1.5 29C9 24.5 19 17.5 30.5 15" fill="none" stroke="#7FA66B" stroke-width="1.2"/><path d="M17 12.5C17 5.8 29 5.8 29 12.5" fill="none" stroke="#9C9384" stroke-width="1.8" stroke-linecap="round"/><path d="M18.2 13.4C19.2 8.4 26.8 8.4 27.8 13.4Z" fill="#7FA66B"/><path d="M20.5 10.8Q23 9.6 25.5 10.8" fill="none" stroke="#A9C995" stroke-width=".9" stroke-linecap="round"/><rect x="18" y="12.9" width="10" height="2" rx=".5" fill="#DDD6C8" stroke="#9C9384" stroke-width=".4"/><path d="M4.5 21C4.5 14.3 16.5 14.3 16.5 21" fill="none" stroke="#9C9384" stroke-width="1.8" stroke-linecap="round"/><path d="M5.7 21.9C6.7 16.9 14.3 16.9 15.3 21.9Z" fill="#7FA66B"/><path d="M8 19.3Q10.5 18.1 13 19.3" fill="none" stroke="#A9C995" stroke-width=".9" stroke-linecap="round"/><rect x="5.5" y="21.4" width="10" height="2" rx=".5" fill="#DDD6C8" stroke="#9C9384" stroke-width=".4"/><path d="M20.4 22.6L22.5 20.6L24.6 22.6Z" fill="#8F8676"/><rect x="21.4" y="22.6" width="2.2" height="2.6" fill="#D9D1C1" stroke="#8F8676" stroke-width=".4"/><rect x="22.1" y="23.3" width=".8" height="1.1" fill="#ECB22E"/><rect x="21.7" y="25.2" width="1.6" height="1.8" fill="#B8AE9C"/><rect x="20.8" y="27" width="3.4" height=".9" fill="#8F8676"/>`,
};

// 카테고리 아이콘 (viewBox 0 0 20 20): 역사 = 기와 전각, 하천 = 물결, 공원 = 산과 나무
const CATEGORY_SVG = {
  history: `<path d="M1.5 8.6C3.6 9.3 5.4 8 6.6 6H13.4C14.6 8 16.4 9.3 18.5 8.6C17.3 10.1 15.2 10.2 13.4 9.8H6.6C4.8 10.2 2.7 10.1 1.5 8.6Z" fill="#A8331A"/><path d="M6.2 6.1Q10 4.4 13.8 6.1" fill="none" stroke="#A8331A" stroke-width="1.4" stroke-linecap="round"/><path d="M5.6 10v6.4M14.4 10v6.4" stroke="#A8331A" stroke-width="1.5" stroke-linecap="round"/><rect x="7.4" y="10.4" width="5.2" height="6" fill="#F8E1D8"/><path d="M10 10.4v6" stroke="#A8331A" stroke-width=".8"/><path d="M3.5 17h13" stroke="#A8331A" stroke-width="1.5" stroke-linecap="round"/>`,
  stream: `<path d="M2 7.5C4 5.8 6 5.8 8 7.5S12 9.2 14 7.5S18 5.8 18 6.2" fill="none" stroke="#34508C" stroke-width="1.7" stroke-linecap="round"/><path d="M2 11.5C4 9.8 6 9.8 8 11.5S12 13.2 14 11.5S18 9.8 18 10.2" fill="none" stroke="#6F88BE" stroke-width="1.7" stroke-linecap="round"/><path d="M2 15.5C4 13.8 6 13.8 8 15.5S12 17.2 14 15.5S18 13.8 18 14.2" fill="none" stroke="#34508C" stroke-width="1.7" stroke-linecap="round"/><circle cx="15.5" cy="3.6" r="1.3" fill="#ECB22E"/>`,
  park: `<path d="M1.5 17L7.5 7L11 12.4L13.4 9.4L18.5 17Z" fill="#B9D3C6"/><path d="M6 9.4L7.5 7L9 9.4Z" fill="#FBF9F5"/><path d="M14.5 4.2C12.2 4.2 11.2 6.6 12.2 8.2C10.8 8.8 11 11.4 13 11.6H16C18 11.4 18.2 8.8 16.8 8.2C17.8 6.6 16.8 4.2 14.5 4.2Z" fill="#2F6E5E"/><path d="M14.5 11.6V17" stroke="#7A5134" stroke-width="1.5" stroke-linecap="round"/><path d="M1.5 17H18.5" stroke="#2F6E5E" stroke-width="1.5" stroke-linecap="round"/>`,
};

// 장소 테마 아이콘: 선 그림 (viewBox 0 0 24 24, 색은 currentColor). 코스 목적지 그림(SPOT_SVG)과는 따로예요
// 전시 = 이젤, 역사 = 홍살문, 종교 = 연꽃, 공원 = 소나무, 전체 = 네모 4칸
const GROUP_LINE = {
  all: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  exhibit: "M5 4h14v10H5z M8 11l3-3 2.5 2.5L16 8.5 M8.5 14L6 21 M15.5 14L18 21",
  heritage: "M3 6c3 .7 6 1 9 1s6-.3 9-1 M6 7v14 M18 7v14 M5 11h14 M10 11V4 M14 11V4",
  religion: "M12 19c-2-1.8-3-4.3-3-7s1-4.6 3-6.5c2 1.9 3 3.8 3 6.5s-1 5.2-3 7z M12 19c-3.5 0-6.5-2-7.5-5.5 2.3 0 4.3.8 5.6 2.4 M12 19c3.5 0 6.5-2 7.5-5.5-2.3 0-4.3.8-5.6 2.4",
  park: "M12 3l4.5 6H14l4 5.5H6L10 9H7.5z M12 14.5V21",
};
// 테마 색은 --icon으로 넘겨요. 칩이 골라져 배경이 채워지면 styles.css에서 글자색을 따라가요
const GROUP_COLOR = { all: "#23701A", exhibit: "#1F66D1", heritage: "#D9501A", religion: "#B02E86", park: "#3A9116" };
const lineOf = (group) => GROUP_LINE[group] || GROUP_LINE.heritage;
const colorOf = (group) => GROUP_COLOR[group] || GROUP_COLOR.heritage;

export const groupIconSvg = (group) => `<svg class="grp-icon" style="--icon:${colorOf(group)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${lineOf(group)}"/></svg>`;
// 리액트 화면용 테마 아이콘 (칩·목록·지도 핀)
export function GroupIcon({ group, size = 20, className = "grp-icon" }) {
  return (
    <svg className={className} style={{ "--icon": colorOf(group) }} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={lineOf(group)} />
    </svg>
  );
}

// 모든 장소(코스 목적지 포함)는 테마 아이콘으로 통일 (심우장·정릉·의릉 = 역사, 길상사 = 종교)
// 코스 목적지(심우장·정릉·의릉·길상사)는 원래 장소 그림, 나머지 장소는 테마 아이콘
export function spotIconSvg(spot) {
  if (SPOT_SVG[spot.id]) return `<svg viewBox="0 0 32 32" aria-hidden="true">${SPOT_SVG[spot.id]}</svg>`;
  return groupIconSvg(spot.group || groupOf(spot));
}
// 예전 장소별 그림 (지금은 안 써요. 다시 쓰고 싶으면 위 함수에서 SPOT_SVG[spot.id]를 먼저 보면 돼요)
export function spotOwnIconSvg(spot) {
  if (SPOT_SVG[spot.id]) return `<svg viewBox="0 0 32 32" aria-hidden="true">${SPOT_SVG[spot.id]}</svg>`;
  return `<svg viewBox="0 0 20 20" aria-hidden="true">${CATEGORY_SVG[spot.category] || CATEGORY_SVG.history}</svg>`;
}

// 필터 칩용 카테고리 아이콘
export function CategoryIcon({ category, size = 18 }) {
  return (
    <svg className="cat-icon" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: CATEGORY_SVG[category] || "" }} />
  );
}

// 홈 지도처럼 스팟이 몰려 보일 때 배지를 옮겨 둘 자리 (px, 실제 위치에서 배지 중심까지). 없으면 제자리에 그려요.
// 홈 지도(MapView.jsx의 FitSpots)가 이 값으로 배지·이름표 자리를 계산해 화면 안에 맞춰요.
export const LABEL_OFFSETS = {
  gilsangsa: [-43, -62],
  jeongneung: [27, -62],
  uiryeong: [36, -50],
  simujang: [-46, 12],
};
