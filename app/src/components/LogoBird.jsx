// LessGo 로고: 성북구 윤곽을 딴 새 모양. 몸 위로 흰 러닝 경로가 지나가고, 오른쪽 끝에 도착점(흰 고리)이 있어요.
// - <LogoBird />                : 기본 로고 (연두 몸 + 흰 경로)
// - <LogoBird variant="icon" /> : 앱 아이콘 (연두 둥근 사각형 안에 크림색 실루엣 + 초록 경로)
// - flap                        : 양쪽 날개를 0.9초마다 펄럭여요 (로딩 화면). 움직임 줄이기 설정이면 멈춰요.

import { useEffect, useState } from "react";
import { Wordmark } from "./Wordmark.jsx";

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
const toPath = (pts) => "M" + pts.map(([x, y]) => `${x} ${y}`).join(" L") + " Z";
export const BODY_UP = toPath(OUTLINE);
// 날개를 내린 모양: 디자인 캔버스(로딩 화면) 원본 값 그대로. 꼭짓점 60개라 BODY_UP과 짝이 맞아요
export const BODY_DOWN = "M20 228 L56 222 L90 218 L118 216 L150 214 L185 214 L215 214 L250 214 L275 216 L296 218 L330 206 L372 204 L404 214 L416 236 L440 226 L470 206 L488 222 L506 226 L526 232 L544 236 L560 242 L572 238 L584 232 L596 222 L606 210 L632 186 L664 182 L676 196 L672 222 L650 252 L620 270 L600 300 L566 304 L530 300 L500 312 L474 330 L456 362 L440 396 L418 428 L384 452 L356 470 L330 488 L318 500 L304 478 L276 462 L246 446 L232 424 L216 400 L190 384 L150 370 L110 350 L64 340 L46 324 L52 298 L84 284 L112 276 L104 260 L80 250 L54 244 L30 238 Z";
export const ROUTE = "M96 330 C 200 318, 270 312, 340 286 C 420 256, 470 250, 540 236 C 590 226, 615 214, 636 206";
export const END = [636, 206];
// 날갯짓: 펼침 → 내림 → 펼침, 0.9초 (디자인 값)
export const FLAP = { dur: "0.9s", keyTimes: "0;.4;1", keySplines: ".45 0 .55 1;.45 0 .55 1", values: `${BODY_UP};${BODY_DOWN};${BODY_UP}` };

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
        <animate attributeName="d" dur={FLAP.dur} repeatCount="indefinite" calcMode="spline"
          keyTimes={FLAP.keyTimes} keySplines={FLAP.keySplines} values={FLAP.values} />
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
export function Brand({ size = 34, subtitle = true, name = "LessGo", className = "" }) {
  // "성북런"은 글꼴 대신 글자 패스 SVG(Wordmark)로 그려서, 첫 화면부터 최종 글씨체 그대로 보여요 (글꼴 바뀜 깜빡임 없음)
  if (name === "성북런") {
    return (
      <span className={`brand ${className}`} role="img" aria-label="성북런">
        <LogoBird variant="icon" size={size} />
        <span className="brand-name"><b className="brand-wordmark"><Wordmark /></b>{subtitle && <small>RUN · SEONGBUK</small>}</span>
      </span>
    );
  }
  return (
    <span className={`brand ${className}`}>
      <LogoBird variant="icon" size={size} />
      <span className="brand-name"><b>{name}</b>{subtitle && <small>RUN · SEONGBUK</small>}</span>
    </span>
  );
}
