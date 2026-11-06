// Guide a runner to the START of an existing saved course.
// Kakao Maps provides walking directions; Less GO only begins tracking after live GPS validation.
// 화면(디자인): 위 = 뒤로 + "출발지로 이동 중" + 모드 알약(달리기/걷기)
//   지도 = 내 위치(파란 점) → 출발지(깃발) 파란 점선, 출발지 둘레 150m 원
//   시트 = "{출발지}까지" 남은 m · 걸어서 약 N분(80m/분) · 진행 바 · GPS 알약 · 코스 요약 · 카카오맵 길안내 · 시작 버튼
// GPS 판단(150m · 정확도 60m)과 시작(startSavedCourse)은 그대로예요. move는 코스 고르기의 pick.move를 써요.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { MapView, Route, FitBounds, HereDot, StartFlag, RangeCircle } from "../components/MapView.jsx";
import { distance } from "../lib/geo.js";
import { loc, t } from "../lib/i18n.js";
import { startSavedCourse } from "../lib/startSavedCourse.js";
import { minutesFor, durText } from "../lib/routes.js";

const START_RADIUS_M = 150;
const MAX_ACCURACY_M = 60;
const WALK_M_PER_MIN = 80; // 출발지까지 "걸어서 약 N분"

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

  const move = app.pick?.move === "walk" ? "walk" : "run";
  // 진행 바: 처음 잰(가장 먼) 거리를 기준으로 얼마나 가까워졌는지
  const farthest = useRef(0);
  if (meters != null && meters > farthest.current) farthest.current = meters;
  const progress = meters == null || !farthest.current ? 0 : ready ? 1 : Math.max(0, Math.min(1, 1 - meters / farthest.current));

  if (!course || !start) return (
    <section className="screen to-start-screen">
      <div className="to-start-panel">
        <h2>코스를 찾을 수 없어요.</h2>
        <button className="btn btn-soft" onClick={() => app.go("courses")}>코스 선택으로 돌아가기</button>
      </div>
    </section>
  );

  const p = course.properties;
  const left = meters == null ? null : Math.max(0, Math.round(meters));
  const gpsTone = !position ? "wait" : accurate ? "good" : "low";
  const gpsText = !position ? t("gps_checking") : t(accurate ? "gps_good" : "gps_low", { m: Math.round(position.accuracy) });
  const summary = `${loc(p.title || p.name)} · ${loc(p.modeName)} · ${t("about_dur", { d: durText(minutesFor(p.distance_km, move)) })}`;

  return (
    <section className="screen to-start-screen">
      <MapView className="to-start-map" center={[start.lat, start.lng]} zoom={15}>
        <Route path={course.path} color="#2F6512" weight={5} opacity={0.45} />
        <RangeCircle at={[start.lat, start.lng]} radius={START_RADIUS_M} />
        {position && !near && <Route path={[position, start]} color="#3B82C4" weight={4} opacity={0.95} dashed />}
        <StartFlag at={[start.lat, start.lng]} label={t("start_flag")} />
        {position && <HereDot at={[position.lat, position.lng]} />}
        <FitBounds
          points={position ? [[position.lat, position.lng], [start.lat, start.lng]] : [[start.lat, start.lng]]}
          fitKey={position ? `${Math.round(position.lat*1000)}-${Math.round(position.lng*1000)}` : "start"}
          padTL={[40, 90]} padBR={[40, 130]}
        />
      </MapView>
      <div className="to-start-top">
        <button type="button" className="round-btn glass" onClick={() => app.go("courses")} aria-label={t("back_courses")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <strong className="glass ts-title">{t("to_start_title")}</strong>
        <span className={`ts-mode ${move}`}>{t(move === "walk" ? "move_walk" : "move_run")}</span>
      </div>
      <div className="to-start-panel hanji-sheet">
        <div className="ts-head" role="status">
          <small>{ready ? t("to_start_arrived") : t("to_start_until", { name: startName })}</small>
          <div className="ts-big">{left == null ? "—" : left >= 1000 ? (left / 1000).toFixed(2) : left}<em>{left != null && left >= 1000 ? "km" : "m"}</em></div>
          <span className="ts-walk">{left == null ? t("gps_checking") : t("walk_about", { n: Math.max(1, Math.ceil(left / WALK_M_PER_MIN)) })}</span>
          <span className="ts-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={t("to_start_title")}><i style={{ width: `${progress * 100}%` }} /></span>
        </div>
        <div className="ts-pills">
          <span className={`ts-gps ${gpsTone}`}><i aria-hidden="true" />{gpsText}</span>
          <span className="ts-course">{summary}</span>
        </div>
        {error && <p className="to-start-error" role="alert">{error}</p>}
        <button type="button" className="btn soft ts-kakao" onClick={openDirections} disabled={!directionUrl}>{t("open_kakao_nav")}</button>
        <p className="ts-note">{t("to_start_note")}</p>
        {opening && <p className="to-start-hint">{t("kakao_return_hint")}</p>}
        <button type="button" className="to-start-refresh" onClick={retry}>{t("gps_recheck")}</button>
        <button type="button" className="btn btn-cta ts-start" onClick={run} disabled={!ready}>
          {ready ? t(move === "walk" ? "start_walk" : "start_run") : t("start_locked")}
        </button>
      </div>
    </section>
  );
}
