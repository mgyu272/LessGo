// ⑩ 내 기록 (디자인 원본 docs/design/Stats.dc.html)
// 탭: 오늘(목표 링) · 주간(막대 차트, 목표 달성일 별) · 배지
// useUserData의 runs · stamps · 별(보유·누적) · 쿠폰으로 계산하고, 목표·배지 규칙은 lib/badges.js 한곳에 있어요.
// 위쪽 "도장·쿠폰"(예전 스탬프·별 화면)과 "기록 목록"(예전 내 기록 · 로그아웃)으로 이어져요.

import { useMemo, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc, getLang } from "../lib/i18n.js";
import { fmtTime } from "../lib/geo.js";
import { DAILY_GOAL_KM, byDay, badgeStates, dayStart, DAY } from "../lib/badges.js";
import { LogoBird } from "../components/LogoBird.jsx";
import { Badge, ConfirmDialog } from "../components/ui.jsx";

const TABS = ["today", "week", "badge"];
const METRICS = ["km", "time", "star"];

export default function Stats() {
  const app = useApp();
  const { user } = app;
  const [tab, setTab] = useState("today");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const days = useMemo(() => byDay(user.runs), [user.runs]);
  const share = async () => {
    const text = t("stats_share_stars", { km: totalKm(user.runs).toFixed(1), n: user.starsEarned });
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); app.toast(t("shared")); } } catch {}
  };
  const logout = async () => {
    await user.signOut();
    app.go("onboarding");
  };

  return (
    <section className="screen stats-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="pd-scroll">
        <div className="st-top">
          <div className="st-heading"><h1>{t("tab_stats")}</h1><p>{t("hello", { name: user.profile?.nickname || "" })}</p></div>
          <button className="st-logout" onClick={() => setConfirmLogout(true)}>{t("logout")}</button>
          <button className="round-btn glass" onClick={share} aria-label={t("share")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg></button>
        </div>
        <div className="st-links">
          <button className="soft" onClick={() => app.go("stars")}>{t("stamps_coupons")}</button>
          <button className="soft" onClick={() => app.go("records")}>{t("run_list")}</button>
        </div>
        <div className="pd-tabs" role="tablist" aria-label={t("records_view")}>
          {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className="pd-tab" onClick={() => setTab(k)}>{t("st_tab_" + k)}</button>)}
        </div>
        <div className="pd-body">
          {tab === "today" && <Today days={days} />}
          {tab === "week" && <Week days={days} />}
          {tab === "badge" && <Badges />}
        </div>
      </div>
      <ConfirmDialog open={confirmLogout} title={t("logout_confirm_title")} cancelLabel={t("cancel")} confirmLabel={t("logout")}
        onCancel={() => setConfirmLogout(false)} onConfirm={logout} />
    </section>
  );
}

function Today({ days }) {
  const app = useApp();
  const today = days[dayStart(Date.now())] || { km: 0, seconds: 0, stars: 0 };
  const left = Math.max(0, DAILY_GOAL_KM - today.km);
  const pct = Math.min(1, today.km / DAILY_GOAL_KM);
  const R = 70, C = 2 * Math.PI * R;
  return (
    <div className="rise pd-col">
      <div className="card st-ring-card">
        <svg className="st-ring" viewBox="0 0 180 180" role="img" aria-label={t("goal_ring", { km: today.km.toFixed(1), goal: DAILY_GOAL_KM })}>
          <circle cx="90" cy="90" r={R} fill="none" stroke="#DCEDC6" strokeWidth="14" />
          <circle cx="90" cy="90" r={R} fill="none" stroke="#5FA52A" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 90 90)" />
          <text x="90" y="88" textAnchor="middle" className="st-ring-num">{today.km.toFixed(1)}</text>
          <text x="90" y="112" textAnchor="middle" className="st-ring-sub">/ {DAILY_GOAL_KM}km</text>
        </svg>
        <p>{left > 0 ? t("goal_left", { km: left.toFixed(1) }) : t("goal_done")}</p>
        <button className="btn btn-cta" onClick={() => app.go("courses")}>{t("keep_going")} →</button>
      </div>
      <RunnerTemperature stars={app.user.starsEarned || 0} />
      <div className="st-trio">
        <div className="soft"><b>{fmtTime(today.seconds)}</b><small>{t("time")}</small></div>
        <div className="soft"><b>{t("plus_stars", { n: today.stars })}</b><small>{t("stars_collected")}</small></div>
        <div className="soft"><b>{app.user.starsEarned || 0}</b><small>누적 별</small></div>
      </div>
      <p className="st-note">{t("goal_note", { km: DAILY_GOAL_KM })}</p>
    </div>
  );
}

function RunnerTemperature({ stars }) {
  // Cumulative earned stars: never decreases when stars are exchanged for coupons.
  const count = Math.max(0, Number(stars) || 0);
  const temperature = Math.min(99.9, 36.5 + count * 0.15);
  const percent = Math.max(0, Math.min(100, (temperature - 36.5) / (99.9 - 36.5) * 100));
  const rank = temperature >= 60 ? "뜨거운 러너" : temperature >= 45 ? "꾸준한 러너" : "새싹 러너";
  return (
    <section className="card runner-temp" aria-label="러너 온도">
      <div className="runner-temp-top"><b>🌡 나의 러너 온도</b><small>누적 활동 지수</small></div>
      <div className="runner-temp-value">{temperature.toFixed(1)}<small>°C</small></div>
      <div className="runner-temp-track" role="progressbar" aria-label="러너 온도" aria-valuemin={36.5} aria-valuemax={99.9} aria-valuenow={Number(temperature.toFixed(1))}><i style={{width: percent + "%"}} /></div>
      <div className="runner-temp-bottom"><span>{rank}</span><span>누적 별 {count.toLocaleString("ko-KR")}개</span></div>
      <p>별을 모을수록 온도가 올라가요. 할인쿠폰과는 별개로 누적됩니다.</p>
    </section>
  );
}

