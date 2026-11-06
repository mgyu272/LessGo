import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { loc } from "../lib/i18n.js";
import { shopsNear } from "../components/NearbyShops.jsx";
import { ShopPhoto, catLabel } from "./Market.jsx";

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
  const back = () => { stop(); setSelected(null); setResult(""); setError(""); };
  const done = result === "success";
  return <section className="reward-content">
    {selected ? <>
      <button type="button" className="rw-back" onClick={back}>← 가게 목록</button>
      {/* 가게 사진을 배경으로 한 머리 카드 */}
      <div className="rw-hero" style={selected.image ? { backgroundImage: `url("${selected.image}")` } : undefined}>
        <div className="rw-hero-shade">
          <small>{[catLabel(selected), selected.address].filter(Boolean).join(" · ")}</small>
          <h3>{loc(selected.name)}</h3>
        </div>
      </div>
      {/* 쿠폰: 눈에 띄는 노란 쿠폰권 */}
      <div className={`rw-coupon ${done ? "done" : ""}`} role="status" aria-live="polite">
        <span className="rw-coupon-amt"><b>500</b>원</span>
        <span className="rw-coupon-text">
          <b>{done ? "할인쿠폰이 발급되었어요!" : "할인쿠폰"}</b>
          <small>{done ? "QR 스캔 완료 · 계산할 때 보여 주세요" : "매장 QR을 인식하면 바로 발급돼요"}</small>
        </span>
      </div>
      <div className="reward-camera">
        <video ref={videoRef} muted playsInline aria-label="매장 QR 스캔 카메라" />
        {!cameraReady && <span>{scanning ? "카메라 연결 중…" : "카메라 대기 중"}</span>}
      </div>
      {error && <p className="reward-error" role="alert">{error}</p>}

      {!scanning && <button className="btn btn-teal" onClick={() => { setResult(""); setError(""); setScanning(true); }}>QR 스캔 카메라 켜기</button>}

    </> : <>
      <h3>주변 제휴 가게</h3>
      <p className="muted">가게를 선택하고 매장 QR을 스캔해 보세요.</p>
      <div className="reward-store-list">{near.map(({ s, d }) => (
        <button type="button" className="card mk-card rw-store" key={s.id} onClick={() => { setSelected(s); setError(""); setResult(""); setCameraReady(false); }}>
          <span className="mk-main">
            <ShopPhoto shop={s} />
            <span className="mk-text">
              <b>{loc(s.name)}</b>
              <small>{[catLabel(s), `약 ${d}m`].filter(Boolean).join(" · ")}</small>
              {s.address && <span className="mk-addr">{s.address}</span>}
            </span>
          </span>
          <span className="rw-qr" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 14h2v2h-2z M14 18h2v2h-2z M18 18h2v2h-2z" /></svg>
            <small>QR</small>
          </span>
        </button>
      ))}</div>
      {!near.length && <p className="muted">이 장소 주변에 등록된 가게가 없습니다.</p>}
    </>}
  </section>;
}
