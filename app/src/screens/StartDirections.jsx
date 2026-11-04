// Directions to the selected saved course's START (not its historical destination).
// Kakao Maps handles pedestrian navigation; Less GO only checks GPS proximity
// after the user returns and starts the actual run upon an explicit tap.
import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { MapView, Dot, Me, FitBounds } from "../components/MapView.jsx";
import { distance } from "../lib/geo.js";
import { t, loc } from "../lib/i18n.js";

const START_RADIUS_M = 150;
const MAX_START_ACCURACY_M = 60;
const POSITION_MAX_AGE_MS = 15000;

function kakaoWalkUrl(start, name, current, fresh) {
  const target = `${encodeURIComponent(name)},${start.lat},${start.lng}`;
  if (!current || !fresh || current.accuracy > 150) {
    // Kakao Maps lets the user choose their location when browser GPS is unavailable.
    return `https://map.kakao.com/link/to/${target}`;
  }
  const origin = `${encodeURIComponent("내 위치")},${current.lat},${current.lng}`;
  return `https://map.kakao.com/link/by/walk/${origin}/${target}`;
}

export default function StartDirections() {
  const app = useApp();
  const course = app.course;
  const start = course?.path?.[0];
  const startName = course?.properties?.route?.start?.name || t("start_point");
  const destinationName = loc(app.data?.spotById?.[course?.properties?.dest]?.name);
  const [gps, setGps] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!course || !start) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    if (!window.isSecureContext || !navigator.geolocation) {
      setError(t("start_nav_no_gps"));
      return () => clearInterval(clock);
    }
    let alive = true;
    const onSuccess = (p) => {
      if (!alive) return;
      const c = p.coords;
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
      setGps({ lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, timestamp: p.timestamp });
      setError("");
    };
    const onError = (e) => {
      if (!alive) return;
      setError(e.code === 1 ? t("start_nav_denied") : t("start_nav_gps_wait"));
    };
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
    const id = navigator.geolocation.watchPosition(onSuccess, onError, options);
    const whenVisible = () => {
      if (document.visibilityState === "visible") {
        navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
      }
    };
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      alive = false;
      navigator.geolocation.clearWatch(id);
      document.removeEventListener("visibilitychange", whenVisible);
      clearInterval(clock);
    };
  }, [course?.id]);

  if (!course || !start) {
    return (
      <section className="screen start-nav-screen">
        <div className="start-nav-panel">
          <h2>{t("start_nav_missing")}</h2>
          <button className="btn btn-cta" onClick={() => app.go("courses")}>{t("pick_course")}</button>
        </div>
      </section>
    );
  }

  const fresh = !!gps && now - gps.timestamp <= POSITION_MAX_AGE_MS;
  const fromStart = gps ? Math.round(distance(gps, start)) : null;
  const goodAccuracy = fresh && gps.accuracy <= MAX_START_ACCURACY_M;
  const arrived = goodAccuracy && fromStart <= START_RADIUS_M;
  const mapUrl = kakaoWalkUrl(start, startName, gps, fresh);

  const startRun = () => {
    if (!arrived) return;
    // Explicit start after a recent, good-quality browser GPS measurement.
    app.run.start(course, { demo: false, speedup: 1 });
  };

  return (
    <section className="screen start-nav-screen">
      <MapView className="start-nav-map" center={[start.lat, start.lng]} zoom={14}>
        <Dot at={[start.lat, start.lng]} color="#2F6512" radius={10} />
        {gps && <Me at={[gps.lat, gps.lng]} />}
        <FitBounds
          points={gps ? [[start.lat, start.lng], [gps.lat, gps.lng]] : [[start.lat, start.lng]]}
          padTL={[20, 95]} padBR={[20, 310]}
          fitKey={course.id + (gps ? "-located" : "-unlocated")}
        />
      </MapView>

      <div className="start-nav-top">
        <button className="round-btn glass" onClick={() => app.go("courses")} aria-label={t("back")}>←</button>
        <span className="glass start-nav-title">{t("start_nav_title")}</span>
      </div>

      <div className="start-nav-panel hanji-sheet">
        <div className="start-nav-route">
          <div className="start-nav-step">
            <span className="start-nav-step-dot" />
            <div><small>{t("start_nav_from")}</small><b>{t("start_nav_current")}</b></div>
          </div>
          <div className="start-nav-step">
            <span className="start-nav-step-dot is-target" />
            <div><small>{t("start_nav_to")}</small><b>{startName}</b></div>
          </div>
        </div>
        <p className="start-nav-sub">{t("start_nav_course", { name: destinationName, km: course.properties.distance_km })}</p>

        <div className="start-nav-status" role="status">
          {gps && fresh ? (
            <>
              <b>{t("start_nav_straight", { m: fromStart.toLocaleString() })}</b>
              <small>{t("start_nav_accuracy", { m: Math.round(gps.accuracy) })}</small>
            </>
          ) : (
            <>
              <b>{t("start_nav_locating")}</b>
              <small>{error || t("start_nav_gps_wait")}</small>
            </>
          )}
        </div>

        <a className="btn btn-soft start-nav-walk" href={mapUrl} target="_blank" rel="noopener noreferrer">
          {t("start_nav_kakao")}
          <span aria-hidden="true">↗</span>
        </a>
        <p className="start-nav-help">{gps && fresh && gps.accuracy > 150 ? t("start_nav_low_quality") : t("start_nav_walk_hint")}</p>

        {arrived ? (
          <p className="start-nav-arrival" role="status">{t("start_nav_arrived")}</p>
        ) : (
          <p className="start-nav-wait">{goodAccuracy ? t("start_nav_far", { m: fromStart.toLocaleString() }) : t("start_nav_wait_accurate")}</p>
        )}
        <button className="btn btn-cta start-nav-run" onClick={startRun} disabled={!arrived}>
          {t("gps_start")}
        </button>
        <p className="start-nav-safety">{t("start_nav_safety")}</p>
      </div>
    </section>
  );
}