function Week({ days }) {
  const [metric, setMetric] = useState("km");
  const start = dayStart(Date.now()) - 6 * DAY;
  const list = Array.from({ length: 7 }, (_, i) => ({ day: start + i * DAY, ...(days[start + i * DAY] || { km: 0, seconds: 0, stars: 0 }) }));
  const val = (d) => (metric === "km" ? d.km : metric === "time" ? d.seconds / 60 : d.stars);
  const max = Math.max(1, ...list.map(val), metric === "km" ? DAILY_GOAL_KM : 0);
  const goalDays = list.filter((d) => d.km >= DAILY_GOAL_KM).length;
  const avg = list.reduce((s, d) => s + d.km, 0) / 7;
  const tot = { km: list.reduce((s, d) => s + d.km, 0), sec: list.reduce((s, d) => s + d.seconds, 0), stars: list.reduce((s, d) => s + d.stars, 0) };
  const wd = (ms) => new Intl.DateTimeFormat(getLang() === "ko" ? "ko-KR" : "en-US", { weekday: "narrow" }).format(new Date(ms));
  return (
    <div className="rise pd-col">
      <div className="card st-week">
        <div className="st-week-head">
          <div><small>{t("week_avg")}</small><div className="st-big">{avg.toFixed(1)}<em>km</em></div></div>
          <Badge>★ {t("goal_days", { n: goalDays })}</Badge>
        </div>
        <svg className="st-bars" viewBox="0 0 280 150" role="img" aria-label={t("week_chart")}>
          {metric === "km" && <line x1="0" x2="280" y1={120 - (DAILY_GOAL_KM / max) * 100} y2={120 - (DAILY_GOAL_KM / max) * 100} stroke="#9FD25E" strokeDasharray="4 4" />}
          {list.map((d, i) => {
            const h = (val(d) / max) * 100, x = i * 40 + 10;
            return (
              <g key={i}>
                <rect x={x} y={120 - h} width="20" height={Math.max(h, 2)} rx="6" fill={d.km >= DAILY_GOAL_KM ? "#5FA52A" : "#C6E59E"} />
                {d.km >= DAILY_GOAL_KM && <text x={x + 10} y={112 - h} textAnchor="middle" className="st-star">★</text>}
                <text x={x + 10} y="140" textAnchor="middle" className="st-day">{wd(d.day)}</text>
              </g>
            );
          })}
        </svg>
        <div className="ui-segment st-metric" role="radiogroup" aria-label={t("metric")} style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {METRICS.map((m) => <button key={m} role="radio" aria-checked={metric === m} className={metric === m ? "on" : ""} onClick={() => setMetric(m)}><span>{t("metric_" + m)}</span></button>)}
        </div>
      </div>
      <div className="st-trio">
        <div className="soft"><b>{tot.km.toFixed(1)}km</b><small>{t("total_km")}</small></div>
        <div className="soft"><b>{fmtTime(tot.sec)}</b><small>{t("total_time")}</small></div>
        <div className="soft"><b>{t("stars_n", { n: tot.stars })}</b><small>{t("stars_collected")}</small></div>
      </div>
    </div>
  );
}

function Badges() {
  const { user, data } = useApp();
  const states = badgeStates({ runs: user.runs, stamps: user.stamps, starsEarned: user.starsEarned });
  const got = states.filter((b) => b.done);
  const next = states.find((b) => !b.done);
  const place = (id) => loc(data.spotById[id]?.name).replace(/\s*\(.*\)/, "");
  const sub = (b) => {
    if (b.missing?.length && !b.done) return t("badge_left", { names: b.missing.map(place).join(" · ") });
    if (b.id === "run_10k" && !b.done) return t("badge_best", { km: b.best.toFixed(1) });
    if (b.id === "stars_100" && !b.done) return t("badge_now_stars", { n: b.now });
    return b.done ? t("badge_got") : `${Math.floor(b.have)} / ${b.need}`;
  };
  // "다음 배지까지" 카드: 장소 배지면 "심우장만 남았어요 · 2 / 3"처럼 남은 장소와 모은 수 (실제 도장 기록으로 계산)
  const nextSub = (b) => (b.missing?.length
    ? t("next_left", { names: b.missing.map(place).join(" · "), have: b.have, need: b.need })
    : sub(b));
  return (
    <div className="rise pd-col">
      {next && (
        <div className="card st-next">
          <LogoBird variant="icon" size={72} />
          <div>
            <small>{t("next_badge")}</small>
            <b>{t("badge_" + next.id)}</b>
            <span className="st-prog"><i style={{ width: `${(next.have / next.need) * 100}%` }} /></span>
            <small className="muted">{nextSub(next)}</small>
          </div>
        </div>
      )}
      <h2 className="st-h2">{t("badges_got", { n: got.length, total: states.length })}</h2>
      <div className="st-grid">
        {states.map((b) => (
          <div key={b.id} className={`st-tile ${b.done ? "card done" : "soft"}`}>
            <span className="st-medal" aria-hidden="true">{b.done ? "★" : "?"}</span>
            <b>{t("badge_" + b.id)}</b>
            <small>{sub(b)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function totalKm(runs) { return runs.reduce((s, r) => s + (r.meters || 0) / 1000, 0); }
