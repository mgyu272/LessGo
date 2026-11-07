// ⑧ 장소 상세 (디자인 원본 docs/design/PlaceDetail.dc.html)
// 탭: 이야기(해설 듣기 + spots.json cards + 출처) / 방문 정보 / 문화 활동
// "정보가 달라요" → 신고 시트 → Firestore reports 컬렉션에 저장
// 관람 시간·휴관일·관람료·주소는 explore.json의 같은 장소(spot_id)에서 가져오고, 없으면 "정보 준비 중"이에요 (가짜 값을 넣지 않아요).
// 방문 정보 탭 아래에 "근처 둘러볼 곳": 이 목적지가 가장 가까운 둘러볼 곳 4곳 + 모두 보기(장소와 이야기).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../state/AppContext.jsx";
import { t, loc, getLang } from "../lib/i18n.js";
import { fmtTime } from "../lib/geo.js";
import * as voice from "../lib/voice.js";
import { PLACE_TOPICS, REPORT_REASONS, kakaoDirections, byNearest, round10, CHECKED_DATE, groupOf } from "../lib/places.js";
import { spotIconSvg, GroupIcon } from "../components/SpotIcons.jsx";
import HistoryLens from "./HistoryLens.jsx";
import PlacePhoto, { PlaceThumb } from "../components/PlacePhoto.jsx";
import NearbyShops from "../components/NearbyShops.jsx";

const TABS = ["visit", "story", "history_lens"]; // 장소 정보 → 이야기 → AI 역사 렌즈 (문화 활동 탭은 뺐어요)
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusableIn = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);

export default function PlaceDetail() {
  const app = useApp();
  const spot = app.spot;
  const [tab, setTab] = useState("visit");
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [report, setReport] = useState(false);
  // 홈 지도 핀으로 열면 가운데 모달: X, 바깥 막, Esc로 닫고 눌렀던 핀으로 포커스를 돌려줘요
  const popup = app.placeFrom === "home";
  const dialogRef = useRef(null);
  const reportRef = useRef(null);
  const openerRef = useRef(document.activeElement);
  const back = () => { voice.stop(); app.go(app.placeFrom || "places"); };
  const closePopup = () => {
    const opener = openerRef.current;
    const label = loc(spot.name);
    back();
    // 닫은 뒤 다른 핀이 다시 그려지므로 다음 차례에 포커스를 옮겨요. 핀이 새로 만들어졌으면 이름으로 찾아요
    setTimeout(() => {
      const pin = opener?.isConnected && opener !== document.body ? opener : document.querySelector(`.home-map button[aria-label="${CSS.escape(label)}"]`);
      pin?.focus({ preventScroll: true });
    }, 0);
  };
  useEffect(() => () => voice.stop(), []);
  // 열리면 포커스를 모달 안으로. 신고 시트가 열려 있으면 그 안으로
  useEffect(() => {
    if (!popup) return;
    if (report) focusableIn(reportRef.current || document.body)[0]?.focus();
    else dialogRef.current?.focus({ preventScroll: true });
  }, [popup, report]);
  // Esc로 닫기, Tab은 모달 안에서만 돌게
  useEffect(() => {
    if (!popup) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (report) setReport(false); else closePopup();
        return;
      }
      if (e.key !== "Tab") return;
      const root = report ? reportRef.current : dialogRef.current;
      if (!root) return;
      const items = focusableIn(root);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], now = document.activeElement;
      if (e.shiftKey && (now === first || now === root || !root.contains(now))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (now === last || !root.contains(now))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup, report]);
  if (!spot) return null;

  const name = loc(spot.name);
  // 새로 추가된 장소: 탭 형식·기능은 같고 내용은 비워 둔 "준비 중" (발표 때 채울 예정)
  const prep = spot.preparing === true;
  const text = loc(spot.narration);
  const listen = () => {
    if (playing) { voice.stop(); setPlaying(false); return; }
    setAudioError("");
    setPlaying(true);
    voice.speak(text, {
      lang: getLang(), queue: false, chunk: true,
      onend: () => setPlaying(false),
      onerror: (event) => {
        setPlaying(false);
        setAudioError(t(event.error === "language-unavailable" || event.error === "voice-unavailable"
          ? "place_voice_language_error" : "place_voice_error"));
      },
    });
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

  return (
    <>
    {popup && <div className="ui-scrim pd-scrim" onClick={closePopup} aria-hidden="true" />}
    <section ref={dialogRef} className={`screen pd-screen ${popup ? "pd-popup" : ""}`}
      {...(popup ? { role: "dialog", "aria-modal": true, "aria-labelledby": "pd-modal-title", tabIndex: -1 } : {})}>
      <div className="hanji-layer" aria-hidden="true" />
      <div className="pd-scroll">
        <div className="pd-hero">
          <div className="pd-bar">
            {popup
              ? <button className="round-btn glass" onClick={closePopup} aria-label={t("close")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
              : <button className="round-btn glass" onClick={back} aria-label={t("back")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></button>}
            <button className="round-btn glass" onClick={share} aria-label={t("share")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg></button>
          </div>
          <div className="pd-id">
            <span className="pd-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(spot) }} />
            <div>
              <small>{spot.kindLabel || (PLACE_TOPICS[spot.id] || []).map((k) => t("topic_" + k)).join(" · ") || t("filter_" + spot.category)}</small>
              <h1 id={popup ? "pd-modal-title" : undefined}>{name}</h1>
            </div>
          </div>
        </div>

        <div className="pd-tabs" role="tablist" aria-label={t("place_info")}>
          {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className="pd-tab" onClick={() => setTab(k)}>{t("pd_tab_" + k)}</button>)}
        </div>

        <div className="pd-body">
          {/* 대표 사진을 맨 위에. AI 역사 렌즈는 카메라 화면이라 빼고, 사진이 없을 때 안내는 장소 정보 탭에서만 */}
          {tab !== "history_lens" && <div className="pd-lead"><PlacePhoto spot={spot} fallback={tab === "visit" ? undefined : null} /></div>}
          {prep && (
            <div className="rise pd-col">
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
              {audioError && <p className="note cream" role="alert">{audioError}</p>}
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
                          <PlaceThumb place={p} fallback={<GroupIcon group={groupOf(p)} size={30} />} />
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

      {/* 모달 안에서는 잘리니 신고 시트는 폰 화면 위에 띄워요 */}
      {report && (popup
        ? createPortal(<div ref={reportRef}><ReportSheet spot={spot} onClose={() => setReport(false)} /></div>, document.querySelector(".phone"))
        : <ReportSheet spot={spot} onClose={() => setReport(false)} />)}
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
