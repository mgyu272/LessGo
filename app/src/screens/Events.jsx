// ⑨ 문화 활동 (디자인 원본 docs/design/Events.dc.html)
// 주간 날짜 카드(이전/다음 주) · 주제 칩 · 활동 카드 · 상세 시트
// 데이터: public/data/events.json (lib/events.js). 모르는 값은 "정보 준비 중"으로 보여줘요.

import { useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc, getLang } from "../lib/i18n.js";
import { useEvents, EVENT_CATEGORIES, mondayOf, addDays, dayKey, onDay, startOfDay } from "../lib/events.js";
import { Badge } from "../components/ui.jsx";

export default function Events() {
  const app = useApp();
  const events = useEvents();
  const today = startOfDay(new Date());
  const [week, setWeek] = useState(() => mondayOf(today));
  const [day, setDay] = useState(today);
  const [cat, setCat] = useState("all");
  const [sel, setSel] = useState(null);
  const weekRef = useRef(null);
  const showWeek = () => {
    const el = weekRef.current; if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true }); // 키보드·화면 읽기 사용자도 그 영역으로 옮겨가요
  };
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const list = (events || []).filter((e) => onDay(e, day) && (cat === "all" || e.category === cat));
  const countOn = (d) => (events || []).filter((e) => onDay(e, d)).length;
  const moveWeek = (n) => { const w = addDays(week, n * 7); setWeek(w); setDay(w); };
  const lang = getLang();
  const weekTitle = new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "long" }).format(week)
    + " · " + t("week_" + Math.min(5, Math.ceil((week.getDate() + new Date(week.getFullYear(), week.getMonth(), 1).getDay()) / 7)));
  const wd = (d) => new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { weekday: "short" }).format(d);

  return (
    <section className="screen events-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="pl-top">
          <button className="round-btn glass" onClick={() => app.go("places")} aria-label={t("back")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{t("events_title")}</h1>
          {/* 달력 보기 기능은 아직 없어서, 누르면 "이번 주 날짜" 영역으로 스크롤만 해요 */}
          <button className="round-btn glass ev-cal" onClick={showWeek} aria-label={t("view_calendar")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
          </button>
        </div>
        <p className="ev-sub">{t("events_sub")}</p>

        <section className="card ev-week" aria-label={t("this_week")} ref={weekRef} tabIndex={-1}>
          <div className="ev-week-head">
            <b>{weekTitle}</b>
            <button onClick={() => moveWeek(-1)} aria-label={t("prev_week")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></button>
            <button onClick={() => moveWeek(1)} aria-label={t("next_week")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg></button>
          </div>
          <div className="ev-days" role="radiogroup" aria-label={t("date")}>
            {days.map((d, i) => {
              const on = dayKey(d) === dayKey(day), isToday = dayKey(d) === dayKey(today), n = countOn(d);
              return (
                <button key={i} role="radio" aria-checked={on} className={`ev-day ${on ? "on" : ""} ${isToday ? "today" : ""} ${i === 5 ? "sat" : i === 6 ? "sun" : ""}`}
                  aria-label={`${d.getMonth() + 1}/${d.getDate()} ${wd(d)}${n ? " · " + t("events_n", { n }) : ""}`} onClick={() => setDay(d)}>
                  <small>{wd(d)}</small><b>{d.getDate()}</b>
                  <span aria-hidden="true"><i className={n > 0 ? "d1" : ""} /><i className={n > 1 ? "d2" : ""} /></span>
                </button>
              );
            })}
          </div>
          <div className="ev-legend"><span><i className="dot" />{t("has_events")}</span><span><i className="box" />{t("today")}</span></div>
        </section>

        <div className="pl-topics scroll" role="radiogroup" aria-label={t("topic")}>
          {EVENT_CATEGORIES.map((k) => (
            <button key={k} role="radio" aria-checked={cat === k} className={`pl-topic ${cat === k ? "on" : "soft"}`} onClick={() => setCat(k)}>{t("evcat_" + k)}</button>
          ))}
        </div>

        <p className="pl-count">{events === null ? t("loading_short") : list.length ? t("events_n", { n: list.length }) : t("events_none")}</p>
        {list.map((e) => <EventCard key={e.id} e={e} onOpen={() => setSel(e)} />)}

        <p className="ev-note">{t("events_note")}</p>
      </div>

      {sel && <EventSheet e={sel} onClose={() => setSel(null)} />}
    </section>
  );
}

function EventCard({ e, onOpen }) {
  const { data } = useApp();
  return (
    <button className="card ev-card" onClick={onOpen}>
      <span className="ev-badges">
        <Badge>{t("evcat_" + e.category)}</Badge>
        <Badge tone="plain">{e.fee ? loc(e.fee) : t("fee_unknown")}</Badge>
        {e.near && data.spotById[e.near] && <Badge tone="plain">{loc(data.spotById[e.near].name)}</Badge>}
      </span>
      <b>{loc(e.title)}</b>
      <span className="ev-meta"><span>{whenText(e)}</span><span>{e.where ? loc(e.where) : t("info_pending")}</span></span>
    </button>
  );
}

function EventSheet({ e, onClose }) {
  const app = useApp();
  const run = () => { app.setPick({ ...app.pick, dest: e.near }); app.go("courses"); };
  const rows = [["ev_when", whenText(e)], ["ev_where", e.where ? loc(e.where) : null], ["ev_fee", e.fee ? loc(e.fee) : null], ["ev_apply", e.apply ? loc(e.apply) : null]];
  return (
    <div className="ui-layer">
      <div className="ui-scrim" onClick={onClose} />
      <section className="ui-optsheet hanji-sheet rise" role="dialog" aria-modal="true" aria-label={loc(e.title)}>
        <span className="grip" aria-hidden="true" />
        <div className="ev-sheet-head">
          <div><Badge>{t("evcat_" + e.category)}</Badge><h2>{loc(e.title)}</h2></div>
          <button className="round-btn" onClick={onClose} aria-label={t("close")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <dl className="card ev-kv">
          {rows.map(([k, v]) => <div key={k}><dt>{t(k)}</dt><dd>{v || t("info_pending")}</dd></div>)}
        </dl>
        <small className="ev-src">{e.source ? t("ev_source", { name: loc(e.source.name), date: e.source.checked || t("info_pending") }) : t("ev_source_none")}</small>
        <div className="ui-dialog-row">
          {e.url ? <a className="btn btn-soft" href={e.url} target="_blank" rel="noopener">{t("official_page")}</a> : <button className="btn btn-soft" disabled>{t("official_page")}</button>}
          <button className="btn btn-cta" onClick={run} disabled={!e.near}>{t("run_there")} →</button>
        </div>
      </section>
    </div>
  );
}

function whenText(e) {
  const lang = getLang() === "ko" ? "ko-KR" : "en-US";
  const sameDay = dayKey(e.startAt) === dayKey(e.endAt);
  const d = (x) => new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(x);
  const tm = (x) => new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(x);
  return sameDay ? `${d(e.startAt)} ${tm(e.startAt)}–${tm(e.endAt)}` : `${d(e.startAt)} – ${d(e.endAt)}`;
}
