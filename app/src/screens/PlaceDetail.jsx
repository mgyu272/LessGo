// ⑧ 장소 상세 (디자인 원본 docs/design/PlaceDetail.dc.html)
// 탭: 이야기 → AI 역사 렌즈 → 방문 정보. 처음엔 이야기 탭 (app.placeTab으로 다른 탭을 먼저 열 수 있어요)
// 이야기 탭: 도장 + 질문형 제목(hook) → 음성 해설 카드 → 이야기 카드 한 장씩 넘기기 → AI 역사 렌즈 안내 → 출처
// "정보가 달라요" → 신고 시트 → Firestore reports 컬렉션에 저장
// 관람 시간·휴관일·관람료·주소는 explore.json의 같은 장소(spot_id)에서 가져오고, 없으면 "정보 준비 중"이에요 (가짜 값을 넣지 않아요).
// 방문 정보 탭 아래에 "근처 둘러볼 곳": 이 목적지가 가장 가까운 둘러볼 곳 4곳 + 모두 보기(장소 탭 > 코스 따라 보기).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../state/AppContext.jsx";
import { t, loc, getLang } from "../lib/i18n.js";
import { fmtTime } from "../lib/geo.js";
import * as voice from "../lib/voice.js";
import { PLACE_TOPICS, REPORT_REASONS, kakaoDirections, byNearest, round10, CHECKED_DATE, groupOf } from "../lib/places.js";
import { spotIconSvg, GroupIcon } from "../components/SpotIcons.jsx";
import { Seal, sealText } from "../components/Bits.jsx";
import { LensIcon } from "./Places.jsx";
import HistoryLens from "./HistoryLens.jsx";
import PlacePhoto, { PlaceThumb } from "../components/PlacePhoto.jsx";
import NearbyShops from "../components/NearbyShops.jsx";

const TABS = ["story", "history_lens", "visit"]; // 이야기 → AI 역사 렌즈 → 방문 정보 (문화 활동 탭은 뺐어요)
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusableIn = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);

