// LessGo 로고: 성북구 윤곽을 딴 새 모양. 몸 위로 흰 러닝 경로가 지나가고, 오른쪽 끝에 도착점(흰 고리)이 있어요.
// - <LogoBird />                : 기본 로고 (연두 몸 + 흰 경로)
// - <LogoBird variant="icon" /> : 앱 아이콘 (연두 둥근 사각형 안에 크림색 실루엣 + 초록 경로)
// - flap                        : 양쪽 날개를 0.9초마다 펄럭여요 (로딩 화면). 움직임 줄이기 설정이면 멈춰요.

import { useEffect, useState } from "react";

const VIEWBOX = "20 0 672 512";
// 성북구 윤곽 꼭짓점 (viewBox 20 0 672 512 기준)
const OUTLINE = [
  [36, 44], [70, 22], [98, 10], [118, 30], [150, 46], [185, 70], [215, 100], [250, 130], [275, 165], [296, 196],
  [330, 206], [372, 204], [404, 214], [416, 236], [440, 226], [470, 206], [488, 186], [500, 160], [520, 120], [532, 96],
  [540, 80], [558, 88], [572, 116], [590, 148], [606, 188], [632, 186], [664, 182], [676, 196], [672, 222], [650, 252],
  [620, 270], [600, 300], [566, 304], [530, 300], [500, 312], [474, 330], [456, 362], [440, 396], [418, 428], [384, 452],
  [356, 470], [330, 488], [318, 500], [304, 478], [276, 462], [246, 446], [232, 424], [216, 400], [190, 384], [150, 370],
  [110, 350], [64, 340], [46, 324], [52, 298], [84, 284], [112, 276], [104, 236], [96, 180], [84, 128], [66, 90],
];
// 날개를 내린 모양: 왼쪽 위 끝(1~3번)과 오른쪽 위 끝(18~21번) 꼭짓점을 아래로 내려요
const WING_DOWN = { 1: 30, 2: 40, 3: 26, 18: 22, 19: 34, 20: 42, 21: 30 };
const toPath = (pts) => "M" + pts.map(([x, y]) => `${x} ${y}`).join(" L") + " Z";
const BODY_UP = toPath(OUTLINE);
const BODY_DOWN = toPath(OUTLINE.map(([x, y], i) => [x, y + (WING_DOWN[i] || 0)]));
const ROUTE = "M96 330 C 200 318, 270 312, 340 286 C 420 256, 470 250, 540 236 C 590 226, 615 214, 636 206";
const END = [636, 206];

function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
export { useReducedMotion };

function Body({ fill, stroke, strokeWidth, flap }) {
  const reduced = useReducedMotion();
  return (
    <path d={BODY_UP} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      {flap && !reduced && (
        <animate attributeName="d" dur="0.9s" repeatCount="indefinite" calcMode="spline"
          keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" values={`${BODY_UP};${BODY_DOWN};${BODY_UP}`} />
      )}
    </path>
  );
}

export function LogoBird({ size = 40, variant = "mark", flap = false, fill, stroke, strokeWidth = 0, route, title, className = "" }) {
  const label = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  if (variant === "icon") {
    // 앱 아이콘: 64×64 기준 연두 둥근 사각형 (모서리 17)
    return (
      <svg className={`logo-bird icon ${className}`} width={size} height={size} viewBox="0 0 64 64" {...label}>
        <rect width="64" height="64" rx="17" fill="#7DBE45" />
        <svg x="7" y="11" width="50" height="42" viewBox={VIEWBOX}>
          <Body fill={fill || "#F3F0E4"} flap={flap} />
          <path d={ROUTE} fill="none" stroke={route || "#3F7F1C"} strokeWidth="26" strokeLinecap="round" />
          <circle cx={END[0]} cy={END[1]} r="22" fill="#F3F0E4" stroke={route || "#3F7F1C"} strokeWidth="12" />
        </svg>
      </svg>
    );
  }
  const h = Math.round((size * 512) / 672);
  return (
    <svg className={`logo-bird ${className}`} width={size} height={h} viewBox={VIEWBOX} {...label}>
      <Body fill={fill || "#5FA52A"} stroke={stroke} strokeWidth={strokeWidth} flap={flap} />
      <path d={ROUTE} fill="none" stroke={route || "#FFFFFF"} strokeWidth="22" strokeLinecap="round" />
      <circle cx={END[0]} cy={END[1]} r="20" fill={fill || "#5FA52A"} stroke={route || "#FFFFFF"} strokeWidth="11" />
    </svg>
  );
}

// 로고 + 이름 (로그인 화면 왼쪽 위 등)
export function Brand({ size = 34 }) {
  return (
    <span className="brand">
      <LogoBird variant="icon" size={size} />
      <span className="brand-name"><b>LessGo</b><small>RUN · SEONGBUK</small></span>
    </span>
  );
}
