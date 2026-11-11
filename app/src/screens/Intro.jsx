// 로그인 전 첫 화면: 성북런 소개
// 1) 연두 빈 화면에 행사 문구가 크게 페이드인 → 페이드아웃 (두 문장 차례로). 화면을 누르면 건너뛰어요.
// 2) 성북런 로고 · 한 줄 소개 · 핵심 3가지 → "시작하기"로 로그인 화면.
// 행사 문구(주민 인기투표용)는 우선 한국어로 고정해 둬요. 바꿀 때는 PHRASES만 고치면 돼요.

import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";
import { Brand, useReducedMotion } from "../components/LogoBird.jsx";
import { LangSwitch } from "../components/Bits.jsx";
import { preloadGuidePhotos } from "../components/Guide.jsx";

const PHRASES = [
  <>오늘은 <mark>한성대 분수마루</mark>에<br />방문해주셨네요!</>,
  <>이 다음에는<br /><mark>어디로</mark> 가볼까요?</>,
];
const PHRASE_MS = 2800; // 문장 하나: 페이드인 0.9초 · 머무름 1초 · 페이드아웃 0.9초

const POINTS = [
  ["route", "intro_p1"],
  ["lens", "intro_p2"],
  ["star", "intro_p3"],
];
const POINT_ICONS = {
  route: <><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M8 18h6.5a3.5 3.5 0 000-7h-5a3.5 3.5 0 010-7H16" /></>,
  voice: <><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M16.5 8.5a5 5 0 010 7 M19 6a8.5 8.5 0 010 12" /></>,
  lens: <><path d="M4 8.5A1.5 1.5 0 015.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" /><circle cx="12" cy="13" r="3.5" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
};

export default function Intro() {
  const app = useApp();
  const reduced = useReducedMotion();
  const [i, setI] = useState(0); // 0·1 = 문장, 2 = 소개
  const done = i >= PHRASES.length;
  useEffect(() => { preloadGuidePhotos(app.data); }, [app.data]); // 로그인 뒤 사용법 카드 사진을 미리

  useEffect(() => {
    if (done || reduced) return;
    const id = setTimeout(() => setI((n) => n + 1), PHRASE_MS);
    return () => clearTimeout(id);
  }, [i, done, reduced]);

  if (!done) {
    return (
      <section className={`screen intro-screen ${reduced ? "still" : ""}`} onClick={() => setI((n) => n + 1)}
        role="button" tabIndex={0} aria-label={t("intro_skip")} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setI((n) => n + 1)}>
        <div className="hanji-layer" aria-hidden="true" />
        <p key={i} className="intro-phrase" lang="ko">{PHRASES[i]}</p>
        <span className="intro-tap" aria-hidden="true">{t("intro_tap")}</span>
      </section>
    );
  }

  return (
    <section className="screen intro-screen intro-about">
      <div className="hanji-layer" aria-hidden="true" />
      <header className="login-top"><LangSwitch /></header>
      <div className="intro-body">
        <div className="login-brand">
          <Brand size={96} name="성북런" subtitle={false} className="login-brand-mark" />
          <span>SEONGBUK RUN</span>
        </div>
        <p className="intro-tagline">{t("intro_tagline")}</p>
        <ul className="intro-points">
          {POINTS.map(([ic, key]) => (
            <li key={key} className={`ip-${ic}`}>
              <span className="intro-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{POINT_ICONS[ic]}</svg></span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="btn-pill btn-idlogin intro-start" onClick={() => app.go("onboarding")}>{t("intro_start")}</button>
    </section>
  );
}
