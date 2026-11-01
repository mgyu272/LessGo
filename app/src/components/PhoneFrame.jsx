// 아이폰 16 프레임 (화면 393 × 852pt, 다이내믹 아일랜드, 위 59pt · 아래 34pt 안전 여백)
//
// - PC 브라우저: 아이폰 16 모양 틀 안에 앱을 보여줘요 (발표 화면·캡처용)
// - 실제 휴대폰: 틀 없이 꽉 차게, 노치·홈 바 여백(safe area)만 지켜요
// 주소 끝에 ?frame=off 를 붙이면 PC에서도 틀 없이 볼 수 있어요.

import { useEffect, useState } from "react";

export const IPHONE16 = { w: 393, h: 852 };

function useFramed() {
  const query = "(min-width: 600px) and (hover: hover)";
  const off = new URLSearchParams(location.search).get("frame") === "off";
  const [framed, setFramed] = useState(() => !off && window.matchMedia(query).matches);
  useEffect(() => {
    if (off) return;
    const mq = window.matchMedia(query);
    const on = () => setFramed(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [off]);
  return framed;
}

function useScale(framed) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!framed) return setScale(1);
    const fit = () => setScale(Math.min(1, (window.innerHeight - 48) / (IPHONE16.h + 28), (window.innerWidth - 48) / (IPHONE16.w + 28)));
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [framed]);
  return scale;
}

export function PhoneFrame({ dark, children }) {
  const framed = useFramed();
  const scale = useScale(framed);
  if (!framed) return <div className="phone bare">{children}</div>;
  return (
    <div className="stage">
      <div className="phone framed" style={{ transform: `scale(${scale})` }}>
        <div className={`statusbar ${dark ? "on-dark" : ""}`}>
          <span className="clock">9:41</span>
          <span className="icons">
            <svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
            <svg viewBox="0 0 16 12" width="16" height="12"><path d="M8 11.5l2.4-2.6a3.4 3.4 0 00-4.8 0z M8 5.6a6.4 6.4 0 014.5 1.9l1.5-1.6A8.6 8.6 0 008 3.4a8.6 8.6 0 00-6 2.5l1.5 1.6A6.4 6.4 0 018 5.6z M8 0a12 12 0 018.4 3.5L15 5a10 10 0 00-14 0L-.4 3.5A12 12 0 018 0z" /></svg>
            <span className="battery"><i /></span>
          </span>
        </div>
        <div className="island" />
        {children}
        <div className={`home-indicator ${dark ? "on-dark" : ""}`} />
      </div>
    </div>
  );
}
