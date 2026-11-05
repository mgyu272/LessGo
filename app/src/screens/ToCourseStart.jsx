// Guide a runner to the START of an existing saved course.
// Kakao Maps provides walking directions; Less GO only begins tracking after live GPS validation.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { MapView, Route, Dot, Me, FitBounds } from "../components/MapView.jsx";
import { distance } from "../lib/geo.js";
import { loc, t } from "../lib/i18n.js";
import { startSavedCourse, planStart, fmtM } from "../lib/startSavedCourse.js";

const MAX_ACCURACY_M = 100;

function useStartLocation(enabled) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setError("GPS를 사용할 수 없어요. HTTPS와 위치 권한을 확인해 주세요.");
      return;
    }
    setError("");
    const id = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return;
        setPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, timestamp });
        setError("");
      },
      (e) => setError(e.code === 1 ? "위치 권한이 거부됐어요. 휴대폰 설정에서 허용해 주세요."
        : e.code === 3 ? "GPS 신호를 기다리고 있어요. 실외에서 다시 시도해 주세요."
        : "GPS 위치를 가져오지 못했어요."),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, attempt]);

  return { position, error, retry: () => setAttempt((n) => n + 1) };
}

export default function ToCourseStart() {
  const app = useApp();
  const course = app.course;
  const { position, error, retry } = useStartLocation(Boolean(course));
  const [opening, setOpening] = useState(false);

  const start = course?.path?.[0];
  const namedStart = course?.properties?.route?.start?.name;
  const startName = namedStart && !namedStart.startsWith("OSM ") ? namedStart : "선택한 러닝 코스 출발지";
  const meters = position && start ? distance(position, start) : null;
  const accurate = !!position && Number.isFinite(position.accuracy) && position.accuracy <= MAX_ACCURACY_M;
  // 거리가 멀어도 막지 않아요. 지금 위치에 따라 시작 방식만 달라져요
  const plan = position && start ? planStart(course, position) : null;
  const ready = accurate && !!plan;
  const [starting, setStarting] = useState(false);
  // 미리보기: 내 위치에서 출발하는 코스 (걷는 길은 시작 버튼을 누를 때 받아요. 여기서는 직선으로 보여줘요)
  const joinAt = plan ? course.path[plan.joinIndex] : null;
  const restPath = plan ? course.path.slice(plan.joinIndex) : course?.path || [];
  const previewLen = plan ? plan.joinM + lenOf(restPath) : null;

  const directionUrl = useMemo(() => {
    if (!position || !start) return null;
    const from = `현재 위치,${position.lat},${position.lng}`;
    const to = `${encodeURIComponent(startName)},${start.lat},${start.lng}`;
    return `https://map.kakao.com/link/by/walk/${from}/${to}`;
  }, [position?.lat, position?.lng, start?.lat, start?.lng, startName]);

  const openDirections = () => {
    if (!directionUrl) return;
    // Open new tab to preserve the runner's Less GO session.
    window.open(directionUrl, "_blank", "noopener,noreferrer");
    setOpening(true);
  };

  const run = async () => {
    if (!ready || !course) return;
    setStarting(true);
    await startSavedCourse(app, course, position);
    setStarting(false);
  };

  if (!course || !start) return (
    <section className="screen to-start-screen">
      <div className="to-start-panel">
        <h2>코스를 찾을 수 없어요.</h2>
        <button className="btn btn-soft" onClick={() => app.go("courses")}>코스 선택으로 돌아가기</button>
      </div>
    </section>
  );

  return (
    <section className="screen to-start-screen">
      <MapView className="to-start-map" center={[start.lat, start.lng]} zoom={15}>
        <Route path={plan ? restPath : course.path} color="#2F6512" weight={5} opacity={0.75} />
        {plan?.mode === "connect" && <Route path={[position, joinAt]} color="#E38B2C" weight={4} opacity={0.9} dashed />}
        {!position && <Dot at={[start.lat, start.lng]} color="#E38B2C" radius={10} />}
        {position && <Me at={[position.lat, position.lng]} />}
        <FitBounds
          points={position ? [[position.lat, position.lng], ...restPath.map((q) => [q.lat, q.lng])] : [[start.lat, start.lng]]}
          fitKey={position ? `${Math.round(position.lat*1000)}-${Math.round(position.lng*1000)}` : "start"}
          padTL={[22, 90]} padBR={[22, 270]}
        />
      </MapView>
      <div className="to-start-top">
        <button type="button" className="round-btn glass" onClick={() => app.go("courses")} aria-label="코스 화면으로">←</button>
        <strong className="glass">GPS 러닝 준비</strong>
      </div>
      <div className="to-start-panel hanji-sheet">
        <h2>지금 위치에서 시작해요</h2>
        <p className="to-start-course">{loc(course.properties.name)}</p>
        <div className="to-start-destination">
          <span>코스 출발점</span>
          <strong>{position ? "📍 지금 내 위치" : startName}</strong>
          <small>저장된 코스의 첫 좌표를 기준으로 안내해요.</small>
        </div>
        <div className="to-start-metrics">
          <div>
            <small>예상 코스 길이</small>
            <strong>{previewLen == null ? "측정 중" : fmtM(previewLen)}</strong>
          </div>
          <div>
            <small>GPS 예상 오차</small>
            <strong>{position ? `±${Math.round(position.accuracy)} m` : "측정 중"}</strong>
          </div>
        </div>
        <p className="to-start-status" role="status">
          {!position ? "GPS 위치를 확인하고 있어요."
            : !accurate ? "GPS 신호가 부정확해요. 실외에서 위치를 다시 확인해 주세요."
            : plan.mode === "start" ? "원래 출발점 근처예요. 코스 그대로 시작해요."
            : `지금 위치에서 출발해요. 주황 점선(${fmtM(plan.joinM)})을 따라 코스에 합류해요.`}
        </p>
        {error && <p className="to-start-error" role="alert">{error}</p>}
        <div className="to-start-actions">
          <button type="button" className="btn btn-soft" onClick={openDirections} disabled={!directionUrl}>카카오맵 도보 길찾기</button>
          <button type="button" className="btn btn-cta" onClick={run} disabled={!ready || starting}>{starting ? "코스 만드는 중…" : "여기서 런닝 시작"}</button>
        </div>
        <button type="button" className="to-start-refresh" onClick={retry}>GPS 다시 확인</button>
        {opening && <p className="to-start-hint">길찾기 후 Less GO로 돌아오세요. 현재 위치를 확인해 러닝 시작 버튼이 활성화됩니다.</p>}
        <small className="to-start-hint">GPS 오차 100m 이내면 어디서든 시작할 수 있어요. 실제 출입구와 보행 가능 여부는 현장에서 확인하세요.</small>
      </div>
    </section>
  );
}

function lenOf(path) {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += distance(path[i - 1], path[i]);
  return m;
}
