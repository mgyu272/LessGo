// 장소 근처 가게 목록 (도착 화면 · 장소 상세에서 같이 써요)
// 데이터: public/data/shops.json에서 id가 "kakao-"로 시작하는 가게 (near = 가까운 장소 id)
// 이 가게들은 LessGo 제휴 가게가 아니라서 쿠폰·별·제휴 표시는 붙이지 않아요.
// 줄을 누르면 카카오맵 장소 페이지가 새 탭으로 열려요.

import { useMemo, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { distance } from "../lib/geo.js";

const CAFE_WORDS = ["카페", "커피", "찻집", "베이커리", "제과"];
// 카카오 분류의 마지막 칸 → 짧은 이름
const SHORT = { "커피전문점": "카페", "제과,베이커리": "베이커리", "오리": "오리 요리", "돈까스,우동": "돈까스", "육류,고기": "고기" };
// 짧은 이름 → 영어 화면용 문구 키 (i18n.js shop_kind_*). 목록에 없으면 한국어 이름을 그대로 보여줘요
const KIND_KEY = { "카페": "cafe", "베이커리": "bakery", "한식": "korean", "닭요리": "chicken", "오리 요리": "duck", "돈까스": "cutlet", "고기": "meat", "일본식주점": "izakaya", "전통찻집": "teahouse" };
const FILTERS = ["all", "meal", "cafe"];

export function shopKind(category = "") {
  return CAFE_WORDS.some((w) => category.includes(w)) ? "cafe" : "meal";
}
export function shopLabel(category = "") {
  const last = category.split(">").pop().trim();
  const short = SHORT[last] || last;
  return KIND_KEY[short] ? t("shop_kind_" + KIND_KEY[short]) : short;
}
// 직선거리를 10m 단위로 반올림
const round10 = (m) => Math.round(m / 10) * 10;

// 그 장소 근처 카카오 가게, 가까운 순
export function shopsNear(spot, shops) {
  if (!spot) return [];
  return shops.filter((s) => s.id.startsWith("kakao-") && s.near === spot.id)
    .map((s) => ({ s, d: round10(distance(spot, s)), kind: shopKind(s.category) }))
    .sort((a, b) => a.d - b.d);
}

// variant: "arrival"(도착 화면, 4곳) · "detail"(장소 상세, 거르기 칩 + 모두 보기)
// list: 미리 고른 가게 [{ s, d, kind }] (둘러볼 곳 상세는 places.js의 shopsNearPlace로 골라서 넘겨요)
export default function NearbyShops({ spot, variant = "arrival", list: given }) {
  const { data } = useApp();
  const all = useMemo(() => given || shopsNear(spot, data.shops), [given, spot, data.shops]);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  if (!all.length) return null; // 근처 가게가 없으면 영역 전체를 숨겨요

  const detail = variant === "detail";
  const list = all.filter((x) => filter === "all" || x.kind === filter);
  const shown = detail && open ? list : list.slice(0, 4);
  const place = loc(spot.name).replace(/\s*\(.*\)/, "");
  const pick = (f) => { setFilter(f); setOpen(false); }; // 칩을 바꾸면 다시 접어요

  return (
    <section className={`nearby ${detail ? "detail" : ""}`} aria-label={t(detail ? "shops_nearby" : "take_break")}>
      <div className="nb-head">
        <h3>{t(detail ? "shops_nearby" : "take_break")}</h3>
        <small>{t("closest_to", { name: place })}</small>
      </div>
      {detail && (
        <div className="nb-chips" role="radiogroup" aria-label={t("shop_filter")}>
          {FILTERS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} className={`nb-chip ${filter === f ? "on" : "soft"}`} onClick={() => pick(f)}>{t("shop_f_" + f)}</button>
          ))}
        </div>
      )}
      {shown.length > 0 && (
        <div className="card nb-list">
          {shown.map(({ s, d, kind }) => {
            const name = s.name?.ko || loc(s.name); // 가게 이름은 지금 한국어만 있어서 영어 화면에서도 한국어로
            const label = shopLabel(s.category);
            return (
              <a key={s.id} className="nb-row" href={s.kakao_url} target="_blank" rel="noopener"
                aria-label={`${name}, ${label} · ${t("about_m", { m: d })}, ${t("open_kakao")}`}>
                <span className={`nb-ic ${kind}`} aria-hidden="true">{kind === "cafe" ? <CupIcon /> : <MealIcon />}</span>
                <span className="nb-text"><b>{name}</b><small>{label} · {t("about_m", { m: d })}</small></span>
                <span className="nb-kakao" aria-hidden="true">{t("kakao_map")} ↗</span>
              </a>
            );
          })}
        </div>
      )}
      {detail && list.length > 4 && (
        <button type="button" className="btn btn-soft nb-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("show_less") : t("see_all_n", { n: list.length })}
        </button>
      )}
      <p className="nb-note">{t("not_partner_note")}</p>
    </section>
  );
}

// 숟가락·포크 (식사)
const MealIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M7 3v8a2 2 0 0 0 2 2v8" /><path d="M5 3v5a2 2 0 0 0 2 2M9 3v5a2 2 0 0 1-2 2" /><path d="M17 21V3c-2 1-3 3.5-3 6.5V13h3" /></svg>
);
// 컵 (카페)
const CupIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" /><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8 3.5c0 1-1 1.5-1 2.5s1 1.5 1 2.5M12 3.5c0 1-1 1.5-1 2.5s1 1.5 1 2.5" /></svg>
);