export default function PlaceDetail() {
  const app = useApp();
  const spot = app.spot;
  // 처음 탭: 이야기 탭의 "사진으로 물어보기"로 오면 AI 역사 렌즈, 그 밖에는 이야기
  const [tab, setTab] = useState(() => (TABS.includes(app.placeTab.current) ? app.placeTab.current : "story"));
  useEffect(() => { app.placeTab.current = null; }, [app.placeTab]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 음성 해설 진행 (0~1)
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
  // 진행 막대: 예상 길이만큼 시간이 흐르면 채우고, 읽는 위치를 알려 주는 브라우저면 그 위치로도 맞춰요
  const narration = spot ? loc(spot.narration) : "";
  const estSec = voice.estimateSeconds(narration, app.lang);
  useEffect(() => { if (spot && !spot.preparing) voice.prefetchNarration(narration, app.lang); }, [spot?.id, spot?.preparing, narration, app.lang]);
  useEffect(() => {
    if (!playing) { setProgress(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setProgress((p) => Math.max(p, Math.min(0.98, (Date.now() - t0) / 1000 / Math.max(1, estSec)))), 300);
    return () => clearInterval(id);
  }, [playing, estSec]);
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
      onboundary: (i) => setProgress((p) => Math.max(p, Math.min(0.98, i / Math.max(1, text.length)))),
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
  const short = name.replace(/\s*\(.*\)/, "");
  const courseCount = app.data.courses.filter((c) => c.properties.dest === spot.id).length;
  // 근처 둘러볼 곳 모두 보기 → 장소 탭의 코스 따라 보기 (이 목적지를 고른 상태로)
  const openAlongCourse = () => { voice.stop(); app.placesView.current.dest = spot.id; app.placesView.current.kind = "all"; app.go("placesCourse"); };
  const toLens = () => { voice.stop(); setPlaying(false); setTab("history_lens"); };

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
          {/* 대표 사진은 방문 정보 탭에서만 맨 위에 */}
          {tab === "visit" && <div className="pd-lead"><PlacePhoto spot={spot} /></div>}
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
              {/* 1. 도장 + 질문형 제목 */}
              <div className="pd-hook">
                <Seal text={sealText(spot)} size={46} />
                <div>
                  <h2>{loc(spot.hook) || name}</h2>
                  {spot.hook_meta && <p>{loc(spot.hook_meta)}</p>}
                </div>
              </div>
              {/* 2. 음성 해설 */}
              {text && (
                <div className="card pd-audio">
                  <button type="button" className="pd-audio-btn" onClick={listen} aria-pressed={playing}
                    aria-label={playing ? t("pd_listen_stop_card") : t("pd_listen_card", { t: fmtTime(estSec) })}>
                    {playing
                      ? <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
                      : <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
                  </button>
                  <div className="pd-audio-text">
                    <b>{playing ? t("pd_listen_stop_card") : t("pd_listen_card", { t: fmtTime(estSec) })}</b>
                    {playing && <span className="pd-audio-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${progress * 100}%` }} /></span>}
                  </div>
                </div>
              )}
              {audioError && <p className="note cream" role="alert">{audioError}</p>}
              {/* 3. 이야기 카드 한 장씩 */}
              <StoryCards cards={spot.cards || []} />
              {/* 4. AI 역사 렌즈로 */}
              <button type="button" className="pd-lens-cta" onClick={toLens}>
                <span className="pd-lens-ic" aria-hidden="true"><LensIcon /></span>
                <span><b>{t("pd_lens_cta", { name: short })}</b><small>{t("pd_lens_cta_sub")}</small></span>
                <span className="pd-lens-go" aria-hidden="true">›</span>
              </button>
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
                          <PlaceThumb place={p} fallback={<GroupIcon group={groupOf(p)} size={34} />} />
                          <b>{loc(p.name)}</b>
                          <small>{t("about_m", { m: round10(p.nearest_course.straight_m) })}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn btn-soft pd-explore-all" onClick={openAlongCourse}>
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
          : <button className="btn btn-cta" onClick={runHere}>{courseCount ? t("pd_run_n", { name: short, to: withRo(short), n: courseCount }) : t("run_to", { name: short })} →</button>}
      </div>

      {/* 모달 안에서는 잘리니 신고 시트는 폰 화면 위에 띄워요 */}
      {report && (popup
        ? createPortal(<div ref={reportRef}><ReportSheet spot={spot} onClose={() => setReport(false)} /></div>, document.querySelector(".phone"))
        : <ReportSheet spot={spot} onClose={() => setReport(false)} />)}
    </section>
    </>
  );
}

// 이름 + 조사 "로/으로" (받침이 없거나 ㄹ 받침이면 "로")
function withRo(word) {
  const c = word.charCodeAt(word.length - 1) - 0xAC00;
  if (c < 0 || c > 11171) return `${word}로`;
  const jong = c % 28;
  return `${word}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}

// 이야기 카드: 한 장씩 넘겨 봐요 ("이야기 카드 1 / 3", 점, 이전 · 다음)
function StoryCards({ cards }) {
  const [i, setI] = useState(0);
  const n = cards.length;
  if (!n) return null;
  const c = cards[Math.min(i, n - 1)];
  return (
    <section className="card pd-cards" aria-roledescription="carousel" aria-label={t("pd_card_n", { i: i + 1, n })}>
      <div className="pd-cards-head">
        <span>{t("pd_card_n", { i: i + 1, n })}</span>
        <span className="pd-dots" aria-hidden="true">{cards.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</span>
      </div>
      <div aria-live="polite">
        <h3>{loc(c.title)}</h3>
        <p>{loc(c.body)}</p>
      </div>
      <div className="pd-cards-nav">
        <button type="button" disabled={i === 0} onClick={() => setI(i - 1)}>{t("pd_prev")}</button>
        <button type="button" disabled={i >= n - 1} onClick={() => setI(i + 1)}>{t("pd_next")}</button>
      </div>
    </section>
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
