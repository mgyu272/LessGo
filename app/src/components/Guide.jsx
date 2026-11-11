// 로그인 직후 한 번 뜨는 사용법 카드 (카드뉴스처럼 넘겨 봐요)
// 관광 코스 3선 → 코스 고르기 → AI 역사 렌즈 → 도착 도장 순서. 장마다 그림 배경색이 달라요.
// 옆으로 쓸거나 "다음"으로 넘기고, "건너뛰기"·마지막 "시작하기"로 닫아요 (app.setGuide(false)).

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";



// 카드 사진(심우장·의릉)은 앱에 같이 들어 있어요 (public/guide). 로그인 전 소개 화면에서 미리 받아 둬서 카드가 뜰 때 바로 보여요.
const GUIDE_PHOTOS = {
  simujang: { src: "/guide/simujang.webp", credit: "사진: 한국관광공사" },
  uiryeong: { src: "/guide/uiryeong.webp", credit: "사진: 위키미디어 공용" },
};
let preloaded = false;
export function preloadGuidePhotos() {
  if (preloaded) return;
  preloaded = true;
  Object.values(GUIDE_PHOTOS).forEach(({ src }) => { const im = new Image(); im.decoding = "async"; im.src = src; });
}
function GuidePhoto({ id }) {
  const { src, credit } = GUIDE_PHOTOS[id];
  return (
    <>
      <img className="ga-img" src={src} alt="" decoding="async" fetchpriority="high" />
      <span className="ga-credit">{credit}</span>
    </>
  );
}

// ① 관광 코스 3선: 사진 카드 + "여기로 달리기"만
function ArtCourses() {
  return (
    <div className="ga-card">
      <div className="ga-photo"><GuidePhoto id="simujang" /></div>
      <b>{t("guide_art_place")}</b>
      <span className="ga-btn ga-hit">{t("run_here")} →</span>
    </div>
  );
}

// ② 코스 고르기: 거리 · 길 종류
function ArtPick() {
  return (
    <div className="ga-pick">
      <div className="ga-km">{[3, 5, 10].map((k) => <span key={k} className={k === 5 ? "on" : ""}>{k}<small>km</small></span>)}</div>
      <div className="ga-routes">
        <span className="ga-route low"><svg viewBox="0 0 40 16" aria-hidden="true"><path d="M2 12 C12 12, 16 9, 22 9 S32 7, 38 7" /></svg>{t("guide_art_low")}</span>
        <span className="ga-route high"><svg viewBox="0 0 40 16" aria-hidden="true"><path d="M2 14 L10 5 L16 11 L25 2 L31 9 L38 4" /></svg>{t("guide_art_high")}</span>
      </div>
    </div>
  );
}

// 의릉 사진을 못 불러올 때 쓰는 그림 (능 봉분 · 소나무)
const TOMB = (
  <svg className="ga-tomb" viewBox="0 0 240 150" aria-hidden="true">
    <rect width="240" height="150" fill="#BFE0F5" />
    <path d="M0 96 Q60 70 120 88 T240 80 V150 H0z" fill="#7FB85A" />
    <ellipse cx="120" cy="98" rx="46" ry="20" fill="#5E9E3A" />
    <rect x="70" y="104" width="100" height="8" rx="2" fill="#D9CBB0" />
    <path d="M30 100 l12 -30 l12 30z M196 96 l12 -32 l12 32z" fill="#2F6A2A" />
    <path d="M0 150 V118 Q120 104 240 118 V150z" fill="#94C86E" />
  </svg>
);

// ③ AI 역사 렌즈: 의릉을 카메라로 찍는 화면
function ArtLens() {
  return (
    <div className="ga-cam">
      <span className="ga-cam-top"><i />{t("pd_tab_history_lens")}</span>
      <div className="ga-view">
        {TOMB}
        <GuidePhoto id="uiryeong" />
        <span className="ga-focus" aria-hidden="true"><i className="tl" /><i className="tr" /><i className="bl" /><i className="br" /></span>
        <span className="ga-ai"><b>AI</b>{t("guide_art_lens_result")}</span>
      </div>
      <span className="ga-shutter" aria-hidden="true"><i /></span>
    </div>
  );
}

// ④ 도착: 도장 하나
function ArtStamp() {
  return (
    <div className="ga-seal" aria-hidden="true"><span>{t("guide_art_stamp")}</span></div>
  );
}

const SLIDES = [
  { art: ArtCourses, title: "guide_t1", body: "guide_b1" },
  { art: ArtPick, title: "guide_t2", body: "guide_b2" },
  { art: ArtLens, title: "guide_t3", body: "guide_b3" },
  { art: ArtStamp, title: "guide_t4", body: "guide_b4" },
];

export default function Guide() {
  const app = useApp();
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const close = () => app.setGuide(false);
  const next = () => (last ? close() : setI(i + 1));
  const prev = () => setI(Math.max(0, i - 1));
  const start = useRef(null);
  const box = useRef(null);
  useEffect(() => { box.current?.focus(); }, []);

  const down = (e) => { start.current = e.clientX; };
  const up = (e) => {
    if (start.current == null) return;
    const dx = e.clientX - start.current; start.current = null;
    if (dx < -40) next(); else if (dx > 40) prev();
  };
  const key = (e) => {
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") prev();
    if (e.key === "Escape") close();
  };
  const { art: Art, title, body } = SLIDES[i];

  return (
    <div className="guide-scrim">
      <div className="guide" role="dialog" aria-modal="true" aria-label={t("guide_label")} tabIndex={-1} ref={box}
        onKeyDown={key} onPointerDown={down} onPointerUp={up} onPointerCancel={() => { start.current = null; }}>
        <div className="guide-head">
          <span className="guide-step">{i + 1} / {SLIDES.length}</span>
          {!last && <button type="button" className="guide-skip" onClick={close}>{t("guide_skip")}</button>}
        </div>
        <div className={`guide-art tone-${i + 1}`} key={"a" + i}><Art /></div>
        <div className="guide-text" key={"t" + i}>
          <h2>{t(title)}</h2>
          <p>{t(body)}</p>
        </div>
        <div className="guide-dots" aria-hidden="true">{SLIDES.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>
        <div className="guide-foot">
          {i > 0 && <button type="button" className="btn-pill btn-guest guide-prev" onClick={prev}>{t("guide_prev")}</button>}
          <button type="button" className="btn-pill btn-idlogin guide-next" onClick={next}>{last ? t("guide_done") : t("guide_next")}</button>
        </div>
      </div>
    </div>
  );
}
