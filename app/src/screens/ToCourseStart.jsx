// Guide a runner to the START of an existing saved course.
// Kakao Maps provides walking directions; Less GO only begins tracking after live GPS validation.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { MapView, Route, Dot, Me, FitBounds } from "../components/MapView.jsx";
import { distance } from "../lib/geo.js";
import { loc, t } from "../lib/i18n.js";
import { startSavedCourse } from "../lib/startSavedCourse.js";

const START_RADIUS_M = 150;
const MAX_ACCURACY_M = 60;

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
  const near = meters != null && meters <= START_RADIUS_M;
  const ready = accurate && near;

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
    await startSavedCourse(app, course);
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
        <Route path={course.path} color="#2F6512" weight={5} opacity={0.7} />
        <Dot at={[start.lat, start.lng]} color="#E38B2C" radius={10} />
        {position && <Me at={[position.lat, position.lng]} />}
        <FitBounds
          points={position ? [[position.lat, position.lng], [start.lat, start.lng]] : [[start.lat, start.lng]]}
          fitKey={position ? `${Math.round(position.lat*1000)}-${Math.round(position.lng*1000)}` : "start"}
          padTL={[22, 90]} padBR={[22, 270]}
        />
      </MapView>
      <div className="to-start-top">
        <button type="button" className="round-btn glass" onClick={() => app.go("courses")} aria-label="코스 화면으로">←</button>
        <strong className="glass">출발지까지 길찾기</strong>
      </div>
      <div className="to-start-panel hanji-sheet">
        <h2>먼저 출발지로 이동해요</h2>
        <p className="to-start-course">{loc(course.properties.name)}</p>
        <div className="to-start-destination">
          <span>출발 위치</span>
          <strong>{startName}</strong>
          <small>저장된 코스의 첫 좌표를 기준으로 안내해요.</small>
        </div>
        <div className="to-start-metrics">
          <div>
            <small>출발지까지 직선거리</small>
            <strong>{meters == null ? "측정 중" : meters >= 1000 ? `${(meters/1000).toFixed(2)} km` : `${Math.round(meters)} m`}</strong>
          </div>
          <div>
            <small>GPS 예상 오차</small>
            <strong>{position ? `±${Math.round(position.accuracy)} m` : "측정 중"}</strong>
          </div>
        </div>
        <p className="to-start-status" role="status">
          {ready ? "출발지 근처에 도착했어요. GPS 러닝을 시작할 수 있어요."
            : !position ? "GPS 위치를 확인하고 있어요."
            : !accurate ? "GPS 신호가 부정확해요. 실외에서 위치를 다시 확인해 주세요."
            : `출발지에서 ${Math.round(meters)}m 떨어져 있어요. 카카오맵 도보 길찾기를 이용해 주세요.`}
        </p>
        {error && <p className="to-start-error" role="alert">{error}</p>}
        <div className="to-start-actions">
          <button type="button" className="btn btn-soft" onClick={openDirections} disabled={!directionUrl}>카카오맵 도보 길찾기</button>
          <button type="button" className="btn btn-cta" onClick={run} disabled={!ready}>런닝 시작</button>
        </div>
        <button type="button" className="to-start-refresh" onClick={retry}>GPS 다시 확인</button>
        {opening && <p className="to-start-hint">길찾기 후 Less GO로 돌아오세요. 현재 위치를 확인해 러닝 시작 버튼이 활성화됩니다.</p>}
        <small className="to-start-hint">150m 이내 · GPS 오차 60m 이내일 때 시작할 수 있어요. 실제 출입구와 보행 가능 여부는 현장에서 확인하세요.</small>
      </div>
    </section>
  );
}
