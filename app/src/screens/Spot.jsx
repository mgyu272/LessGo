// ⑥ 스팟 도착 (시안 6번) · ⑦ 주변 가게 (시안 7번) · ⑧ 쿠폰 (시안 8번)

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc, getLang } from "../lib/i18n.js";
import { distance, fmtTime } from "../lib/geo.js";
import { askSpot } from "../lib/ask.js";
import * as voice from "../lib/voice.js";
import { ShopRow, FakeQr, LangPill, Seal, sealText } from "../components/Bits.jsx";
import { CENTER } from "../state/AppContext.jsx";

const CAT = { history: ["History spot", "역사문화 스팟"], stream: ["Stream spot", "하천길 스팟"], park: ["Park & view spot", "공원·전망 스팟"] };

// ---------------- ⑥ 스팟 도착 ----------------
export function Spot() {
  const app = useApp();
  const spot = app.spot;
  const lang = app.lang;
  const text = loc(spot.narration);
  const total = voice.estimateSeconds(text, lang);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showScript, setShowScript] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState(null); // {loading} | {text, sources, cached} | {none}
  const timer = useRef(null);

  const stopAudio = (done = false) => { voice.stop(); clearInterval(timer.current); setPlaying(false); setProgress(done ? 100 : 0); };
  const play = () => {
    if (playing) return stopAudio();
    setPlaying(true);
    const started = Date.now();
    timer.current = setInterval(() => setProgress(Math.min(100, ((Date.now() - started) / 1000 / total) * 100)), 300);
    voice.speak(text, { lang: getLang(), queue: false, onend: () => { clearInterval(timer.current); setPlaying(false); setProgress(100); } });
  };

  // 도착하자마자 해설 자동 재생 (방금 도착했을 때만)
  useEffect(() => {
    const at = app.run.arrivedAt();
    if (at && Date.now() - at < 3000) { const id = setTimeout(play, 600); return () => clearTimeout(id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.id]);
  useEffect(() => () => { voice.stop(); clearInterval(timer.current); }, []);

  const ask = async (text = q) => {
    if (!text.trim()) return;
    setAnswer({ loading: true });
    const res = await askSpot(spot, text.trim());
    setAnswer(res.answer ? { text: res.answer, sources: res.sources, cached: res.cached, model: res.model } : { none: true });
  };

  // 말로 묻기 (브라우저 음성 인식, 지원하는 브라우저에서만 버튼이 보여요)
  const mic = useSpeechInput(lang, (text) => { setQ(text); ask(text); });

  return (
    <section className="screen dark">
      <div className="spot-top">
        <Seal text={sealText(spot)} size={64} stamp />
        <div className="stamp-text"><b>{loc(spot.name)}</b><small>{t("stamped")}</small></div>
      </div>
      <div className="sheet spot-sheet">
        <div className="grip" />
        <div className="scroll-y">
          <div className="row-between">
            <p className="eyebrow purple">{(CAT[spot.category] || CAT.history)[lang === "ko" ? 1 : 0]}</p>
            <LangPill soft />
          </div>
          <small className="muted">{t("ai_reviewed")}</small>

          <div className="cards">
            {spot.cards.map((c, i) => (
              <article className="story" key={i}>
                <span className="n">{i + 1} / {spot.cards.length}</span>
                <h3>{loc(c.title)}</h3>
                <p>{loc(c.body)}</p>
                {i < spot.cards.length - 1 && <span className="swipe">{t("swipe_next")}</span>}
              </article>
            ))}
          </div>

          <div className="audio">
            <button className="play" onClick={play} aria-label="play">{playing ? "■" : "▶"}</button>
            <div className="audio-mid"><b>{t("listen")}</b><div className="bar"><i style={{ width: progress + "%" }} /></div></div>
            <small>{fmtTime(total)}</small>
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
      </div>
    </section>
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
