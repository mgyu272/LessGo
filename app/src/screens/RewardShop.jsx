import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { loc } from "../lib/i18n.js";
import { shopsNear, shopKind } from "../components/NearbyShops.jsx";

// Camera scanner only. Store QR enrollment and actual discounts require a partner agreement.
export function RewardShop({ spot }) {
  const app = useApp();
  const [selected, setSelected] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const near = shopsNear(spot || app.spot, app.data.shops).slice(0, 4);
  const stop = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; setScanning(false); setCameraReady(false); };
  useEffect(() => () => streamRef.current?.getTracks().forEach(t => t.stop()), []);
  useEffect(() => {
    if (!scanning || !selected) return;
    let alive = true, frame = 0;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error("HTTPS와 카메라 권한이 필요합니다.");
        const detector = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setCameraReady(true); }
        if (!detector) { setError("카메라가 켜졌습니다. 이 브라우저는 자동 QR 인식을 지원하지 않습니다."); return; }
        const tick = async () => {
          if (!alive) return;
          try {
            if (videoRef.current?.readyState >= 2) {
              const codes = await detector.detect(videoRef.current);
              if (codes.length) {
                const value = codes[0].rawValue;
                if (value === "LESSGO:STORE:" + selected.id) {
                  setResult("success");
                  return;
                }
                setError("선택한 매장의 Less GO QR이 아닙니다.");
              }
            }
          } catch { /* frame may be unavailable */ }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (e) { setError(e.message || "카메라를 열 수 없습니다."); setScanning(false); }
    })();
    return () => { alive = false; cancelAnimationFrame(frame); streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };
  }, [scanning, selected]);
  return <section className="reward-content">
    {selected ? <>
      <button type="button" className="link" onClick={() => { stop(); setSelected(null); setResult(""); setError(""); }}>← 가게 목록</button>
      <div className="reward-card">
        <h3>{loc(selected.name)}</h3>
        <p>{result === "success" ? "500원 할인쿠폰이 발급되었습니다!" : "QR을 인식하면 500원 할인쿠폰이 발급됩니다."}</p>
      </div>
      <div className="reward-camera">
        <video ref={videoRef} muted playsInline aria-label="매장 QR 스캔 카메라" />
        {!cameraReady && <span>{scanning ? "카메라 연결 중…" : "카메라 대기 중"}</span>}
      </div>
      <div className="reward-card" role="status" aria-live="polite">
        <h3>{result === "success" ? "✓ 500원 할인쿠폰이 발급되었습니다!" : "🎟 500원 할인쿠폰"}</h3>
        <p>{result === "success" ? "QR 스캔 완료" : "매장 QR을 인식하세요."}</p>
      </div>
      {error && <p className="reward-error" role="alert">{error}</p>}

      {!scanning && <button className="btn btn-teal" onClick={() => { setResult(""); setError(""); setScanning(true); }}>QR 스캔 카메라 켜기</button>}

    </> : <>
      <h3>주변 제휴 가게</h3>
      <p className="muted">가게를 선택하고 매장 QR을 스캔해 보세요.</p>
      <div className="reward-store-list">{near.map(({s,d}) => <button type="button" className="reward-store" key={s.id} onClick={() => { setSelected(s); setError(""); setResult(""); setCameraReady(false); }}>
        <span className="reward-store-icon">{shopKind(s.category) === "cafe" ? "☕" : "🍴"}</span><span className="reward-store-name"><b>{loc(s.name)}</b><small>약 {d}m</small></span><span className="reward-store-chevron">›</span>
      </button>)}</div>
      {!near.length && <p className="muted">이 장소 주변에 등록된 가게가 없습니다.</p>}
    </>}
  </section>;
}
