import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { loc } from "../lib/i18n.js";
import { shopsNear } from "../components/NearbyShops.jsx";

// Hackathon demonstration only. No real store has agreed to this offer.
export const DEMO_STORE = { id: "lessgo-demo-cafe", name: "Less GO 시연 카페", discount: 1000 };
export const DEMO_QR = "LESSGO:lessgo-demo-cafe";

export function RewardShop() {
  const app = useApp();
  const [page, setPage] = useState("list");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const video = useRef(null);
  const stream = useRef(null);
  const [cameraVersion, setCameraVersion] = useState(0);
  const near = shopsNear(app.spot, app.data.shops).slice(0, 4);
  const stop = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setScanning(false); };
  useEffect(() => () => { stream.current?.getTracks().forEach(t => t.stop()); }, []);
  useEffect(() => {
    if (!scanning || page !== "scan") return;
    let alive = true, raf = 0;
    const start = async () => {
      try {
        if (!("BarcodeDetector" in window)) { setError("이 브라우저는 QR 카메라 인식을 지원하지 않습니다. Chrome 또는 Android 기기에서 시도해 주세요."); setScanning(false); return; }
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!alive) { media.getTracks().forEach(t => t.stop()); return; }
        stream.current = media;
        if (video.current) { video.current.srcObject = media; await video.current.play(); }
        const tick = async () => {
          if (!alive) return;
          try {
            const codes = video.current?.readyState >= 2 ? await detector.detect(video.current) : [];
            if (codes.length) {
              if (codes.some(c => c.rawValue === DEMO_QR)) { stop(); setPage("coupon"); return; }
              setError("Less GO 시연 매장의 QR코드가 아닙니다.");
            }
          } catch { /* camera frame not ready */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { setError("카메라를 사용할 수 없습니다. 카메라 권한과 HTTPS 연결을 확인해 주세요."); setScanning(false); }
    };
    start();
    return () => { alive = false; cancelAnimationFrame(raf); stop(); };
  }, [scanning, page, cameraVersion]);
  const back = () => { stop(); setError(""); setPage(page === "coupon" || page === "scan" ? "detail" : "list"); };
  return <div className="reward-content">
    {page !== "list" && <button type="button" className="link" onClick={back}>← 뒤로</button>}
    {page === "list" && <>
      <h3>주변 가게</h3>
      <p className="muted">근처 가게를 확인하고, 시연 제휴 매장에서 QR 할인 혜택을 체험해 보세요.</p>
      <button className="reward-store" onClick={() => setPage("detail")}><span>☕</span><span><b>{DEMO_STORE.name}</b><small>가상 제휴 매장 · 1,000원 할인</small></span><span>›</span></button>
      <h4>주변 실제 가게 · 제휴 아님</h4>
      {near.map(({s,d}) => <a className="reward-store" key={s.id} href={s.kakao_url} target="_blank" rel="noopener noreferrer"><span>⌖</span><span><b>{loc(s.name)}</b><small>약 {d}m · 카카오맵에서 보기</small></span><span>↗</span></a>)}
    </>}
    {page === "detail" && <>
      <div className="reward-card"><span className="reward-icon">☕</span><h3>{DEMO_STORE.name}</h3><p>완주자 대상 시연 혜택</p><strong>1,000원 할인</strong><small>실제 제휴·결제 할인은 제공되지 않습니다.</small></div>
      <p>매장에 비치된 Less GO QR코드를 앱으로 스캔하면 할인쿠폰 화면으로 이동해요.</p>
      <button className="btn btn-teal" onClick={() => {setError("");setPage("scan");}}>매장 QR 스캔하기</button>
    </>}
    {page === "scan" && <>
      <h3>매장 QR 스캔</h3><p>Less GO 시연 QR코드를 카메라에 비춰 주세요.</p>
      <div className="reward-camera"><video ref={video} muted playsInline aria-label="QR 코드 카메라 미리보기" />{!scanning && <span>QR 카메라 대기 중</span>}</div>
      {error && <p role="alert" className="reward-error">{error}</p>}
      <button className="btn btn-teal" onClick={() => {stop();setError("");setCameraVersion(n=>n+1);setScanning(true);}}>카메라 켜기</button>
      {app.demo && <button className="btn btn-outline" onClick={() => {stop();setPage("coupon");}}>시연 모드: QR 인식 성공</button>}
    </>}
    {page === "coupon" && <div className="reward-card"><span className="reward-icon">✓</span><h3>QR 인식 완료!</h3><p>{DEMO_STORE.name}</p><strong>1,000원 할인</strong><p>러닝 도착 보상 · 시연용 쿠폰</p><small>실제 매장에서 사용할 수 없는 데모 화면입니다.</small><button className="btn btn-outline" onClick={() => {setPage("list");setError("");}}>가게 목록으로</button></div>}
  </div>;
}
