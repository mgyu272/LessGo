// 로그인 화면 가운데 낮 풍경: 해, 흐르는 구름, 연두 언덕 3겹, 크림색 성곽, 둥근 나무 3그루,
// 흰 점선 길을 따라 러너가 달려가 초록 핀에 도착 (핀은 통통 튀고 펄스). 아래는 물결 모양으로 배경색과 이어져요.

import { useReducedMotion } from "./LogoBird.jsx";

const ROUTE = "M28 214 C 80 196, 120 214, 164 196 S 250 168, 296 172 S 344 150, 360 132";
const wallY = (x) => 166 - 10 * Math.sin(x / 60) - x * 0.03;

export default function LoginScene() {
  const reduced = useReducedMotion();
  const top = [], merlons = [];
  for (let x = -10; x <= 400; x += 10) top.push(`${x},${wallY(x).toFixed(1)}`);
  for (let x = 0; x <= 390; x += 14) merlons.push(<rect key={x} x={x} y={wallY(x + 4) - 7} width="8" height="8" rx="1.5" />);
  return (
    <svg className="login-scene" viewBox="0 0 390 250" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <circle className="ls-sun" cx="318" cy="56" r="26" fill="#FFF3C9" />
      <circle cx="318" cy="56" r="40" fill="#FFF3C9" opacity=".35" />
      <g className="ls-clouds" fill="#FFFFFF">
        <g className="ls-cloud a"><ellipse cx="70" cy="52" rx="34" ry="11" /><ellipse cx="88" cy="44" rx="18" ry="11" /></g>
        <g className="ls-cloud b"><ellipse cx="230" cy="34" rx="28" ry="9" /><ellipse cx="244" cy="28" rx="14" ry="9" /></g>
      </g>
      <path d="M0 150 C 60 112, 120 118, 180 132 S 300 104, 390 126 V250 H0 Z" fill="#CDEBA6" />
      <path d="M0 172 C 70 146, 150 150, 220 160 S 330 140, 390 152 V250 H0 Z" fill="#B4DE84" />
      <polygon points={`${top.join(" ")} 400,250 -10,250`} fill="#F4EEDB" />
      <g fill="#F4EEDB">{merlons}</g>
      <path d="M0 196 C 80 180, 160 190, 240 186 S 340 176, 390 182 V250 H0 Z" fill="#9BD067" />
      <g>
        {[[52, 176, 15], [98, 182, 11], [342, 168, 13]].map(([x, y, r]) => (
          <g key={x}><rect x={x - 2} y={y} width="4" height="12" rx="2" fill="#6E8F45" /><circle cx={x} cy={y - r + 4} r={r} fill="#6FB33A" /><circle cx={x - r / 3} cy={y - r} r={r / 2.6} fill="#8CCB55" /></g>
        ))}
      </g>
      <path d={ROUTE} fill="none" stroke="#FFFFFF" strokeWidth="4" strokeDasharray="1 9" strokeLinecap="round" />
      <g className="ls-pin" transform="translate(360 132)">
        <circle className="ls-pulse" r="9" fill="none" stroke="#2F6512" strokeWidth="2" />
        <g className="ls-bounce">
          <path d="M0 0 C -9 -10, -9 -22, 0 -24 C 9 -22, 9 -10, 0 0 Z" fill="#2F6512" />
          <circle cy="-16" r="3.6" fill="#FFFFFF" />
        </g>
      </g>
      <circle r="6" cx={reduced ? 360 : 0} cy={reduced ? 132 : 0} fill="#FFFFFF" stroke="#2F6512" strokeWidth="2.5">
        {!reduced && <animateMotion dur="5s" repeatCount="indefinite" path={ROUTE} keyPoints="0;1;1" keyTimes="0;.8;1" calcMode="linear" />}
      </circle>
      <path d="M0 226 C 60 214, 120 236, 196 226 S 330 214, 390 226 V250 H0 Z" fill="#E9F6D6" />
    </svg>
  );
}
