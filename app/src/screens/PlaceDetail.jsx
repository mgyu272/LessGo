// ⑧ 장소 상세 (디자인 원본 docs/design/PlaceDetail.dc.html)
// 탭: 이야기(해설 듣기 + spots.json cards + 출처) / 방문 정보 / 문화 활동
// "정보가 달라요" → 신고 시트 → Firestore reports 컬렉션에 저장
// 관람 시간·관람료·주소·가는 길은 아직 데이터가 없어서 "정보 준비 중"으로 보여줘요 (가짜 값을 넣지 않아요).

import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc, getLang } from "../lib/i18n.js";
import { fmtTime } from "../lib/geo.js";
import * as voice from "../lib/voice.js";
import { PLACE_TOPICS, REPORT_REASONS, kakaoDirections } from "../lib/places.js";
import { spotIconSvg } from "../components/SpotIcons.jsx";
import { PlaceEvents } from "./Events.jsx";

const TABS = ["story", "visit", "events"];

export default function PlaceDetail() {
  const app = useApp();
  const spot = app.spot;
  const [tab, setTab] = useState("story");
  const [playing, setPlaying] = useState(false);
  const [report, setReport] = useState(false);
  useEffect(() => () => voice.stop(), []);
  if (!spot) return null;

  const name = loc(spot.name);
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
  const runHere = () => { voice.stop(); app.setPick({ ...app.pick, dest: spot.id }); app.go("courses"); };
  const back = () => { voice.stop(); app.go("places"); };

  return (
    <section className="screen pd-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="pd-scroll">
        <div className="pd-hero">
          <div className="pd-bar">
            <button className="round-btn glass" onClick={back} aria-label={t("back")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></button>
            <button className="round-btn glass" onClick={share} aria-label={t("share")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg></button>
          </div>
          <div className="pd-id">
            <span className="pd-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(spot) }} />
            <div>
              <small>{(PLACE_TOPICS[spot.id] || []).map((k) => t("topic_" + k)).join(" · ") || t("filter_" + spot.category)}</small>
              <h1>{name}</h1>
            </div>
          </div>
        </div>

        <div className="pd-tabs" role="tablist" aria-label={t("place_info")}>
          {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className="pd-tab" onClick={() => setTab(k)}>{t("pd_tab_" + k)}</button>)}
        </div>

        <div className="pd-body">
          {tab === "story" && (
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

          {tab === "visit" && (
            <div className="rise pd-col">
              <div className="card pd-rows">
                {["hours", "fee", "address", "access"].map((k) => (
                  <div className="pd-row" key={k}>
                    <span className="pd-row-ic" aria-hidden="true" />
                    <span><small>{t("visit_" + k)}</small><b>{t("info_pending")}</b>{k === "address" && <small>{t("visit_check_site")}</small>}{k === "access" && <small>{t("visit_quiet")}</small>}</span>
                  </div>
                ))}
              </div>
              {loc(spot.notice) && <p className="note mint">{loc(spot.notice)}</p>}
              <div className="pd-links">
                <a className="btn btn-soft" href={kakaoDirections(name, spot.lat, spot.lng)} target="_blank" rel="noopener">{t("directions")}</a>
              </div>
              <div className="pd-check">
                <small>{t("last_checked", { date: t("info_pending") })}</small>
                <button onClick={() => setReport(true)}>{t("info_wrong")}</button>
              </div>
            </div>
          )}

          {tab === "events" && <div className="rise pd-col"><PlaceEvents spotId={spot.id} /></div>}
        </div>
      </div>

      <div className="pd-cta">
        <button className="btn btn-cta" onClick={runHere}>{t("run_to", { name: name.replace(/\s*\(.*\)/, "") })} →</button>
      </div>

      {report && <ReportSheet spot={spot} onClose={() => setReport(false)} />}
    </section>
  );
}

// 정보가 달라요: 이유 고르기 + 자세히(선택) → Firestore reports
function ReportSheet({ spot, onClose }) {
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
