// ⑥ 스팟 도착 (시안 6번) · ⑦ 주변 가게 (시안 7번) · ⑧ 쿠폰 (시안 8번)

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc, getLang } from "../lib/i18n.js";
import { distance, fmtTime } from "../lib/geo.js";
import { askSpot } from "../lib/ask.js";
import * as voice from "../lib/voice.js";
import { ShopRow, FakeQr, LangPill } from "../components/Bits.jsx";
import { spotIconSvg } from "../components/SpotIcons.jsx";
import { LogoBird } from "../components/LogoBird.jsx";
import { useBottomSheet, BottomSheet } from "../components/ui.jsx";
import { CENTER } from "../state/AppContext.jsx";

const CAT = { history: ["History spot", "역사문화 스팟"], stream: ["Stream spot", "하천길 스팟"], park: ["Park & view spot", "공원·전망 스팟"] };

// ---------------- ⑥ 스팟 도착 ----------------
export function Spot() {
  const app = useApp();
  const spot = app.spot;
  const lang = app.lang;
  const text = loc(spot.narration);
  // 전체 길이: 브라우저 음성 읽기는 길이를 미리 알려주지 않아서 글자 수로 추정한 값이에요
  // (한국어 초당 6.5자, 영어 초당 2.6단어 · lib/voice.js estimateSeconds). 실제 끝나면 끝까지 채워요.
  const total = voice.estimateSeconds(text, lang);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0); // 지금까지 읽은 시간(초)
  const [showScript, setShowScript] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState(null); // {loading} | {text, sources, cached} | {none}
  const timer = useRef(null);
  // 해설 시트: 처음엔 레코드판 아래부터, 끌어올리면 화면 위까지
  const sheet = useBottomSheet({ snaps: (h) => [Math.max(320, h - 380), h - 64], initial: 0 });
  // 읽는 위치: from = 이번에 읽기 시작한 글자, at/atTime = 마지막으로 알려준 단어 위치와 그때 시각
  const pos = useRef({ token: 0, from: 0, startTime: 0, at: null, atTime: 0, resume: 0 });

  // 브라우저가 단어 위치(onboundary)를 알려주면 그 글자 위치로, 안 알려주면 흐른 시간으로 재요
  const elapsed = () => {
    const p = pos.current, now = Date.now();
    const sec = p.at != null
      ? (p.at / text.length) * total + Math.min((now - p.atTime) / 1000, 1.5)
      : (p.from / text.length) * total + (now - p.startTime) / 1000;
    return Math.min(total, sec);
  };
  const halt = () => { pos.current.token++; voice.stop(); clearInterval(timer.current); setPlaying(false); };
  // 멈춘 자리부터 다시 들을 수 있게, 마지막 단어 위치(없으면 시간으로 계산한 위치)를 기억해요
  const pause = () => {
    const p = pos.current;
    const at = p.at ?? Math.round((elapsed() / total) * text.length);
    p.resume = Math.max(0, text.lastIndexOf(" ", at) + 1);
    setCur((p.resume / text.length) * total);
    halt();
  };
  const stopAudio = () => { halt(); pos.current.resume = 0; setCur(0); };
  const play = () => {
    if (playing) return pause();
    const p = pos.current;
    const from = p.resume >= text.length - 1 ? 0 : p.resume;
    const token = ++p.token;
    Object.assign(p, { from, startTime: Date.now(), at: null });
    setPlaying(true);
    timer.current = setInterval(() => setCur(elapsed()), 250);
    voice.speak(text.slice(from), {
      lang: getLang(), queue: false,
      onboundary: (i) => { if (p.token === token) { p.at = from + i; p.atTime = Date.now(); } },
      onend: () => {
        if (p.token !== token) return; // 멈춤·다시 듣기로 끊긴 건 무시
        clearInterval(timer.current); setPlaying(false); setCur(total); p.resume = 0;
      },
    });
  };

  // 도착하자마자 해설 자동 재생 (방금 도착했을 때만)
  useEffect(() => {
    const at = app.run.arrivedAt();
    if (at && Date.now() - at < 3000) { const id = setTimeout(play, 600); return () => clearTimeout(id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.id]);
  useEffect(() => () => { pos.current.token++; voice.stop(); clearInterval(timer.current); }, []);

  const ask = async (text = q) => {
    if (!text.trim()) return;
    setAnswer({ loading: true });
    const res = await askSpot(spot, text.trim());
    setAnswer(res.answer ? { text: res.answer, sources: res.sources, cached: res.cached, model: res.model } : { none: true });
  };

  // 말로 묻기 (브라우저 음성 인식, 지원하는 브라우저에서만 버튼이 보여요)
  const mic = useSpeechInput(lang, (text) => { setQ(text); ask(text); });

  return (
    <section className="screen spot-screen">
      <header className="spot-head">
        <button className="round-btn glass" onClick={() => { stopAudio(); app.run.resume(); }} aria-label={t("keep_running")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
      </header>
      <Record spot={spot} playing={playing} />
      <div className="spot-title"><b>{loc(spot.name)}</b><small>{t("stamped")}</small></div>
      <BottomSheet sheet={sheet} className="spot-sheet2">
        <div className="scroll-y spot-body">
          <div className="spot-cat">
            <p>{(CAT[spot.category] || CAT.history)[lang === "ko" ? 1 : 0]}</p>
            <LangPill glass />
          </div>
          <small className="muted">{t("ai_reviewed")}</small>

          {/* 이야기 카드: spots.json의 cards (밝은 반투명 카드, 옆으로 넘겨요) */}
          <div className="story-rail" role="list">
            {spot.cards.map((c, i) => (
              <article className={`story2 ${i === 0 ? "first" : ""}`} key={i} role="listitem">
                <div className="s2-head">
                  <span className="s2-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(spot) }} />
                  <span className="s2-n">{t("story_n", { i: i + 1, n: spot.cards.length })}</span>
                </div>
                <h3>{loc(c.title)}</h3>
                <p>{loc(c.body)}</p>
                <span className="s2-dots" aria-hidden="true">{spot.cards.map((_, j) => <i key={j} className={j === i ? "on" : ""} />)}</span>
              </article>
            ))}
          </div>

          <div className={`audio glass ${playing ? "playing" : ""}`}>
            <button className="play" onClick={play} aria-label={t(playing ? "audio_pause" : "audio_play")} aria-pressed={playing}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                {playing ? <path d="M7 5h3.5v14H7z M13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13a1 1 0 001.5.9l10-6.5a1 1 0 000-1.8l-10-6.5A1 1 0 008 5.5z" />}
              </svg>
            </button>
            <div className="audio-mid">
              <b>{t("listen")}{playing && <span className="eq" aria-hidden="true"><i /><i /><i /><i /></span>}</b>
              <div className="bar"><i style={{ width: (cur / total) * 100 + "%" }} /></div>
            </div>
            <small className="audio-time">{fmtTime(cur)} / {fmtTime(total)}</small>
          </div>
          {showScript && <div className="script">{text}</div>}
          <button className="link" onClick={() => setShowScript(!showScript)}>{t(showScript ? "hide_script" : "show_script")}</button>

          <p className="note cream">{loc(spot.notice)}</p>

          <div className="ask">
            <h4>{t("ask_title")}</h4>
            <div className="ask-row">
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder={mic.listening ? t("listening") : t("ask_ph")} />
              {mic.supported && (
                <button className={`mic ${mic.listening ? "on" : ""}`} onClick={mic.toggle} aria-label={t("mic")} title={t("mic")}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
                </button>
              )}
              <button className="btn btn-ink sm" onClick={() => ask()}>{t("ask_btn")}</button>
            </div>
            {answer && (
              <div className="ask-answer" data-testid="answer">
                {answer.loading ? t("asking") : answer.none ? t("no_answer") : (
                  <>
                    {answer.text}
                    {answer.sources.length > 0 && (
                      <span className="src">
                        {t("sources")}: {answer.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener">{s.title}</a>)}
                        {answer.cached && " " + t("offline_answer")}
                      </span>
                    )}
                    {!answer.cached && answer.model && <span className="src">✦ AI · {answer.model}</span>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="cta-row two">
          <button className="btn btn-teal" onClick={() => { stopAudio(); app.run.resume(); }}>{t("keep_running")}</button>
          <button className="btn btn-outline" onClick={() => { stopAudio(); app.go("shops"); }}>{t("nearby_shops")}</button>
        </div>
        <p className="foot">{t("partner_note")}</p>
      </BottomSheet>
    </section>
  );
}

// 도착 화면 레코드판: 해설을 들을 때 판이 돌고 톤암이 판 위로 내려와요
function Record({ spot, playing }) {
  return (
    <div className={`record-wrap ${playing ? "playing" : ""}`} aria-hidden="true">
      <div className="vinyl">
        <div className="record-disc">
          <span className="record-label" dangerouslySetInnerHTML={{ __html: spotIconSvg(spot) }} />
        </div>
        <span className="record-shine" />
      </div>
      <svg className="tonearm" viewBox="0 0 70 150">
        <circle cx="52" cy="16" r="11" fill="#F3FBE8" stroke="#4F6B3B" strokeWidth="3" />
        <path d="M52 16V100L36 128" fill="none" stroke="#4F6B3B" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="27" y="124" width="16" height="12" rx="3" fill="#2F6512" transform="rotate(30 35 130)" />
        <circle cx="52" cy="16" r="4" fill="#4F6B3B" />
      </svg>
      <span className="rec-stamp">
        <LogoBird variant="icon" size={52} />
        <i className="spark s1">✦</i><i className="spark s2">✦</i><i className="spark s3">✦</i><i className="spark s4">✦</i>
      </span>
    </div>
  );
}

// ---------------- ⑦ 주변 가게 ----------------
export function Shops() {
  const app = useApp();
  const here = app.run.view?.me ? { lat: app.run.view.me[0], lng: app.run.view.me[1] } : app.spot || { lat: CENTER[0], lng: CENTER[1] };
  const list = app.data.shops.map((s) => ({ s, d: distance(here, s) })).sort((a, b) => a.d - b.d).slice(0, 4);
  const openCoupon = (shop) => { app.setCouponShop(shop); app.go("coupon"); };
  return (
    <section className="screen overlay">
      <div className="dim" onClick={app.run.resume} />
      <div className="sheet">
        <div className="grip" />
        <div className="sheet-head"><h3>{t("near_here")}</h3><small className="muted">{t("partners_n", { n: list.filter((x) => x.s.partner).length })}</small></div>
        {list.map(({ s, d }) => <ShopRow key={s.id} shop={s} dist={d} onCoupon={openCoupon} />)}
        <button className="btn btn-outline" onClick={app.run.resume}>{t("keep_running")}</button>
      </div>
    </section>
  );
}

// ---------------- ⑧ 쿠폰 ----------------
export function Coupon() {
  const app = useApp();
  const s = app.couponShop;
  const title = s.couponTitle || s.coupon;
  const save = () => {
    if (!s.couponTitle) app.user.addCoupon({ id: "c" + Date.now(), shopId: s.id, title: s.coupon, issued: Date.now() });
    app.toast(t("coupon_saved"));
    app.run.isRunning() ? app.run.resume() : app.go("home");
  };
  return (
    <section className="screen dark">
      <div className="coupon-wrap">
        <span className="pill-yellow">{app.lang === "ko" ? `${loc(s.name)} 근처예요` : `Near ${loc(s.name)}`}</span>
        <div className="coupon">
          <small className="muted">{t("coupon_got")}</small>
          <h2 className="serif">{loc(title)}</h2>
          <div className="qr"><FakeQr seed={s.id} /></div>
          <small className="muted">{t("coupon_use")}</small>
          <button className="btn btn-teal" onClick={save}>{t("coupon_save")}</button>
        </div>
        <div className="star-box">
          <div className="row"><span className="star-badge">★</span><div><b>{t("buy_star")}</b><small>{t("buy_star_sub")}</small></div></div>
          <button className="btn btn-outline" onClick={() => { app.user.addBonus(s.buy_stars || 2, "purchase:" + s.id); app.toast(t("buy_ok")); }}>{t("verify_buy")}</button>
        </div>
        <p className="foot light">{t("coupon_foot")}</p>
      </div>
    </section>
  );
}

function useSpeechInput(lang, onText) {
  const Rec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const toggle = () => {
    if (!Rec) return;
    if (listening) { recRef.current?.stop(); return; }
    voice.stop(); // 해설이 나오는 중이면 멈추고 들어요
    const rec = new Rec();
    rec.lang = lang === "ko" ? "ko-KR" : "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => onText(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  return { supported: !!Rec, listening, toggle };
}
