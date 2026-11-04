// 로딩 화면: 글씨 없이 새 로고만 (디자인 캔버스 "로딩" 값 그대로, 390×844 기준).
// 새가 왼쪽 아래에서 날아 들어와(1.7초) 위아래로 떠다니고, 날개를 0.9초마다 펄럭여요.
// 아래에서는 러너 점이 휘어진 점선 길을 달리고, 끝 동그라미에 닿으면 톡 커져요.
// 앱 첫 데이터(코스·스팟)와 로그인 확인이 끝나면 AppContext가 로그인/홈으로 넘겨요.
// 움직임 줄이기 설정이면 모든 움직임을 멈춰요 (CSS + SMIL을 그리지 않음).

import { useReducedMotion, BODY_UP, ROUTE, END, FLAP } from "../components/LogoBird.jsx";

const TRACK = "M8 20 C 38 6, 62 28, 92 16 S 148 8, 168 14";
const BIRD = "#AEDA80";

export default function Loading() {
  const reduced = useReducedMotion();
  return (
    <section className="screen loading-screen" aria-busy="true" aria-label="Loading">
      <div className="hanji-layer" aria-hidden="true" />
      <svg className="ld-art" viewBox="0 0 390 440" aria-hidden="true">
        <circle className="ld-sun" cx="282" cy="96" r="13" fill="#FFF1C2" />

        <g fill="#E2EFD2">
          <g className="ld-cloud c1"><ellipse cx="420" cy="70" rx="34" ry="11" /><ellipse cx="440" cy="63" rx="20" ry="12" /></g>
          <g className="ld-cloud c2"><ellipse cx="470" cy="190" rx="40" ry="12" /><ellipse cx="494" cy="182" rx="22" ry="13" /></g>
          <g className="ld-cloud c3"><ellipse cx="430" cy="330" rx="28" ry="9" /><ellipse cx="446" cy="324" rx="16" ry="10" /></g>
        </g>

        <g className="ld-winds" stroke="#D3E6BC" strokeWidth="3" strokeLinecap="round">
          <line className="ld-wind w1" x1="410" y1="150" x2="450" y2="150" />
          <line className="ld-wind w2" x1="420" y1="214" x2="476" y2="214" />
          <line className="ld-wind w3" x1="400" y1="262" x2="430" y2="262" />
          <line className="ld-wind w4" x1="430" y1="300" x2="480" y2="300" />
          <line className="ld-wind w5" x1="415" y1="122" x2="440" y2="122" />
        </g>

        <ellipse className="ld-shadow" cx="190" cy="400" rx="96" ry="8" fill="#DCEBC8" />

        <g className="ld-flyin">
          <g className="ld-hover">
            <g transform="translate(36 96) scale(0.48) translate(-20 0)">
              <path d={BODY_UP} fill={BIRD} stroke="#5FA52A" strokeOpacity=".45" strokeWidth="6" strokeLinejoin="round">
                {!reduced && (
                  <animate attributeName="d" dur={FLAP.dur} repeatCount="indefinite" calcMode="spline"
                    keyTimes={FLAP.keyTimes} keySplines={FLAP.keySplines} values={FLAP.values} />
                )}
              </path>
              <path className="ld-route" d={ROUTE} fill="none" stroke="#FFFFFF" strokeWidth="16" strokeLinecap="round" />
              <circle cx="96" cy="330" r="12" fill="#FFFFFF" />
              <circle className="ld-halo" cx={END[0]} cy={END[1]} r="30" fill="#FFFFFF" />
              <circle cx={END[0]} cy={END[1]} r="17" fill={BIRD} stroke="#FFFFFF" strokeWidth="9" />
            </g>
          </g>
        </g>
      </svg>

      <div className="ld-progress" role="progressbar" aria-label="Loading">
        <svg width="176" height="32" viewBox="0 0 176 32" aria-hidden="true">
          <defs>
            <linearGradient id="ld-trail-grad" gradientUnits="userSpaceOnUse" x1="8" y1="0" x2="168" y2="0">
              <stop offset="0" stopColor="#9CCB6B" stopOpacity="0" />
              <stop offset=".5" stopColor="#9CCB6B" stopOpacity=".7" />
              <stop offset="1" stopColor="#5E9634" />
            </linearGradient>
          </defs>
          <path d={TRACK} fill="none" stroke="#D3E6BC" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.1 7" />
          <path className="ld-trail" pathLength="100" d={TRACK} fill="none" stroke="url(#ld-trail-grad)" strokeWidth="2.5" strokeLinecap="round" />
          <circle className="ld-goal" cx="168" cy="14" r="4" fill="none" stroke="#9CCB6B" strokeWidth="1.5" />
          {!reduced && (
            <g>
              <circle r="8" fill="#9CCB6B" opacity=".22" />
              <circle r="3.6" fill="#FFFFFF" stroke="#5E9634" strokeWidth="2" />
              <animateMotion dur="2.6s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;.75;1" calcMode="spline"
                keySplines=".45 0 .4 1;0 0 1 1" path={TRACK} />
              <animate attributeName="opacity" dur="2.6s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;.06;.82;1" />
            </g>
          )}
        </svg>
      </div>
    </section>
  );
}
