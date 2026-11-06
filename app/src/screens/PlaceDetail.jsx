// ⑧ 장소 상세 (디자인 원본 docs/design/PlaceDetail.dc.html)
// 탭: 이야기(해설 듣기 + spots.json cards + 출처) / 방문 정보 / 문화 활동
// "정보가 달라요" → 신고 시트 → Firestore reports 컬렉션에 저장
// 관람 시간·휴관일·관람료·주소는 explore.json의 같은 장소(spot_id)에서 가져오고, 없으면 "정보 준비 중"이에요 (가짜 값을 넣지 않아요).
// 방문 정보 탭 아래에 "근처 둘러볼 곳": 이 목적지가 가장 가까운 둘러볼 곳 4곳 + 모두 보기(장소와 이야기).

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc, getLang } from "../lib/i18n.js";
import { fmtTime } from "../lib/geo.js";
import * as voice from "../lib/voice.js";
import { PLACE_TOPICS, REPORT_REASONS, kakaoDirections, byNearest, round10, CHECKED_DATE, groupOf } from "../lib/places.js";
import { spotIconSvg, GroupIcon } from "../components/SpotIcons.jsx";
import HistoryLens from "./HistoryLens.jsx";
import PlacePhoto from "../components/PlacePhoto.jsx";
import NearbyShops from "../components/NearbyShops.jsx";

const TABS = ["visit", "story", "history_lens"]; // 장소 정보 → 이야기 → AI 역사 렌즈 (문화 활동 탭은 뺐어요)

