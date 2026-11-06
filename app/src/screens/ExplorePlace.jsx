// 7-1 둘러볼 곳 상세 (explore.json 한 곳, app.explore = { place, from })
// 위: 뒤로·공유 · 아이콘 · "분류 · 동네" · 이름 · 배지(둘러볼 곳 · 개방 기간)
// 이야기 태그(curation) → 방문 정보(여는 날·관람 시간·관람료·주소) → 길찾기 / 정보가 달라요 → 출처
// → 달리면서 들르기(가까운 코스 목적지 · 3/5/10km) → 주변 가게 → 아래 고정 "{코스} 코스 보고 들르기"
// 도장·해설은 코스 목적지에서만 받아요. issues(조사팀 확인용)는 화면에 보여주지 않아요.

import { useMemo, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { DISTANCES } from "../lib/routes.js";
import { kakaoDirections, exploreColor, kindLabel, areaLabel, destName, round10, openPeriod, inPeriod, periodText, shopsNearPlace, CHECKED_DATE, groupOf } from "../lib/places.js";
import { GroupIcon } from "../components/SpotIcons.jsx";
import { Badge } from "../components/ui.jsx";
import NearbyShops, { shopKind } from "../components/NearbyShops.jsx";
import { ReportSheet } from "./PlaceDetail.jsx";

export default function ExplorePlace() {
  const app = useApp();
  const { data } = app;
  const place = app.explore?.place;
  const [report, setReport] = useState(false);
  const shops = useMemo(() => (place ? shopsNearPlace(place, data.shops, shopKind) : []), [place, data.shops]);
  if (!place) return null;

  const name = loc(place.name);
  const dest = place.nearest_course?.dest;
  const course = dest ? destName(data, dest) : "";
  const period = openPeriod(place.open_days);
  const open = period && inPeriod(period);
  const tags = (place.curation || "").split(",").map((x) => x.trim()).filter(Boolean);
  const visit = [["open_days", place.open_days], ["hours", place.hours], ["fee", place.fee], ["address", place.address]];

  const back = () => app.go(app.explore?.from || "places");
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: name, text: `${name} — LessGo` });
      else { await navigator.clipboard.writeText(name); app.toast(t("shared")); }
    } catch {}
  };
  // 코스 고르기를 이 장소에서 가장 가까운 코스 목적지로 (km를 고르면 그 거리로)
  const openCourses = (km) => { app.setPick({ ...app.pick, dest, ...(km ? { km } : {}) }); app.go("courses"); };

  return (
    <section className="screen pd-screen ex-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="pd-scroll">
        <div className="pd-hero">
          <div className="pd-bar">
            <button className="round-btn glass" onClick={back} aria-label={t("back")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></button>
            <button className="round-btn glass" onClick={share} aria-label={t("share")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg></button>
          </div>
          <div className="pd-id">
            <span className="pd-ic ex-ic" style={{ "--c": exploreColor(place) }} aria-hidden="true"><GroupIcon group={groupOf(place)} size={44} /></span>
            <div>
              <small>{[kindLabel(place), areaLabel(place)].join(" · ")}</small>
              <h1>{name}</h1>
              <span className="ex-badges">
                <Badge>{t("explore_badge")}</Badge>
                {period && <Badge tone={open ? "green" : "warn"}>{open ? t("open_period_now", { p: periodText(period) }) : t("closed_period_now")}</Badge>}
              </span>
            </div>
          </div>
        </div>

        <div className="pd-body pd-col">
          {tags.length > 0 && (
            <article className="card ex-story">
              <h3>{t("explore_story")}</h3>
              <div className="ex-tags">{tags.map((x) => <span key={x}>{x}</span>)}</div>
              {(place.audio === "yes" || place.audio === "maybe") && <p className="note mint">{t("audio_preparing")}</p>}
            </article>
          )}

          <div className="card pd-rows">
            {visit.map(([k, v]) => (
              <div className="pd-row" key={k}>
                <span className="pd-row-ic" aria-hidden="true" />
                <span><small>{t("visit_" + k)}</small><b className={v ? "" : "pd-pending"}>{v || t("info_pending")}</b></span>
              </div>
            ))}
          </div>
          <div className="ex-links">
            <a className="btn btn-soft" href={kakaoDirections(place.name.ko, place.lat, place.lng)} target="_blank" rel="noopener">{t("kakao_directions")}</a>
            <button type="button" className="btn btn-soft" onClick={() => setReport(true)}>{t("info_wrong")}</button>
          </div>
          <p className="pd-src">{t("explore_source", { date: CHECKED_DATE })}</p>

          {dest && (
            <section className="card ex-run" aria-label={t("run_and_visit")}>
              <small>{t("run_and_visit")}</small>
              <h3>{t("course_of", { name: course })}</h3>
              <p>{t("explore_from_dest", { name: course, m: round10(place.nearest_course.straight_m) })}</p>
              <div className="ex-km">
                {DISTANCES.map((km) => <button key={km} type="button" className="soft" onClick={() => openCourses(km)}>{km}km</button>)}
              </div>
            </section>
          )}

          {shops.length > 0 ? <NearbyShops spot={place} variant="detail" list={shops} /> : place.survey_shops.length > 0 && (
            // 카카오에서 못 찾은 가게: 팀 현장 조사 이름만 (거리 없이)
            <section className="nearby detail" aria-label={t("shops_nearby")}>
              <div className="nb-head"><h3>{t("shops_nearby")}</h3><small>{t("team_survey")}</small></div>
              <ul className="card ex-survey">{place.survey_shops.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
          )}
        </div>
      </div>

      {dest && (
        <div className="pd-cta">
          <button className="btn btn-cta" onClick={() => openCourses()}>{t("see_course_visit", { name: course })} →</button>
        </div>
      )}

      {report && <ReportSheet spot={place} onClose={() => setReport(false)} />}
    </section>
  );
}
