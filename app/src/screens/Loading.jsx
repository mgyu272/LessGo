// 로딩 화면: 글씨 없이 새 로고만. 새가 왼쪽 아래에서 날아 들어와 떠다니고,
// 아래에서는 러너 점이 휘어진 점선 길을 달려 끝 동그라미에 닿으면 톡 커져요.
// 앱 첫 데이터(코스·스팟)와 로그인 확인이 끝나면 AppContext가 로그인/홈으로 넘겨요.

import { LogoBird, useReducedMotion } from "../components/LogoBird.jsx";

const TRACK = "M30 46 C 90 10, 150 70, 210 40 S 300 18, 330 34";

export default function Loading() {
  const reduced = useReducedMotion();
  return (
    <section className="screen loading-screen" aria-busy="true" aria-label="Loading">
      <div className="hanji-layer" aria-hidden="true" />
      <svg className="ld-sky" viewBox="0 0 393 852" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <circle className="ld-sun" cx="296" cy="168" r="46" fill="#FBF3D9" />
        <g className="ld-clouds" fill="#FFFFFF" opacity=".85">
          <g className="ld-cloud c1"><ellipse cx="80" cy="140" rx="46" ry="15" /><ellipse cx="104" cy="130" rx="26" ry="15" /></g>
          <g className="ld-cloud c2"><ellipse cx="300" cy="250" rx="54" ry="16" /><ellipse cx="276" cy="240" rx="28" ry="15" /></g>
          <g className="ld-cloud c3"><ellipse cx="180" cy="610" rx="40" ry="12" /><ellipse cx="198" cy="602" rx="20" ry="11" /></g>
        </g>
        <g className="ld-wind" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity=".9">
          <path className="w1" d="M240 330 q 30 -8 60 0" />
          <path className="w2" d="M60 470 q 36 -10 72 0" />
          <path className="w3" d="M270 540 q 26 -7 52 0" />
        </g>
      </svg>

      <div className="ld-center">
        <div className="ld-bird">
          <div className="ld-float">
            <LogoBird size={170} flap fill="#AEDA80" stroke="rgba(95,165,42,.45)" strokeWidth={6} />
          </div>
        </div>
        <span className="ld-shadow" aria-hidden="true" />
      </div>

      <svg className="ld-track" viewBox="0 0 360 70" aria-hidden="true">
        <path d={TRACK} fill="none" stroke="#C6E59E" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />
        <path className="ld-trail" d={TRACK} fill="none" stroke="#5FA52A" strokeWidth="4" strokeLinecap="round" pathLength="100" />
        <circle className="ld-goal" cx="330" cy="34" r="7" fill="#FFFFFF" stroke="#5FA52A" strokeWidth="3" />
        <circle r="6.5" cx={reduced ? 30 : 0} cy={reduced ? 46 : 0} fill="#2F6512" stroke="#FFFFFF" strokeWidth="2.5">
          {reduced ? null : <animateMotion dur="2.4s" repeatCount="indefinite" path={TRACK} keyPoints="0;1;1" keyTimes="0;.85;1" calcMode="linear" />}
        </circle>
      </svg>
    </section>
  );
}
