// 로딩 화면: 글씨 없이 새 로고만 (디자인 캔버스 "로딩" 값 그대로, 390×844 기준).
// 새가 왼쪽 아래에서 날아 들어와(1.7초) 위아래로 떠다니고, 날개를 0.9초마다 펄럭여요.
// 앱 첫 데이터(코스·스팟)와 로그인 확인이 끝나면 AppContext가 로그인/홈으로 넘겨요.
// 움직임 줄이기 설정이면 모든 움직임을 멈춰요 (CSS + SMIL을 그리지 않음).

import { useReducedMotion, BODY_UP, ROUTE, END, FLAP } from "../components/LogoBird.jsx";

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

    </section>
  );
}
