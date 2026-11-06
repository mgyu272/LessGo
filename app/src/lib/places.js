// 장소 종류 칩(GROUPS · groupOf)과 코스 목적지 주제 태그(PLACE_TOPICS), 둘러볼 곳 계산을 한곳에 둬요.
// 칩은 홈 지도와 장소와 이야기가 같은 기준을 써요 (i18n.js의 grp_* 문구와 짝).

import { t, loc, getLang } from "./i18n.js";
import { distance } from "./geo.js";
import { DESTINATIONS } from "./routes.js";

// 장소 종류 칩: 전체 · 전시 · 역사·한옥 · 사찰·성당 · 공원·전망
export const GROUPS = ["all", "exhibit", "heritage", "religion", "park"];

// 코스 목적지 상세(PlaceDetail)·카드에 붙는 주제 태그 (i18n.js의 topic_* 문구와 짝).
// 목적지를 추가하면 여기에 id와 주제를 넣어 주세요.
export const PLACE_TOPICS = {
  simujang: ["indep", "hanok"],
  jeongneung: ["tomb"],
  uiryeong: ["tomb"],
};

// 정보가 달라요 신고 이유 (Firestore reports.reason 값과 같아요. 보안 규칙에도 같은 목록이 있어요)
export const REPORT_REASONS = ["hours", "fee", "entrance", "closed", "story", "etc"];

// 카카오맵 길찾기 링크 (목적지만 정해 두면 출발지는 카카오맵이 현재 위치로 잡아요)
export const kakaoDirections = (name, lat, lng) => `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`;

// ---------- 둘러볼 곳 (explore.json) ----------

// 지도 점 색: 역사문화 · 공원 · 하천
export const EXPLORE_COLORS = { history: "#2F6512", park: "#2E8A6B", stream: "#3B82C4" };
export const exploreColor = (p) => EXPLORE_COLORS[p.chip] || EXPLORE_COLORS.history;
// 지도 아이콘 종류: explore.json의 kind·name·chip으로 정해요 (위에서부터 먼저 맞는 것)
export function iconTypeOf(p) {
  const kind = p.kind || "", name = p.name?.ko || "";
  const has = (...words) => words.some((w) => kind.includes(w));
  if (has("성곽", "한양도성") || ["숙정문", "혜화문"].includes(name)) return "wall";
  if (p.chip === "park") return "park";
  if (has("사찰")) return "temple";
  if (has("종교") || name.includes("성당")) return "church";
  if (has("문학")) return "literature";
  if (has("박물관") || name.includes("박물관")) return "museum";
  if (has("미술관", "전시", "조각", "예술", "건축")) return "art";
  if (has("정보")) return "info";
  return "hanok";
}
// 칩 묶음: 코스 목적지(심우장·정릉·의릉)는 역사·한옥, 공원(chip park)은 아이콘보다 먼저 봐요. 나머지는 지도 아이콘 종류로
const GROUP_OF_ICON = { museum: "exhibit", art: "exhibit", literature: "exhibit", hanok: "heritage", wall: "heritage", info: "heritage", temple: "religion", church: "religion" };
// 테마를 따로 정한 스팟 (spots.json에는 kind가 없어서요)
const SPOT_GROUP = { gilsangsa: "religion" };
export function groupOf(p) {
  if (SPOT_GROUP[p.id] || SPOT_GROUP[p.spot_id]) return SPOT_GROUP[p.id] || SPOT_GROUP[p.spot_id];
  if (DESTINATIONS.includes(p.id)) return "heritage";
  if (p.chip === "park") return "park";
  return GROUP_OF_ICON[iconTypeOf(p)] || "heritage";
}

// explore.json 방문 정보를 팀이 마지막으로 확인한 날
export const CHECKED_DATE = "2026.10.30";

// 직선거리는 10m 단위로
export const round10 = (m) => Math.round(m / 10) * 10;

// 분류: 한국어 화면은 엑셀 분류(kind), 영어 화면은 칩 이름
export const kindLabel = (p) => (getLang() === "ko" && p.kind ? p.kind : t("filter_" + p.chip));
// 동네 이름 (area 슬러그 → area_* 문구)
export const areaLabel = (p) => t("area_" + String(p.area).replace(/-/g, "_"));

// 입장료 짧게: "무료…"면 "무료", 아니면 첫 구절만 ("성인 7,000원·청소년…" → "성인 7,000원")
export function shortFee(fee) {
  if (!fee) return null;
  if (fee.startsWith("무료")) return t("fee_free");
  return fee.split(/\s*(?:·|, |\/|\(|\s-\s)/)[0].trim() || fee;
}

// "분류 · 입장료 · 해설 준비 중"
export const exploreMeta = (p) => [kindLabel(p), shortFee(p.fee), p.audio === "yes" ? t("audio_soon") : null].filter(Boolean).join(" · ");

// 가까운 코스 목적지 이름 ("심우장 (만해 한용운 유택)" → "심우장")
export const destName = (data, dest) => loc(data.spotById[dest]?.name).replace(/\s*\(.*\)/, "");

// "{코스} 코스 도착지에서 {N}m"
export const fromCourseEnd = (data, p) => (p.nearest_course?.dest
  ? t("from_course_end", { name: destName(data, p.nearest_course.dest), m: round10(p.nearest_course.straight_m) }) : "");

// 가까운 코스 목적지 순
export const byNearest = (a, b) => (a.nearest_course?.straight_m ?? 1e9) - (b.nearest_course?.straight_m ?? 1e9);

// 개방 기간 "4~11월" → { from: 4, to: 11 } (없으면 null). 12~2월처럼 해를 넘겨도 돼요
export function openPeriod(openDays) {
  const m = /(\d{1,2})\s*~\s*(\d{1,2})월/.exec(openDays || "");
  return m ? { from: Number(m[1]), to: Number(m[2]) } : null;
}
// "4~11월" · "Apr–Nov"
export function periodText({ from, to }) {
  if (getLang() === "ko") return `${from}~${to}월`;
  const mon = (n) => new Date(2026, n - 1, 1).toLocaleString("en", { month: "short" });
  return `${mon(from)}–${mon(to)}`;
}
export function inPeriod(period, date = new Date()) {
  const mo = date.getMonth() + 1;
  return period.from <= period.to ? mo >= period.from && mo <= period.to : mo >= period.from || mo <= period.to;
}

// 둘러볼 곳 근처 가게: shops.json의 near_places에 이 장소가 있으면 그 가게, 없으면 800m 안 카카오 가게 (가까운 순)
export const SHOP_RADIUS_M = 800;
export function shopsNearPlace(place, shops, kindOf) {
  const listed = shops.filter((s) => s.near_places?.includes(place.id));
  const pool = listed.length ? listed : shops.filter((s) => s.id.startsWith("kakao-") && distance(place, s) <= SHOP_RADIUS_M);
  return pool.map((s) => ({ s, d: round10(distance(place, s)), kind: kindOf(s.category) })).sort((a, b) => a.d - b.d);
}