export default function PlaceDetail() {
  const app = useApp();
  const spot = app.spot;
  const [tab, setTab] = useState("visit");
  const [playing, setPlaying] = useState(false);
  const [report, setReport] = useState(false);
  // 홈 팝업: 처음엔 화면 절반, 위로 끌면 전체, 아래로 끌면 다시 절반 → 한 번 더 내리면 닫기
  const [full, setFull] = useState(false);
  const [dragY, setDragY] = useState(0);
  const drag = useRef(null);
  useEffect(() => () => voice.stop(), []);
  if (!spot) return null;

  const name = loc(spot.name);
  // 새로 추가된 장소: 탭 형식·기능은 같고 내용은 비워 둔 "준비 중" (발표 때 채울 예정)
  const prep = spot.preparing === true;
  const text = loc(spot.narration);
  const listen = () => {
    if (playing) { voice.stop(); setPlaying(false); return; }
    setPlaying(true);
    voice.speak(text, { lang: getLang(), queue: false, onend: () => setPlaying(false) });
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: name, text: `${name} — LessGo` });
      else { await navigator.clipboard.writeText(name); app.toast(t("shared")); }
    } catch {}
  };
  // 방문 정보: explore.json의 같은 장소 (값이 없으면 null → "정보 준비 중")
  const info = app.data.exploreBySpot[spot.id] || {};
  const visitorNote = info.visitor_note ?? app.data.explore.find((p) => p.id === spot.id)?.visitor_note;
  const visit = { hours: info.hours, closed: info.open_days, fee: info.fee, address: info.address }; // 가는 길은 뺐어요
  const nearby = app.data.explore.filter((p) => p.nearest_course?.dest === spot.id).sort(byNearest);
  const openExplore = (p) => { voice.stop(); app.setExplore({ place: p, from: "place" }); app.go("explore"); };
  const runHere = () => { voice.stop(); app.setPick({ ...app.pick, dest: spot.id }); app.go("courses"); };
  const back = () => { voice.stop(); app.go(app.placeFrom || "places"); };
  // 홈 지도 핀으로 열면 팝업: 위 왼쪽 버튼이 X(닫기), 바깥 덮개를 눌러도 닫혀요
  const popup = app.placeFrom === "home";
  // 끌기: 누른 뒤에는 창 전체에서 움직임을 받아요 (손가락이 시트 밖으로 나가도 이어지게)
  const onDown = (e) => {
    if (!popup || e.target.closest("button")) return;
    e.preventDefault(); // 글자 선택·끌어 놓기가 시작되지 않게
    const y0 = e.clientY;
    let dy = 0;
    const move = (ev) => { dy = ev.clientY - y0; setDragY(dy || 0.01); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragY(0);
      if (dy < -40) setFull(true);
      else if (dy > 60) { if (drag.current?.full) setFull(false); else back(); }
    };
    drag.current = { full };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const dragHandlers = popup ? { onPointerDown: onDown } : {};

  return (
    <>
    {popup && <div className="ui-scrim pd-scrim" onClick={back} aria-hidden="true" />}
    <section className={`screen pd-screen ${popup ? `pd-popup rise ${full ? "pd-full" : ""} ${dragY ? "pd-dragging" : ""}` : ""}`}
      style={popup && dragY ? { top: `calc(${full ? "44px + var(--safe-top)" : "50%"} + ${full ? Math.max(0, dragY) : dragY}px)` } : undefined}
      {...(popup ? { role: "dialog", "aria-modal": true, "aria-label": name } : {})}>
      <div className="hanji-layer" aria-hidden="true" />
      <div className="pd-scroll">
        <div className="pd-hero" {...dragHandlers}>
          {popup && <span className="grip" aria-hidden="true" />}
          <div className="pd-bar">
            {popup
              ? <button className="round-btn glass" onClick={back} aria-label={t("close")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
              : <button className="round-btn glass" onClick={back} aria-label={t("back")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></button>}
            <button className="round-btn glass" onClick={share} aria-label={t("share")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg></button>
          </div>
          <div className="pd-id">
            <span className="pd-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(spot) }} />
            <div>
              <small>{spot.kindLabel || (PLACE_TOPICS[spot.id] || []).map((k) => t("topic_" + k)).join(" · ") || t("filter_" + spot.category)}</small>
              <h1>{name}</h1>
            </div>
          </div>
        </div>

        <div className="pd-tabs" role="tablist" aria-label={t("place_info")}>
          {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className="pd-tab" onClick={() => setTab(k)}>{t("pd_tab_" + k)}</button>)}
        </div>

        <div className="pd-body">
          {prep && (
            <div className="rise pd-col">
              {tab === "visit" && <PlacePhoto spot={spot} />}
              <article className="card pd-story pd-prep">
                <span>{loc({ ko: "준비 중", en: "Coming soon" })}</span>
                <h3>{loc({ ko: "곧 이야기가 채워져요", en: "Stories are on the way" })}</h3>
                <p>{loc({ ko: "이 장소의 해설·방문 정보·러닝 코스를 준비하고 있어요.", en: "We're preparing the story, visit info and running course for this place." })}</p>
              </article>
              {tab === "visit" && visitorNote && <p className="pd-src">{visitorNote}</p>}
            </div>
          )}
          {!prep && tab === "story" && (
            <div className="rise pd-col">
              <button className="btn btn-cta pd-listen" onClick={listen} aria-pressed={playing}>
                <span>{t(playing ? "listen_stop" : "listen_about", { t: fmtTime(voice.estimateSeconds(text, app.lang)) })}</span>
                <span className="pd-play" aria-hidden="true">{playing ? "■" : "▶"}</span>
              </button>
              {spot.cards.map((c, i) => (
                <article key={i} className="card pd-story">
                  <span>{t("story_i", { i: i + 1 })}</span>
                  <h3>{loc(c.title)}</h3>
                  <p>{loc(c.body)}</p>
                </article>
              ))}
              {/* 출처: spots.json의 source(원고 작성)와 sources(참고 자료) */}
              <p className="pd-src">
                {spot.source === "lessgo" && <span>{t("script_by_team")}</span>}
                {spot.sources?.length > 0 && <span> · {t("sources")}: {spot.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener">{s.title}</a>)}</span>}
              </p>
            </div>
          )}

          {!prep && tab === "visit" && (
            <div className="rise pd-col">
              {/* 대표 사진을 먼저 보여주고, 아래로 내리면 관람 시간·휴관일 등 */}
              <PlacePhoto spot={spot} />
              <div className="card pd-rows">
                {Object.keys(visit).map((k) => (
                  <div className="pd-row" key={k}>
                    <span><b className="pd-row-k">{t("visit_" + k)}</b><span className={`pd-row-v ${visit[k] ? "" : "pd-pending"}`}>{visit[k] || t("info_pending")}</span>{k === "address" && <small>{t("visit_check_site")}</small>}{k === "access" && <small>{t("visit_quiet")}</small>}</span>
                  </div>
                ))}
              </div>
              {visitorNote && <p className="pd-src">{visitorNote}</p>}
              {loc(spot.notice) && <p className="note mint">{loc(spot.notice)}</p>}
              <div className="pd-links">
                <a className="btn btn-soft" href={kakaoDirections(name, spot.lat, spot.lng)} target="_blank" rel="noopener">{t("directions")}</a>
              </div>
              {/* 주변 가게: 거르기 칩 + 4곳, 더 있으면 모두 보기 (제휴 아님) */}
              <NearbyShops spot={spot} variant="detail" />
              {nearby.length > 0 && (
                <section className="pd-explore" aria-label={t("explore_near_title")}>
                  <h3>{t("explore_near_title")}</h3>
                  <ul className="card">
                    {nearby.slice(0, 4).map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => openExplore(p)}>
                          <GroupIcon group={groupOf(p)} size={28} className="grp-icon list" />
                          <b>{loc(p.name)}</b>
                          <small>{t("about_m", { m: round10(p.nearest_course.straight_m) })}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn btn-soft pd-explore-all" onClick={() => { voice.stop(); app.setPlacesNear(spot.id); app.go("places"); }}>
                    {t("explore_near_all", { name: name.replace(/\s*\(.*\)/, ""), n: nearby.length })}
                  </button>
                </section>
              )}
              <div className="pd-check">
                <small>{t("last_checked", { date: app.data.exploreBySpot[spot.id] ? CHECKED_DATE : t("info_pending") })}</small>
                <button onClick={() => setReport(true)}>{t("info_wrong")}</button>
              </div>
            </div>
          )}

          {!prep && tab === "history_lens" && <HistoryLens spotId={spot.id} spotName={name} />}
        </div>
      </div>

      <div className="pd-cta">
        {prep && !(app.data.destinations || []).includes(spot.id)
          ? <button className="btn btn-cta" disabled>{loc({ ko: "코스 준비 중", en: "Course coming soon" })}</button>
          : <button className="btn btn-cta" onClick={runHere}>{t("run_to", { name: name.replace(/\s*\(.*\)/, "") })} →</button>}
      </div>

      {report && <ReportSheet spot={spot} onClose={() => setReport(false)} />}
    </section>
    </>
  );
}

// 정보가 달라요: 이유 고르기 + 자세히(선택) → Firestore reports
export function ReportSheet({ spot, onClose }) {
  const { user } = useApp();
  const [reason, setReason] = useState("hours");
  const [note, setNote] = useState("");
  const [state, setState] = useState("edit"); // edit | sending | sent
  const [err, setErr] = useState("");
  const send = async () => {
    setState("sending"); setErr("");
    const res = await user.sendReport({ spotId: spot.id, reason, note });
    if (res.ok) setState("sent"); else { setState("edit"); setErr(t(res.error)); }
  };
  return (
    <div className="ui-layer">
      <div className="ui-scrim" onClick={onClose} />
      <section className="ui-optsheet hanji-sheet rise" role="dialog" aria-modal="true" aria-label={t("report_title")}>
        <span className="grip" aria-hidden="true" />
        {state !== "sent" ? (
          <>
            <div><h2>{t("report_title")}</h2><p className="pd-sub">{t("report_sub")}</p></div>
            <div className="pd-reasons" role="radiogroup" aria-label={t("report_reason")}>
              {REPORT_REASONS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={reason === k} className={`pd-reason ${reason === k ? "on" : "soft"}`} onClick={() => setReason(k)}>{t("reason_" + k)}</button>
              ))}
            </div>
            <label className="pd-note">{t("report_detail")}
              <textarea rows="3" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("report_detail_ph")} />
            </label>
            {err && <p className="note cream" role="alert">{err}</p>}
            <div className="ui-dialog-row pd-row2">
              <button type="button" className="btn btn-soft" onClick={onClose}>{t("cancel")}</button>
              <button type="button" className="btn btn-cta" disabled={state === "sending"} onClick={send}>{t("send")}</button>
            </div>
          </>
        ) : (
          <div className="pd-sent">
            <span aria-hidden="true">✓</span>
            <h2>{t("report_got")}</h2>
            <p>{t("report_got_sub")}</p>
            <button type="button" className="btn btn-cta" onClick={onClose}>{t("ok")}</button>
          </div>
        )}
      </section>
    </div>
  );
}
