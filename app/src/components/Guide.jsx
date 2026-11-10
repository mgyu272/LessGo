// 로그인 직후 한 번 뜨는 사용법 카드 (카드뉴스처럼 넘겨 봐요)
// 장소와 이야기(메인) → 코스 고르기 → 달리는 중 → 지도·상권 순서. 그림은 실제 화면을 작게 줄인 모양이에요.
// 옆으로 쓸거나 "다음"으로 넘기고, "건너뛰기"·마지막 "시작하기"로 닫아요 (app.setGuide(false)).

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";

const Svg = ({ children, className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const STAR = <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />;

// ① 추천 코스 3선 카드
function ArtCourses() {
  return (
    <div className="ga-courses">
      <span className="ga-peek" />
      <div className="ga-card">
        <div className="ga-photo"><span className="ga-count">{t("courses_n", { n: 6 })}</span></div>
        <b>{t("guide_art_place")}</b>
        <div className="ga-btns">
          <span className="ga-btn soft">{t("story_visit")}</span>
          <span className="ga-btn ink ga-hit">{t("run_here")} →</span>
        </div>
      </div>
      <span className="ga-peek" />
      <div className="ga-dots"><i className="on" /><i /><i /></div>
    </div>
  );
}

// ② 코스 고르기: 달리기/걷기 · 거리 · 길 종류
function ArtPick() {
  return (
    <div className="ga-pick">
      <div className="ga-seg"><span className="on">{t("guide_art_run")}</span><span>{t("guide_art_walk")}</span></div>
      <div className="ga-km">{[3, 5, 10].map((k) => <span key={k} className={k === 5 ? "on" : ""}>{k}km</span>)}</div>
      <div className="ga-routes">
        <span className="ga-route low"><i />{t("guide_art_low")}</span>
        <span className="ga-route high"><i />{t("guide_art_high")}</span>
      </div>
    </div>
  );
}

// ③ 달리는 중: 음성 안내 배너 · 별
function ArtRun() {
  return (
    <div className="ga-run">
      <div className="ga-cue"><Svg><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M16.5 8.5a5 5 0 010 7" /></Svg><span>{t("guide_art_cue")}</span></div>
      <div className="ga-stars">{[0, 1, 2, 3, 4].map((k) => <Svg key={k} className={k < 3 ? "on" : ""}>{STAR}</Svg>)}</div>
      <div className="ga-stamp"><span>{t("guide_art_stamp")}</span></div>
    </div>
  );
}

// ④ 하단 메뉴: 지도 · 상권 강조
function ArtTabs() {
  const tabs = [
    ["tab_places", <path key="p" d="M4 19.5V6a2 2 0 012-2h11v14H6a2 2 0 00-2 1.5zM4 19.5A2 2 0 006 21h12" />, false],
    ["tab_map", <path key="p" d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />, true],
    ["tab_market", <path key="p" d="M4 9l1.5-5h13L20 9 M4 9h16v11H4z M10 20v-5h4v5" />, true],
    ["tab_stats", <path key="p" d="M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2" />, false],
  ];
  return (
    <div className="ga-tabs">
      {tabs.map(([key, icon, hit]) => (
        <span key={key} className={hit ? "hit" : ""}><Svg>{icon}</Svg>{t(key)}</span>
      ))}
    </div>
  );
}

const SLIDES = [
  { art: ArtCourses, title: "guide_t1", body: "guide_b1" },
  { art: ArtPick, title: "guide_t2", body: "guide_b2" },
  { art: ArtRun, title: "guide_t3", body: "guide_b3" },
  { art: ArtTabs, title: "guide_t4", body: "guide_b4" },
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
        <div className="guide-art" key={"a" + i}><Art /></div>
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
