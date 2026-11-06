// 장소와 이야기 화면에서 쓰는 장소 주제(태그). spots.json에는 아직 주제가 없어서 여기 한곳에 둬요.
// 장소를 추가하면 여기에 id와 주제를 넣어 주세요. (i18n.js의 topic_* 문구와 짝)
// 둘러볼 곳(explore.json)은 장소마다 topics가 있고, park는 chip이 park인 곳이에요 (exploreTopics).

import { t, loc, getLang } from "./i18n.js";
import { distance } from "./geo.js";

export const TOPICS = ["all", "tomb", "indep", "hanok", "wall", "temple", "museum", "park"];

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
export const exploreTopics = (p) => (p.chip === "park" ? [...p.topics, "park"] : p.topics);

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
