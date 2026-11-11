// 도장·별(누적 별 + 도장) · 기록 목록(로그아웃)  — 새 "내 기록" 화면(Stats.jsx)에서 열려요

import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { fmtTime, fmtPace } from "../lib/geo.js";
import { STAR_RULES } from "../state/useUserData.js";
import { spotIconSvg } from "../components/SpotIcons.jsx";

// ---------------- 완주 요약 ----------------
// ---------------- ⑨ 스탬프·별 + 내 영역 + 랭킹 ----------------
export function Stars() {
  const app = useApp();
  const { user, data } = app;

  return (
    <section className="screen stars-screen">
      <div className="stars-head">
        <small>{t("my_stars")}</small>
        <div className="star-total serif"><span>★</span> <b>{user.bonus}</b></div>
        <small>{t("stars_earned_total", { n: user.starsEarned })}</small>
      </div>
      <div className="scroll-y pad stars-body">
        <div className="next-card">누적 별 {user.starsEarned}개 · 러너 온도에 반영됩니다.</div>

        <h4>{t("my_seals")} {user.stamps.size}/{data.spots.length}</h4>
        <div className="seal-grid">
          {data.spots.map((sp) => (
            <figure key={sp.id} className={user.stamps.has(sp.id) ? "" : "off"}><span className="me-place-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(sp) }} /><figcaption>{loc(sp.name)}</figcaption></figure>
          ))}
        </div>

        <h4>{t("how_earn")}</h4>
        <div className="earn-grid">
          <div><b>★ 1</b>{t("e_course_star", { m: STAR_RULES.everyM })}</div>
          <div><b>★ 1</b>{t("e_free_star", { m: STAR_RULES.everyM })}</div>

        </div>

      </div>
    </section>
  );
}

// ---------------- 내 기록 ----------------
export function Records() {
  const app = useApp();
  const { user } = app;
  return (
    <section className="screen light">
      <header className="topbar">
        <button className="round-back glass" onClick={() => app.go("stats")} aria-label={t("back_aria")}>‹</button>
        <div><h3>{t("run_list")}</h3></div>
      </header>
      <div className="scroll-y pad has-tabbar">
        {user.runs.length === 0 && <p className="empty">{t("no_records")}</p>}
        {user.runs.map((r) => (
          <div className="record" key={r.id}>
            <div className="date"><b>{new Date(r.date).getDate()}</b><small>{new Date(r.date).toLocaleDateString(app.lang === "ko" ? "ko-KR" : "en-US", { month: "short" })}</small></div>
            <div className="body">
              <b>{loc(r.name)}{r.move === "walk" && <em className="rec-walk">{t("move_walk")}</em>}</b>
              {/* 걷기 기록은 페이스를 보여주지 않아요 */}
              <div className="meta"><span>{(r.meters / 1000).toFixed(2)}km</span><span>{fmtTime(r.seconds)}</span>{r.move !== "walk" && <span>{fmtPace(r.seconds, r.meters)}</span>}<span>★ {r.starsGot || 0}</span><span>📍 {r.stamps}</span></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
